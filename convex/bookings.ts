import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAgentThread } from "./agentAuth";
import { writeAudit } from "./audit";
import { requireRole, requireUser } from "./roles";
import { atLeast } from "../lib/auth/roles";
import {
  availabilitySchema, DEFAULT_BOOKING_RULES as RULES, localDateTimeSchema, type Availability, type BookingFacts,
} from "../lib/booking/schemas";
import {
  bookingState, canCancel, canConfirm, canRecordOutcome, checkBooking, customerRef, joinWindow, pausedUntil,
  releaseAt, shareWindow, shortName, shouldRelease, toInstant, toLocal, upcomingSlots,
} from "../lib/booking/rules";

/*
 * Booking a call with a specialist from the chat (console.html#calendar, the `.book` card in chat.html).
 * Only operators are bookable, and the call goes through information: never advice or a credit decision.
 * Demo: the video link is a public Jitsi room and nobody phones the customer; the screens say so.
 * Slots are computed from the operator's weekly hours, never sent by the client. Only the customer's own click books.
 */

const channel = v.union(v.literal("video"), v.literal("phone"));
const TOPIC_MAX = 120;
const REASON_MAX = 200;
const SLOTS_SHOWN = 6;

const operatorView = v.object({
  operatorId: v.string(), name: v.string(), title: v.string(), initials: v.string(), minutes: v.number(), timeZone: v.string(),
  slots: v.array(v.string()),
});
const customerBookingView = v.object({
  bookingId: v.string(), operatorName: v.string(), operatorTitle: v.string(), start: v.string(), minutes: v.number(), timeZone: v.string(),
  channel, topic: v.string(),
  state: v.union(v.literal("pending"), v.literal("booked"), v.literal("done"), v.literal("no_show"), v.literal("cancelled")),
  cancelledBy: v.union(v.null(), v.literal("customer"), v.literal("operator"), v.literal("not_confirmed")),
  cancelReason: v.union(v.null(), v.string()),
  confirmBy: v.number(), canConfirm: v.boolean(), canCancel: v.boolean(),
  /** In-app reminder to show, if any. */
  reminder: v.union(v.null(), v.literal("confirm"), v.literal("starts_soon")),
  joinFrom: v.number(), joinUrl: v.union(v.null(), v.string()),
  planId: v.union(v.null(), v.string()), sharePlan: v.boolean(),
});

const facts = (b: Doc<"bookings">): BookingFacts =>
  ({ operatorId: b.operatorId, start: b.start, minutes: b.minutes, status: b.status, confirmedAt: b.confirmedAt, outcomeAt: b.outcomeAt });
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function availabilityOf(ctx: Pick<QueryCtx, "db">, operatorId: string) {
  const row = await ctx.db.query("operatorAvailability").withIndex("by_operator", (q) => q.eq("operatorId", operatorId)).unique();
  if (!row || !row.active) return null;
  return { row, availability: availabilitySchema.parse(row.availability) };
}

async function operatorBookings(ctx: Pick<QueryCtx, "db">, operatorId: string, fromDate: string) {
  return ctx.db.query("bookings").withIndex("by_operator_start", (q) => q.eq("operatorId", operatorId).gte("start", fromDate)).collect();
}

async function ownBookings(ctx: Pick<QueryCtx, "db">, ownerKey: string) {
  return ctx.db.query("bookings").withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey)).order("desc").take(50);
}

async function event(ctx: Pick<MutationCtx, "db">, b: Doc<"bookings">, kind: Doc<"bookingEvents">["kind"], actor: Doc<"bookingEvents">["actor"]) {
  await ctx.db.insert("bookingEvents", { bookingId: b.bookingId, kind, actor, at: Date.now() });
}

function customerView(b: Doc<"bookings">, now: number) {
  const f = facts(b);
  const join = joinWindow(f, b.timeZone, RULES, now);
  const starts = toInstant(b.start, b.timeZone);
  const reminder = canConfirm(f, b.timeZone, RULES, now) ? "confirm" as const
    : b.status === "booked" && b.confirmedAt !== null && now < starts && starts - now <= 60 * 60_000 ? "starts_soon" as const : null;
  return {
    bookingId: b.bookingId, operatorName: b.operatorName, operatorTitle: b.operatorTitle, start: b.start, minutes: b.minutes,
    timeZone: b.timeZone, channel: b.channel, topic: b.topic, state: bookingState(f),
    cancelledBy: b.cancelledBy ?? null, cancelReason: b.cancelledBy === "operator" ? b.cancelReason ?? null : null,
    confirmBy: releaseAt(f, b.timeZone, RULES), canConfirm: canConfirm(f, b.timeZone, RULES, now), canCancel: canCancel(f, b.timeZone, now),
    reminder, joinFrom: join.from, joinUrl: join.open && b.channel === "video" ? b.meetingUrl ?? null : null,
    planId: b.planId ?? null, sharePlan: b.sharePlan,
  };
}

/** The customer's booking card: the bookable specialists with their next open slots, and the customer's latest call. */
export const options = query({
  args: {},
  returns: v.object({
    operators: v.array(operatorView),
    booking: v.union(v.null(), customerBookingView),
    pausedUntil: v.union(v.null(), v.number()),
  }),
  handler: async (ctx) => {
    const caller = await requireUser(ctx);
    const now = Date.now();
    const rows = await ctx.db.query("operatorAvailability").withIndex("by_active", (q) => q.eq("active", true)).take(10);
    const operators = [];
    for (const row of rows) {
      const availability = availabilitySchema.parse(row.availability);
      const held = await operatorBookings(ctx, row.operatorId, toLocal(now, availability.timeZone).slice(0, 10));
      operators.push({
        operatorId: row.operatorId, name: row.name, title: row.title, initials: initialsOf(row.name), minutes: availability.slotMinutes,
        timeZone: availability.timeZone, slots: upcomingSlots(availability, held.map(facts), now, SLOTS_SHOWN),
      });
    }
    const own = await ownBookings(ctx, caller.identity.tokenIdentifier);
    // The open call if there is one, otherwise a recent cancellation the customer should hear about
    const open = own.find((b) => b.status === "booked" && toInstant(b.start, b.timeZone) + b.minutes * 60_000 > now);
    const notice = own.find((b) => b.status === "cancelled" && b.cancelledBy !== "customer" && now - (b.cancelledAt ?? 0) < 7 * 24 * 3_600_000);
    const shown = open ?? notice;
    return {
      operators,
      booking: shown ? customerView(shown, now) : null,
      pausedUntil: pausedUntil(own.map(facts), RULES, now),
    };
  },
});

/** The customer books one of the open slots. A plan is shared only if the customer ticks it, and only around the call. */
export const book = mutation({
  args: {
    operatorId: v.string(), start: v.string(), channel, topic: v.string(),
    threadId: v.optional(v.id("ragThreads")), sharePlan: v.boolean(),
  },
  returns: v.union(
    v.object({ status: v.literal("booked"), bookingId: v.string() }),
    v.object({ status: v.literal("refused"), reason: v.string(), pausedUntil: v.union(v.null(), v.number()) }),
  ),
  handler: async (ctx, args) => {
    const caller = await requireUser(ctx);
    if (!localDateTimeSchema.safeParse(args.start).success) throw new ConvexError("booking_start_invalid");
    const topic = args.topic.trim();
    if (!topic || topic.length > TOPIC_MAX) throw new ConvexError("booking_topic_invalid");
    const ownerKey = caller.identity.tokenIdentifier;
    let planId: string | undefined;
    if (args.threadId) {
      const thread = await requireAgentThread(ctx, args.threadId);
      if (args.sharePlan) {
        const plan = await ctx.db.query("planSummaries").withIndex("by_thread_version", (q) => q.eq("threadId", thread._id)).order("desc").first();
        if (!plan) throw new ConvexError("plan_unavailable");
        planId = plan.planId;
      }
    } else if (args.sharePlan) throw new ConvexError("plan_unavailable");

    const found = await availabilityOf(ctx, args.operatorId);
    if (!found) return { status: "refused" as const, reason: "slot_unavailable", pausedUntil: null };
    const { row, availability } = found;
    const now = Date.now();
    const held = await operatorBookings(ctx, args.operatorId, toLocal(now, availability.timeZone).slice(0, 10));
    const own = await ownBookings(ctx, ownerKey);
    const check = checkBooking({ availability, bookings: held.map(facts), customerBookings: own.map(facts), start: args.start, now, rules: RULES });
    if (!check.ok) return { status: "refused" as const, reason: check.reason, pausedUntil: check.pausedUntil };

    let bookingId = "";
    for (let i = 0; i < 5 && !bookingId; i += 1) {
      const id = `BK-${String(100_000 + (parseInt(randomHex(4), 16) % 900_000))}`;
      if (!await ctx.db.query("bookings").withIndex("by_booking_id", (q) => q.eq("bookingId", id)).unique()) bookingId = id;
    }
    if (!bookingId) throw new ConvexError("booking_id_unavailable");
    const id = await ctx.db.insert("bookings", {
      bookingId, operatorId: row.operatorId, operatorName: row.name, operatorTitle: row.title,
      ownerKey, customerRef: customerRef(ownerKey),
      customerName: shortName(caller.identity.givenName, caller.identity.familyName) ?? "Customer",
      threadId: args.threadId, start: args.start, minutes: availability.slotMinutes, timeZone: availability.timeZone,
      channel: args.channel, topic, planId, sharePlan: planId !== undefined,
      status: "booked", bookedAt: now, confirmedAt: check.confirmedAt, outcomeAt: null,
      meetingUrl: args.channel === "video" ? `https://meet.jit.si/RaiffyDemo-${randomHex(12)}` : undefined,
      source: "chat",
    });
    const b = (await ctx.db.get(id))!;
    await event(ctx, b, "booked", "customer");
    if (check.confirmedAt !== null) await event(ctx, b, "confirmed", "customer");
    return { status: "booked" as const, bookingId };
  },
});

async function ownBooking(ctx: Pick<QueryCtx, "auth" | "db">, bookingId: string) {
  const caller = await requireUser(ctx);
  const b = await ctx.db.query("bookings").withIndex("by_booking_id", (q) => q.eq("bookingId", bookingId)).unique();
  // Someone else's booking reads the same as a missing one
  if (!b || b.ownerKey !== caller.identity.tokenIdentifier) throw new ConvexError("booking_unavailable");
  return b;
}

export const confirm = mutation({
  args: { bookingId: v.string() }, returns: v.null(),
  handler: async (ctx, { bookingId }) => {
    const b = await ownBooking(ctx, bookingId);
    if (!canConfirm(facts(b), b.timeZone, RULES, Date.now())) throw new ConvexError("booking_not_confirmable");
    await ctx.db.patch(b._id, { confirmedAt: Date.now() });
    await event(ctx, b, "confirmed", "customer");
    return null;
  },
});

export const cancel = mutation({
  args: { bookingId: v.string() }, returns: v.null(),
  handler: async (ctx, { bookingId }) => {
    const b = await ownBooking(ctx, bookingId);
    if (!canCancel(facts(b), b.timeZone, Date.now())) throw new ConvexError("booking_not_cancellable");
    await ctx.db.patch(b._id, { status: "cancelled", cancelledBy: "customer", cancelledAt: Date.now() });
    await event(ctx, b, "cancelled", "customer");
    return null;
  },
});

/* ───────────── Operators ───────────── */

/** An operator sets their own hours; an admin can set anyone's (the demo's seed). */
export const setAvailability = mutation({
  args: {
    operatorId: v.string(), name: v.string(), title: v.string(), active: v.boolean(),
    availability: v.object({
      timeZone: v.string(),
      weekly: v.record(v.string(), v.array(v.string())),
      breaks: v.array(v.array(v.string())),
      slotMinutes: v.number(), bufferMinutes: v.number(), dailyCap: v.number(), minLeadHours: v.number(), horizonDays: v.number(),
      daysOff: v.array(v.object({ date: v.string(), reason: v.string() })),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, "operator");
    if (caller.clerkUserId !== args.operatorId && !atLeast(caller.role, "admin")) throw new ConvexError("forbidden");
    const name = args.name.trim();
    const title = args.title.trim();
    if (!name || name.length > 40 || !title || title.length > 60) throw new ConvexError("operator_name_invalid");
    const parsed = availabilitySchema.safeParse({ ...args.availability, operatorId: args.operatorId });
    if (!parsed.success) throw new ConvexError("availability_invalid");
    try { toLocal(Date.now(), parsed.data.timeZone); } catch { throw new ConvexError("availability_invalid"); }
    const existing = await ctx.db.query("operatorAvailability").withIndex("by_operator", (q) => q.eq("operatorId", args.operatorId)).unique();
    const row = { operatorId: args.operatorId, name, title, active: args.active, availability: parsed.data, updatedBy: caller.clerkUserId, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("operatorAvailability", row);
    await writeAudit(ctx, caller, { action: "booking.availability_set", targetUserId: args.operatorId, details: { active: String(args.active) } });
    return null;
  },
});

const agendaItem = v.object({
  bookingId: v.string(), customerRef: v.string(), customerName: v.string(), start: v.string(), minutes: v.number(), timeZone: v.string(),
  channel, topic: v.string(),
  state: v.union(v.literal("pending"), v.literal("booked"), v.literal("done"), v.literal("no_show"), v.literal("cancelled")),
  cancelledBy: v.union(v.null(), v.literal("customer"), v.literal("operator"), v.literal("not_confirmed")),
  canCancel: v.boolean(), canRecordOutcome: v.boolean(),
  joinUrl: v.union(v.null(), v.string()), joinFrom: v.number(),
  /** The customer's plan, only if they chose to share it and only inside the share window. */
  sharedPlan: v.union(v.null(), v.object({ planId: v.string(), version: v.number(), plan: v.any() })),
  planShared: v.boolean(),
});

/** An operator's calls from yesterday on. An admin may look at another operator's calendar. */
export const agenda = query({
  args: { operatorId: v.optional(v.string()) },
  returns: v.object({ operator: v.union(v.null(), v.object({ name: v.string(), title: v.string() })), items: v.array(agendaItem) }),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, "operator");
    const operatorId = args.operatorId ?? caller.clerkUserId;
    if (operatorId !== caller.clerkUserId && !atLeast(caller.role, "admin")) throw new ConvexError("forbidden");
    const found = await availabilityOf(ctx, operatorId);
    const now = Date.now();
    const zone = found?.availability.timeZone ?? "Europe/Bucharest";
    const from = toLocal(now - 24 * 3_600_000, zone).slice(0, 10);
    const rows = (await operatorBookings(ctx, operatorId, from)).sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, 100);
    const items = [];
    for (const b of rows) {
      const f = facts(b);
      const join = joinWindow(f, b.timeZone, RULES, now);
      let sharedPlan = null;
      if (b.planId && shareWindow(f, b.sharePlan, b.timeZone, RULES, now).open) {
        const p = await ctx.db.query("planSummaries").withIndex("by_plan_version", (q) => q.eq("planId", b.planId!)).order("desc").first();
        if (p && p.ownerKey === b.ownerKey) sharedPlan = { planId: p.planId, version: p.version, plan: p.plan };
      }
      items.push({
        bookingId: b.bookingId, customerRef: b.customerRef, customerName: b.customerName, start: b.start, minutes: b.minutes,
        timeZone: b.timeZone, channel: b.channel, topic: b.topic, state: bookingState(f), cancelledBy: b.cancelledBy ?? null,
        canCancel: canCancel(f, b.timeZone, now), canRecordOutcome: canRecordOutcome(f, b.timeZone, now),
        joinUrl: join.open && b.channel === "video" ? b.meetingUrl ?? null : null, joinFrom: join.from,
        sharedPlan, planShared: b.sharePlan,
      });
    }
    return { operator: found ? { name: found.row.name, title: found.row.title } : null, items };
  },
});

async function operatorsBooking(ctx: Pick<QueryCtx, "auth" | "db">, bookingId: string) {
  const caller = await requireRole(ctx, "operator");
  const b = await ctx.db.query("bookings").withIndex("by_booking_id", (q) => q.eq("bookingId", bookingId)).unique();
  if (!b || (b.operatorId !== caller.clerkUserId && !atLeast(caller.role, "admin"))) throw new ConvexError("booking_unavailable");
  return { caller, b };
}

/** The operator cancels with a reason the customer sees. */
export const operatorCancel = mutation({
  args: { bookingId: v.string(), reason: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { caller, b } = await operatorsBooking(ctx, args.bookingId);
    const reason = args.reason.trim();
    if (!reason || reason.length > REASON_MAX) throw new ConvexError("cancel_reason_invalid");
    if (!canCancel(facts(b), b.timeZone, Date.now())) throw new ConvexError("booking_not_cancellable");
    await ctx.db.patch(b._id, { status: "cancelled", cancelledBy: "operator", cancelReason: reason, cancelledAt: Date.now() });
    await event(ctx, b, "cancelled", "operator");
    await writeAudit(ctx, caller, { action: "booking.cancelled", details: { bookingId: b.bookingId } });
    return null;
  },
});

/** After the call starts, the operator records whether it happened. Two missed calls pause the customer's booking. */
export const recordOutcome = mutation({
  args: { bookingId: v.string(), outcome: v.union(v.literal("done"), v.literal("no_show")) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { b } = await operatorsBooking(ctx, args.bookingId);
    if (!canRecordOutcome(facts(b), b.timeZone, Date.now())) throw new ConvexError("booking_outcome_too_early");
    await ctx.db.patch(b._id, { status: args.outcome, outcomeAt: Date.now() });
    await event(ctx, b, args.outcome, "operator");
    return null;
  },
});

/** Cron: calls not confirmed 24 hours before they start are released, so the slot opens again. */
export const releaseUnconfirmed = internalMutation({
  args: {}, returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db.query("bookings").withIndex("by_status_start", (q) => q.eq("status", "booked")).take(500);
    let released = 0;
    for (const b of open) {
      if (!shouldRelease(facts(b), b.timeZone, RULES, now)) continue;
      await ctx.db.patch(b._id, { status: "cancelled", cancelledBy: "not_confirmed", cancelledAt: now });
      await event(ctx, b, "released", "system");
      released += 1;
    }
    return released;
  },
});

export type BookingId = Id<"bookings">;
export type { Availability };

import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAgentThread } from "./agentAuth";
import { writeAudit } from "./audit";
import { requireRole, requireUser } from "./roles";
import { atLeast, type Role } from "../lib/auth/roles";
import {
  availabilitySchema, DEFAULT_BOOKING_RULES as RULES, DEFAULT_HOURS, localDateTimeSchema, type Availability, type BookingFacts,
} from "../lib/booking/schemas";
import {
  attemptAllowed, bookingState, canCancel, canConfirm, canRecordOutcome, checkBooking, customerRef, joinWindow, openSlotsOn, pauseOf, pausedUntil,
  releaseAt, shareWindow, shortName, shouldRelease, slotsForCustomer, toInstant, toLocal, upcomingSlots,
} from "../lib/booking/rules";
import { screenChat } from "../lib/agent/privacy";
import { scheduleBookingEmails } from "./bookingEmails";

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
  threadId: v.union(v.null(), v.id("ragThreads")),
});

const facts = (b: Doc<"bookings">): BookingFacts =>
  ({ operatorId: b.operatorId, start: b.start, minutes: b.minutes, status: b.status, confirmedAt: b.confirmedAt, outcomeAt: b.outcomeAt,
    timeZone: b.timeZone, ...(b.cancelledBy ? { cancelledBy: b.cancelledBy } : {}), ...(b.cancelledAt !== undefined ? { cancelledAt: b.cancelledAt } : {}) });
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/*
 * Who is bookable: every operator and admin in the users mirror, on their saved hours or DEFAULT_HOURS until they save
 * some. The mirror is the staff directory here, not the caller's authorization: the token's role still guards writes.
 * Someone demoted to member drops out of the chat, even with hours saved.
 */
type Specialist = {
  operatorId: string; name: string; title: string; active: boolean; role: Role; email: string | null;
  /** False while they're on the default hours. */
  custom: boolean; availability: Availability;
};
const DEFAULT_TITLE = "Specialist";
const MAX_SPECIALISTS = 50;

/** "Ana Maria Ionescu" → "Ana I.", as the prototype shows specialists to customers. */
function displayName(user: Doc<"users">) {
  const [first, ...rest] = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  const last = rest.at(-1);
  return first ? `${first}${last ? ` ${last[0]!.toUpperCase()}.` : ""}`.slice(0, 40) : "Raiffeisen specialist";
}

function specialistOf(user: Doc<"users">, row: Doc<"operatorAvailability"> | null): Specialist {
  const base = { operatorId: user.clerkUserId, role: user.role, email: user.email ?? null };
  if (!row) return { ...base, name: displayName(user), title: DEFAULT_TITLE, active: true, custom: false, availability: { ...DEFAULT_HOURS, operatorId: user.clerkUserId } };
  return { ...base, name: row.name, title: row.title, active: row.active, custom: true, availability: availabilitySchema.parse(row.availability) };
}

async function hoursRow(ctx: Pick<QueryCtx, "db">, operatorId: string) {
  return ctx.db.query("operatorAvailability").withIndex("by_operator", (q) => q.eq("operatorId", operatorId)).unique();
}

async function staffUser(ctx: Pick<QueryCtx, "db">, operatorId: string) {
  const user = await ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", operatorId)).unique();
  return user && atLeast(user.role, "operator") ? user : null;
}

async function specialist(ctx: Pick<QueryCtx, "db">, operatorId: string): Promise<Specialist | null> {
  const user = await staffUser(ctx, operatorId);
  return user ? specialistOf(user, await hoursRow(ctx, operatorId)) : null;
}

async function allSpecialists(ctx: Pick<QueryCtx, "db">): Promise<Specialist[]> {
  const users = [];
  for (const role of ["operator", "admin"] as const) users.push(...await ctx.db.query("users").withIndex("by_role", (q) => q.eq("role", role)).take(MAX_SPECIALISTS));
  const out = [];
  for (const user of users.slice(0, MAX_SPECIALISTS)) out.push(specialistOf(user, await hoursRow(ctx, user.clerkUserId)));
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
    planId: b.planId ?? null, sharePlan: b.sharePlan, threadId: b.threadId ?? null,
  };
}

/** The customer's booking card: the bookable specialists with their next open slots, and the customer's latest call. */
export const options = query({
  args: {},
  returns: v.object({
    operators: v.array(operatorView),
    booking: v.union(v.null(), customerBookingView),
    pausedUntil: v.union(v.null(), v.number()),
    pauseCause: v.union(v.null(), v.literal("missed"), v.literal("cancellations")),
  }),
  handler: async (ctx) => {
    const caller = await requireUser(ctx);
    const now = Date.now();
    const own = await ownBookings(ctx, caller.identity.tokenIdentifier);
    const operators = [];
    for (const s of (await allSpecialists(ctx)).filter((x) => x.active).slice(0, 10)) {
      const { availability } = s;
      const held = await operatorBookings(ctx, s.operatorId, toLocal(now, availability.timeZone).slice(0, 10));
      operators.push({
        operatorId: s.operatorId, name: s.name, title: s.title, initials: initialsOf(s.name), minutes: availability.slotMinutes,
        // Only times this customer could book: none at the same time as another of their calls (lib/booking/rules.ts)
        timeZone: availability.timeZone, slots: slotsForCustomer(availability, held.map(facts), own.map(facts), now, SLOTS_SHOWN),
      });
    }
    // The open call if there is one, otherwise a recent cancellation the customer should hear about
    const open = own.find((b) => b.status === "booked" && toInstant(b.start, b.timeZone) + b.minutes * 60_000 > now);
    const notice = own.find((b) => b.status === "cancelled" && b.cancelledBy !== "customer" && now - (b.cancelledAt ?? 0) < 7 * 24 * 3_600_000);
    const shown = open ?? notice;
    const pause = pauseOf(own.map(facts), RULES, now);
    return {
      operators,
      booking: shown ? customerView(shown, now) : null,
      pausedUntil: pause?.until ?? null,
      pauseCause: pause?.cause ?? null,
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
    const ownerKey = caller.identity.tokenIdentifier;
    // Every attempt counts, refused or not, before anything else is read
    const now = Date.now();
    if (!await recordAttempt(ctx, ownerKey, now)) return { status: "refused" as const, reason: "too_many_attempts", pausedUntil: null };
    if (!localDateTimeSchema.safeParse(args.start).success) throw new ConvexError("booking_start_invalid");
    // The topic reaches the specialist's calendar, so it goes through the same privacy screen as a chat message
    if (!args.topic.trim() || args.topic.trim().length > TOPIC_MAX) throw new ConvexError("booking_topic_invalid");
    const topic = screenChat(args.topic).text.trim().slice(0, TOPIC_MAX);
    let planId: string | undefined;
    if (args.threadId) {
      const thread = await requireAgentThread(ctx, args.threadId);
      if (args.sharePlan) {
        const plan = await ctx.db.query("planSummaries").withIndex("by_thread_version", (q) => q.eq("threadId", thread._id)).order("desc").first();
        if (!plan) throw new ConvexError("plan_unavailable");
        planId = plan.planId;
      }
    } else if (args.sharePlan) throw new ConvexError("plan_unavailable");

    const row = await specialist(ctx, args.operatorId);
    if (!row?.active) return { status: "refused" as const, reason: "slot_unavailable", pausedUntil: null };
    const { availability } = row;
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
    await scheduleBookingEmails(ctx, b._id);
    return { status: "booked" as const, bookingId };
  },
});

/** Records a booking attempt and says whether it's within the limit; attempts outside the window are deleted as they're read. */
async function recordAttempt(ctx: MutationCtx, ownerKey: string, now: number): Promise<boolean> {
  const since = now - RULES.attemptWindowMinutes * 60_000;
  const old = await ctx.db.query("bookingAttempts").withIndex("by_owner_at", (q) => q.eq("ownerKey", ownerKey).lt("at", since)).take(50);
  for (const a of old) await ctx.db.delete(a._id);
  const recent = await ctx.db.query("bookingAttempts").withIndex("by_owner_at", (q) => q.eq("ownerKey", ownerKey).gte("at", since)).take(RULES.attemptsPerWindow + 1);
  if (!attemptAllowed(recent.map((a) => a.at), RULES, now)) return false;
  await ctx.db.insert("bookingAttempts", { ownerKey, at: now });
  return true;
}

/** The customer's calls, newest first (the list at /chat/calls): no calendar, the same view as the booking card. */
export const mine = query({
  args: {},
  returns: v.array(customerBookingView),
  handler: async (ctx) => {
    const caller = await requireUser(ctx);
    const now = Date.now();
    const own = await ownBookings(ctx, caller.identity.tokenIdentifier);
    return own.sort((a, b) => toInstant(b.start, b.timeZone) - toInstant(a.start, a.timeZone)).map((b) => customerView(b, now));
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
const availabilityFields = v.object({
  timeZone: v.string(),
  weekly: v.record(v.string(), v.array(v.string())),
  breaks: v.array(v.array(v.string())),
  slotMinutes: v.number(), bufferMinutes: v.number(), dailyCap: v.number(), minLeadHours: v.number(), horizonDays: v.number(),
  daysOff: v.array(v.object({ date: v.string(), reason: v.string() })),
});

export const setAvailability = mutation({
  args: { operatorId: v.string(), name: v.string(), title: v.string(), active: v.boolean(), availability: availabilityFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, "operator");
    if (caller.clerkUserId !== args.operatorId) {
      if (!atLeast(caller.role, "admin")) throw new ConvexError("forbidden");
      // An admin sets hours only for someone who is an operator or admin
      if (!await staffUser(ctx, args.operatorId)) throw new ConvexError("not_a_specialist");
    }
    const name = args.name.trim();
    const title = args.title.trim();
    if (!name || name.length > 40 || !title || title.length > 60) throw new ConvexError("operator_name_invalid");
    const parsed = availabilitySchema.safeParse({ ...args.availability, operatorId: args.operatorId });
    if (!parsed.success) throw new ConvexError("availability_invalid");
    try { toLocal(Date.now(), parsed.data.timeZone); } catch { throw new ConvexError("availability_invalid"); }
    const existing = await hoursRow(ctx, args.operatorId);
    const row = { operatorId: args.operatorId, name, title, active: args.active, availability: parsed.data, updatedBy: caller.clerkUserId, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("operatorAvailability", row);
    await writeAudit(ctx, caller, {
      action: "booking.availability_set", targetUserId: args.operatorId,
      details: { active: String(args.active), by: caller.clerkUserId === args.operatorId ? "self" : "admin" },
    });
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
    const found = await specialist(ctx, operatorId);
    const now = Date.now();
    const zone = found?.availability.timeZone ?? DEFAULT_HOURS.timeZone;
    const from = toLocal(now - 24 * 3_600_000, zone).slice(0, 10);
    const rows = (await operatorBookings(ctx, operatorId, from)).sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, 100);
    const items = [];
    for (const b of rows) items.push(await agendaView(ctx, b, now));
    return { operator: found?.active ? { name: found.name, title: found.title } : null, items };
  },
});

/** One call as the operator sees it. The shared plan comes only inside its window. */
async function agendaView(ctx: Pick<QueryCtx, "db">, b: Doc<"bookings">, now: number) {
  const f = facts(b);
  const join = joinWindow(f, b.timeZone, RULES, now);
  let sharedPlan = null;
  if (b.planId && shareWindow(f, b.sharePlan, b.timeZone, RULES, now).open) {
    const p = await ctx.db.query("planSummaries").withIndex("by_plan_version", (q) => q.eq("planId", b.planId!)).order("desc").first();
    if (p && p.ownerKey === b.ownerKey) sharedPlan = { planId: p.planId, version: p.version, plan: p.plan };
  }
  return {
    bookingId: b.bookingId, customerRef: b.customerRef, customerName: b.customerName, start: b.start, minutes: b.minutes,
    timeZone: b.timeZone, channel: b.channel, topic: b.topic, state: bookingState(f), cancelledBy: b.cancelledBy ?? null,
    canCancel: canCancel(f, b.timeZone, now), canRecordOutcome: canRecordOutcome(f, b.timeZone, now),
    joinUrl: join.open && b.channel === "video" ? b.meetingUrl ?? null : null, joinFrom: join.from,
    sharedPlan, planShared: b.sharePlan,
  };
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 3_600_000).toISOString().slice(0, 10);
const WEEKS_AROUND = 8;

/**
 * The console calendar (console.html#calendar): one Monday-to-Friday week of an operator's calls with each day's open
 * slots, their hours, the next call and the customers who missed calls. An admin may open another operator's calendar.
 * Times are wall-clock in the operator's zone; `now` lets the page shade the past without a clock of its own.
 */
export const calendar = query({
  args: { operatorId: v.optional(v.string()), weekOffset: v.optional(v.number()) },
  returns: v.object({
    operatorId: v.string(),
    operator: v.union(v.null(), v.object({ name: v.string(), title: v.string(), active: v.boolean() })),
    availability: v.union(v.null(), availabilityFields),
    timeZone: v.string(), now: v.number(), today: v.string(), week: v.string(), weekOffset: v.number(),
    days: v.array(v.object({ date: v.string(), open: v.array(v.string()) })),
    items: v.array(agendaItem),
    next: v.union(v.null(), agendaItem),
    missed: v.array(v.object({ customerRef: v.string(), customerName: v.string(), count: v.number(), pausedUntil: v.union(v.null(), v.number()) })),
    rules: v.object({
      confirmBeforeHours: v.number(), shareBeforeMinutes: v.number(), shareAfterHours: v.number(), joinBeforeMinutes: v.number(),
      noShowPauseAfter: v.number(), pauseDays: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, "operator");
    const operatorId = args.operatorId ?? caller.clerkUserId;
    if (operatorId !== caller.clerkUserId && !atLeast(caller.role, "admin")) throw new ConvexError("forbidden");
    const offset = Math.max(-WEEKS_AROUND, Math.min(WEEKS_AROUND, Math.trunc(args.weekOffset ?? 0)));
    const row = await specialist(ctx, operatorId);
    const availability = row?.availability ?? null;
    const timeZone = availability?.timeZone ?? DEFAULT_HOURS.timeZone;
    const now = Date.now();
    const today = toLocal(now, timeZone).slice(0, 10);
    const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const week = addDays(monday, offset * 7);
    const from = [week, addDays(today, -RULES.pauseDays)].sort()[0]!;
    const rows = (await operatorBookings(ctx, operatorId, from)).sort((a, b) => (a.start < b.start ? -1 : 1));
    const held = rows.map(facts);

    const items = [];
    for (const b of rows.filter((x) => x.start >= week && x.start < addDays(week, 7)).slice(0, 200)) items.push(await agendaView(ctx, b, now));
    const upcoming = rows.find((b) => b.status === "booked" && toInstant(b.start, b.timeZone) + b.minutes * 60_000 > now);

    // Customers with a recent no-show: one more pauses their booking, or it already has
    const missed = [];
    for (const ref of [...new Set(rows.filter((b) => b.status === "no_show").map((b) => b.customerRef))].slice(0, 20)) {
      const any = rows.find((b) => b.customerRef === ref)!;
      const own = await ownBookings(ctx, any.ownerKey);
      missed.push({
        customerRef: ref, customerName: any.customerName, count: own.filter((b) => b.status === "no_show").length,
        pausedUntil: pausedUntil(own.map(facts), RULES, now),
      });
    }

    let hours = null;
    if (availability) { const { operatorId: _, ...rest } = availability; hours = rest; }
    return {
      operatorId,
      operator: row ? { name: row.name, title: row.title, active: row.active } : null,
      availability: hours, timeZone, now, today, week, weekOffset: offset,
      days: [0, 1, 2, 3, 4].map((i) => addDays(week, i)).map((date) => ({ date, open: availability && row?.active ? openSlotsOn(availability, held, date, now) : [] })),
      items, next: upcoming ? await agendaView(ctx, upcoming, now) : null, missed,
      rules: {
        confirmBeforeHours: RULES.confirmBeforeHours, shareBeforeMinutes: RULES.shareBeforeMinutes, shareAfterHours: RULES.shareAfterHours,
        joinBeforeMinutes: RULES.joinBeforeMinutes, noShowPauseAfter: RULES.noShowPauseAfter, pauseDays: RULES.pauseDays,
      },
    };
  },
});

/** Whose calendar an admin can open: every operator and admin, bookable or not. */
export const calendars = query({
  args: {},
  returns: v.array(v.object({ operatorId: v.string(), name: v.string(), title: v.string(), active: v.boolean() })),
  handler: async (ctx) => {
    await requireRole(ctx, "admin");
    return (await allSpecialists(ctx)).map((s) => ({ operatorId: s.operatorId, name: s.name, title: s.title, active: s.active }));
  },
});

/** Admin › Specialists: everyone customers can book, their hours, and what the chat offers from them next. */
export const specialists = query({
  args: {},
  returns: v.array(v.object({
    operatorId: v.string(), name: v.string(), title: v.string(), role: v.union(v.literal("operator"), v.literal("admin")),
    email: v.union(v.null(), v.string()), active: v.boolean(), custom: v.boolean(), availability: availabilityFields,
    today: v.string(), nextSlots: v.array(v.string()), upcoming: v.number(),
  })),
  handler: async (ctx) => {
    await requireRole(ctx, "admin");
    const now = Date.now();
    const out = [];
    for (const s of await allSpecialists(ctx)) {
      const today = toLocal(now, s.availability.timeZone).slice(0, 10);
      const held = await operatorBookings(ctx, s.operatorId, today);
      const { operatorId: _, ...hours } = s.availability;
      out.push({
        operatorId: s.operatorId, name: s.name, title: s.title, role: s.role === "admin" ? "admin" as const : "operator" as const,
        email: s.email, active: s.active, custom: s.custom, availability: hours, today,
        nextSlots: s.active ? upcomingSlots(s.availability, held.map(facts), now, 3) : [],
        upcoming: held.filter((b) => b.status === "booked" && toInstant(b.start, b.timeZone) > now).length,
      });
    }
    return out;
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

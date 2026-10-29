import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import { internal } from "./_generated/api";
import type { JSONValue } from "convex/values";
import resend from "@convex-dev/resend/test";
import schema from "./schema";
import { toInstant } from "../lib/booking/rules";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./bookings.ts": () => import("./bookings"),
  "./audit.ts": () => import("./audit"),
  "./bookingEmails.ts": () => import("./bookingEmails"),
  "./answerCheckEmails.ts": () => import("./answerCheckEmails"),
};
const identity = (subject: string, role?: JSONValue, name: { givenName?: string; familyName?: string } = {}) => ({
  subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...name, ...(role === undefined ? {} : { role }),
});
const TZ = "Europe/Bucharest";
const HOURS = {
  timeZone: TZ, slotMinutes: 30, bufferMinutes: 0, dailyCap: 5, minLeadHours: 2, horizonDays: 14,
  weekly: { 1: ["09:00", "17:00"], 2: ["09:00", "17:00"], 3: ["09:00", "17:00"], 4: ["09:00", "17:00"], 5: ["09:00", "13:00"] },
  breaks: [["12:30", "13:30"]], daysOff: [],
};
const ANA = { operatorId: "user_ana", name: "Ana M.", title: "Credit specialist", active: true, availability: HOURS };

/** The users mirror row convex/users.ts ensure writes on first sign-in: the staff directory bookings reads. */
async function mirror(t: ReturnType<typeof convexTest>, clerkUserId: string, role: "member" | "operator" | "admin", name?: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkUserId, tokenIdentifier: `https://clerk.test|${clerkUserId}`, role, name, firstSeenAt: 0, lastSeenAt: 0 });
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  resend.register(t);
  await mirror(t, "user_ana", "operator");
  await t.withIdentity(identity("user_admin", "admin")).mutation(anyApi.bookings!.setAvailability!, ANA);
  return {
    t,
    ioana: t.withIdentity(identity("user_ioana", "member", { givenName: "Ioana", familyName: "Popescu" })),
    vlad: t.withIdentity(identity("user_vlad", "member", { givenName: "Vlad" })),
    ana: t.withIdentity(identity("user_ana", "operator")),
  };
}
const book = (start: string, over: Record<string, unknown> = {}) => ({ operatorId: "user_ana", start, channel: "video", topic: "Documents for a personal loan", sharePlan: false, ...over });

// Half a minute before 08:00: convex-test moves the clock 1 ms per insert, and the 10:00 slot sits exactly on the 2 h lead
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(toInstant("2026-10-29T08:00", TZ) - 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("availability", () => {
  it("is set by the operator or an admin, never by a customer or another operator", async () => {
    const { t, ioana } = await setup();
    await expect(t.mutation(anyApi.bookings!.setAvailability!, ANA)).rejects.toThrow("authentication_required");
    await expect(ioana.mutation(anyApi.bookings!.setAvailability!, ANA)).rejects.toThrow("forbidden");
    await expect(t.withIdentity(identity("user_bob", "operator")).mutation(anyApi.bookings!.setAvailability!, ANA)).rejects.toThrow("forbidden");
    await t.withIdentity(identity("user_ana", "operator")).mutation(anyApi.bookings!.setAvailability!, { ...ANA, title: "Specialist" });
    await expect(t.withIdentity(identity("user_ana", "operator")).mutation(anyApi.bookings!.setAvailability!,
      { ...ANA, availability: { ...HOURS, slotMinutes: 45 } })).rejects.toThrow("availability_invalid");
    await expect(t.withIdentity(identity("user_ana", "operator")).mutation(anyApi.bookings!.setAvailability!,
      { ...ANA, availability: { ...HOURS, timeZone: "Mars/Olympus" } })).rejects.toThrow("availability_invalid");
  });
});

describe("who is bookable", () => {
  it("offers every operator and admin, on default hours until they save their own", async () => {
    const { t, ioana } = await setup();
    await mirror(t, "user_mara", "admin", "Mara Elena Dobre");
    await mirror(t, "user_ion", "member", "Ion Pop");
    const { operators } = await ioana.query(anyApi.bookings!.options!, {});
    expect(operators.map((o: { name: string }) => o.name)).toEqual(["Ana M.", "Mara D."]);
    expect(operators[1]).toMatchObject({ operatorId: "user_mara", title: "Specialist", initials: "MD", minutes: 30 });
    expect(operators[1].slots[0]).toBe("2026-10-29T10:00");
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T10:00", { operatorId: "user_mara" }))).toMatchObject({ status: "booked" });
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T10:00", { operatorId: "user_ion" }))).toMatchObject({ status: "refused", reason: "slot_unavailable" });
  });

  it("drops someone who turned booking off or was demoted, even with hours saved", async () => {
    const { t, ioana } = await setup();
    const admin = t.withIdentity(identity("user_admin", "admin"));
    await admin.mutation(anyApi.bookings!.setAvailability!, { ...ANA, active: false });
    expect((await ioana.query(anyApi.bookings!.options!, {})).operators).toEqual([]);
    await admin.mutation(anyApi.bookings!.setAvailability!, ANA);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", "user_ana")).unique();
      await ctx.db.patch(row!._id, { role: "member" });
    });
    expect((await ioana.query(anyApi.bookings!.options!, {})).operators).toEqual([]);
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"))).toMatchObject({ status: "refused", reason: "slot_unavailable" });
  });

  it("lets an admin set hours only for an operator or admin, and list everyone with what the chat offers", async () => {
    const { t, ana, ioana } = await setup();
    const admin = t.withIdentity(identity("user_admin", "admin"));
    await mirror(t, "user_ion", "member", "Ion Pop");
    await mirror(t, "user_mara", "admin", "Mara Dobre");
    await expect(admin.mutation(anyApi.bookings!.setAvailability!, { ...ANA, operatorId: "user_ion" })).rejects.toThrow("not_a_specialist");
    await expect(admin.mutation(anyApi.bookings!.setAvailability!, { ...ANA, operatorId: "user_nobody" })).rejects.toThrow("not_a_specialist");
    await expect(ana.query(anyApi.bookings!.specialists!, {})).rejects.toThrow("forbidden");
    await expect(ioana.query(anyApi.bookings!.specialists!, {})).rejects.toThrow("forbidden");

    await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"));
    const list = await admin.query(anyApi.bookings!.specialists!, {});
    expect(list.map((s: { operatorId: string }) => s.operatorId)).toEqual(["user_ana", "user_mara"]);
    expect(list[0]).toMatchObject({ role: "operator", custom: true, active: true, upcoming: 1, today: "2026-10-29", nextSlots: ["2026-10-29T10:00", "2026-10-29T10:30", "2026-10-29T11:00"] });
    expect(list[1]).toMatchObject({ name: "Mara D.", role: "admin", custom: false, upcoming: 0 });
    expect(list[1].availability).toMatchObject({ slotMinutes: 30, weekly: { 1: ["09:00", "17:00"] } });
    expect(list[1].availability).not.toHaveProperty("operatorId");
  });
});

describe("customer booking", () => {
  it("shows computed slots and books one, confirming a call less than a day away", async () => {
    const { ioana } = await setup();
    const before = await ioana.query(anyApi.bookings!.options!, {});
    expect(before.operators[0]).toMatchObject({ name: "Ana M.", initials: "AM", minutes: 30 });
    expect(before.operators[0].slots[0]).toBe("2026-10-29T10:00");
    expect(before.booking).toBeNull();

    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"))).toMatchObject({ status: "booked" });
    const after = await ioana.query(anyApi.bookings!.options!, {});
    expect(after.booking).toMatchObject({ start: "2026-10-29T14:00", state: "booked", channel: "video", canCancel: true, joinUrl: null, reminder: null });
    expect(after.operators[0].slots).not.toContain("2026-10-29T14:00");
  });

  it("refuses a slot the client invented, a taken slot and a second open call", async () => {
    const { ioana, vlad } = await setup();
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:15"))).toMatchObject({ status: "refused", reason: "slot_unavailable" });
    await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"));
    expect(await vlad.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"))).toMatchObject({ status: "refused", reason: "slot_unavailable" });
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T15:00"))).toMatchObject({ status: "refused", reason: "already_booked" });
    await expect(ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T15:00", { topic: " " }))).rejects.toThrow("booking_topic_invalid");
    await expect(ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T15:00", { sharePlan: true }))).rejects.toThrow("plan_unavailable");
  });

  it("asks the customer to confirm a later call, and releases it if they don't", async () => {
    const { t, ioana } = await setup();
    await ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T10:00"));
    expect((await ioana.query(anyApi.bookings!.options!, {})).booking).toMatchObject({ state: "pending", reminder: "confirm", canConfirm: true });
    vi.setSystemTime(toInstant("2026-11-01T10:01", TZ));
    expect(await t.mutation(anyApi.bookings!.releaseUnconfirmed!, {})).toBe(1);
    const released = (await ioana.query(anyApi.bookings!.options!, {})).booking;
    expect(released).toMatchObject({ state: "cancelled", cancelledBy: "not_confirmed" });
    expect((await ioana.query(anyApi.bookings!.options!, {})).operators[0].slots).toContain("2026-11-02T10:00");
  });

  it("keeps a confirmed call, and shows the video link only from 10 minutes before", async () => {
    const { t, ioana, ana } = await setup();
    const { bookingId } = await ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T10:00"));
    await ioana.mutation(anyApi.bookings!.confirm!, { bookingId });
    vi.setSystemTime(toInstant("2026-11-01T10:01", TZ));
    expect(await t.mutation(anyApi.bookings!.releaseUnconfirmed!, {})).toBe(0);
    vi.setSystemTime(toInstant("2026-11-02T09:40", TZ));
    expect((await ioana.query(anyApi.bookings!.options!, {})).booking).toMatchObject({ joinUrl: null, reminder: "starts_soon" });
    vi.setSystemTime(toInstant("2026-11-02T09:52", TZ));
    const url = (await ioana.query(anyApi.bookings!.options!, {})).booking.joinUrl;
    expect(url).toMatch(/^https:\/\/meet\.jit\.si\/RaiffyDemo-[0-9a-f]{24}$/);
    expect((await ana.query(anyApi.bookings!.agenda!, {})).items[0].joinUrl).toBe(url);
  });

  it("lets only the owner see, confirm or cancel a booking", async () => {
    const { ioana, vlad } = await setup();
    const { bookingId } = await ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T10:00"));
    expect((await vlad.query(anyApi.bookings!.options!, {})).booking).toBeNull();
    await expect(vlad.mutation(anyApi.bookings!.cancel!, { bookingId })).rejects.toThrow("booking_unavailable");
    await expect(vlad.mutation(anyApi.bookings!.confirm!, { bookingId })).rejects.toThrow("booking_unavailable");
    await ioana.mutation(anyApi.bookings!.cancel!, { bookingId });
    // A customer's own cancellation isn't shown back as a notice
    expect((await ioana.query(anyApi.bookings!.options!, {})).booking).toBeNull();
  });
});

describe("operator calendar", () => {
  it("shows the operator a first name and reference, not the identity", async () => {
    const { ioana, ana, t } = await setup();
    await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"));
    const { items } = await ana.query(anyApi.bookings!.agenda!, {});
    expect(items[0]).toMatchObject({ customerName: "Ioana P.", customerRef: expect.stringMatching(/^C-\d{4}$/), topic: "Documents for a personal loan" });
    expect(JSON.stringify(items)).not.toContain("user_ioana");
    await expect(ioana.query(anyApi.bookings!.agenda!, {})).rejects.toThrow("forbidden");
    await expect(t.withIdentity(identity("user_bob", "operator")).query(anyApi.bookings!.agenda!, { operatorId: "user_ana" })).rejects.toThrow("forbidden");
  });

  it("cancels with a reason the customer sees, and records an outcome only after the call starts", async () => {
    const { ioana, vlad, ana } = await setup();
    const a = await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"));
    await expect(ana.mutation(anyApi.bookings!.operatorCancel!, { bookingId: a.bookingId, reason: " " })).rejects.toThrow("cancel_reason_invalid");
    await ana.mutation(anyApi.bookings!.operatorCancel!, { bookingId: a.bookingId, reason: "I'm unwell today" });
    expect((await ioana.query(anyApi.bookings!.options!, {})).booking).toMatchObject({ state: "cancelled", cancelledBy: "operator", cancelReason: "I'm unwell today" });

    const b = await vlad.mutation(anyApi.bookings!.book!, book("2026-10-29T15:00"));
    await expect(ana.mutation(anyApi.bookings!.recordOutcome!, { bookingId: b.bookingId, outcome: "done" })).rejects.toThrow("booking_outcome_too_early");
    vi.setSystemTime(toInstant("2026-10-29T15:20", TZ));
    await ana.mutation(anyApi.bookings!.recordOutcome!, { bookingId: b.bookingId, outcome: "no_show" });
    expect((await ana.query(anyApi.bookings!.agenda!, {})).items.find((i: { bookingId: string }) => i.bookingId === b.bookingId).state).toBe("no_show");
  });

  it("shows one Monday-to-Friday week with open slots, the next call and customers who missed one", async () => {
    const { ioana, vlad, ana } = await setup();
    const i = await ioana.mutation(anyApi.bookings!.book!, book("2026-10-29T14:00"));
    const v = await vlad.mutation(anyApi.bookings!.book!, book("2026-11-02T10:00"));
    const now = await ana.query(anyApi.bookings!.calendar!, {});
    expect(now).toMatchObject({ operatorId: "user_ana", operator: { name: "Ana M.", active: true }, today: "2026-10-29", week: "2026-10-26", weekOffset: 0 });
    expect(now.availability.slotMinutes).toBe(30);
    expect(now.availability).not.toHaveProperty("operatorId");
    expect(now.days.map((d: { date: string }) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    // The past is closed, the lead time is two hours, and a booked call takes its slot
    expect(now.days[2].open).toEqual([]);
    expect(now.days[3].open.length).toBeGreaterThan(0);
    expect(now.days[3].open.every((s: string) => s >= "2026-10-29T10:00")).toBe(true);
    expect(now.days[3].open).not.toContain("2026-10-29T14:00");
    expect(now.items.map((i: { start: string }) => i.start)).toEqual(["2026-10-29T14:00"]);
    expect(now.next.start).toBe("2026-10-29T14:00");

    const next = await ana.query(anyApi.bookings!.calendar!, { weekOffset: 1 });
    expect(next.week).toBe("2026-11-02");
    expect(next.items.map((i: { bookingId: string }) => i.bookingId)).toEqual([v.bookingId]);
    expect((await ana.query(anyApi.bookings!.calendar!, { weekOffset: 40 })).weekOffset).toBe(8);

    vi.setSystemTime(toInstant("2026-10-29T14:20", TZ));
    await ana.mutation(anyApi.bookings!.recordOutcome!, { bookingId: i.bookingId, outcome: "no_show" });
    expect((await ana.query(anyApi.bookings!.calendar!, {})).missed).toEqual([{ customerRef: expect.stringMatching(/^C-\d{4}$/), customerName: "Ioana P.", count: 1, pausedUntil: null }]);
  });

  it("opens another operator's calendar, or the list of calendars, only for an admin", async () => {
    const { ana, t } = await setup();
    const admin = t.withIdentity(identity("user_admin", "admin"));
    const bob = t.withIdentity(identity("user_bob", "operator"));
    await expect(bob.query(anyApi.bookings!.calendar!, { operatorId: "user_ana" })).rejects.toThrow("forbidden");
    await expect(ana.query(anyApi.bookings!.calendars!, {})).rejects.toThrow("forbidden");
    expect((await admin.query(anyApi.bookings!.calendar!, { operatorId: "user_ana" })).operator.name).toBe("Ana M.");
    expect(await admin.query(anyApi.bookings!.calendars!, {})).toEqual([{ operatorId: "user_ana", name: "Ana M.", title: "Credit specialist", active: true }]);
    // Someone who isn't in the staff directory yet gets an empty week to set hours up from
    expect(await bob.query(anyApi.bookings!.calendar!, {})).toMatchObject({ operator: null, availability: null, items: [], next: null });
  });
});

describe("booking e-mails", () => {
  const URL = "https://test-deployment.convex.cloud";
  const on = () => {
    vi.stubEnv("RAIFFY_EMAIL_ENABLED", "true"); vi.stubEnv("RAIFFY_EMAIL_DEPLOYMENT_URL", URL); vi.stubEnv("CONVEX_CLOUD_URL", URL);
    vi.stubEnv("RAIFFY_EMAIL_FROM", "Raiffy <raiffy@example.com>"); vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "re_test_1" }] }), { status: 200, headers: { "content-type": "application/json" } })));
  };
  async function booked() {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const ana = await ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", "user_ana")).unique();
      await ctx.db.patch(ana!._id, { email: "ana@example.com" });
      await ctx.db.insert("users", { clerkUserId: "user_ioana", tokenIdentifier: "https://clerk.test|user_ioana", role: "member", email: "ioana@example.com", firstSeenAt: 0, lastSeenAt: 0 });
    });
    const r = await s.ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T14:00"));
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const row = await s.t.run((ctx) => ctx.db.query("bookings").withIndex("by_booking_id", (q) => q.eq("bookingId", r.bookingId)).unique());
    return { ...s, row: row! };
  }

  it("records one skipped e-mail for each side where sending is off", async () => {
    const { row } = await booked();
    expect(row.emails).toEqual([
      expect.objectContaining({ kind: "booked", to: "customer", outcome: "skipped", reason: "off" }),
      expect.objectContaining({ kind: "booked", to: "operator", outcome: "skipped", reason: "off" }),
    ]);
  });

  it("e-mails the customer and the specialist once each, to Resend's test inbox until it's live, and never stores an address", async () => {
    on();
    const { t, row } = await booked();
    expect(row.emails!.map((e) => [e.to, e.outcome])).toEqual([["customer", "test"], ["operator", "test"]]);
    expect(JSON.stringify(row)).not.toMatch(/@example\.com/);
    // A repeated send for the same booking does nothing
    await t.mutation(internal.bookingEmails.send, { id: row._id, to: "customer" });
    expect((await t.run((ctx) => ctx.db.get(row._id)))!.emails).toHaveLength(2);
  });

  it("sends nothing for a refused booking", async () => {
    const { t, ioana } = await setup();
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-31T10:00"))).toMatchObject({ status: "refused" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("bookings").collect())).toEqual([]);
  });
});

describe("abuse limits", () => {
  it("allows five booking attempts in ten minutes, refused ones included, then again after the window", async () => {
    const { ioana } = await setup();
    for (let i = 0; i < 5; i += 1) expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-10-31T10:00"))).toMatchObject({ reason: "slot_unavailable" });
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T14:00"))).toMatchObject({ status: "refused", reason: "too_many_attempts" });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T14:00"))).toMatchObject({ status: "booked" });
  });

  it("pauses booking after three cancellations in a week, and says why", async () => {
    const { ioana } = await setup();
    for (const start of ["2026-11-02T10:00", "2026-11-03T10:00", "2026-11-04T10:00"]) {
      const r = await ioana.mutation(anyApi.bookings!.book!, book(start));
      await ioana.mutation(anyApi.bookings!.cancel!, { bookingId: r.bookingId });
    }
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await ioana.mutation(anyApi.bookings!.book!, book("2026-11-05T10:00"))).toMatchObject({ status: "refused", reason: "paused_cancellations" });
    expect(await ioana.query(anyApi.bookings!.options!, {})).toMatchObject({ pauseCause: "cancellations", pausedUntil: expect.any(Number) });
  });

  it("keeps the customer's personal data out of the topic the specialist sees", async () => {
    const { t, ioana } = await setup();
    await ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T14:00", { topic: "Loan for card 4111 1111 1111 1111" }));
    const [row] = await t.run((ctx) => ctx.db.query("bookings").collect());
    expect(row!.topic).not.toContain("4111 1111 1111 1111");
  });
});

describe("the customer's calls", () => {
  it("lists only the caller's own calls, latest start first, with what they can do", async () => {
    const { t, ioana, vlad } = await setup();
    const first = await ioana.mutation(anyApi.bookings!.book!, book("2026-11-02T14:00"));
    await ioana.mutation(anyApi.bookings!.cancel!, { bookingId: first.bookingId });
    await ioana.mutation(anyApi.bookings!.book!, book("2026-11-04T10:00"));
    await vlad.mutation(anyApi.bookings!.book!, book("2026-11-03T10:00"));
    const mine = await ioana.query(anyApi.bookings!.mine!, {});
    expect(mine.map((b: { start: string; state: string }) => [b.start, b.state])).toEqual([["2026-11-04T10:00", "pending"], ["2026-11-02T14:00", "cancelled"]]);
    expect(mine[0]).toMatchObject({ canConfirm: true, canCancel: true, operatorName: "Ana M." });
    await expect(t.query(anyApi.bookings!.mine!, {})).rejects.toThrow("authentication_required");
  });
});

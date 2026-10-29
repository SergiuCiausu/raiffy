import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import schema from "./schema";
import { toInstant } from "../lib/booking/rules";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./bookings.ts": () => import("./bookings"),
  "./audit.ts": () => import("./audit"),
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

async function setup() {
  const t = convexTest(schema, modules);
  await t.withIdentity(identity("user_admin", "admin")).mutation(anyApi.bookings!.setAvailability!, ANA);
  return {
    t,
    ioana: t.withIdentity(identity("user_ioana", "member", { givenName: "Ioana", familyName: "Popescu" })),
    vlad: t.withIdentity(identity("user_vlad", "member", { givenName: "Vlad" })),
    ana: t.withIdentity(identity("user_ana", "operator")),
  };
}
const book = (start: string, over: Record<string, unknown> = {}) => ({ operatorId: "user_ana", start, channel: "video", topic: "Documents for a personal loan", sharePlan: false, ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(toInstant("2026-10-29T08:00", TZ)); });
afterEach(() => { vi.useRealTimers(); });

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
});

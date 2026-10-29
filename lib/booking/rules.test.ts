import { describe, expect, it } from "vitest";
import { DEFAULT_BOOKING_RULES as RULES, type Availability, type BookingFacts } from "./schemas";
import {
  attemptAllowed, bookingState, canCancel, canConfirm, canRecordOutcome, checkBooking, customerRef, joinWindow, openSlotsOn, pausedUntil,
  pauseOf, releaseAt, shareWindow, shortName, shouldRelease, slotsForCustomer, toInstant, toLocal, upcomingSlots,
} from "./rules";

const TZ = "Europe/Bucharest";
// console.html's Ana M.: weekdays 09:00–17:00, Friday until 13:00, lunch 12:30–13:30, a training day on 3 Nov
const AV: Availability = {
  operatorId: "u_ana", timeZone: TZ, slotMinutes: 30, bufferMinutes: 0, dailyCap: 5, minLeadHours: 2, horizonDays: 14,
  weekly: { 1: ["09:00", "17:00"], 2: ["09:00", "17:00"], 3: ["09:00", "17:00"], 4: ["09:00", "17:00"], 5: ["09:00", "13:00"] },
  breaks: [["12:30", "13:30"]],
  daysOff: [{ date: "2026-11-03", reason: "Team training" }],
};
const at = (local: string) => toInstant(local, TZ);
const bk = (start: string, over: Partial<BookingFacts> = {}): BookingFacts =>
  ({ operatorId: "u_ana", start, minutes: 30, status: "booked", confirmedAt: at("2026-10-27T10:00"), outcomeAt: null, ...over });

describe("wall-clock times", () => {
  it("converts Bucharest times either side of the October clock change", () => {
    expect(new Date(at("2026-10-23T10:00")).toISOString()).toBe("2026-10-23T07:00:00.000Z"); // summer time, UTC+3
    expect(new Date(at("2026-10-29T10:00")).toISOString()).toBe("2026-10-29T08:00:00.000Z"); // winter time, UTC+2
    expect(toLocal(Date.parse("2026-10-29T08:00:00Z"), TZ)).toBe("2026-10-29T10:00");
  });
});

describe("open slots", () => {
  const now = at("2026-10-29T08:00"); // Thursday
  it("follows the weekly hours, the lunch break and the lead time", () => {
    const thu = openSlotsOn(AV, [], "2026-10-29", now);
    expect(thu[0]).toBe("2026-10-29T10:00"); // 09:00 and 09:30 are inside the 2-hour lead time
    expect(thu).not.toContain("2026-10-29T12:30");
    expect(thu).not.toContain("2026-10-29T13:00");
    expect(thu.at(-1)).toBe("2026-10-29T16:30");
    expect(openSlotsOn(AV, [], "2026-10-30", now).at(-1)).toBe("2026-10-30T12:00"); // Friday ends at 13:00, lunch from 12:30
  });

  it("has nothing on weekends, days off and full days", () => {
    expect(openSlotsOn(AV, [], "2026-10-31", now)).toEqual([]);
    expect(openSlotsOn(AV, [], "2026-11-03", now)).toEqual([]);
    const full = ["09:00", "09:30", "10:00", "10:30", "11:00"].map((h) => bk(`2026-11-02T${h}`));
    expect(openSlotsOn(AV, full, "2026-11-02", now)).toEqual([]);
  });

  it("skips held slots and their buffer, but frees cancelled ones", () => {
    const held = [bk("2026-11-02T10:00"), bk("2026-11-02T11:00", { status: "cancelled" })];
    const mon = openSlotsOn({ ...AV, bufferMinutes: 10 }, held, "2026-11-02", now);
    expect(mon).not.toContain("2026-11-02T09:30");
    expect(mon).not.toContain("2026-11-02T10:00");
    expect(mon).not.toContain("2026-11-02T10:30");
    expect(mon).toContain("2026-11-02T11:00");
    expect(openSlotsOn(AV, [bk("2026-11-02T10:00", { operatorId: "u_other" })], "2026-11-02", now)).toContain("2026-11-02T10:00");
  });

  it("lists the horizon earliest first, up to a limit", () => {
    expect(upcomingSlots(AV, [], now, 3)).toEqual(["2026-10-29T10:00", "2026-10-29T10:30", "2026-10-29T11:00"]);
    expect(upcomingSlots({ ...AV, horizonDays: 1 }, [], now).every((s) => s.startsWith("2026-10-29"))).toBe(true);
  });
});

describe("booking", () => {
  const now = at("2026-10-29T08:00");
  const base = { availability: AV, bookings: [], customerBookings: [], now, rules: RULES };

  it("books an open slot, confirming it when it is less than a day away", () => {
    expect(checkBooking({ ...base, start: "2026-10-29T14:00" })).toEqual({ ok: true, confirmedAt: now });
    expect(checkBooking({ ...base, start: "2026-11-02T14:00" })).toEqual({ ok: true, confirmedAt: null });
  });

  it("refuses a taken, closed or invented slot", () => {
    expect(checkBooking({ ...base, bookings: [bk("2026-10-29T14:00")], start: "2026-10-29T14:00" })).toMatchObject({ ok: false, reason: "slot_unavailable" });
    expect(checkBooking({ ...base, start: "2026-10-31T10:00" })).toMatchObject({ ok: false, reason: "slot_unavailable" });
    expect(checkBooking({ ...base, start: "2026-10-29T14:15" })).toMatchObject({ ok: false, reason: "slot_unavailable" });
    expect(checkBooking({ ...base, start: "2026-12-29T10:00" })).toMatchObject({ ok: false, reason: "slot_unavailable" });
  });

  it("allows one open call per customer; a past or cancelled call doesn't count", () => {
    expect(checkBooking({ ...base, customerBookings: [bk("2026-11-02T10:00")], start: "2026-10-29T14:00" })).toMatchObject({ ok: false, reason: "already_booked" });
    const old = [bk("2026-10-26T10:00", { status: "done" }), bk("2026-11-02T10:00", { status: "cancelled" })];
    expect(checkBooking({ ...base, customerBookings: old, start: "2026-10-29T14:00" }).ok).toBe(true);
  });

  it("pauses booking for 30 days after two missed calls", () => {
    const missed = [bk("2026-10-20T10:00", { status: "no_show", outcomeAt: at("2026-10-20T10:40") }),
      bk("2026-10-27T10:00", { status: "no_show", outcomeAt: at("2026-10-27T10:40") })];
    expect(checkBooking({ ...base, customerBookings: missed, start: "2026-10-29T14:00" }))
      .toEqual({ ok: false, reason: "paused", pausedUntil: at("2026-10-27T10:40") + 30 * 24 * 3_600_000 });
    expect(pausedUntil(missed.slice(1), RULES, now)).toBeNull();
    expect(pausedUntil(missed, RULES, at("2026-12-01T10:00"))).toBeNull();
  });
});

describe("abuse limits", () => {
  const now = at("2026-10-29T08:00");
  const TWO = { ...RULES, openPerCustomer: 2 };
  const base = { availability: AV, bookings: [], now, rules: TWO };

  it("never lets a customer hold two calls at the same time, with any specialist, and frees the time once cancelled", () => {
    // 13:30 with another specialist in London is 15:30 in Bucharest
    const elsewhere = bk("2026-11-02T13:30", { operatorId: "u_ion", timeZone: "Europe/London" });
    expect(checkBooking({ ...base, customerBookings: [elsewhere], start: "2026-11-02T15:30" })).toMatchObject({ ok: false, reason: "same_time" });
    expect(checkBooking({ ...base, customerBookings: [{ ...elsewhere, status: "cancelled" }], start: "2026-11-02T15:30" }).ok).toBe(true);
    expect(checkBooking({ ...base, customerBookings: [elsewhere], start: "2026-11-02T16:00" }).ok).toBe(true);
  });

  it("allows one call a day with the same specialist", () => {
    const earlier = bk("2026-11-02T09:00", { operatorId: "u_ana" });
    expect(checkBooking({ ...base, customerBookings: [earlier], start: "2026-11-02T15:00" })).toMatchObject({ ok: false, reason: "one_per_day" });
    expect(checkBooking({ ...base, customerBookings: [{ ...earlier, operatorId: "u_ion" }], start: "2026-11-02T15:00" }).ok).toBe(true);
  });

  it("offers the customer only slots they could book", () => {
    const own = [bk("2026-10-29T14:00", { operatorId: "u_ion" })];
    const offered = slotsForCustomer(AV, [], own, now, 4);
    expect(offered).not.toContain("2026-10-29T14:00");
    expect(offered).toEqual(upcomingSlots(AV, [], now).filter((x) => x !== "2026-10-29T14:00").slice(0, 4));
  });

  it("pauses booking for 7 days after three cancellations in a week, but not for ones the specialist made", () => {
    const cancel = (start: string, day: string, by: "customer" | "operator" = "customer") =>
      bk(start, { status: "cancelled", cancelledBy: by, cancelledAt: at(`${day}T09:00`) });
    const three = [cancel("2026-11-02T10:00", "2026-10-26"), cancel("2026-11-02T11:00", "2026-10-27"), cancel("2026-11-02T14:00", "2026-10-28")];
    expect(checkBooking({ ...base, customerBookings: three, start: "2026-10-29T14:00" }))
      .toEqual({ ok: false, reason: "paused_cancellations", pausedUntil: at("2026-10-28T09:00") + 7 * 24 * 3_600_000 });
    expect(pauseOf([...three.slice(0, 2), cancel("2026-11-02T14:00", "2026-10-28", "operator")], RULES, now)).toBeNull();
    expect(pauseOf(three, RULES, at("2026-11-05T10:00"))).toBeNull();
  });

  it("allows five booking attempts in ten minutes, refused ones included", () => {
    const tries = [0, 1, 2, 3].map((m) => now - m * 60_000);
    expect(attemptAllowed(tries, RULES, now)).toBe(true);
    expect(attemptAllowed([...tries, now - 5 * 60_000], RULES, now)).toBe(false);
    expect(attemptAllowed([...tries, now - 11 * 60_000], RULES, now)).toBe(true);
  });
});

describe("after booking", () => {
  const pending = bk("2026-11-02T10:00", { confirmedAt: null });

  it("releases an unconfirmed call 24 hours before it", () => {
    expect(releaseAt(pending, TZ, RULES)).toBe(at("2026-11-01T10:00"));
    expect(bookingState(pending)).toBe("pending");
    expect(canConfirm(pending, TZ, RULES, at("2026-11-01T09:59"))).toBe(true);
    expect(shouldRelease(pending, TZ, RULES, at("2026-11-01T09:59"))).toBe(false);
    expect(shouldRelease(pending, TZ, RULES, at("2026-11-01T10:00"))).toBe(true);
    expect(canConfirm(pending, TZ, RULES, at("2026-11-01T10:00"))).toBe(false);
    expect(shouldRelease(bk("2026-11-02T10:00"), TZ, RULES, at("2026-11-02T09:00"))).toBe(false);
  });

  it("can be cancelled until it starts, and its outcome recorded only after", () => {
    const call = bk("2026-11-02T10:00");
    expect(canCancel(call, TZ, at("2026-11-02T09:59"))).toBe(true);
    expect(canCancel(call, TZ, at("2026-11-02T10:00"))).toBe(false);
    expect(canRecordOutcome(call, TZ, at("2026-11-02T09:59"))).toBe(false);
    expect(canRecordOutcome(call, TZ, at("2026-11-02T10:05"))).toBe(true);
    expect(canRecordOutcome({ ...call, status: "done" }, TZ, at("2026-11-02T10:05"))).toBe(false);
  });

  it("opens the video link 10 minutes before a confirmed call, and a shared plan 15 minutes before until a day after", () => {
    const call = bk("2026-11-02T10:00");
    expect(joinWindow(call, TZ, RULES, at("2026-11-02T09:49")).open).toBe(false);
    expect(joinWindow(call, TZ, RULES, at("2026-11-02T09:50")).open).toBe(true);
    expect(joinWindow(call, TZ, RULES, at("2026-11-02T10:31")).open).toBe(false);
    expect(joinWindow(pending, TZ, RULES, at("2026-11-02T09:55")).open).toBe(false);
    expect(shareWindow(call, true, TZ, RULES, at("2026-11-02T09:45")).open).toBe(true);
    expect(shareWindow(call, true, TZ, RULES, at("2026-11-03T10:29")).open).toBe(true);
    expect(shareWindow(call, true, TZ, RULES, at("2026-11-03T10:31")).open).toBe(false);
    expect(shareWindow(call, false, TZ, RULES, at("2026-11-02T10:00")).open).toBe(false);
  });
});

describe("customer names in the calendar", () => {
  it("shows a first name and initial, and a stable pseudonymous reference", () => {
    expect(shortName("Ioana", "Popescu")).toBe("Ioana P.");
    expect(shortName("Ioana", undefined)).toBe("Ioana");
    expect(shortName(" ", "Popescu")).toBeNull();
    expect(customerRef("https://clerk|user_1")).toMatch(/^C-\d{4}$/);
    expect(customerRef("https://clerk|user_1")).toBe(customerRef("https://clerk|user_1"));
  });
});

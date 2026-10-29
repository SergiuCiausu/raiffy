import { z } from "zod";
import {
  availabilitySchema, bookingCheckSchema, bookingFactsSchema, bookingRulesSchema, localDateSchema, localDateTimeSchema,
  type Availability, type BookingCheck, type BookingFacts, type BookingRules,
} from "./schemas";

/*
 * Pure booking rules, the same ones console.html runs on its mock data (openSlots, releaseAt, shareWindow).
 * Wall-clock times are in the operator's zone; `now` and every returned instant are epoch milliseconds.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const parts = (ms: number, timeZone: string) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(p.find((x) => x.type === type)!.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
};
const offset = (ms: number, timeZone: string) => {
  const x = parts(ms, timeZone);
  return Date.UTC(x.y, x.mo - 1, x.d, x.h, x.mi) - Math.floor(ms / MINUTE) * MINUTE;
};

/** The instant a wall-clock time names in a zone. A time skipped by a clock change resolves forward. */
export function toInstant(local: string, timeZone: string): number {
  const at = localDateTimeSchema.parse(local);
  const guess = Date.UTC(+at.slice(0, 4), +at.slice(5, 7) - 1, +at.slice(8, 10), +at.slice(11, 13), +at.slice(14, 16));
  const first = guess - offset(guess, timeZone);
  return guess - offset(first, timeZone);
}

/** The wall-clock time of an instant in a zone. */
export function toLocal(ms: number, timeZone: string): string {
  const x = parts(ms, timeZone);
  const n = (v: number, w = 2) => String(v).padStart(w, "0");
  return `${n(x.y, 4)}-${n(x.mo)}-${n(x.d)}T${n(x.h)}:${n(x.mi)}`;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10);
const weekday = (date: string) => String(new Date(`${date}T00:00:00Z`).getUTCDay()) as keyof Availability["weekly"];

/** Bookings that hold a slot: anything not cancelled, for this operator on this day, in start order. */
function heldOn(bookings: readonly BookingFacts[], operatorId: string, date: string) {
  return bookings.filter((b) => b.status !== "cancelled" && b.operatorId === operatorId && b.start.slice(0, 10) === date)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** Open slots on one day: weekly hours, breaks, days off, a buffer around calls, the daily cap and the lead time. */
export function openSlotsOn(rawAvailability: Availability, rawBookings: readonly BookingFacts[], rawDate: string, now: number): string[] {
  const av = availabilitySchema.parse(rawAvailability);
  const bookings = z.array(bookingFactsSchema).parse(rawBookings);
  const date = localDateSchema.parse(rawDate);
  const hours = av.weekly[weekday(date)];
  const taken = heldOn(bookings, av.operatorId, date);
  if (!hours || av.daysOff.some((o) => o.date === date) || taken.length >= av.dailyCap) return [];
  const out: string[] = [];
  for (let m = minutesOf(hours[0]); m + av.slotMinutes <= minutesOf(hours[1]); m += av.slotMinutes) {
    const end = m + av.slotMinutes;
    if (av.breaks.some(([from, to]) => m < minutesOf(to) && end > minutesOf(from))) continue;
    if (taken.some((b) => {
      const s = minutesOf(b.start.slice(11));
      return m < s + b.minutes + av.bufferMinutes && end > s - av.bufferMinutes;
    })) continue;
    const start = `${date}T${hhmmOf(m)}`;
    if (toInstant(start, av.timeZone) - now < av.minLeadHours * HOUR) continue;
    out.push(start);
  }
  return out;
}

/** Open slots from today through the horizon, earliest first. */
export function upcomingSlots(availability: Availability, bookings: readonly BookingFacts[], now: number, limit = Infinity): string[] {
  const av = availabilitySchema.parse(availability);
  const today = toLocal(now, av.timeZone).slice(0, 10);
  const out: string[] = [];
  for (let i = 0; i < av.horizonDays && out.length < limit; i += 1) out.push(...openSlotsOn(av, bookings, addDays(today, i), now));
  return out.slice(0, limit);
}

const endOf = (b: Pick<BookingFacts, "start" | "minutes">, timeZone: string) => toInstant(b.start, timeZone) + b.minutes * MINUTE;

/** A booked call still ahead of the customer counts towards their limit, confirmed or not. */
export function isOpen(b: BookingFacts, timeZone: string, now: number): boolean {
  return b.status === "booked" && endOf(b, timeZone) > now;
}

/** After `noShowPauseAfter` missed calls within `pauseDays`, booking pauses until `pauseDays` after the last one. */
export function pausedUntil(customerBookings: readonly BookingFacts[], rawRules: BookingRules, now: number): number | null {
  const rules = bookingRulesSchema.parse(rawRules);
  const missed = customerBookings.filter((b) => b.status === "no_show" && b.outcomeAt !== null && now - b.outcomeAt! < rules.pauseDays * 24 * HOUR)
    .map((b) => b.outcomeAt!).sort((a, b) => b - a);
  if (missed.length < rules.noShowPauseAfter) return null;
  return missed[0]! + rules.pauseDays * 24 * HOUR;
}

/**
 * Whether a customer may take a slot now. `bookings` are the operator's, `customerBookings` the customer's own.
 * A booking made inside the confirmation window is confirmed by making it.
 */
export function checkBooking(input: {
  availability: Availability; bookings: readonly BookingFacts[]; customerBookings: readonly BookingFacts[];
  start: string; now: number; rules: BookingRules;
}): BookingCheck {
  const av = availabilitySchema.parse(input.availability);
  const rules = bookingRulesSchema.parse(input.rules);
  const start = localDateTimeSchema.parse(input.start);
  const paused = pausedUntil(input.customerBookings, rules, input.now);
  if (paused !== null) return bookingCheckSchema.parse({ ok: false, reason: "paused", pausedUntil: paused });
  if (input.customerBookings.filter((b) => isOpen(b, av.timeZone, input.now)).length >= rules.openPerCustomer) {
    return bookingCheckSchema.parse({ ok: false, reason: "already_booked", pausedUntil: null });
  }
  if (!upcomingSlots(av, input.bookings, input.now).includes(start)) {
    return bookingCheckSchema.parse({ ok: false, reason: "slot_unavailable", pausedUntil: null });
  }
  const confirmed = toInstant(start, av.timeZone) - input.now <= rules.confirmBeforeHours * HOUR ? input.now : null;
  return bookingCheckSchema.parse({ ok: true, confirmedAt: confirmed });
}

/** When an unconfirmed call is released. */
export function releaseAt(b: Pick<BookingFacts, "start">, timeZone: string, rules: BookingRules): number {
  return toInstant(b.start, timeZone) - bookingRulesSchema.parse(rules).confirmBeforeHours * HOUR;
}

/** booked and unconfirmed reads as "pending" on screen. Released and finished calls keep their stored status. */
export function bookingState(b: BookingFacts): "pending" | BookingFacts["status"] {
  return b.status === "booked" && b.confirmedAt === null ? "pending" : b.status;
}

export function shouldRelease(b: BookingFacts, timeZone: string, rules: BookingRules, now: number): boolean {
  return b.status === "booked" && b.confirmedAt === null && now >= releaseAt(b, timeZone, rules);
}

export function canConfirm(b: BookingFacts, timeZone: string, rules: BookingRules, now: number): boolean {
  return b.status === "booked" && b.confirmedAt === null && now < releaseAt(b, timeZone, rules);
}

/** Either side can cancel a booked call until it starts. */
export function canCancel(b: BookingFacts, timeZone: string, now: number): boolean {
  return b.status === "booked" && now < toInstant(b.start, timeZone);
}

/** The operator records done or no-show once the call has started. */
export function canRecordOutcome(b: BookingFacts, timeZone: string, now: number): boolean {
  return b.status === "booked" && b.confirmedAt !== null && now >= toInstant(b.start, timeZone);
}

export type Window = { from: number; to: number; open: boolean };

/** The video link works from shortly before a confirmed call until it ends. */
export function joinWindow(b: BookingFacts, timeZone: string, rules: BookingRules, now: number): Window {
  const from = toInstant(b.start, timeZone) - bookingRulesSchema.parse(rules).joinBeforeMinutes * MINUTE;
  const to = endOf(b, timeZone);
  return { from, to, open: b.status === "booked" && b.confirmedAt !== null && now >= from && now <= to };
}

/** A plan the customer chose to share opens to the operator shortly before the call and closes a day after it. */
export function shareWindow(b: BookingFacts, shared: boolean, timeZone: string, rawRules: BookingRules, now: number): Window {
  const rules = bookingRulesSchema.parse(rawRules);
  const from = toInstant(b.start, timeZone) - rules.shareBeforeMinutes * MINUTE;
  const to = endOf(b, timeZone) + rules.shareAfterHours * HOUR;
  return { from, to, open: shared && b.status !== "cancelled" && now >= from && now <= to };
}

/** "Ioana P." from a Clerk name, or null when there is no first name to show. */
export function shortName(given: string | undefined, family: string | undefined): string | null {
  const first = given?.trim();
  if (!first) return null;
  const initial = family?.trim().charAt(0);
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/** A stable pseudonymous reference for the operator's calendar ("C-4821"), never the identity itself. */
export function customerRef(ownerKey: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < ownerKey.length; i += 1) h = Math.imul(h ^ ownerKey.charCodeAt(i), 0x01000193) >>> 0;
  return `C-${String(1000 + (h % 9000))}`;
}

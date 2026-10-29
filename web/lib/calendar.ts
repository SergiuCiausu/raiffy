import type { AgendaItem, Availability } from "./booking-api";

/*
 * The calendar page's arithmetic (console.html gridHTML, outsideHours, avError), on wall-clock strings in the
 * operator's zone: "2026-10-29" and "2026-10-29T14:00". The open slots themselves come from convex/bookings.ts.
 */

export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** Date#getDay of a date, as the key `weekly` uses. */
export const weekday = (date: string) => String(new Date(`${date}T00:00:00Z`).getUTCDay());
export const endOf = (b: Pick<AgendaItem, "start" | "minutes">) => minutesOf(b.start.slice(11)) + b.minutes;
export const hoursOn = (av: Availability | null, date: string) => {
  const h = av?.weekly[weekday(date)];
  return h && h.length === 2 ? (h as [string, string]) : null;
};
export const dayOff = (av: Availability | null, date: string) => av?.daysOff.find((o) => o.date === date) ?? null;

/** The wall-clock time of an instant in a zone. */
export function localAt(ms: number, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The rows the week grid shows, in whole hours: every day's hours and every call, else 09:00 to 17:00. */
export function gridRange(dates: readonly string[], av: Availability | null, items: readonly AgendaItem[]) {
  let first = 24 * 60, last = 0;
  for (const d of dates) {
    const h = hoursOn(av, d);
    if (h) { first = Math.min(first, minutesOf(h[0])); last = Math.max(last, minutesOf(h[1])); }
  }
  for (const b of items) { first = Math.min(first, minutesOf(b.start.slice(11))); last = Math.max(last, endOf(b)); }
  if (first >= last) { first = 9 * 60; last = 17 * 60; }
  return { first: Math.floor(first / 60) * 60, last: Math.min(24 * 60, Math.ceil(last / 60) * 60) };
}

/** A booked call the new hours would no longer cover. It stays booked; the page says so. */
export function outsideHours(av: Availability, b: Pick<AgendaItem, "start" | "minutes">): boolean {
  const date = b.start.slice(0, 10), h = hoursOn(av, date), s = minutesOf(b.start.slice(11));
  return !h || !!dayOff(av, date) || s < minutesOf(h[0]) || s + b.minutes > minutesOf(h[1])
    || av.breaks.some(([from, to]) => s < minutesOf(to!) && s + b.minutes > minutesOf(from!));
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** What's wrong with edited hours, in the words the form shows, or null. */
export function availabilityError(av: Availability): string | null {
  for (const [day, h] of Object.entries(av.weekly)) if (h.length !== 2 || minutesOf(h[0]!) >= minutesOf(h[1]!)) return `${DAY_NAMES[Number(day)]}: the end has to be after the start.`;
  const br = av.breaks[0];
  if (br && minutesOf(br[0]!) >= minutesOf(br[1]!)) return "The break has to end after it starts.";
  if (!Number.isInteger(av.dailyCap) || av.dailyCap < 1 || av.dailyCap > 16) return "Calls a day has to be between 1 and 16.";
  return null;
}

/**
 * Hours for someone who hasn't saved their own. Mirror of DEFAULT_HOURS in ../../lib/booking/schemas.ts, which
 * convex/bookings.ts offers customers; the web build can't import the root lib, and calendar.test.ts checks they match.
 */
export const DEFAULT_AVAILABILITY: Availability = {
  timeZone: "Europe/Bucharest",
  weekly: { 1: ["09:00", "17:00"], 2: ["09:00", "17:00"], 3: ["09:00", "17:00"], 4: ["09:00", "17:00"], 5: ["09:00", "17:00"] },
  breaks: [["12:30", "13:30"]], slotMinutes: 30, bufferMinutes: 10, dailyCap: 6, minLeadHours: 2, horizonDays: 14, daysOff: [],
};

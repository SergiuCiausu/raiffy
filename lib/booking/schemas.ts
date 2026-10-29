import { z } from "zod";

/*
 * Booking a call with a specialist (an operator), as drawn in console.html#calendar and the `.book` card in chat.html.
 * Only operators are bookable for now, and the call goes through information with the customer: it is never advice
 * or a credit decision. Times are wall-clock strings in the operator's time zone ("2026-10-29T09:30"), so a slot
 * means the same thing on every screen; rules convert them to instants with the zone passed in.
 */

export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
const span = z.tuple([localTimeSchema, localTimeSchema]).refine(([from, to]) => from < to, "span_empty");

/** Weekday keys follow Date#getDay: "0" is Sunday. A missing day is a day without calls. */
export const WEEKDAYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

export const availabilitySchema = z.object({
  operatorId: z.string().min(1),
  /** An IANA zone, such as Europe/Bucharest. */
  timeZone: z.string().min(1),
  weekly: z.partialRecord(z.enum(WEEKDAYS), span),
  breaks: z.array(span).max(4),
  slotMinutes: z.union([z.literal(30), z.literal(60)]),
  bufferMinutes: z.number().int().min(0).max(60),
  dailyCap: z.number().int().min(1).max(16),
  /** Customers can't book a slot that starts sooner than this. */
  minLeadHours: z.number().int().min(0).max(72),
  /** How many days ahead slots are offered, today included. */
  horizonDays: z.number().int().min(1).max(60),
  daysOff: z.array(z.object({ date: localDateSchema, reason: z.string().max(80) })).max(60),
});
export type Availability = z.infer<typeof availabilitySchema>;

/** The hours every operator and admin is bookable on until they, or an admin, save their own. */
export const DEFAULT_HOURS: Omit<Availability, "operatorId"> = availabilitySchema.omit({ operatorId: true }).parse({
  timeZone: "Europe/Bucharest",
  weekly: { 1: ["09:00", "17:00"], 2: ["09:00", "17:00"], 3: ["09:00", "17:00"], 4: ["09:00", "17:00"], 5: ["09:00", "17:00"] },
  breaks: [["12:30", "13:30"]], slotMinutes: 30, bufferMinutes: 10, dailyCap: 6, minLeadHours: 2, horizonDays: 14, daysOff: [],
});

/** The console's BOOK_RULES. Limits a later version reads from Parameters. */
export const bookingRulesSchema = z.object({
  openPerCustomer: z.number().int().min(1).max(3),
  /** Cancelling this many calls within `cancelWindowDays` pauses booking for `cancelPauseDays` after the last one. */
  cancelPauseAfter: z.number().int().min(1).max(20),
  cancelWindowDays: z.number().int().min(1).max(90),
  cancelPauseDays: z.number().int().min(1).max(90),
  /** Booking attempts a customer may make (refused ones count) within `attemptWindowMinutes`. */
  attemptsPerWindow: z.number().int().min(1).max(50),
  attemptWindowMinutes: z.number().int().min(1).max(1440),
  /** A call not confirmed this long before it starts is released. Booking inside the window counts as confirming. */
  confirmBeforeHours: z.number().int().min(1).max(72),
  noShowPauseAfter: z.number().int().min(1).max(10),
  pauseDays: z.number().int().min(1).max(90),
  /** The shared plan opens to the operator this long before the call and closes this long after it ends. */
  shareBeforeMinutes: z.number().int().min(0).max(120),
  shareAfterHours: z.number().int().min(0).max(72),
  /** The video link works from this long before the call until it ends. */
  joinBeforeMinutes: z.number().int().min(0).max(60),
});
export type BookingRules = z.infer<typeof bookingRulesSchema>;

export const DEFAULT_BOOKING_RULES: BookingRules = bookingRulesSchema.parse({
  openPerCustomer: 1, cancelPauseAfter: 3, cancelWindowDays: 7, cancelPauseDays: 7, attemptsPerWindow: 5, attemptWindowMinutes: 10,
  confirmBeforeHours: 24, noShowPauseAfter: 2, pauseDays: 30,
  shareBeforeMinutes: 15, shareAfterHours: 24, joinBeforeMinutes: 10,
});

export const bookingStatusSchema = z.enum(["booked", "done", "no_show", "cancelled"]);
export const cancelledBySchema = z.enum(["customer", "operator", "not_confirmed"]);
export const channelSchema = z.enum(["video", "phone"]);

/** What the rules read from a stored booking. Instants are epoch milliseconds. */
export const bookingFactsSchema = z.object({
  operatorId: z.string().min(1),
  start: localDateTimeSchema,
  minutes: z.number().int().positive(),
  status: bookingStatusSchema,
  confirmedAt: z.number().nullable(),
  /** When a no-show was recorded, for the pause. */
  outcomeAt: z.number().nullable(),
  /** The operator's zone, needed to compare a customer's calls with different specialists. Defaults to the one being booked. */
  timeZone: z.string().min(1).optional(),
  /** Who cancelled and when, for the pause after repeated cancellations. */
  cancelledBy: cancelledBySchema.optional(),
  cancelledAt: z.number().optional(),
});
export type BookingFacts = z.infer<typeof bookingFactsSchema>;

export const BOOKING_REFUSALS = ["slot_unavailable", "already_booked", "same_time", "one_per_day", "paused", "paused_cancellations", "too_many_attempts"] as const;
export type BookingRefusal = (typeof BOOKING_REFUSALS)[number];

export const bookingCheckSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), confirmedAt: z.number().nullable() }),
  z.object({ ok: z.literal(false), reason: z.enum(BOOKING_REFUSALS), pausedUntil: z.number().nullable() }),
]);
export type BookingCheck = z.infer<typeof bookingCheckSchema>;

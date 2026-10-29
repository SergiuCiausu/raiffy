import { makeFunctionReference } from "convex/server";
import type { MessageId, ThreadId } from "@/lib/agent-api";
import type { PlanSummary } from "../../lib/plan/schemas";

/*
 * Typed references to ../convex/bookings.ts and the plan list in ../convex/plans.ts, mirrored like agent-api.ts.
 * Keep them in step with the Convex functions.
 */

export type Channel = "video" | "phone";
export type BookingState = "pending" | "booked" | "done" | "no_show" | "cancelled";

export type BookableOperator = {
  operatorId: string; name: string; title: string; initials: string; minutes: number; timeZone: string;
  /** Wall-clock starts in timeZone, "2026-10-29T10:00", computed on the server. */
  slots: string[];
};

export type CustomerBooking = {
  bookingId: string; operatorName: string; operatorTitle: string; start: string; minutes: number; timeZone: string;
  channel: Channel; topic: string; state: BookingState;
  cancelledBy: null | "customer" | "operator" | "not_confirmed"; cancelReason: string | null;
  confirmBy: number; canConfirm: boolean; canCancel: boolean;
  reminder: null | "confirm" | "starts_soon";
  joinFrom: number; joinUrl: string | null;
  planId: string | null; sharePlan: boolean;
};

export type BookingOptions = { operators: BookableOperator[]; booking: CustomerBooking | null; pausedUntil: number | null };
export type BookResult = { status: "booked"; bookingId: string } | { status: "refused"; reason: string; pausedUntil: number | null };

export const bookingApi = {
  options: makeFunctionReference<"query", Record<string, never>, BookingOptions>("bookings:options"),
  book: makeFunctionReference<"mutation", { operatorId: string; start: string; channel: Channel; topic: string; threadId?: ThreadId; sharePlan: boolean }, BookResult>("bookings:book"),
  confirm: makeFunctionReference<"mutation", { bookingId: string }, null>("bookings:confirm"),
  cancel: makeFunctionReference<"mutation", { bookingId: string }, null>("bookings:cancel"),
};

export type PlanListItem = { planId: string; version: number; createdAt: number; amount: number; termMonths: number; monthly: number; checked: string; messageId?: MessageId };
export const planListApi = {
  listForThread: makeFunctionReference<"query", { threadId: ThreadId }, PlanListItem[]>("plans:listForThread"),
};

/** "Build my plan" (convex/plans.ts): the server builds it from the stored answer and the reviewed catalog. */
export type BuildPlanResult = { status: "ok"; planId: string; version: number }
  | { status: "unavailable"; why: "no_figures" | "not_in_catalog" | "no_template" | "catalog_gaps"; gaps: { role: string; reason: string }[] };
export const planApi = {
  ...planListApi,
  buildFromAnswer: makeFunctionReference<"mutation", { messageId: MessageId; amount?: number; termMonths?: number }, BuildPlanResult>("plans:buildFromAnswer"),
  get: makeFunctionReference<"query", { planId: string; version?: number }, { plan: PlanSummary; latestVersion: number }>("plans:get"),
};

/* ───────────── The operator's calendar (console.html#calendar) ───────────── */

/** Weekly hours keyed by Date#getDay ("1" is Monday), each a ["09:00", "17:00"] span. */
export type Availability = {
  timeZone: string; weekly: Record<string, string[]>; breaks: string[][];
  slotMinutes: number; bufferMinutes: number; dailyCap: number; minLeadHours: number; horizonDays: number;
  daysOff: { date: string; reason: string }[];
};

export type AgendaItem = {
  bookingId: string; customerRef: string; customerName: string; start: string; minutes: number; timeZone: string;
  channel: Channel; topic: string; state: BookingState; cancelledBy: null | "customer" | "operator" | "not_confirmed";
  canCancel: boolean; canRecordOutcome: boolean; joinUrl: string | null; joinFrom: number;
  sharedPlan: null | { planId: string; version: number; plan: unknown }; planShared: boolean;
};

export type CalendarWeek = {
  operatorId: string;
  operator: null | { name: string; title: string; active: boolean };
  availability: Availability | null;
  timeZone: string; now: number; today: string; week: string; weekOffset: number;
  days: { date: string; open: string[] }[];
  items: AgendaItem[]; next: AgendaItem | null;
  missed: { customerRef: string; customerName: string; count: number; pausedUntil: number | null }[];
  rules: { confirmBeforeHours: number; shareBeforeMinutes: number; shareAfterHours: number; joinBeforeMinutes: number; noShowPauseAfter: number; pauseDays: number };
};

export type CalendarOwner = { operatorId: string; name: string; title: string; active: boolean };

/** Admin › Specialists: everyone customers can book. `custom` is false while they're on the default hours. */
export type SpecialistRow = {
  operatorId: string; name: string; title: string; role: "operator" | "admin"; email: string | null;
  active: boolean; custom: boolean; availability: Availability; today: string;
  /** What the chat offers next, wall-clock in the specialist's zone. */
  nextSlots: string[];
  /** Booked calls still ahead. */
  upcoming: number;
};

export const calendarApi = {
  calendar: makeFunctionReference<"query", { operatorId?: string; weekOffset?: number }, CalendarWeek>("bookings:calendar"),
  calendars: makeFunctionReference<"query", Record<string, never>, CalendarOwner[]>("bookings:calendars"),
  specialists: makeFunctionReference<"query", Record<string, never>, SpecialistRow[]>("bookings:specialists"),
  setAvailability: makeFunctionReference<"mutation", { operatorId: string; name: string; title: string; active: boolean; availability: Availability }, null>("bookings:setAvailability"),
  operatorCancel: makeFunctionReference<"mutation", { bookingId: string; reason: string }, null>("bookings:operatorCancel"),
  recordOutcome: makeFunctionReference<"mutation", { bookingId: string; outcome: "done" | "no_show" }, null>("bookings:recordOutcome"),
};

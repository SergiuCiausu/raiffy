import { makeFunctionReference } from "convex/server";
import type { ThreadId } from "@/lib/agent-api";

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

export type PlanListItem = { planId: string; version: number; createdAt: number; amount: number; termMonths: number; monthly: number; checked: string };
export const planListApi = {
  listForThread: makeFunctionReference<"query", { threadId: ThreadId }, PlanListItem[]>("plans:listForThread"),
};

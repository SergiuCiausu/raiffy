import { makeFunctionReference } from "convex/server";
import type { PlanSummary } from "../../lib/plan/schemas";

/* Typed references to ../convex/planChecks.ts: the customer's "Check my plan" and the operators' queue. */

export type PlanCheckStatus = "open" | "confirmed" | "corrected" | "returned";
export type PlanCheckRow = {
  id: string; reference: string; status: PlanCheckStatus; track: "personal" | "business"; planId: string; version: number;
  product: string; amount: number; termMonths: number; monthly: number; hasNote: boolean;
  createdAt: number; decidedAt: number | null; decidedBy: string | null;
};
/** lib/plan/checks.ts: worked out on the server when the check is opened. */
export type AutomaticCheck = { key: "figures_add_up" | "catalog_current" | "affordability" | "rate_range"; status: "pass" | "warn" | "fail"; detail: string; params?: Record<string, string | number> };
export type PlanCheckCase = PlanCheckRow & {
  plan: PlanSummary; note: string | null; customerNote: string | null; reason: string | null; latestVersion: number; checks: AutomaticCheck[];
  emails: { kind: "received" | "decided"; outcome: "sent" | "test" | "skipped"; reason: string | null; at: number }[];
};

/** One row of "Your plans" (convex/plans.ts `mine`): the latest version of a plan and where it stands. */
export type MyPlan = {
  planId: string; version: number; threadId: string; createdAt: number; product: string; amount: number; termMonths: number;
  monthly: number; monthlyLow: number | null; figuresFrom: "catalog" | "cited_page"; source: string;
  state: "unchecked" | "changed" | "pending" | "checked"; verification: PlanSummary["verification"];
  check: { reference: string; version: number; status: PlanCheckStatus; createdAt: number; decidedAt: number | null } | null;
};

export const planCheckApi = {
  mine: makeFunctionReference<"query", { track: "personal" | "business" }, MyPlan[]>("plans:mine"),
  request: makeFunctionReference<"mutation", { planId: string; version: number; note?: string }, { reference: string }>("planChecks:request"),
  list: makeFunctionReference<"query", Record<string, never>, { open: PlanCheckRow[]; decided: PlanCheckRow[] }>("planChecks:list"),
  get: makeFunctionReference<"query", { checkId: string }, PlanCheckCase | null>("planChecks:get"),
  decide: makeFunctionReference<"mutation", { checkId: string; decision: "confirm" | "correct" | "return"; note?: string; reason?: string }, null>("planChecks:decide"),
};

export const PLAN_CHECK_ERRORS: Record<string, string> = {
  forbidden: "Your role can’t do that.",
  note_required: "Add the note the customer will read.",
  reason_required: "Add why it needed a correction. Only the team sees it.",
  checks_failed: "An automatic check fails. Send the plan back instead of confirming it.",
  note_too_long: "Keep the note under 500 characters.",
  already_decided: "Someone already decided this check.",
  not_found: "This check isn’t there any more.",
};

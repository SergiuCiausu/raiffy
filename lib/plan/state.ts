import type { PlanVerification } from "./schemas";

/*
 * Where a plan stands with a specialist, for "Your plans" (chat.html #plans): not checked yet, changed after a check,
 * being checked, or checked (confirmed, confirmed with a note, or sent back). The first two get "Check my plan".
 */
export type PlanState = "unchecked" | "changed" | "pending" | "checked";

export function planState(v: PlanVerification): PlanState {
  if (v.level === "pending_review") return "pending";
  if (v.changed) return "changed";
  return v.level === "none" ? "unchecked" : "checked";
}

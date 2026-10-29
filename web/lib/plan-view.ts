import type { PlanSummary } from "../../lib/plan/schemas";

/*
 * What the chat's plan card shows of a PlanSummary (chat.html c.type === 'plan'). The plan is built on the server
 * from the catalog (convex/plans.ts); this only picks and shapes its figures. Money stays in bani until formatted.
 */

const bani = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "961.21 lei" from 96121 bani. */
export const lei2 = (amount: number) => `${bani.format(amount / 100)} lei`;

export type PlanCardView = {
  id: string; version: number; goal: string; product: string; amount: number; termMonths: number; recommended: boolean;
  monthly: number; total: number; daePercent: string; upfrontFee: number | null;
  /** The balance after each sampled month, as a share of the amount (0–100), starting with the full amount. */
  bars: number[]; paidOff: string;
  sources: string[]; check: "Not checked" | "Being checked" | "Confirmed" | "Changed after the check" | "Returned";
};

const CHECK: Record<PlanSummary["verification"]["level"], PlanCardView["check"]> = {
  none: "Not checked", pending_review: "Being checked", confirmed: "Confirmed", edited: "Confirmed", returned: "Returned",
};

export function planCardView(plan: PlanSummary): PlanCardView {
  const rows = plan.repaymentSchedule;
  const step = Math.max(1, Math.ceil(rows.length / 30));
  const amount = plan.goal.amount;
  const bars = [amount, ...rows.map((r) => r.balance)].filter((_, i) => i % step === 0).map((b) => Math.max(2, Math.round((b / amount) * 100)));
  const upfront = plan.figures.commissions.find((c) => c.basis === "charged" && c.frequency === "once");
  const last = rows.at(-1)!;
  return {
    id: plan.id, version: plan.version, goal: plan.goal.summary, product: plan.goal.product, amount, termMonths: plan.goal.termMonths,
    recommended: plan.routes.find((r) => r.chosen)?.recommended ?? false,
    monthly: plan.figures.monthly, total: plan.figures.total, daePercent: `${(plan.figures.dae * 100).toFixed(2)}%`,
    upfrontFee: upfront?.amount ?? null, bars,
    paidOff: new Date(`${last.date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
    sources: [...new Set(plan.sources.map((s) => new URL(s.url).hostname.replace(/^www\./, "")))],
    check: plan.verification.changed ? "Changed after the check" : CHECK[plan.verification.level],
  };
}

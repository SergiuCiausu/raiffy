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
  /** When the bank sets the rate within a published range: the plan's other end. The figures above are the top. */
  range: { minPercent: string; maxPercent: string; monthly: number; total: number; daePercent: string } | null;
  /** Where the figures come from: the reviewed catalog, or (demo only) the page the chat cited, and when. */
  cited: { on: string; unconfirmedFees: boolean } | null;
  fixedRate: boolean;
  sources: string[]; check: "Not checked" | "Being checked" | "Confirmed" | "Changed after the check" | "Returned";
};

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const bps = (n: number) => `${(n / 100).toFixed(2)}%`;

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
    monthly: plan.figures.monthly, total: plan.figures.total, daePercent: pct(plan.figures.dae),
    upfrontFee: upfront?.amount ?? null, bars,
    range: plan.terms.rateRange && plan.figures.atLowest ? {
      minPercent: bps(plan.terms.rateRange.minBps), maxPercent: bps(plan.terms.rateRange.maxBps),
      monthly: plan.figures.atLowest.monthly, total: plan.figures.atLowest.total, daePercent: pct(plan.figures.atLowest.dae),
    } : null,
    paidOff: new Date(`${last.date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
    cited: plan.figuresFrom === "cited_page" ? {
      on: new Date(plan.sources[0]!.collectedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Bucharest" }),
      unconfirmedFees: plan.figures.commissions.some((c) => c.basis === "missing"),
    } : null,
    fixedRate: plan.terms.rateType === "fixed",
    sources: [...new Set(plan.sources.map((s) => new URL(s.url).hostname.replace(/^www\./, "")))],
    check: plan.verification.changed ? "Changed after the check" : CHECK[plan.verification.level],
  };
}

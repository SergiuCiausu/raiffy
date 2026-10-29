import type { TermRecord } from "../catalog/schemas";
import { planInvariants, type PlanTemplate } from "./build";
import type { PlanSummary } from "./schemas";

/*
 * The automatic checks a specialist sees next to a plan (console.html planChecks), worked out on the server when the
 * check is opened. Pure: the plan, today's catalog records for its product, its template and the clock come in.
 * A failing check blocks confirming; a warning asks the specialist to look. Keys and values, not sentences: the
 * console words them.
 */

export type PlanCheckResult = {
  key: "figures_add_up" | "catalog_current" | "affordability" | "rate_range";
  status: "pass" | "warn" | "fail";
  /** Why, as a key the console words, with what it needs. */
  detail: string;
  params?: Record<string, string | number>;
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function planCheckList(input: { plan: PlanSummary; records: readonly TermRecord[]; template?: PlanTemplate; now: number }): PlanCheckResult[] {
  const { plan, records, template, now } = input;
  const out: PlanCheckResult[] = [];

  const failed = planInvariants(plan, plan.figuresFrom === "catalog" ? template : undefined);
  out.push(failed.length
    ? { key: "figures_add_up", status: "fail", detail: "invariants_failed", params: { failed: failed.join(", ") } }
    : { key: "figures_add_up", status: "pass", detail: "schedule_matches", params: { total: plan.figures.total, amount: plan.goal.amount } });

  if (plan.figuresFrom === "cited_page") {
    out.push({ key: "catalog_current", status: "warn", detail: "cited_page", params: { url: plan.sources[0]!.url, citedAt: plan.sources[0]!.collectedAt } });
  } else {
    const changed: string[] = [], lapsed: string[] = [];
    for (const s of plan.sources) {
      const r = records.find((x) => x.termId === s.termId);
      if (!r || r.provenance.url !== s.url || r.provenance.collectedAt !== s.collectedAt || (r.verification.reviewedAt ?? "") !== (s.reviewedAt ?? "")) changed.push(r?.label ?? s.termId);
      else if (r.provenance.reviewBy < day(now)) lapsed.push(r.label);
    }
    out.push(changed.length ? { key: "catalog_current", status: "fail", detail: "changed_since", params: { terms: changed.join(", ") } }
      : lapsed.length ? { key: "catalog_current", status: "warn", detail: "review_lapsed", params: { terms: lapsed.join(", ") } }
      : { key: "catalog_current", status: "pass", detail: "current", params: { count: plan.sources.length } });
  }

  const a = plan.affordability;
  const ceiling = template?.debtShareCeilingTermId ? records.find((r) => r.termId === template.debtShareCeilingTermId) : undefined;
  const ceilingBps = ceiling?.value.type === "exact" && ceiling.unit === "bps" ? ceiling.value.amount : null;
  if (!a) out.push({ key: "affordability", status: "warn", detail: "not_checked" });
  else if (ceilingBps === null) out.push({ key: "affordability", status: "warn", detail: "no_ceiling", params: { debtShareBps: a.debtShareBps } });
  else out.push({ key: "affordability", status: a.debtShareBps > ceilingBps ? "fail" : "pass", detail: a.debtShareBps > ceilingBps ? "above_ceiling" : "within_ceiling", params: { debtShareBps: a.debtShareBps, ceilingBps } });

  if (plan.terms.rateRange) out.push({ key: "rate_range", status: "warn", detail: "rate_set_by_bank", params: { minBps: plan.terms.rateRange.minBps, maxBps: plan.terms.rateRange.maxBps } });
  return out;
}

/** Confirming (with or without a correction) needs every check to pass or only warn. */
export const blocksConfirm = (checks: readonly PlanCheckResult[]) => checks.some((c) => c.status === "fail");

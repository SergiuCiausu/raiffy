import { z } from "zod";
import { assemblePlan, planBaseInputSchema } from "./build";
import type { BuildPlanResult, Commission, CommissionKey, PlanGap, PlanNote, PlanSource } from "./schemas";

/*
 * The demo fallback for "Build my plan" when the reviewed catalog can't back the loan (no product, no template, or
 * terms not reviewed yet). CLAUDE.md allows the demo to quote rates and fees from that turn's cited search results,
 * labelled as dated public figures: so the plan is figured from the simulation card's own rate, longest term and fees,
 * each of which the answer's number check found in a cited passage. It is marked figuresFrom "cited_page", never
 * reviewed, and only built where lib/plan/demo.ts allows it. Anything it can't read strictly is left out and said so.
 */

export const citedFeeSchema = z.object({ label: z.string(), value: z.string(), source: z.url().optional() });

export const citationSchema = z.object({
  product: z.string().trim().min(1).max(60),
  /** The page the rate is copied from. */
  url: z.url(),
  /** When the answer citing it was written. */
  citedAt: z.iso.datetime({ offset: true }),
  /** Percent as printed; the lowest when the page gives a range. */
  ratePercent: z.number().min(0).max(40),
  rateMaxPercent: z.number().min(0).max(40).optional(),
  termMaxMonths: z.number().int().min(1).max(360).optional(),
  fees: z.array(citedFeeSchema).max(3).default([]),
  /** Set when the card's rate belongs to another product than the one asked about. */
  rateFor: z.string().optional(),
});
export type Citation = z.input<typeof citationSchema>;

export const citedPlanInputSchema = planBaseInputSchema.extend({ citation: citationSchema });
export type CitedPlanInput = z.input<typeof citedPlanInputSchema>;

/** "200 lei", "1.500 lei", "1,500.50 RON" → bani; anything else (a percentage, a range, words) → null. */
export function leiAmount(value: string): number | null {
  const m = value.trim().match(/^(\d{1,3}(?:[.,\s]\d{3})*|\d+)(?:[.,](\d{1,2}))?\s*(?:lei|ron)$/i);
  if (!m) return null;
  return Number(m[1]!.replace(/[.,\s]/g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** Which plan line a cited fee is, and how often it is charged, from its label in English or Romanian. */
export function feeLine(label: string): { key: CommissionKey; use: "upfront" | "monthly" | "if_used" } | null {
  const l = label.toLowerCase();
  const once = /one[- ]time|once|upfront|unic|o singur/.test(l), monthly = /monthly|a month|per month|lunar/.test(l);
  if (/early|anticipat/.test(l)) return { key: "early_repayment_fee", use: "if_used" };
  if (/insurance|asigur/.test(l)) return null;
  if (/account|package|pachet|cont curent/.test(l) && monthly) return { key: "account_package", use: "monthly" };
  if (/analys|analiz|origination|acordare|processing|disbursement/.test(l) && once) return { key: "origination_fee", use: "upfront" };
  if (/administ|management|gestiune/.test(l) && monthly) return { key: "administration_fee", use: "monthly" };
  return null;
}

const bps = (percent: number) => Math.round(percent * 100);

export function buildCitedPlan(raw: CitedPlanInput): BuildPlanResult {
  const input = citedPlanInputSchema.parse(raw);
  const c = input.citation;
  const gaps: PlanGap[] = [];
  if (c.rateFor) gaps.push({ role: "rate", reason: "wrong_product" });
  const low = bps(c.ratePercent), high = c.rateMaxPercent !== undefined ? bps(c.rateMaxPercent) : low;
  if (high < low) gaps.push({ role: "rate", reason: "not_a_number" });
  if (c.termMaxMonths !== undefined && input.termMonths > c.termMaxMonths) gaps.push({ role: "term_limit", reason: "term_above_limit" });
  if (gaps.length) return { status: "unavailable", gaps };

  // Fees: counted only when the label says what it is and how often, and the value is a plain lei amount
  const commissions: Commission[] = [];
  const missing: PlanNote[] = [{ key: "not_in_reviewed_catalog" }];
  const sources: PlanSource[] = [{ termId: "cited#rate", url: c.url, collectedAt: c.citedAt }];
  let upfrontFee = 0, monthlyFee = 0;
  for (const [i, f] of c.fees.entries()) {
    const line = feeLine(f.label), amount = leiAmount(f.value);
    if (!line || commissions.some((x) => x.key === line.key) || (line.use !== "if_used" && amount === null)) {
      missing.push({ key: "cited_fee_not_counted", params: { label: f.label.slice(0, 80), value: f.value.slice(0, 40) } });
      continue;
    }
    const termId = `cited#fee-${i + 1}`;
    if (f.source && f.source !== c.url) sources.push({ termId, url: f.source, collectedAt: c.citedAt });
    if (line.use === "if_used") { commissions.push({ key: line.key, termId, amount: null, basis: "if_used", conditions: [f.value] }); continue; }
    if (line.use === "upfront") upfrontFee += amount!; else monthlyFee += amount!;
    commissions.push({ key: line.key, termId, amount, basis: amount ? "charged" : "none", frequency: line.use === "upfront" ? "once" : "monthly", conditions: [] });
  }
  // The lines every loan plan lists: what the page didn't state is "Not confirmed", never zero
  for (const key of ["origination_fee", "administration_fee", "early_repayment_fee"] as const) {
    if (commissions.some((x) => x.key === key)) continue;
    commissions.push({ key, amount: null, basis: "missing", conditions: [] });
    missing.push({ key: "conditional_fee_unconfirmed", params: { commission: key } });
  }

  return assemblePlan(input, {
    rateBps: high, lowBps: high > low ? low : null, rateType: "assumed_constant", rateTermId: "cited#rate",
    upfrontFee, monthlyFee, commissions, missing, termLimit: c.termMaxMonths ? { max: c.termMaxMonths } : null,
    sources, product: c.product, figuresFrom: "cited_page",
  });
}

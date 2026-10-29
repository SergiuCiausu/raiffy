import { describe, expect, it } from "vitest";
import type { TermRecord } from "../../lib/catalog/schemas";
import { buildPlan, type BuildPlanInput, type PlanTemplate } from "../../lib/plan/build";
import { lei2, planCardView } from "./plan-view";

// The fixture from lib/plan/build.test.ts: the bank's published example, 50,000 lei over 60 months

const NOW = Date.parse("2026-10-28T12:00:00Z");
const PRODUCT = "raiffeisen:personal-loan";
const URL = "https://www.raiffeisen.ro/ro/persoane-fizice/produsele-noastre/credite/credit-de-nevoi-personale-fara-ipoteca.html";

// Raiffeisen's representative example as a reviewed catalog: 5,55% fixed, 200 lei analysis fee, 5 lei a month
const record = (termId: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${PRODUCT}#${termId}`, productId: PRODUCT, product: "Credit de nevoi personale", bank: "raiffeisen", track: "personal",
  kind: "fee", label: termId, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" },
  quote: "rata lunara este 961,21 Lei",
  provenance: { bank: "raiffeisen", url: URL, collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" },
  ...over,
});
const RECORDS: Record<string, TermRecord> = {
  rate: record("rate", { kind: "interest_rate", label: "Dobândă fixă", value: { type: "exact", amount: 555 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } }),
  origination_fee: record("analysis-fee", { label: "Comision de analiză", value: { type: "exact", amount: 20_000 }, frequency: "once" }),
  administration_fee: record("admin-fee", { label: "Comision de administrare", value: { type: "exact", amount: 500 }, frequency: "monthly" }),
  early_repayment_fee: record("early", { label: "Rambursare anticipată", value: { type: "text", text: "0,5% din suma rambursată anticipat" }, unit: "none", conditions: ["Nu se aplică în ultimele 12 luni"] }),
  amount_limit: record("amount", { kind: "limit", label: "Suma", value: { type: "range", min: 200_000, max: 20_000_000 } }),
  term_limit: record("term", { kind: "term", label: "Perioada", value: { type: "range", min: 6, max: 60 }, unit: "months" }),
};
const TEMPLATE: PlanTemplate = {
  rateTermId: RECORDS.rate!.termId,
  commissions: [
    { key: "origination_fee", termId: RECORDS.origination_fee!.termId, use: "upfront" },
    { key: "administration_fee", termId: RECORDS.administration_fee!.termId, use: "monthly" },
    { key: "early_repayment_fee", termId: RECORDS.early_repayment_fee!.termId, use: "if_used" },
  ],
  amountLimitTermId: RECORDS.amount_limit!.termId,
  termLimitTermId: RECORDS.term_limit!.termId,
};
const INPUT: BuildPlanInput = {
  id: "PS-2318", version: 1, conversationId: "conv_8f21", track: "personal", now: NOW, createdAt: "2026-10-28T18:50:00+02:00",
  goal: "Fix up the kitchen", productId: PRODUCT, amount: 5_000_000, termMonths: 60, firstPaymentDate: "2026-12-01",
  template: TEMPLATE, records: Object.values(RECORDS), alternativeTerms: [48, 72],
  otherRoutes: [{ key: "overdraft", productId: "raiffeisen:overdraft", termMonths: 12, monthly: null, cost: null, fits: false, recommended: false, note: "overdraft_renews_yearly" }],
  recommendedRoute: "term_60",
};
const ok = (result: ReturnType<typeof buildPlan>) => {
  if (result.status !== "ok") throw new Error(`expected a plan, got gaps ${JSON.stringify(result.gaps)}`);
  return result.plan;
};

describe("planCardView", () => {
  it("shows the server-built plan's figures, its balance falling to zero and where the terms come from", () => {
    const v = planCardView(ok(buildPlan(INPUT)));
    expect(v).toMatchObject({ id: "PS-2318", version: 1, goal: "Fix up the kitchen", amount: 5_000_000, termMonths: 60, recommended: true, check: "Not checked", sources: ["raiffeisen.ro"] });
    expect(v.bars[0]).toBe(100);
    expect(v.bars.at(-1)).toBeLessThan(10);
    expect(v.bars.length).toBeLessThanOrEqual(31);
    expect(v.paidOff).toBe("Nov 2031");
    expect(lei2(v.monthly)).toMatch(/^\d{1,3}(,\d{3})*\.\d{2} lei$/);
  });

  it("formats bani as lei with two decimals", () => {
    expect(lei2(96_121)).toBe("961.21 lei");
    expect(lei2(1_234_567)).toBe("12,345.67 lei");
  });
});

import { describe, expect, it } from "vitest";
import cases from "../../evals/calc-scenarios.json";
import type { TermRecord } from "../catalog/schemas";
import type { PlanTemplate } from "../plan/build";
import { buildPlan } from "../plan/build";
import { resolveScenarioInputs, runScenario, type RunScenarioInput, type ScenarioRequest } from "./scenario";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const LOAN = "raiffeisen:personal-loan";
const OD = "raiffeisen:overdraft";
const URL = "https://www.raiffeisen.ro/ro/persoane-fizice/produsele-noastre/credite/credit-de-nevoi-personale-fara-ipoteca.html";

// Raiffeisen's representative example as a reviewed catalog: 5,55% fixed, 200 lei analysis fee, 5 lei a month
const record = (productId: string, termId: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${productId}#${termId}`, productId, product: productId === LOAN ? "Credit de nevoi personale" : "Descoperit de cont", bank: "raiffeisen", track: "personal",
  kind: "fee", label: termId, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: productId === LOAN ? "personal_loan" : "overdraft", currency: "RON" },
  quote: "rata lunara este 961,21 Lei",
  provenance: { bank: "raiffeisen", url: URL, collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" },
  ...over,
});
const R = {
  rate: record(LOAN, "rate", { kind: "interest_rate", label: "Dobândă fixă", value: { type: "exact", amount: 555 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } }),
  analysis: record(LOAN, "analysis-fee", { label: "Comision de analiză", value: { type: "exact", amount: 20_000 }, frequency: "once" }),
  admin: record(LOAN, "admin-fee", { label: "Comision de administrare", value: { type: "exact", amount: 500 }, frequency: "monthly" }),
  amount: record(LOAN, "amount", { kind: "limit", label: "Suma", value: { type: "range", min: 200_000, max: 20_000_000 } }),
  term: record(LOAN, "term", { kind: "term", label: "Perioada", value: { type: "range", min: 6, max: 60 }, unit: "months" }),
  odRate: record(OD, "rate", { kind: "interest_rate", label: "Dobândă variabilă", value: { type: "exact", amount: 1150 }, unit: "bps", comparability: { category: "overdraft", currency: "RON", rateType: "variable" } }),
  odFee: record(OD, "yearly-fee", { label: "Comision anual", value: { type: "exact", amount: 5_000 }, frequency: "yearly" }),
  odTerm: record(OD, "term", { kind: "term", label: "Perioada", value: { type: "up_to", max: 12 }, unit: "months" }),
};
const loanRefs = { productId: LOAN, rateTermId: R.rate.termId, feeTermIds: [R.analysis.termId, R.admin.termId], amountLimitTermId: R.amount.termId, termLimitTermId: R.term.termId };
const odRefs = { productId: OD, rateTermId: R.odRate.termId, feeTermIds: [R.odFee.termId], termLimitTermId: R.odTerm.termId };
const base = (request: Partial<ScenarioRequest>, over: Partial<RunScenarioInput> = {}): RunScenarioInput => ({
  request: { calculation: "loan_cost", loan: loanRefs, ...request } as ScenarioRequest,
  records: Object.values(R), now: NOW, today: "2026-10-28", amount: 5_000_000, months: 60, basis: "customer",
  params: { nearTieMarginBani: 5_000, variableStressBps: 200 }, ...over,
});

describe("runScenario", () => {
  it("matches the bank's published example and the plan builder for the same records", () => {
    const r = runScenario(base({}));
    expect(r.status).toBe("ok");
    expect(Math.abs(r.loan!.monthly - 96_121)).toBeLessThanOrEqual(10);
    expect(r.loan!.totalPayable).toBe(r.loan!.totalFees + r.loan!.totalInterest + 5_000_000);
    expect(r.loan!.stressTest).toBeUndefined();
    expect(r.sources.map(s => s.termId).sort()).toEqual([R.rate, R.analysis, R.admin, R.amount, R.term].map(x => x.termId).sort());
    const template: PlanTemplate = { rateTermId: R.rate.termId, commissions: [
      { key: "origination_fee", termId: R.analysis.termId, use: "upfront" }, { key: "administration_fee", termId: R.admin.termId, use: "monthly" }],
      amountLimitTermId: R.amount.termId, termLimitTermId: R.term.termId };
    const plan = buildPlan({ id: "PS-1001", version: 1, conversationId: "c", track: "personal", now: NOW, createdAt: "2026-10-28T12:00:00Z", goal: "x",
      productId: LOAN, amount: 5_000_000, termMonths: 60, firstPaymentDate: "2026-11-28", template, records: Object.values(R), recommendedRoute: "term_60" });
    if (plan.status !== "ok") throw new Error("plan failed");
    expect(r.loan!.monthly).toBe(plan.plan.figures.monthly);
    expect(r.loan!.totalPayable).toBe(plan.plan.figures.total);
  });

  it("uses the plan template's fees, not the model's, and refuses a counted fee the template leaves unconfirmed", () => {
    const template: PlanTemplate = { rateTermId: R.rate.termId, commissions: [
      { key: "origination_fee", termId: R.analysis.termId, use: "upfront" }, { key: "administration_fee", termId: R.admin.termId, use: "monthly" }] };
    const withTemplate = runScenario(base({ loan: { ...loanRefs, feeTermIds: [] } }, { loanTemplate: template }));
    expect(withTemplate.loan!.totalFees).toBe(20_000 + 500 * 60);
    expect(withTemplate.assumptions).toContain("fees_from_template");
    const unconfirmed = runScenario(base({}, { loanTemplate: { ...template, commissions: [{ key: "origination_fee", use: "upfront" }] } }));
    expect(unconfirmed.status).toBe("unavailable");
    expect(unconfirmed.gaps).toContainEqual({ side: "loan", role: "fee", reason: "missing_charge" });
  });

  it("compares a loan with a variable-rate overdraft, stresses the variable rate and recommends by total cost", () => {
    const r = runScenario(base({ calculation: "loan_vs_overdraft", overdraft: odRefs }, { amount: 500_000, months: 6 }));
    expect(r.status).toBe("ok");
    expect(r.overdraft!.fitsTerm).toBe(true);
    expect(r.overdraft!.stressTest!.rateBps).toBe(1350);
    expect(r.overdraft!.stressTest!.totalPayable).toBeGreaterThan(r.overdraft!.totalPayable);
    expect(r.recommendation).toBeDefined();
    const long = runScenario(base({ calculation: "loan_vs_overdraft", overdraft: odRefs }, { amount: 500_000, months: 24 }));
    expect(long.overdraft!.fitsTerm).toBe(false);
    expect(long.recommendation).toMatchObject({ pick: "loan", reason: "onlyFit" });
  });

  it("asks for the customer's amount and term instead of guessing them", () => {
    const r = runScenario(base({}, { amount: null, months: null }));
    expect(r.status).toBe("unavailable");
    expect(r.gaps.map(g => g.reason)).toEqual(["missing_amount", "missing_term"]);
  });

  it("counts a model-sent amount only when the customer said it, and marks a defaulted input as an example", () => {
    const own = (n: number) => n === 50_000;
    expect(resolveScenarioInputs({ amountLei: 50_000, months: 60 }, { months: { value: 60, source: "customer" } }, own))
      .toEqual({ amount: 5_000_000, months: 60, basis: "customer" });
    expect(resolveScenarioInputs({ amountLei: 80_000 }, { amount: { value: 20_000, source: "default" }, months: { value: 36, source: "default" } }, own))
      .toEqual({ amount: 2_000_000, months: 36, basis: "example" });
  });

  for (const c of cases) {
    it(`${c.id}: ${c.title}`, () => {
      const records = Object.values(R).map(r => (c.patch as Record<string, Partial<TermRecord>>)[r.termId.split("#")[1]! + (r.productId === OD ? "@od" : "")]
        ? { ...r, ...(c.patch as Record<string, Partial<TermRecord>>)[r.termId.split("#")[1]! + (r.productId === OD ? "@od" : "")] } : r);
      const r = runScenario(base(c.request as Partial<ScenarioRequest>, { records, ...(c.inputs as Partial<RunScenarioInput>) }));
      expect(r.status).toBe(c.expect.status);
      for (const reason of c.expect.gapReasons) expect(r.gaps.map(g => g.reason)).toContain(reason);
    });
  }
});

import { describe, expect, it } from "vitest";
import cases from "../../evals/plan-build.json";
import type { TermRecord } from "../catalog/schemas";
import { buildPlan, planInvariants, type BuildPlanInput, type PlanTemplate } from "./build";
import type { CommissionKey } from "./schemas";

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

describe("buildPlan", () => {
  it("builds a plan that matches the bank's published example to within 10 bani", () => {
    const plan = ok(buildPlan(INPUT));
    expect(Math.abs(plan.figures.monthly - 96_121)).toBeLessThanOrEqual(10);
    expect(plan.terms).toMatchObject({ annualRateBps: 555, upfrontFee: 20_000, monthlyFee: 500, rateType: "fixed" });
    expect(plan.goal).toEqual({ summary: "Fix up the kitchen", productId: PRODUCT, product: "Credit de nevoi personale", amount: 5_000_000, termMonths: 60 });
    expect(planInvariants(plan, TEMPLATE)).toEqual([]);
    expect(plan.label).toBe("indicative");
    expect(plan.verification).toEqual({ level: "none" });
    expect(plan.handoff).toEqual({ target: "smart_mobile", productId: PRODUCT, amount: 5_000_000, termMonths: 60 });
  });

  it("lists every commission in the template's order, with the catalog record behind it", () => {
    const plan = ok(buildPlan(INPUT));
    expect(plan.figures.commissions).toEqual([
      { key: "origination_fee", termId: RECORDS.origination_fee!.termId, amount: 20_000, basis: "charged", frequency: "once", conditions: [] },
      { key: "administration_fee", termId: RECORDS.administration_fee!.termId, amount: 500, basis: "charged", frequency: "monthly", conditions: [] },
      { key: "early_repayment_fee", termId: RECORDS.early_repayment_fee!.termId, amount: null, basis: "if_used", conditions: ["Nu se aplică în ultimele 12 luni"] },
    ]);
    expect(plan.sources.map((s) => s.termId).sort()).toEqual(Object.values(RECORDS).map((r) => r.termId).sort());
  });

  it("shows the chosen term, other terms inside the product's limits, and other tools' routes, with one recommended", () => {
    const plan = ok(buildPlan(INPUT));
    expect(plan.routes.map((r) => [r.key, r.chosen, r.recommended, r.fits])).toEqual([
      ["term_60", true, true, true], ["term_48", false, false, true], ["overdraft", false, false, false],
    ]);
    const [chosen, shorter] = plan.routes;
    expect(shorter!.monthly!).toBeGreaterThan(chosen!.monthly!);
    expect(shorter!.cost!).toBeLessThan(chosen!.cost!);
  });

  it("can recommend a route other than the one the customer chose", () => {
    const plan = ok(buildPlan({ ...INPUT, recommendedRoute: "term_48" }));
    expect(plan.routes.find((r) => r.recommended)?.key).toBe("term_48");
    expect(plan.routes.find((r) => r.chosen)?.key).toBe("term_60");
  });

  it("refuses a ceiling as the rate", () => {
    const records = { ...RECORDS, rate: { ...RECORDS.rate!, value: { type: "up_to" as const, max: 1200 } } };
    expect(buildPlan({ ...INPUT, records: Object.values(records) })).toEqual({ status: "unavailable", gaps: [{ role: "rate", termId: RECORDS.rate!.termId, reason: "ceiling_value" }] });
  });

  it("reports every gap at once, not only the first", () => {
    const records = { ...RECORDS, rate: { ...RECORDS.rate!, verification: { quoteFound: false } }, origination_fee: { ...RECORDS.origination_fee!, frequency: "monthly" as const } };
    const result = buildPlan({ ...INPUT, records: Object.values(records), amount: 100_000 });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.gaps.map((g) => g.reason).sort()).toEqual(["amount_below_limit", "frequency_mismatch", "quote_not_found"]);
  });

  it("says affordability isn't checked without income, and works out the debt share with it", () => {
    expect(ok(buildPlan(INPUT)).missing.map((m) => m.key)).toEqual(["affordability_not_checked", "credit_assessment"]);
    const plan = ok(buildPlan({ ...INPUT, affordability: { income: 780_000, obligations: 65_000 } }));
    expect(plan.affordability).toEqual({
      income: 780_000, obligations: 65_000,
      debtShareBps: Math.round(((plan.figures.monthly + 65_000) * 10_000) / 780_000), leftEachMonth: 780_000 - 65_000 - plan.figures.monthly,
    });
    expect(plan.missing.map((m) => m.key)).toEqual(["credit_assessment"]);
  });

  it("matches the chat prototype's plan to the ban", () => {
    // chat.html: 8,000 lei over 24 months at 7.9% fixed with the 249 lei fee
    const records = { ...RECORDS,
      rate: { ...RECORDS.rate!, value: { type: "exact" as const, amount: 790 } },
      origination_fee: { ...RECORDS.origination_fee!, value: { type: "exact" as const, amount: 24_900 } },
      administration_fee: { ...RECORDS.administration_fee!, value: { type: "exact" as const, amount: 0 } } };
    const plan = ok(buildPlan({ ...INPUT, records: Object.values(records), amount: 800_000, termMonths: 24, alternativeTerms: [12], otherRoutes: [], recommendedRoute: "term_24", firstPaymentDate: "2026-11-28" }));
    expect([plan.figures.monthly, plan.figures.total]).toEqual([36_145, 892_389]);
  });

  it("rejects input that isn't whole bani or a plan ID", () => {
    expect(() => buildPlan({ ...INPUT, amount: 1000.5 })).toThrow();
    expect(() => buildPlan({ ...INPUT, id: "plan-1" })).toThrow();
    expect(() => buildPlan({ ...INPUT, template: { ...TEMPLATE, commissions: [TEMPLATE.commissions[0]!, TEMPLATE.commissions[0]!] } })).toThrow();
  });
});

describe("planInvariants", () => {
  it("catches a schedule that no longer adds up, and a missing commission line", () => {
    const plan = ok(buildPlan(INPUT));
    const broken = { ...plan, figures: { ...plan.figures, total: plan.figures.total + 1, commissions: plan.figures.commissions.slice(1) } };
    expect(planInvariants(broken, TEMPLATE)).toEqual(["total_sum", "commission_lines"]);
  });
});

/* evals/plan-build.json: each case overrides records by role, the template or the input */
type EvalCase = {
  id: string;
  scenario: string;
  records?: Record<string, Partial<TermRecord>>;
  template?: { dropTermId: CommissionKey };
  input?: Partial<BuildPlanInput>;
  expect: {
    status: "ok" | "unavailable";
    reasons?: string[];
    invariants?: string[];
    commission?: { key: string; basis: string; amount: number | null };
    missing?: string[];
    verification?: Record<string, unknown>;
  };
};

describe("evals/plan-build.json", () => {
  for (const c of cases.cases as EvalCase[]) {
    it(`${c.id}: ${c.scenario}`, () => {
      const records = Object.entries(RECORDS).map(([role, r]) => ({ ...r, ...(c.records?.[role] ?? {}),
        provenance: { ...r.provenance, ...(c.records?.[role]?.provenance ?? {}) } }));
      const template = c.template
        ? { ...TEMPLATE, commissions: TEMPLATE.commissions.map((line) => line.key === c.template!.dropTermId ? { key: line.key, use: line.use } : line) }
        : TEMPLATE;
      const result = buildPlan({ ...INPUT, ...c.input, records, template });
      expect(result.status).toBe(c.expect.status);
      if (result.status === "unavailable") {
        expect(result.gaps.map((g) => g.reason)).toEqual(c.expect.reasons);
        return;
      }
      if (c.expect.invariants) expect(planInvariants(result.plan, template)).toEqual(c.expect.invariants);
      if (c.expect.commission) expect(result.plan.figures.commissions.find((x) => x.key === c.expect.commission!.key)).toMatchObject(c.expect.commission);
      if (c.expect.missing) expect(result.plan.missing.map((m) => m.key)).toEqual(expect.arrayContaining(c.expect.missing));
      if (c.expect.verification) expect(result.plan.verification).toMatchObject(c.expect.verification);
    });
  }
});

import { describe, expect, it } from "vitest";
import type { TermRecord } from "../catalog/schemas";
import { runScenario } from "../calc/scenario";
import { recommendRoute } from "./recommend";
import { buildRoutes, type BuildRoutesInput } from "./routes";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const LOAN = "raiffeisen:personal-loan";
const OD = "raiffeisen:overdraft";

const record = (productId: string, termId: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${productId}#${termId}`, productId, product: productId === LOAN ? "Credit de nevoi personale" : "Descoperit de cont", bank: "raiffeisen", track: "personal",
  kind: "fee", label: termId, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: productId === LOAN ? "personal_loan" : "overdraft", currency: "RON" }, quote: "rata lunara este 961,21 Lei",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/loan.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" },
  ...over,
});
const R = {
  rate: record(LOAN, "rate", { kind: "interest_rate", value: { type: "exact", amount: 790 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } }),
  analysis: record(LOAN, "analysis-fee", { value: { type: "exact", amount: 24_900 }, frequency: "once" }),
  amount: record(LOAN, "amount", { kind: "limit", value: { type: "range", min: 200_000, max: 20_000_000 } }),
  term: record(LOAN, "term", { kind: "term", value: { type: "range", min: 6, max: 60 }, unit: "months" }),
  odRate: record(OD, "rate", { kind: "interest_rate", value: { type: "exact", amount: 1150 }, unit: "bps", comparability: { category: "overdraft", currency: "RON", rateType: "variable" } }),
  odTerm: record(OD, "term", { kind: "term", value: { type: "up_to", max: 12 }, unit: "months" }),
};
const loan = { productId: LOAN, rateTermId: R.rate.termId, feeTermIds: [R.analysis.termId], amountLimitTermId: R.amount.termId, termLimitTermId: R.term.termId };
const overdraft = { productId: OD, rateTermId: R.odRate.termId, termLimitTermId: R.odTerm.termId };
const PARAMS = { nearTieMarginBani: 5_000, variableStressBps: 200, saveFirstMonths: 8, maxSaveOnlyMonths: 24 };
// The renovation example: 40,000 lei over 60 months, 7,800 lei income, 650 lei of other payments, 1,250 lei saved a month
const INPUT: BuildRoutesInput = {
  records: Object.values(R), now: NOW, today: "2026-10-28", loan, overdraft, alternativeTerms: [48],
  customer: { amount: 4_000_000, months: 60, income: 780_000, obligations: 65_000, monthlySaving: 125_000 }, params: PARAMS,
};
const byKey = (input: BuildRoutesInput) => Object.fromEntries(buildRoutes(input).routes.map((r) => [r.key, r]));

describe("buildRoutes", () => {
  it("works out the chosen loan with the scenario calculator, to the ban", () => {
    const routes = byKey(INPUT);
    const scenario = runScenario({ request: { calculation: "loan_cost", loan }, records: Object.values(R), now: NOW, today: "2026-10-28",
      amount: 4_000_000, months: 60, basis: "customer", params: { nearTieMarginBani: 5_000, variableStressBps: 200 } });
    expect(routes.loan_60).toMatchObject({
      status: "ok", chosen: true, borrowed: 4_000_000, startsInMonths: 0, rateBps: 790, rateType: "fixed",
      monthly: scenario.loan!.monthly, cost: scenario.loan!.totalInterest + scenario.loan!.totalFees,
      debtShareBps: Math.round((scenario.loan!.monthly + 65_000) * 10_000 / 780_000),
      leftEachMonth: 780_000 - 65_000 - scenario.loan!.monthly,
    });
    expect(routes.loan_60!.termIds.sort()).toEqual([R.rate, R.analysis, R.amount, R.term].map((r) => r.termId).sort());
  });

  it("shows another term as a variant, saving first, and saving only", () => {
    const routes = byKey(INPUT);
    expect(Object.keys(routes)).toEqual(["loan_60", "loan_48", "overdraft", "save_then_borrow"]);
    expect(routes.loan_48).toMatchObject({ variantOf: "loan_60", repaymentMonths: 48 });
    expect(routes.loan_48!.monthly!).toBeGreaterThan(routes.loan_60!.monthly!);
    expect(routes.loan_48!.cost!).toBeLessThan(routes.loan_60!.cost!);
    expect(routes.save_then_borrow).toMatchObject({ borrowed: 3_000_000, startsInMonths: 8, startDate: "2027-06-28", saving: { monthly: 125_000, months: 8, saved: 1_000_000 } });
    expect(routes.save_then_borrow!.cost!).toBeLessThan(routes.loan_60!.cost!);
  });

  it("leaves out a save-only route longer than the policy allows, and shows none without a saving amount", () => {
    expect(byKey(INPUT).save_only).toBeUndefined();
    expect(byKey({ ...INPUT, params: { ...PARAMS, maxSaveOnlyMonths: 36 } }).save_only).toMatchObject({ startsInMonths: 32, cost: 0, borrowed: 0 });
    const none = byKey({ ...INPUT, customer: { ...INPUT.customer, monthlySaving: null } });
    expect(none.save_then_borrow).toBeUndefined();
    expect(buildRoutes({ ...INPUT, customer: { ...INPUT.customer, monthlySaving: null } }).assumptions).toEqual([]);
  });

  it("marks the overdraft unavailable when the term is beyond its limit, never estimated", () => {
    expect(byKey(INPUT).overdraft).toMatchObject({ status: "unavailable", monthly: null, cost: null });
    const short = byKey({ ...INPUT, customer: { ...INPUT.customer, months: 12 }, alternativeTerms: [] });
    expect(short.overdraft).toMatchObject({ status: "ok", rateType: "variable" });
    expect(short.overdraft!.stressedMonthly!).toBeGreaterThan(short.overdraft!.monthly!);
    // Affordability of a variable rate uses the stressed payment
    expect(short.overdraft!.debtShareBps).toBe(Math.round((short.overdraft!.stressedMonthly! + 65_000) * 10_000 / 780_000));
  });

  it("returns every loan route unavailable when the rate isn't reviewed", () => {
    const records = Object.values({ ...R, rate: { ...R.rate, verification: { quoteFound: true } } });
    const routes = byKey({ ...INPUT, records });
    for (const key of ["loan_60", "loan_48", "save_then_borrow"]) expect(routes[key]).toMatchObject({ status: "unavailable", monthly: null, cost: null });
    expect(routes.loan_60!.gaps.map((g) => g.reason)).toContain("unreviewed");
  });

  it("leaves affordability empty without the customer's income", () => {
    const routes = byKey({ ...INPUT, customer: { ...INPUT.customer, income: null } });
    expect(routes.loan_60).toMatchObject({ debtShareBps: null, leftEachMonth: null });
  });
});

describe("buildRoutes then recommendRoute", () => {
  const policy = { nearTieMarginBani: 5_000, debtShareCeiling: { bps: 4_000, termId: "raiffeisen:personal-loan#grad-indatorare" } };

  it("recommends the chosen loan for a customer who needs the money now, with saving first as the cheaper route if it can wait", () => {
    const { routes } = buildRoutes(INPUT);
    const r = recommendRoute({ routes, needByMonths: 0, policy });
    const save = routes.find((x) => x.key === "save_then_borrow")!;
    const chosen = routes.find((x) => x.key === "loan_60")!;
    expect(r).toMatchObject({ status: "ok", pick: "loan_60", betterIf: { route: "save_then_borrow", startDate: "2027-06-28", saves: chosen.cost! - save.cost! } });
    expect(r.reasons.map((x) => x.key)).toEqual(["starts_now", "debt_share_room", "fixed_rate", "lowest_payment_now", "your_term"]);
  });

  it("recommends saving first when the customer can wait for it", () => {
    const r = recommendRoute({ routes: buildRoutes(INPUT).routes, needByMonths: 12, policy });
    expect(r.pick).toBe("save_then_borrow");
  });
});

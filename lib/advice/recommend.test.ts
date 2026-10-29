import { describe, expect, it } from "vitest";
import cases from "../../evals/advice-recommend.json";
import { recommendRoute, type RecommendInput } from "./recommend";
import type { Route } from "./schemas";

// The chat.html renovation example: 40,000 lei, income 7,800 lei, 650 lei of other loan payments
const route = (over: Partial<Route> & Pick<Route, "key">): Route => ({
  kind: "loan", productId: "raiffeisen:flexicredit", product: "Flexicredit", status: "ok", gaps: [], chosen: false,
  borrowed: 4_000_000, saving: null, startsInMonths: 0, startDate: "2026-10-28", repaymentMonths: 60,
  monthly: 81_800, stressedMonthly: null, cost: 933_800, rateBps: 790, rateType: "fixed",
  debtShareBps: 1_882, leftEachMonth: 633_200, termIds: ["raiffeisen:flexicredit#rate"], ...over,
});
const ROUTES: Record<string, Route> = {
  loan_60: route({ key: "loan_60", chosen: true }),
  loan_48: route({ key: "loan_48", variantOf: "loan_60", repaymentMonths: 48, monthly: 98_400, cost: 746_400, debtShareBps: 2_095, leftEachMonth: 616_600 }),
  save_then_borrow: route({ key: "save_then_borrow", kind: "save_then_borrow", borrowed: 3_000_000, saving: { monthly: 125_000, months: 8, saved: 1_000_000 },
    startsInMonths: 8, startDate: "2027-06-28", monthly: 74_000, cost: 576_800, debtShareBps: 1_782, leftEachMonth: 590_000 }),
  overdraft: route({ key: "overdraft", kind: "overdraft", productId: "raiffeisen:overdraft", status: "unavailable",
    gaps: [{ side: "overdraft", role: "term", reason: "term_above_limit" }], monthly: null, cost: null, rateBps: null, rateType: null, debtShareBps: null, leftEachMonth: null }),
};
const CEILING = { bps: 4_000, termId: "raiffeisen:flexicredit#grad-indatorare" };
const input = (over: Partial<RecommendInput> = {}): RecommendInput => ({
  routes: Object.values(ROUTES), needByMonths: 0, policy: { nearTieMarginBani: 5_000, debtShareCeiling: CEILING }, ...over,
});

describe("recommendRoute", () => {
  it("recommends the chosen loan, compares every other route with it, and says when saving first fits better", () => {
    const r = recommendRoute(input());
    expect(r.pick).toBe("loan_60");
    expect(r.tradeOffs).toEqual([
      { route: "loan_48", key: "higher_payment_lower_cost", monthlyDiff: 16_600, costDiff: -187_400, startsLaterMonths: 0 },
      { route: "save_then_borrow", key: "cheaper_starts_later", monthlyDiff: -7_800, costDiff: -357_000, startsLaterMonths: 8 },
    ]);
    expect(r.betterIf).toEqual({ route: "save_then_borrow", condition: "can_wait", startDate: "2027-06-28", saves: 357_000 });
    expect(r.reasons.find((x) => x.key === "debt_share_room")?.params).toEqual({ debtShareBps: 1_882, ceilingBps: 4_000, ceilingTermId: CEILING.termId });
    expect(r.excluded).toContainEqual({ route: "overdraft", reason: "not_available" });
  });

  it("never calls a payment the lowest when another route shown is lower", () => {
    const r = recommendRoute(input());
    expect(r.reasons.map((x) => x.key)).not.toContain("lowest_payment");
    expect(r.reasons.map((x) => x.key)).toContain("lowest_payment_now");
  });

  it("asks for income and timing together when both are missing", () => {
    const routes = Object.values(ROUTES).map((x) => ({ ...x, debtShareBps: null, leftEachMonth: null }));
    expect(recommendRoute(input({ routes, needByMonths: null }))).toMatchObject({ status: "needs_input", needs: ["income_obligations", "need_by"] });
  });

  it("judges a variable rate's debt share by the caller's stressed figure", () => {
    // routes.ts puts the stressed payment into debtShareBps; the rule only reads it
    const routes = [ROUTES.loan_60!, { ...ROUTES.overdraft!, status: "ok" as const, gaps: [], cost: 100_000, monthly: 70_000, stressedMonthly: 74_000, rateType: "variable" as const, debtShareBps: 4_100, leftEachMonth: 640_000 }];
    expect(recommendRoute(input({ routes }))).toMatchObject({ pick: "loan_60", excluded: [{ route: "overdraft", reason: "debt_share_over_ceiling" }] });
  });
});

/* evals/advice-recommend.json: each case overrides routes by key, the timing or the ceiling */
type EvalCase = {
  id: string;
  scenario: string;
  needByMonths: number | null;
  ceiling?: null;
  routes?: Record<string, Partial<Route>>;
  expect: { status: string; pick?: string; reasons?: string[]; needs?: string[]; betterIf?: string; excluded?: string[] };
};

describe("evals/advice-recommend.json", () => {
  for (const c of cases.cases as EvalCase[]) {
    it(`${c.id}: ${c.scenario}`, () => {
      const routes = Object.entries(ROUTES).map(([key, r]) => ({ ...r, ...(c.routes?.[key] ?? {}) }));
      const r = recommendRoute(input({ routes, needByMonths: c.needByMonths, policy: { nearTieMarginBani: 5_000, debtShareCeiling: c.ceiling === null ? null : CEILING } }));
      expect(r.status).toBe(c.expect.status);
      if (c.expect.pick) expect(r.pick).toBe(c.expect.pick);
      if (c.expect.reasons) expect(r.reasons.map((x) => x.key)).toEqual(c.expect.reasons);
      if (c.expect.needs) expect(r.needs).toEqual(c.expect.needs);
      if (c.expect.betterIf) expect(r.betterIf?.route).toBe(c.expect.betterIf);
      if (c.expect.excluded) expect(r.excluded.filter((e) => e.reason !== "not_available").map((e) => `${e.route}:${e.reason}`)).toEqual(c.expect.excluded);
    });
  }
});

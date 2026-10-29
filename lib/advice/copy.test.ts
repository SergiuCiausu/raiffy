import { describe, expect, it } from "vitest";
import { checkCards } from "../agent/blocks";
import type { TermRecord } from "../catalog/schemas";
import { findUngroundedNumbers } from "../rag/numbers";
import { routeName, routesCard, routesCitable, withHostRoutesCard } from "./copy";
import { debtShareCeiling, recommendRoute } from "./recommend";
import { buildRoutes } from "./routes";
import { resolveAdviceInputs } from "./tool";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const LOAN = "raiffeisen:personal-loan";
const URL = "https://www.raiffeisen.ro/loan.html";
const record = (termId: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${LOAN}#${termId}`, productId: LOAN, product: "Flexicredit", bank: "raiffeisen", track: "personal",
  kind: "fee", label: termId, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" }, quote: "q",
  provenance: { bank: "raiffeisen", url: URL, collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" }, ...over,
});
const R = {
  rate: record("rate", { kind: "interest_rate", value: { type: "exact", amount: 790 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } }),
  fee: record("analysis-fee", { value: { type: "exact", amount: 24_900 }, frequency: "once" }),
  term: record("term", { kind: "term", value: { type: "range", min: 6, max: 60 }, unit: "months" }),
  ceiling: record("grad-indatorare", { kind: "eligibility", value: { type: "exact", amount: 4_000 }, unit: "bps" }),
};
const records = Object.values(R);
const { routes, assumptions } = buildRoutes({
  records, now: NOW, today: "2026-10-28", alternativeTerms: [48],
  loan: { productId: LOAN, rateTermId: R.rate.termId, feeTermIds: [R.fee.termId], termLimitTermId: R.term.termId },
  customer: { amount: 4_000_000, months: 60, income: 780_000, obligations: 65_000, monthlySaving: 125_000 },
  params: { nearTieMarginBani: 5_000, variableStressBps: 200, saveFirstMonths: 8, maxSaveOnlyMonths: 24 },
});
const result = { routes, assumptions };
const ceiling = debtShareCeiling(records, R.ceiling.termId, LOAN, NOW);
const rec = recommendRoute({ routes, needByMonths: 0, policy: { nearTieMarginBani: 5_000, debtShareCeiling: ceiling } });
const citable = routesCitable(result, rec, { url: URL, collectedAt: R.rate.provenance.collectedAt, termIds: [R.rate.termId] }, 1);

describe("routesCard", () => {
  it("passes the card check against the comparison it came from, with no figure dropped", () => {
    // Without the comparison as grounding, its route names would fail: proof the check still guards other prose
    expect((checkCards({ cards: [routesCard(result, rec, URL, "t")!] }, [citable], []) as { dropped: string[] }).dropped.length).toBeGreaterThan(0);
    const card = routesCard(result, rec, URL, "Ways to reach your goal")!;
    // The host passes the comparison text as grounding for its own wording (convex/agent.ts withRoutesCard)
    const checked = checkCards({ cards: [card] }, [citable], [citable.text]);
    if ("error" in checked) throw new Error(checked.error);
    expect(checked.dropped).toEqual([]);
    expect(checked.cards).toEqual([card]);
  });

  it("recommends the rule's pick, first, with the reasons and the save-first alternative", () => {
    const card = routesCard(result, rec, URL, "Ways to reach your goal")!;
    if (card.type !== "routes") throw new Error("not a routes card");
    expect(card.routes.map((r) => r.name)).toEqual(["Flexicredit, 60 months", "Flexicredit, 48 months", "Save 8 months, then borrow 30,000.00 lei"]);
    expect(card.recommendation.option).toBe("Flexicredit, 60 months");
    expect(card.recommendation.reasons[0]).toMatch(/^With your other payments, about .+% of your income goes to loans each month, under the bank's 40.00% limit\.$/);
    expect(card.recommendation.reasons[1]).toBe("The rate is fixed, so the payment stays the same for all 60 months.");
    expect(card.recommendation.whenOther).toMatch(/^Save 8 months, then borrow 30,000.00 lei is the better pick if it can wait until June 2027: it costs .+ lei less\.$/);
    expect(card.routes[1]!.summary).toBe("A higher payment, but less interest in total.");
    // The customer's own term carries the "Your choice" flag; nothing else does
    expect(card.routes.map((r) => r.chosen ?? false)).toEqual([true, false, false]);
    expect(card.recommendation.whenOther).not.toContain("the choice is yours");
  });

  it("has every figure of the citable text grounded in the routes, and none invented", () => {
    const figures = routes.flatMap((r) => [r.monthly, r.cost, r.borrowed, r.saving?.monthly].filter((x): x is number => x !== null && x !== undefined));
    expect(figures.length).toBeGreaterThan(0);
    expect(citable.text).toContain("Indicative, not an offer");
    expect(findUngroundedNumbers(citable.text, [citable.text])).toEqual([]);
  });

  it("shows no card, and tells the model to ask, when an input is missing", () => {
    const ask = recommendRoute({ routes, needByMonths: null, policy: { nearTieMarginBani: 5_000, debtShareCeiling: ceiling } });
    expect(routesCard(result, ask, URL, "t")).toBeNull();
    expect(routesCitable(result, ask, { url: URL, collectedAt: "2026-10-28", termIds: [] }, 2).text).toContain("No recommendation yet: ask for when the customer needs the money.");
  });

  it("names routes plainly", () => {
    expect(routes.map(routeName)).toEqual(["Flexicredit, 60 months", "Flexicredit, 48 months", "Save 8 months, then borrow 30,000.00 lei"]);
  });
});

describe("debtShareCeiling", () => {
  it("reads only a fresh, reviewed, exact eligibility term of the product in bps", () => {
    expect(ceiling).toEqual({ bps: 4_000, termId: R.ceiling.termId });
    expect(debtShareCeiling(records, undefined, LOAN, NOW)).toBeNull();
    expect(debtShareCeiling(records, R.ceiling.termId, "other", NOW)).toBeNull();
    const unreviewed = [{ ...R.ceiling, verification: { quoteFound: true } }];
    expect(debtShareCeiling(unreviewed, R.ceiling.termId, LOAN, NOW)).toBeNull();
    const upTo = [{ ...R.ceiling, value: { type: "up_to" as const, max: 4_000 } }];
    expect(debtShareCeiling(upTo, R.ceiling.termId, LOAN, NOW)).toBeNull();
  });
});

describe("resolveAdviceInputs", () => {
  const base = { loan: { productId: LOAN, rateTermId: R.rate.termId, feeTermIds: [] }, timing: "now" as const };
  const said = (n: number) => [40_000, 60, 7_800, 650, 1_250, 12].includes(n);

  it("takes the customer's stated inputs, and the model's figures only when the customer said them", () => {
    expect(resolveAdviceInputs({ ...base, amountLei: 40_000, months: 60, incomeLei: 9_999 }, { obligations: { value: 650, source: "customer" } }, said))
      .toEqual({ amount: 4_000_000, months: 60, income: null, obligations: 65_000, monthlySaving: null, needByMonths: 0 });
  });

  it("never uses a defaulted input", () => {
    const r = resolveAdviceInputs(base, { amount: { value: 10_000, source: "default" }, income: { value: 5_000, source: "default" } }, said);
    expect([r.amount, r.income]).toEqual([null, null]);
  });

  it("reads timing as now, a stated wait, or unknown", () => {
    expect(resolveAdviceInputs({ ...base, timing: "can_wait", waitMonths: 12 }, {}, said).needByMonths).toBe(12);
    expect(resolveAdviceInputs({ ...base, timing: "can_wait", waitMonths: 18 }, {}, said).needByMonths).toBeNull();
    expect(resolveAdviceInputs({ ...base, timing: "unknown" }, {}, said).needByMonths).toBeNull();
    expect(resolveAdviceInputs({ ...base, obligationsLei: 0 }, {}, said).obligations).toBe(0);
  });

  it("takes the customer's stated timing over the model's reading", () => {
    expect(resolveAdviceInputs({ ...base, timing: "unknown" }, { needBy: { value: 8, source: "customer" } }, said).needByMonths).toBe(8);
    expect(resolveAdviceInputs({ ...base, timing: "now" }, { needBy: { value: 24, source: "customer" } }, said).needByMonths).toBe(24);
    expect(resolveAdviceInputs({ ...base, timing: "unknown" }, { needBy: { value: 6, source: "default" } }, said).needByMonths).toBeNull();
  });
});

describe("withHostRoutesCard", () => {
  const card = routesCard(result, rec, URL, "Ways to reach your goal")!;
  const host = { card, text: citable.text };
  const keyFacts = { type: "keyFacts" as const, title: "Fees", facts: [{ label: "Analysis fee", value: "249.00 lei", source: URL }] };
  const modelRoutes = { ...card, recommendation: { ...(card as Extract<typeof card, { type: "routes" }>).recommendation, option: "Flexicredit, 48 months" } };

  it("puts the host card in place of the model's routes card and keeps the model's other cards", () => {
    const merged = withHostRoutesCard(host, [modelRoutes, keyFacts], ["https://other.example"], [citable], []);
    expect(merged).toMatchObject({ cards: [card, keyFacts], replaced: true });
    expect((merged as { urls: string[] }).urls).toEqual([URL, "https://other.example"]);
  });

  it("is the only card when the model showed none", () => {
    expect(withHostRoutesCard(host, [], [], [citable], [])).toEqual({ cards: [card], urls: [URL], replaced: false });
  });

  it("does nothing without a host card, and drops a host card whose source isn't one of this turn's results", () => {
    expect(withHostRoutesCard(null, [keyFacts], [], [citable], [])).toBeNull();
    expect(withHostRoutesCard(host, [], [], [{ ...citable, url: "https://elsewhere.example" }], [])).toHaveProperty("dropped");
  });
});

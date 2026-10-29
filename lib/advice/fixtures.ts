import type { TermRecord } from "../catalog/schemas";
import { routesCard, routesCitable } from "./copy";
import { debtShareCeiling, recommendRoute } from "./recommend";
import { buildRoutes } from "./routes";

/*
 * The chat.html renovation example as a reviewed catalog, for tests and evals only (evals/advice-answers.json,
 * scripts/eval-advice.ts): 40,000 lei over 60 months at 7.9% fixed, 7,800 lei income, 650 lei of other loan
 * payments, 1,250 lei saved a month. Illustrative figures, not Raiffeisen's terms.
 */

export const FIXTURE_NOW = Date.parse("2026-10-28T12:00:00Z");
const LOAN = "raiffeisen:personal-loan";
const URL = "https://www.raiffeisen.ro/loan.html";
const record = (termId: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${LOAN}#${termId}`, productId: LOAN, product: "Flexicredit", bank: "raiffeisen", track: "personal",
  kind: "fee", label: termId, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" }, quote: "q",
  provenance: { bank: "raiffeisen", url: URL, collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" }, ...over,
});
export const FIXTURE_RECORDS = {
  rate: record("rate", { kind: "interest_rate", value: { type: "exact", amount: 790 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } }),
  fee: record("analysis-fee", { value: { type: "exact", amount: 24_900 }, frequency: "once" }),
  term: record("term", { kind: "term", value: { type: "range", min: 6, max: 60 }, unit: "months" }),
  ceiling: record("grad-indatorare", { kind: "eligibility", value: { type: "exact", amount: 4_000 }, unit: "bps" }),
};

/** The renovation comparison for a timing, as compare_routes would return it. */
export function renovationComparison(needByMonths: number | null, customer: Partial<{ income: number | null; obligations: number | null }> = {}) {
  const records = Object.values(FIXTURE_RECORDS);
  const R = FIXTURE_RECORDS;
  const routes = buildRoutes({
    records, now: FIXTURE_NOW, today: "2026-10-28", alternativeTerms: [48],
    loan: { productId: LOAN, rateTermId: R.rate.termId, feeTermIds: [R.fee.termId], termLimitTermId: R.term.termId },
    customer: { amount: 4_000_000, months: 60, income: 780_000, obligations: 65_000, monthlySaving: 125_000, ...customer },
    params: { nearTieMarginBani: 5_000, variableStressBps: 200, saveFirstMonths: 8, maxSaveOnlyMonths: 24 },
  });
  const recommendation = recommendRoute({ routes: routes.routes, needByMonths,
    policy: { nearTieMarginBani: 5_000, debtShareCeiling: debtShareCeiling(records, R.ceiling.termId, LOAN, FIXTURE_NOW) } });
  const citable = routesCitable(routes, recommendation, { url: URL, collectedAt: R.rate.provenance.collectedAt, termIds: [R.rate.termId, R.fee.termId, R.term.termId] }, 1);
  return { routes, recommendation, citable, card: routesCard(routes, recommendation, URL, "Ways to reach your goal") };
}

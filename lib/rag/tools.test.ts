import { describe, expect, it } from "vitest";
import type { TermRecord } from "../catalog/schemas";
import { buildProductTermsResult } from "../catalog/terms";
import { runScenario } from "../calc/scenario";
import { findUngroundedNumbers } from "./numbers";
import { scenarioCitable, scenarioGapsNote, termCitables, termGapsNote, termValueText } from "./tools";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const P = "raiffeisen:personal-loan";
const rec = (id: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${P}#${id}`, productId: P, product: "Credit de nevoi personale", bank: "raiffeisen", track: "personal", kind: "fee", label: id,
  value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [], comparability: { category: "personal_loan", currency: "RON" }, quote: "q",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/loan.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "admin", reviewedAt: "2026-10-28T10:00:00Z" }, ...over,
});
const rate = rec("rate", { kind: "interest_rate", label: "Fixed interest", value: { type: "exact", amount: 555 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } });
const fee = rec("analysis", { label: "Analysis fee", value: { type: "exact", amount: 20_000 }, frequency: "once" });
const unreviewed = rec("admin", { label: "Admin fee", value: { type: "exact", amount: 500 }, frequency: "monthly", verification: { quoteFound: true } });

describe("catalog and calculator results for the model", () => {
  it("states starting values and ceilings as such", () => {
    expect(termValueText(rec("x", { value: { type: "from", min: 505 }, unit: "bps" }))).toBe("from 5.05% (a starting value, not the customer's)");
    expect(termValueText(rec("x", { value: { type: "up_to", max: 60 }, unit: "months" }))).toBe("up to 60 months (a ceiling, not what the customer gets)");
  });

  it("makes usable terms citable and lists unusable ones in a separate note", () => {
    const result = buildProductTermsResult({ track: "personal", query: "rate and fees", productIds: [P], records: [rate, fee, unreviewed], now: NOW });
    const citables = termCitables(result);
    expect(citables.map(c => c.chunkId)).toEqual([`term:${rate.termId}`, `term:${fee.termId}`]);
    expect(citables[0]!.text).toContain("Fixed interest: 5.55%.");
    expect(termGapsNote(result)).toContain("Admin fee: unreviewed");
  });

  it("writes every calculated figure so an answer quoting it passes the number check", () => {
    const result = runScenario({ request: { calculation: "loan_cost", loan: { productId: P, rateTermId: rate.termId, feeTermIds: [fee.termId] } },
      records: [rate, fee], now: NOW, today: "2026-10-28", amount: 5_000_000, months: 60, basis: "customer",
      params: { nearTieMarginBani: 5_000, variableStressBps: 200 } });
    const c = scenarioCitable(result, 1)!;
    expect(c.url).toBe("https://www.raiffeisen.ro/loan.html");
    const monthly = (result.loan!.monthly / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 });
    expect(findUngroundedNumbers(`You'd pay ${monthly} lei a month, ${(result.loan!.totalPayable / 100).toFixed(2)} lei in total.`, [c.text])).toEqual([]);
    expect(c.text).toContain("Indicative, not an offer");
    const gaps = runScenario({ request: { calculation: "loan_cost", loan: { productId: P, rateTermId: unreviewed.termId } }, records: [unreviewed], now: NOW,
      today: "2026-10-28", amount: null, months: null, basis: "customer", params: { nearTieMarginBani: 0, variableStressBps: 200 } });
    expect(scenarioCitable(gaps, 2)).toBeNull();
    expect(scenarioGapsNote(gaps)).toMatch(/missing_amount.*unreviewed|unreviewed.*missing_amount/s);
  });
});

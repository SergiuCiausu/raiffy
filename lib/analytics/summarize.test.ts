import { describe, expect, it } from "vitest";
import type { AnswerTrace, OutcomeEvent } from "./schemas";
import { analyticsSummarySchema } from "./schemas";
import { datesBetween, median, summarize } from "./summarize";

const at = (d: string, h = 10) => `${d}T${String(h).padStart(2, "0")}:00:00Z`;

function answer(i: number, over: Partial<AnswerTrace> = {}): AnswerTrace {
  return {
    at: at("2026-10-20"), conversationKey: `c${i}`, customerKey: `u${i}`, track: "personal", entry: "web",
    intent: "newLoan", dataUsed: ["loans"], evaluatorLoops: 0, fallback: false, escalated: false, staleBlocked: false,
    ...over,
  };
}

const base = (i: number, d = "2026-10-20") => ({ at: at(d), conversationKey: `c${i}`, customerKey: `u${i}`, track: "personal" as const, entry: "web" as const });
const times = <T>(count: number, f: (i: number) => T) => Array.from({ length: count }, (_, i) => f(i));
const filter = { from: "2026-10-01", to: "2026-10-31", minCount: 10 };

describe("summarize", () => {
  it("returns a valid summary for empty input, with everything suppressed", () => {
    const s = summarize([], [], filter);
    expect(analyticsSummarySchema.parse(s)).toBeTruthy();
    expect(s.kpis.answers).toBeNull();
    expect(s.kpis.accountDataShare).toBeNull();
    expect(s.daily).toHaveLength(31);
  });

  it("counts answers, conversations and the share using account data", () => {
    const A = [...times(30, (i) => answer(i)), ...times(10, (i) => answer(100 + i, { dataUsed: [] }))];
    const s = summarize(A, [], filter);
    expect(s.kpis.answers).toBe(40);
    expect(s.kpis.conversations).toBe(40);
    expect(s.kpis.accountDataShare).toBeCloseTo(0.75);
    expect(s.dataUsage.find((d) => d.source === "loans")).toMatchObject({ answers: 30 });
  });

  it("suppresses counts under the threshold", () => {
    const A = [...times(20, (i) => answer(i)), ...times(3, (i) => answer(50 + i, { dataUsed: ["deposits"] }))];
    const s = summarize(A, [], filter);
    expect(s.dataUsage.find((d) => d.source === "deposits")).toEqual({ source: "deposits", answers: null, share: null });
  });

  it("applies the date, track and entry filters", () => {
    const A = [
      ...times(12, (i) => answer(i)),
      ...times(12, (i) => answer(20 + i, { track: "business" })),
      ...times(12, (i) => answer(40 + i, { at: at("2026-09-30") })),
      ...times(12, (i) => answer(60 + i, { entry: "smartMobile" })),
    ];
    expect(summarize(A, [], { ...filter, track: "personal", entry: "web" }).kpis.answers).toBe(12);
    expect(summarize(A, [], filter).kpis.answers).toBe(36);
  });

  it("builds the pre-approved offer funnel and checks the offers are bank-issued", () => {
    const E: OutcomeEvent[] = [
      ...times(40, (i) => ({ ...base(i), kind: "offer" as const, productId: "personal-loan", stage: "shown" as const, source: "bank" as const, rateGapPts: 1.5 })),
      ...times(20, (i) => ({ ...base(i), kind: "offer" as const, productId: "personal-loan", stage: "opened" as const, source: "bank" as const, rateGapPts: 1.5 })),
      ...times(10, (i) => ({ ...base(i), kind: "offer" as const, productId: "personal-loan", stage: "applied" as const, source: "bank" as const, rateGapPts: 1.5 })),
    ];
    const s = summarize([], E, filter);
    expect(s.offers.funnel).toEqual({ shown: 40, opened: 20, applied: 10 });
    expect(s.kpis.offerTakeUp).toBeCloseTo(0.25);
    expect(s.offers.avgRateGapPts).toBeCloseTo(1.5);
    expect(s.offers.bankSourcedShare).toBe(1);
  });

  it("splits digital and branch applications with the branch reasons", () => {
    const E: OutcomeEvent[] = [
      ...times(30, (i) => ({ ...base(i), kind: "application" as const, productId: "personal-loan", channel: "digital" as const })),
      ...times(10, (i) => ({ ...base(i), kind: "application" as const, productId: "personal-loan", channel: "branch" as const, branchReason: "idNotVerified" as const })),
    ];
    const s = summarize([], E, filter);
    expect(s.kpis.digitalShare).toBeCloseTo(0.75);
    expect(s.channel.branchReasons.find((r) => r.reason === "idNotVerified")?.count).toBe(10);
    expect(s.channel.branchReasons.find((r) => r.reason === "documents")?.count).toBeNull();
  });

  it("totals the money-saved ledger per customer and takes the median", () => {
    const E: OutcomeEvent[] = times(12, (i) => ({ ...base(i), kind: "moneySaved" as const, lei: 100 * (i + 1) }));
    E.push({ ...base(0), kind: "moneySaved", lei: 1000 }); // a second entry for customer u0
    const s = summarize([], E, filter);
    expect(s.contracts.moneySaved.customers).toBe(12);
    expect(s.contracts.moneySaved.totalLei).toBe(100 * 78 + 1000);
    expect(s.contracts.moneySaved.medianLei).toBe(750);
  });

  it("hides the money saved when too few customers are behind it", () => {
    const E: OutcomeEvent[] = times(30, () => ({ ...base(1), kind: "moneySaved" as const, lei: 50 }));
    expect(summarize([], E, filter).kpis.moneySavedLei).toBeNull();
  });

  it("reports the evaluator first-pass share", () => {
    const A = [...times(15, (i) => answer(i)), ...times(5, (i) => answer(30 + i, { evaluatorLoops: 1 }))];
    expect(summarize(A, [], filter).quality.firstPassShare).toBeCloseTo(0.75);
  });

  it("ranks the most-asked-about fee lines", () => {
    const E: OutcomeEvent[] = [
      ...times(14, (i) => ({ ...base(i), kind: "feeExplained" as const, feeLine: "ATM withdrawal fee", productId: "debit-card", resolved: true })),
      ...times(11, (i) => ({ ...base(i), kind: "feeExplained" as const, feeLine: "Package fee", productId: "current-account", resolved: false })),
      ...times(2, (i) => ({ ...base(i), kind: "feeExplained" as const, feeLine: "SMS alerts", productId: "current-account", resolved: true })),
    ];
    const s = summarize([], E, filter);
    expect(s.fees.top.map((t) => t.feeLine)).toEqual(["ATM withdrawal fee", "Package fee"]);
    expect(s.fees.resolvedShare).toBeCloseTo(16 / 27);
  });
});

describe("helpers", () => {
  it("median handles even, odd and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("datesBetween is inclusive and crosses month ends", () => {
    expect(datesBetween("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

import { describe, expect, it } from "vitest";
import { impactPreview } from "./impact";
import { annuityPayment, depositInterest, quoteLoan, quoteOverdraft, recommendLoanOrOverdraft } from "./loan";

const loan = { annualRate: 0.094, originationFee: 249, monthlyFee: 0 };
const od = { annualRate: 0.115, annualFee: 9, maxAmount: 15000, maxMonths: 12 };

describe("annuityPayment", () => {
  it("matches the standard formula", () => {
    expect(annuityPayment(8000, 12, 0.094)).toBeCloseTo(701.10, 2);
  });

  it("splits the principal evenly at a zero rate", () => {
    expect(annuityPayment(6000, 12, 0)).toBe(500);
  });
});

describe("quoteLoan", () => {
  it("counts interest and every fee in the total cost", () => {
    const q = quoteLoan({ amount: 8000, months: 12 }, loan);
    expect(q.totalCost).toBeCloseTo(701.0966 * 12 - 8000 + 249, 0);
  });

  it("adds the monthly fee to the payment", () => {
    const q = quoteLoan({ amount: 8000, months: 12 }, { ...loan, monthlyFee: 10 });
    expect(q.monthly).toBeCloseTo(711.10, 2);
  });
});

describe("quoteOverdraft", () => {
  it("charges interest on the average balance plus the yearly fee", () => {
    const q = quoteOverdraft({ amount: 8000, months: 12 }, od);
    expect(q.totalCost).toBeCloseTo(8000 * 0.115 * 13 / 24 + 9, 6);
    expect(q.fits).toBe(true);
  });

  it("does not fit beyond its limit or its 12-month renewal", () => {
    expect(quoteOverdraft({ amount: 20000, months: 12 }, od).fits).toBe(false);
    expect(quoteOverdraft({ amount: 8000, months: 24 }, od).fits).toBe(false);
  });
});

describe("recommendLoanOrOverdraft", () => {
  it("picks the loan when the overdraft does not fit", () => {
    const c = { amount: 20000, months: 24 };
    expect(recommendLoanOrOverdraft(quoteLoan(c, loan), quoteOverdraft(c, od), 40)).toMatchObject({ pick: "loan", reason: "onlyFit" });
  });

  it("gives a near-tie to the fixed-rate loan", () => {
    const r = recommendLoanOrOverdraft({ monthly: 0, totalCost: 520 }, { fits: true, monthly: 0, totalCost: 500 }, 40);
    expect(r).toEqual({ pick: "loan", reason: "nearTie", gap: 20 });
  });

  it("picks the cheaper option outside the margin", () => {
    const c = { amount: 8000, months: 12 };
    expect(recommendLoanOrOverdraft(quoteLoan(c, loan), quoteOverdraft(c, od), 40)).toMatchObject({ pick: "overdraft", reason: "cheaper" });
  });
});

describe("depositInterest", () => {
  it("is simple interest for the term", () => {
    expect(depositInterest(10000, 6, 0.056)).toBeCloseTo(280, 6);
  });
});

describe("impactPreview", () => {
  it("reports the payment change for each sample case", () => {
    const rows = impactPreview({ kind: "loan", cases: [{ amount: 8000, months: 12 }], before: loan, after: { ...loan, annualRate: 0.104 } });
    expect(rows[0]!.metric).toBe("monthly");
    expect(rows[0]!.delta).toBeGreaterThan(0);
    expect(rows[0]!.recommendation).toBeUndefined();
  });

  it("flags a case whose recommendation flips", () => {
    const rows = impactPreview({
      kind: "loan",
      cases: [{ amount: 8000, months: 12 }],
      before: loan,
      after: { ...loan, originationFee: 0, annualRate: 0.06 },
      compareWith: { overdraft: od, nearTieMargin: 40 },
    });
    expect(rows[0]!.recommendation).toEqual({ before: "overdraft", after: "loan", changed: true });
  });

  it("re-runs the recommendation when the overdraft changes", () => {
    const rows = impactPreview({
      kind: "overdraft",
      cases: [{ amount: 8000, months: 12 }],
      before: od,
      after: od,
      compareWith: { loan, nearTieMargin: 40 },
    });
    expect(rows[0]!.recommendation?.changed).toBe(false);
    expect(rows[0]!.delta).toBe(0);
  });

  it("measures interest earned for deposits", () => {
    const rows = impactPreview({ kind: "deposit", cases: [{ amount: 10000, months: 6 }], before: { annualRate: 0.056 }, after: { annualRate: 0.05 } });
    expect(rows[0]).toMatchObject({ metric: "interest" });
    expect(rows[0]!.delta).toBeCloseTo(-30, 6);
  });

  it("rejects a rate given as a percentage", () => {
    expect(() => impactPreview({ kind: "deposit", cases: [{ amount: 1, months: 1 }], before: { annualRate: 5.6 }, after: { annualRate: 0.05 } })).toThrow();
  });
});

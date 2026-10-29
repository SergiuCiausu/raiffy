import { describe, expect, it } from "vitest";
import { checkAffordability, type AffordabilityLimits } from "./affordability";
import { annuityPayment } from "./loan";

// Test parameters only; real values come from the reviewed regulatoryLimits records.
const limits: AffordabilityLimits = {
  maxDebtShareRon: 0.4, maxDebtShareFx: 0.2, maxConsumerTermMonths: 60,
  source: { label: "Test limits", url: "https://example.test/limits", validFrom: "2026-01-01", status: "pending_review" },
};

describe("checkAffordability", () => {
  it("finds the income share left for the loan and the highest rate at which it still fits", () => {
    const r = checkAffordability({ netMonthlyIncome: 4500, loanAmount: 50000, termMonths: 60, age: 29 }, limits);
    expect(r.maxNewInstalment).toBeCloseTo(1800, 6);
    expect(r.zeroRateInstalment).toBeCloseTo(833.33, 2);
    expect(r.fitsAtZeroRate).toBe(true);
    expect(r.maxFittingAnnualRate).toBeCloseTo(0.358, 3);
    expect(annuityPayment(50000, 60, r.maxFittingAnnualRate!)).toBeCloseTo(1800, 4);
    expect(r).toMatchObject({ termWithinConsumerLimit: true, ageAtEnd: 34 });
  });

  it("takes existing instalments off the limit and reports a loan that never fits", () => {
    const r = checkAffordability({ netMonthlyIncome: 2500, loanAmount: 50000, termMonths: 60, existingMonthlyInstalments: 400 }, limits);
    expect(r.maxNewInstalment).toBeCloseTo(600, 6);
    expect(r).toMatchObject({ fitsAtZeroRate: false, maxFittingAnnualRate: null, ageAtEnd: null });
  });

  it("uses the foreign-currency share, caps the rate search and flags a term over the consumer limit", () => {
    expect(checkAffordability({ netMonthlyIncome: 4500, loanAmount: 10000, termMonths: 60, currency: "FX" }, limits).maxNewInstalment).toBeCloseTo(900, 6);
    expect(checkAffordability({ netMonthlyIncome: 20000, loanAmount: 1000, termMonths: 12 }, limits).maxFittingAnnualRate).toBe(1);
    expect(checkAffordability({ netMonthlyIncome: 4500, loanAmount: 50000, termMonths: 84 }, limits).termWithinConsumerLimit).toBe(false);
  });
});

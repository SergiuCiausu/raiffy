import { describe, expect, it } from "vitest";
import type { AffordabilityLimits } from "../calc/affordability";
import { runCalculator } from "./calculator";

// Test parameters only; real values come from the regulatoryLimits records.
const limits: AffordabilityLimits = {
  maxDebtShareRon: 0.4, maxDebtShareFx: 0.2, maxConsumerTermMonths: 60,
  source: { label: "Test limits", url: "https://example.test/limits", validFrom: "2026-01-01", status: "pending_review" },
};
const ana = "Sunt Ana, am 29 de Ani, lucrez pe un salariu de 4500 de lei si vreau sa iau un credit de nevoi personale pe o durata de 60 de luni de 50000 de lei, sunt eligibila?";
const input = { calculation: "loan_affordability" as const, netMonthlyIncome: 4500, loanAmount: 50000, termMonths: 60, age: 29 };

describe("runCalculator", () => {
  it("runs on the customer's own figures and returns rounded, sourced results", () => {
    const result = runCalculator(input, [ana], limits);
    expect(result.status).toBe("ok");
    const content = JSON.parse(result.status === "ok" ? result.content : "{}");
    expect(content).toMatchObject({
      indicativeOnly: true, notACreditDecision: true,
      inputs: { netMonthlyIncome: 4500, loanAmount: 50000, termMonths: 60, existingMonthlyInstalments: 0, currency: "RON", age: 29 },
      limit: { maxDebtSharePercent: 40, reviewStatus: "pending_review" },
      results: { maxNewMonthlyInstalment: 1800, instalmentWithNoInterest: 833, fitsEvenWithNoInterest: true,
        fitsAtAnyAnnualRateUpToPercent: 35.8, termWithinConsumerLimit: true, ageAtEndOfLoan: 34 },
    });
    expect(content.notChecked).toContain("credit history at the Biroul de Credit");
  });

  it("refuses figures the customer never wrote, but accepts a term given in years or grouped digits", () => {
    expect(runCalculator(input, ["I want a 50000 lei loan over 60 months. I'm 29."], limits))
      .toEqual({ status: "unavailable", reason: expect.stringContaining("netMonthlyIncome 4500") });
    expect(runCalculator(input, ["Salary 4.500 lei, I'm 29, loan of 50,000 lei over 5 years"], limits).status).toBe("ok");
    expect(runCalculator(input, [ana], null).status).toBe("unavailable");
  });

  it("checks figures from earlier customer turns and an existing instalment", () => {
    const result = runCalculator({ ...input, existingMonthlyInstalments: 600 }, ["My salary is 4500 lei and I'm 29.", "I already pay 600 lei a month. Can I borrow 50000 lei for 60 months?"], limits);
    expect(result.status === "ok" && JSON.parse(result.content).results.maxNewMonthlyInstalment).toBe(1200);
  });
});

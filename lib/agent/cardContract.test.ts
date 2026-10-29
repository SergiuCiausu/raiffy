import { describe, expect, it } from "vitest";
import type { AffordabilityLimits } from "../calc/affordability";
import { affordabilityBlock } from "./affordabilityBlock";
import { runCalculator } from "./calculator";
import { EXPECTED_CARDS, expectedCards, meetsCardContract } from "./cardContract";
import { INQUIRIES } from "./jev";

describe("card contract per answer pattern", () => {
  it("names a card for every pattern that needs one, and none for text-only patterns", () => {
    expect(Object.keys(EXPECTED_CARDS).sort()).toEqual(Object.keys(INQUIRIES).sort());
    expect(expectedCards("product_comparison")).toEqual(["compare_table", "comparison"]);
    expect(expectedCards("product_explanation")).toContain("keyFacts");
    expect(expectedCards("affordability")).toContain("affordability");
    expect(expectedCards("listing")).toEqual([]);
    expect(expectedCards(null)).toEqual([]);
  });

  it("is met by any one of the pattern's cards, and never by callouts or memory", () => {
    expect(meetsCardContract("purchase_goal", [{ type: "callout" }, { type: "simulation" }])).toBe(true);
    expect(meetsCardContract("purchase_goal", [{ type: "callout" }, { type: "memory" }])).toBe(false);
    expect(meetsCardContract("product_comparison", [{ type: "keyFacts" }])).toBe(false);
    expect(meetsCardContract("security_complaint", [])).toBe(true);
  });
});

describe("affordability card", () => {
  const limits: AffordabilityLimits = {
    maxDebtShareRon: 0.4, maxDebtShareFx: 0.2, maxConsumerTermMonths: 60,
    source: { label: "Test limits", url: "https://example.test/limits", validFrom: "2026-01-01", status: "pending_review" },
  };
  const input = { calculation: "loan_affordability" as const, netMonthlyIncome: 4500, loanAmount: 50000, termMonths: 60 };

  it("is built by code from the check's result, numbers only", () => {
    const result = runCalculator(input, ["I earn 4500 lei and want 50000 lei over 60 months."], limits);
    const block = affordabilityBlock(result.status === "ok" ? result.content : "");
    expect(block).toMatchObject({ type: "affordability", indicativeOnly: true,
      results: { maxNewMonthlyInstalment: 1800, instalmentWithNoInterest: 833, fitsEvenWithNoInterest: true }, limit: { source: "Test limits" } });
  });

  it("reads nothing else as a check", () => {
    expect(affordabilityBlock("not json")).toBeNull();
    expect(affordabilityBlock(JSON.stringify({ calculation: "loan_payment" }))).toBeNull();
  });
});

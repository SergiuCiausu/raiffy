import { describe, expect, it } from "vitest";
import { containsFinancialFigure, findUngroundedNumbers, numberTokens, numericValues } from "./numbers";

describe("numberTokens", () => {
  it("finds amounts, decimals and percentages", () => {
    expect(numberTokens("DAE 32,40%, rata 961,21 lei pentru 50.000 lei pe 5 ani")).toEqual([
      "32,40", "961,21", "50.000", "5",
    ]);
  });

  it("skips list markers at the start of a line", () => {
    expect(numberTokens("1. Fee of 25 lei\n2) Another 30 lei")).toEqual(["25", "30"]);
  });
});

describe("numericValues", () => {
  it("reads both separator conventions", () => {
    expect(numericValues("961,21")).toEqual(["961.21"]);
    expect(numericValues("4.70")).toEqual(["4.7"]);
    expect(numericValues("50.000").sort()).toEqual(["50", "50000"]);
    expect(numericValues("1,000,000")).toEqual(["1000000"]);
    expect(numericValues("6.152,52")).toEqual(["6152.52"]);
    expect(numericValues("6,152.52")).toEqual(["6152.52"]);
    expect(numericValues("15")).toEqual(["15"]);
  });
});

describe("findUngroundedNumbers", () => {
  const source = "Exemplu: 50.000 lei pe 60 luni, rata lunară 961,21 lei, DAE 9,85%.";

  it("accepts numbers restated in English format", () => {
    expect(findUngroundedNumbers("For 50,000 lei over 60 months the payment is 961.21 lei (APR 9.85%).", [source]))
      .toEqual([]);
  });

  it("flags a number no source contains", () => {
    expect(findUngroundedNumbers("The payment is about 960 lei, 1,650 lei in fees.", [source])).toEqual(["960", "1,650"]);
  });

  it("accepts numbers from any allowed text, such as the question or the collection date", () => {
    expect(findUngroundedNumbers("As of 28 October 2026, it costs 15 lei.", ["15 lei", "2026-10-28"])).toEqual([]);
  });
});

describe("containsFinancialFigure", () => {
  it("finds rates, amounts and named price terms", () => {
    expect(containsFinancialFigure("The interest rate is 5.5%.")).toBe(true);
    expect(containsFinancialFigure("Your salary of 4,500 lei is above the minimum.")).toBe(true);
    expect(containsFinancialFigure("The DAE starts from 9")).toBe(true);
    expect(containsFinancialFigure("It costs ten euros a month.")).toBe(true);
  });

  it("leaves terms, ages and counts alone", () => {
    expect(containsFinancialFigure("A 6-month deposit in lei renews automatically.")).toBe(false);
    expect(containsFinancialFigure("You must be at least 21 and employed for 3 months.")).toBe(false);
  });
});

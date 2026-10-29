import { describe, expect, it } from "vitest";
import { compareAmortised, compareRevolving, monthlyPayment, recommend, remainingBalance } from "./finance";
import { CHAT_LOAN_FEE, CHAT_OVERDRAFT, LANDING_LOAN, LANDING_OVERDRAFT } from "./demo-terms";

const chatLoan = { annualRate: 0.079, oneOffFee: CHAT_LOAN_FEE };

describe("monthlyPayment", () => {
  it("matches the prototype's 8,000 lei over 12 months at 7.9%", () => {
    expect(monthlyPayment(8000, 0.079, 12)).toBeCloseTo(695.54, 2);
  });
});

describe("compareAmortised (landing simulator)", () => {
  it("reproduces the figures shown on the landing page", () => {
    const c = compareAmortised({ amount: 8000, months: 12 }, LANDING_LOAN, LANDING_OVERDRAFT);
    expect(c.loan.cost).toBeCloseTo(595.45, 2);
    expect(c.overdraft.monthly).toBeCloseTo(708.92, 2);
    expect(c.overdraft.cost).toBeCloseTo(507.05, 2);
    expect(c.loan.total).toBeCloseTo(8595.45, 2);
  });
  it("marks the overdraft unavailable above its limit", () => {
    const c = compareAmortised({ amount: 20000, months: 24 }, LANDING_LOAN, LANDING_OVERDRAFT);
    expect(c.overdraft).toMatchObject({ available: false, unavailableBecause: "limit" });
  });
});

describe("compareRevolving (chat)", () => {
  it("charges interest on the average balance plus the flat fee", () => {
    const c = compareRevolving({ amount: 8000, months: 12 }, chatLoan, CHAT_OVERDRAFT);
    expect(c.overdraft.cost).toBeCloseTo(507.33, 2);
    expect(c.overdraft.monthly).toBeCloseTo(708.94, 2);
  });
  it("doesn't fit terms over 12 months", () => {
    const c = compareRevolving({ amount: 8000, months: 24 }, chatLoan, CHAT_OVERDRAFT);
    expect(c.overdraft).toMatchObject({ available: false, unavailableBecause: "term" });
  });
  it("reports the limit before the term when both fail", () => {
    const c = compareRevolving({ amount: 20000, months: 24 }, chatLoan, CHAT_OVERDRAFT);
    expect(c.overdraft.unavailableBecause).toBe("limit");
  });
});

describe("recommend", () => {
  it("picks the cheaper overdraft and reports the difference", () => {
    const r = recommend(compareAmortised({ amount: 8000, months: 12 }, LANDING_LOAN, LANDING_OVERDRAFT));
    expect(r).toMatchObject({ pick: "overdraft", rule: "cheaper" });
    expect(r.difference).toBeCloseTo(88.41, 2);
  });
  it("picks the loan when it's cheaper", () => {
    const r = recommend(compareAmortised({ amount: 8000, months: 36 }, LANDING_LOAN, LANDING_OVERDRAFT));
    expect(r).toMatchObject({ pick: "loan", rule: "cheaper" });
  });
  it("gives a near-tie to the fixed-rate loan", () => {
    const opt = { available: true, unavailableBecause: null, monthly: 0, total: 0 };
    const r = recommend({ loan: { ...opt, cost: 520 }, overdraft: { ...opt, cost: 500 } });
    expect(r).toMatchObject({ pick: "loan", rule: "near-tie" });
  });
  it("picks the loan as the only fit when the overdraft is unavailable", () => {
    const r = recommend(compareRevolving({ amount: 8000, months: 24 }, chatLoan, CHAT_OVERDRAFT));
    expect(r).toMatchObject({ pick: "loan", rule: "only-fit" });
  });
});

describe("remainingBalance", () => {
  it("is what's left after half the term", () => {
    expect(remainingBalance(8000, 0.079, 12, 6)).toBeCloseTo(4078.73, 2);
  });
  it("is zero at the end of the term", () => {
    expect(remainingBalance(8000, 0.079, 12, 12)).toBeCloseTo(0, 6);
  });
});

describe("monthlyPayment matches the server calculator", () => {
  it("gives the same payment as lib/calc annuityPayment, so the live simulation card agrees with the server", async () => {
    const { annuityPayment } = await import("../../lib/calc/loan");
    for (const [p, rate, n] of [[30000, 0.0795, 36], [5000, 0.12, 12], [120000, 0.065, 60]] as const) {
      expect(monthlyPayment(p, rate, n)).toBeCloseTo(annuityPayment(p, n, rate), 6);
    }
  });
});

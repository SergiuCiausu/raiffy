import { describe, expect, it } from "vitest";
import { addMonths, annualPercentageRate, repaymentSchedule } from "./schedule";

const base = { principal: 1_000_000, months: 12, annualRateBps: 1000, upfrontFee: 0, monthlyFee: 0, firstPaymentDate: "2026-12-15" };

describe("repaymentSchedule", () => {
  it("pays the principal off exactly, to the ban", () => {
    const s = repaymentSchedule(base);
    expect(s.rows).toHaveLength(12);
    expect(s.rows.reduce((sum, r) => sum + r.principal, 0)).toBe(1_000_000);
    expect(s.rows.at(-1)?.balance).toBe(0);
    expect(s.totals.payable).toBe(s.rows.reduce((sum, r) => sum + r.payment, 0));
  });

  it("matches the annuity formula and splits each payment into interest and principal", () => {
    const s = repaymentSchedule(base);
    expect(s.instalment).toBe(87_916); // 879,16 lei
    expect(s.rows[0]).toMatchObject({ n: 1, date: "2026-12-15", interest: 8_333, principal: 79_583, balance: 920_417 });
  });

  it("splits the principal evenly at a zero rate", () => {
    const s = repaymentSchedule({ ...base, annualRateBps: 0 });
    expect(s.totals.interest).toBe(0);
    expect(s.dae).toBe(0);
    expect(s.rows.every((r) => r.principal === 83_333 || r.n === 12)).toBe(true);
  });

  it("counts the upfront and monthly fees in the total and the DAE", () => {
    const s = repaymentSchedule({ ...base, upfrontFee: 20_000, monthlyFee: 500 });
    expect(s.monthly).toBe(s.instalment + 500);
    expect(s.totals.fees).toBe(20_000 + 500 * 12);
    expect(s.dae).toBeGreaterThan(repaymentSchedule(base).dae);
  });

  it("comes within a few bani of a bank's published example", () => {
    // Raiffeisen's representative example: 50.000 lei, 60 months, 5,55%, 5 lei a month: "rata lunara este 961,21 Lei".
    // Its 9,49% DAE also counts a 3.600 lei life insurance premium, which isn't passed in here, so ours is lower.
    const s = repaymentSchedule({ principal: 5_000_000, months: 60, annualRateBps: 555, upfrontFee: 20_000, monthlyFee: 500, firstPaymentDate: "2026-12-01" });
    expect(Math.abs(s.monthly - 96_121)).toBeLessThanOrEqual(10);
    expect(s.dae).toBeLessThan(0.0949);
  });

  it("rejects amounts that aren't whole bani", () => {
    expect(() => repaymentSchedule({ ...base, principal: 1000.5 })).toThrow();
  });
});

describe("addMonths", () => {
  it("moves to the last day of shorter months", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("annualPercentageRate", () => {
  it("equals the effective yearly rate of a fee-free loan", () => {
    const s = repaymentSchedule(base);
    expect(annualPercentageRate(1_000_000, s.rows.map((r) => r.payment))).toBeCloseTo(Math.pow(1 + 0.1 / 12, 12) - 1, 4);
  });
});

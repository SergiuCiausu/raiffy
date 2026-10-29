import { z } from "zod";

/*
 * Indicative repayment schedule for a fixed-rate amortizing loan, the table in a plan summary
 * (raiffy-spec/docs/shared/plan-summary-handoff.md). Money is integer bani and the rate is integer basis points,
 * both passed in from the catalog. Each instalment is rounded to the ban; the last one absorbs the rounding.
 * Interest is monthly at rate / 12, so a bank's day-count can differ by a few bani: the official schedule is
 * the one the bank issues.
 */

export const scheduleInputSchema = z.object({
  principal: z.number().int().positive(),
  months: z.number().int().min(1).max(600),
  annualRateBps: z.number().int().min(0).max(10_000),
  /** Charged once at disbursement, such as the analysis fee. */
  upfrontFee: z.number().int().min(0),
  /** Charged with every instalment, such as the administration fee. */
  monthlyFee: z.number().int().min(0),
  firstPaymentDate: z.iso.date(),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const scheduleRowSchema = z.object({
  n: z.number().int().positive(),
  date: z.iso.date(),
  principal: z.number().int(),
  interest: z.number().int(),
  fees: z.number().int(),
  /** principal + interest + fees */
  payment: z.number().int(),
  balance: z.number().int(),
});
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;

export const scheduleSchema = z.object({
  /** Principal plus interest of a regular instalment, before fees. */
  instalment: z.number().int(),
  /** A regular instalment with its monthly fee: what the customer pays each month. */
  monthly: z.number().int(),
  rows: z.array(scheduleRowSchema),
  totals: z.object({ principal: z.number().int(), interest: z.number().int(), fees: z.number().int(), payable: z.number().int() }),
  /** Annual percentage rate of charge (DAE) of these costs only, as a fraction. Insurance or other costs not passed in are not counted. */
  dae: z.number(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

/** The same day each month, moved to the month's last day when it doesn't exist (31 Jan → 28 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [y = 0, m = 1, d = 1] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * DAE per the consumer credit formula: the yearly rate X at which the credit paid out (principal minus upfront
 * fees) equals the payments discounted at (1 + X)^(k / 12). Bisection, so it always converges.
 */
export function annualPercentageRate(netCredit: number, payments: number[]): number {
  const pv = (x: number) => payments.reduce((sum, p, i) => sum + p / Math.pow(1 + x, (i + 1) / 12), 0);
  let lo = 0;
  let hi = 10;
  if (pv(lo) <= netCredit) return 0;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > netCredit) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function repaymentSchedule(raw: ScheduleInput): Schedule {
  const input = scheduleInputSchema.parse(raw);
  const r = input.annualRateBps / 10_000 / 12;
  const exact = r === 0 ? input.principal / input.months : (input.principal * r) / (1 - Math.pow(1 + r, -input.months));
  const instalment = Math.round(exact);

  const rows: ScheduleRow[] = [];
  let balance = input.principal;
  for (let n = 1; n <= input.months; n++) {
    const interest = Math.round(balance * r);
    const principal = n === input.months ? balance : Math.min(balance, instalment - interest);
    balance -= principal;
    rows.push({
      n, date: addMonths(input.firstPaymentDate, n - 1), principal, interest, fees: input.monthlyFee,
      payment: principal + interest + input.monthlyFee, balance,
    });
  }

  const interest = rows.reduce((s, row) => s + row.interest, 0);
  const fees = input.upfrontFee + input.monthlyFee * input.months;
  return scheduleSchema.parse({
    instalment,
    monthly: instalment + input.monthlyFee,
    rows,
    totals: { principal: input.principal, interest, fees, payable: input.principal + interest + fees },
    dae: annualPercentageRate(input.principal - input.upfrontFee, rows.map((row) => row.payment)),
  });
}

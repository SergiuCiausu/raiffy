import { z } from "zod";

/*
 * Loan-versus-overdraft maths for the demo pages. Pure: rates and fees come in as arguments
 * (see lib/demo-terms.ts), and results are numbers and keys, never formatted strings.
 */

export const LoanTermsSchema = z.object({
  annualRate: z.number().positive(),
  oneOffFee: z.number().nonnegative(),
});
export type LoanTerms = z.infer<typeof LoanTermsSchema>;

export const OverdraftTermsSchema = z.object({
  annualRate: z.number().positive(),
  limit: z.number().positive(),
  /** Overdrafts renew every 12 months; longer terms don't fit. Omit for no term cap. */
  maxTermMonths: z.number().int().positive().optional(),
  /** Flat cost added once (e.g. a package fee), on top of interest. */
  flatFee: z.number().nonnegative().default(0),
});
export type OverdraftTerms = z.input<typeof OverdraftTermsSchema>;

export const RequestSchema = z.object({
  amount: z.number().positive(),
  months: z.number().int().positive(),
});
export type Request = z.infer<typeof RequestSchema>;

export const OptionResultSchema = z.object({
  available: z.boolean(),
  unavailableBecause: z.enum(["limit", "term"]).nullable(),
  monthly: z.number(),
  cost: z.number(),
  total: z.number(),
});
export type OptionResult = z.infer<typeof OptionResultSchema>;

export const ComparisonSchema = z.object({ loan: OptionResultSchema, overdraft: OptionResultSchema });
export type Comparison = z.infer<typeof ComparisonSchema>;

export const RecommendationSchema = z.object({
  pick: z.enum(["loan", "overdraft"]),
  rule: z.enum(["only-fit", "near-tie", "cheaper"]),
  /** Absolute difference in total cost, in lei. */
  difference: z.number().nonnegative(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/** Annuity payment for principal P at an annual rate over n months. */
export function monthlyPayment(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

function overdraftFit(req: Request, od: OverdraftTerms): OptionResult["unavailableBecause"] {
  if (req.amount > od.limit) return "limit";
  if (od.maxTermMonths !== undefined && req.months > od.maxTermMonths) return "term";
  return null;
}

function loanResult(req: Request, loan: LoanTerms): OptionResult {
  const monthly = monthlyPayment(req.amount, loan.annualRate, req.months);
  const cost = monthly * req.months - req.amount + loan.oneOffFee;
  return { available: true, unavailableBecause: null, monthly, cost, total: req.amount + cost };
}

/**
 * Landing-page model: the overdraft is repaid in equal monthly instalments, like a loan at its own rate.
 */
export function compareAmortised(req: Request, loan: LoanTerms, od: OverdraftTerms): Comparison {
  const why = overdraftFit(req, od);
  const monthly = monthlyPayment(req.amount, od.annualRate, req.months);
  const cost = monthly * req.months - req.amount + (od.flatFee ?? 0);
  return {
    loan: loanResult(req, loan),
    overdraft: { available: why === null, unavailableBecause: why, monthly, cost, total: req.amount + cost },
  };
}

/**
 * Chat model: the overdraft balance falls linearly to zero, so interest accrues on the average balance.
 */
export function compareRevolving(req: Request, loan: LoanTerms, od: OverdraftTerms): Comparison {
  const why = overdraftFit(req, od);
  const interest = (req.amount * od.annualRate * (req.months + 1)) / 2 / 12;
  const cost = interest + (od.flatFee ?? 0);
  return {
    loan: loanResult(req, loan),
    overdraft: {
      available: why === null,
      unavailableBecause: why,
      monthly: (req.amount + cost) / req.months,
      cost,
      total: req.amount + cost,
    },
  };
}

/**
 * The recommendation rule (deterministic, never the LLM): the cheapest option that fits,
 * with a near-tie going to the fixed-rate loan.
 */
export function recommend(c: Comparison, nearTie = 40): Recommendation {
  const difference = Math.abs(c.loan.cost - c.overdraft.cost);
  if (!c.overdraft.available) return { pick: "loan", rule: "only-fit", difference };
  if (difference < nearTie) return { pick: "loan", rule: "near-tie", difference };
  return { pick: c.overdraft.cost < c.loan.cost ? "overdraft" : "loan", rule: "cheaper", difference };
}

/** Balance left on an annuity loan after k payments. */
export function remainingBalance(principal: number, annualRate: number, months: number, afterMonths: number): number {
  const r = annualRate / 12;
  const m = monthlyPayment(principal, annualRate, months);
  const g = Math.pow(1 + r, afterMonths);
  return principal * g - (m * (g - 1)) / r;
}

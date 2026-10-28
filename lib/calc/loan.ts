import { z } from "zod";

/**
 * Deterministic cost math for the console's impact preview and the chat simulator.
 * Rates, fees and limits always come in from the catalog; nothing here is a hardcoded fact.
 * Results are numbers in lei, unrounded; formatting happens in the UI.
 */

export const loanTermsSchema = z.object({
  /** Annual nominal rate as a fraction, 0.094 for 9.4%. */
  annualRate: z.number().min(0).max(1),
  /** One-off origination fee in lei. */
  originationFee: z.number().min(0),
  /** Monthly administration fee in lei. */
  monthlyFee: z.number().min(0),
});
export type LoanTerms = z.infer<typeof loanTermsSchema>;

export const overdraftTermsSchema = z.object({
  annualRate: z.number().min(0).max(1),
  /** Yearly fee in lei, charged once per 12-month renewal. */
  annualFee: z.number().min(0),
  maxAmount: z.number().positive(),
  /** An overdraft renews every 12 months, so longer terms do not fit. */
  maxMonths: z.number().int().positive(),
});
export type OverdraftTerms = z.infer<typeof overdraftTermsSchema>;

export const sampleCaseSchema = z.object({
  amount: z.number().positive(),
  months: z.number().int().positive(),
});
export type SampleCase = z.infer<typeof sampleCaseSchema>;

export const loanQuoteSchema = z.object({ monthly: z.number(), totalCost: z.number() });
export type LoanQuote = z.infer<typeof loanQuoteSchema>;

export const overdraftQuoteSchema = z.object({ fits: z.boolean(), monthly: z.number(), totalCost: z.number() });
export type OverdraftQuote = z.infer<typeof overdraftQuoteSchema>;

/** Fixed monthly payment for an amortizing loan. A zero rate splits the principal evenly. */
export function annuityPayment(principal: number, months: number, annualRate: number): number {
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Monthly payment and total cost (interest plus every fee) of a fixed-rate loan. */
export function quoteLoan(c: SampleCase, t: LoanTerms): LoanQuote {
  const monthly = annuityPayment(c.amount, c.months, t.annualRate) + t.monthlyFee;
  return { monthly, totalCost: monthly * c.months - c.amount + t.originationFee };
}

/**
 * An overdraft repaid in equal parts: interest runs on the average balance, (n + 1) / 2 of the amount,
 * plus the yearly fee once per started 12 months.
 */
export function quoteOverdraft(c: SampleCase, t: OverdraftTerms): OverdraftQuote {
  const interest = (c.amount * t.annualRate * (c.months + 1)) / 2 / 12;
  const fees = t.annualFee * Math.ceil(c.months / 12);
  const totalCost = interest + fees;
  return {
    fits: c.months <= t.maxMonths && c.amount <= t.maxAmount,
    monthly: (c.amount + totalCost) / c.months,
    totalCost,
  };
}

export const recommendationSchema = z.object({
  pick: z.enum(["loan", "overdraft"]),
  reason: z.enum(["onlyFit", "nearTie", "cheaper"]),
  /** Total-cost gap between the two options, in lei. */
  gap: z.number(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

/**
 * The recommendation rule from DESIGN.md: the cheapest option that fits, with a near-tie going to the
 * fixed-rate loan. `nearTieMargin` is a catalog parameter, not a constant.
 */
export function recommendLoanOrOverdraft(loan: LoanQuote, od: OverdraftQuote, nearTieMargin: number): Recommendation {
  const gap = Math.abs(loan.totalCost - od.totalCost);
  if (!od.fits) return { pick: "loan", reason: "onlyFit", gap };
  if (gap < nearTieMargin) return { pick: "loan", reason: "nearTie", gap };
  return od.totalCost < loan.totalCost ? { pick: "overdraft", reason: "cheaper", gap } : { pick: "loan", reason: "cheaper", gap };
}

/** Simple interest earned on a term deposit or savings balance, before tax. */
export function depositInterest(amount: number, months: number, annualRate: number): number {
  return (amount * annualRate * months) / 12;
}

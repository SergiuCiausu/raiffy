import { z } from "zod";
import {
  depositInterest,
  loanTermsSchema,
  overdraftTermsSchema,
  quoteLoan,
  quoteOverdraft,
  recommendLoanOrOverdraft,
  sampleCaseSchema,
  type LoanTerms,
  type OverdraftTerms,
  type SampleCase,
} from "./loan";

/**
 * Impact preview for a catalog change (docs/shared/console.md → Change lifecycle): run the calculators
 * on a fixed set of sample cases with the published and the proposed values, and report before and after.
 */

export const loanImpactInputSchema = z.object({
  kind: z.literal("loan"),
  cases: z.array(sampleCaseSchema).min(1),
  before: loanTermsSchema,
  after: loanTermsSchema,
  /** When set, the loan-vs-overdraft recommendation is re-run for each case. */
  compareWith: z.object({ overdraft: overdraftTermsSchema, nearTieMargin: z.number().min(0) }).optional(),
});

export const overdraftImpactInputSchema = z.object({
  kind: z.literal("overdraft"),
  cases: z.array(sampleCaseSchema).min(1),
  before: overdraftTermsSchema,
  after: overdraftTermsSchema,
  compareWith: z.object({ loan: loanTermsSchema, nearTieMargin: z.number().min(0) }).optional(),
});

export const depositImpactInputSchema = z.object({
  kind: z.literal("deposit"),
  cases: z.array(sampleCaseSchema).min(1),
  before: z.object({ annualRate: z.number().min(0).max(1) }),
  after: z.object({ annualRate: z.number().min(0).max(1) }),
});

export const impactInputSchema = z.discriminatedUnion("kind", [
  loanImpactInputSchema,
  overdraftImpactInputSchema,
  depositImpactInputSchema,
]);
export type ImpactInput = z.infer<typeof impactInputSchema>;

export const impactRowSchema = z.object({
  case: sampleCaseSchema,
  /** What the row measures: the monthly payment, or the interest earned for deposits. */
  metric: z.enum(["monthly", "interest"]),
  before: z.number(),
  after: z.number(),
  delta: z.number(),
  recommendation: z
    .object({ before: z.enum(["loan", "overdraft"]), after: z.enum(["loan", "overdraft"]), changed: z.boolean() })
    .optional(),
});
export type ImpactRow = z.infer<typeof impactRowSchema>;

function recommendationShift(c: SampleCase, loanBefore: LoanTerms, loanAfter: LoanTerms, odBefore: OverdraftTerms, odAfter: OverdraftTerms, margin: number) {
  const before = recommendLoanOrOverdraft(quoteLoan(c, loanBefore), quoteOverdraft(c, odBefore), margin).pick;
  const after = recommendLoanOrOverdraft(quoteLoan(c, loanAfter), quoteOverdraft(c, odAfter), margin).pick;
  return { before, after, changed: before !== after };
}

export function impactPreview(input: ImpactInput): ImpactRow[] {
  const parsed = impactInputSchema.parse(input);
  switch (parsed.kind) {
    case "loan":
      return parsed.cases.map((c) => {
        const before = quoteLoan(c, parsed.before).monthly;
        const after = quoteLoan(c, parsed.after).monthly;
        const cw = parsed.compareWith;
        return {
          case: c, metric: "monthly", before, after, delta: after - before,
          ...(cw && { recommendation: recommendationShift(c, parsed.before, parsed.after, cw.overdraft, cw.overdraft, cw.nearTieMargin) }),
        };
      });
    case "overdraft":
      return parsed.cases.map((c) => {
        const before = quoteOverdraft(c, parsed.before).monthly;
        const after = quoteOverdraft(c, parsed.after).monthly;
        const cw = parsed.compareWith;
        return {
          case: c, metric: "monthly", before, after, delta: after - before,
          ...(cw && { recommendation: recommendationShift(c, cw.loan, cw.loan, parsed.before, parsed.after, cw.nearTieMargin) }),
        };
      });
    case "deposit":
      return parsed.cases.map((c) => {
        const before = depositInterest(c.amount, c.months, parsed.before.annualRate);
        const after = depositInterest(c.amount, c.months, parsed.after.annualRate);
        return { case: c, metric: "interest", before, after, delta: after - before };
      });
  }
}

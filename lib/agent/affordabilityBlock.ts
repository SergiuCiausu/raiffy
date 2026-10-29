import { z } from "zod";

/*
 * The affordability card, built by code from a check_affordability result (lib/agent/calculator.ts), never by the
 * model. It shows the indicative debt-service check: the most a new monthly instalment could be under the dated
 * limit, the instalment with no interest, and what the check can't see. Numbers only; the chat formats them.
 */

export const affordabilityBlockSchema = z.object({
  type: z.literal("affordability"),
  indicativeOnly: z.literal(true),
  inputs: z.object({
    netMonthlyIncome: z.number(), loanAmount: z.number(), termMonths: z.number().int(), existingMonthlyInstalments: z.number(),
    currency: z.string(), age: z.number().optional(),
  }),
  limit: z.object({ maxDebtSharePercent: z.number(), maxConsumerTermMonths: z.number().nullable().optional(), source: z.string(), validFrom: z.string(), reviewStatus: z.string() }),
  results: z.object({
    maxNewMonthlyInstalment: z.number(),
    instalmentWithNoInterest: z.number(),
    fitsEvenWithNoInterest: z.boolean(),
    fitsAtAnyAnnualRateUpToPercent: z.number().nullable(),
    termWithinConsumerLimit: z.boolean(),
    ageAtEndOfLoan: z.number().optional(),
  }),
  notChecked: z.array(z.string()),
});
export type AffordabilityBlock = z.infer<typeof affordabilityBlockSchema>;

/** The card for the last successful check this turn; null when the result doesn't read as one. */
export function affordabilityBlock(content: string): AffordabilityBlock | null {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return null; }
  if ((raw as { calculation?: unknown })?.calculation !== "loan_affordability") return null;
  const parsed = affordabilityBlockSchema.safeParse({ ...(raw as object), type: "affordability" });
  return parsed.success ? parsed.data : null;
}

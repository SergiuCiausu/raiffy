import { z } from "zod";
import { annuityPayment } from "./loan";

/**
 * Indicative affordability for a fixed-rate consumer loan: how much of the customer's income the debt-service
 * limit leaves for instalments, and up to which annual rate the requested loan still fits under it. It needs no
 * product rate, so it can answer before a reviewed catalog exists. Limits come in with their source and review
 * status; nothing here is a hardcoded fact. Results are unrounded numbers; formatting happens in the caller.
 */

export const affordabilityInputSchema = z.object({
  netMonthlyIncome: z.number().positive(),
  loanAmount: z.number().positive(),
  termMonths: z.number().int().positive().max(480),
  existingMonthlyInstalments: z.number().nonnegative().default(0),
  currency: z.enum(["RON", "FX"]).default("RON"),
  age: z.number().int().min(18).max(100).optional(),
});
export type AffordabilityInput = z.input<typeof affordabilityInputSchema>;

/** Regulatory limits as reviewed parameters (BNR debt-service rule), each with its source. */
export const affordabilityLimitsSchema = z.object({
  maxDebtShareRon: z.number().gt(0).lt(1),
  maxDebtShareFx: z.number().gt(0).lt(1),
  maxConsumerTermMonths: z.number().int().positive(),
  source: z.object({ label: z.string().min(1), url: z.url(), validFrom: z.iso.date(), status: z.enum(["pending_review", "approved"]) }),
});
export type AffordabilityLimits = z.infer<typeof affordabilityLimitsSchema>;

export const affordabilityResultSchema = z.object({
  maxDebtShare: z.number(),
  /** Income share left for the new loan's instalment after existing instalments. */
  maxNewInstalment: z.number(),
  /** The instalment with no interest at all: the floor of any real offer. */
  zeroRateInstalment: z.number(),
  fitsAtZeroRate: z.boolean(),
  /** Highest annual rate (0.358 = 35.8%) at which the instalment still fits; null if it never fits. Capped at 1. */
  maxFittingAnnualRate: z.number().nullable(),
  termWithinConsumerLimit: z.boolean(),
  ageAtEnd: z.number().nullable(),
});
export type AffordabilityResult = z.infer<typeof affordabilityResultSchema>;

export function checkAffordability(rawInput: AffordabilityInput, rawLimits: AffordabilityLimits): AffordabilityResult {
  const input = affordabilityInputSchema.parse(rawInput);
  const limits = affordabilityLimitsSchema.parse(rawLimits);
  const maxDebtShare = input.currency === "RON" ? limits.maxDebtShareRon : limits.maxDebtShareFx;
  const maxNewInstalment = Math.max(0, input.netMonthlyIncome * maxDebtShare - input.existingMonthlyInstalments);
  const payment = (rate: number) => annuityPayment(input.loanAmount, input.termMonths, rate);
  const zeroRateInstalment = payment(0);
  const fitsAtZeroRate = zeroRateInstalment <= maxNewInstalment;

  let maxFittingAnnualRate: number | null = null;
  if (fitsAtZeroRate) {
    // The instalment grows with the rate, so bisection finds where it meets the limit.
    let [low, high] = [0, 1];
    if (payment(high) <= maxNewInstalment) low = high;
    else for (let i = 0; i < 60; i++) { const mid = (low + high) / 2; if (payment(mid) <= maxNewInstalment) low = mid; else high = mid; }
    maxFittingAnnualRate = low;
  }

  return affordabilityResultSchema.parse({
    maxDebtShare, maxNewInstalment, zeroRateInstalment, fitsAtZeroRate, maxFittingAnnualRate,
    termWithinConsumerLimit: input.termMonths <= limits.maxConsumerTermMonths,
    ageAtEnd: input.age === undefined ? null : input.age + input.termMonths / 12,
  });
}

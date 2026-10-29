import { z } from "zod";
import { provenanceSchema } from "../rag/provenance";
import { bankSchema, trackSchema } from "../rag/schemas";

/*
 * The structured product catalog (raiffy-spec/docs/plans/retrieval.md → Term record). Product numbers come from
 * here, never from the vector store. Money is integer minor units (bani), rates are integer basis points.
 */

export const TERM_KINDS = ["interest_rate", "dae", "fee", "limit", "term", "eligibility", "document", "benefit"] as const;
export const termKindSchema = z.enum(TERM_KINDS);
export type TermKind = z.infer<typeof termKindSchema>;

export const TERM_UNITS = ["bps", "minor_ron", "minor_eur", "months", "years", "days", "none"] as const;
export const termUnitSchema = z.enum(TERM_UNITS);
export type TermUnit = z.infer<typeof termUnitSchema>;

/** How often a fee is charged. Absent for values that aren't charges. */
export const termFrequencySchema = z.enum(["once", "monthly", "yearly"]);
export type TermFrequency = z.infer<typeof termFrequencySchema>;

export const termValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact"), amount: z.number().int() }),
  z.object({ type: z.literal("range"), min: z.number().int(), max: z.number().int() }),
  /** "de la 5,05%": a starting value, never shown as the customer's rate. */
  z.object({ type: z.literal("from"), min: z.number().int() }),
  /** "până la 60 de luni": a ceiling, never shown as what the customer gets. */
  z.object({ type: z.literal("up_to"), max: z.number().int() }),
  /** Conditions that aren't a single number. */
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
  /** Stated as missing on the source page. Missing is never zero. */
  z.object({ type: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type TermValue = z.infer<typeof termValueSchema>;

export const rateTypeSchema = z.enum(["fixed", "variable", "campaign", "promo"]);

/** Two values are compared only when every key here matches. */
export const comparabilitySchema = z.object({
  category: z.string().min(1),
  termMonths: z.number().int().positive().optional(),
  currency: z.enum(["RON", "EUR"]).optional(),
  insuranceIncluded: z.boolean().optional(),
  rateType: rateTypeSchema.optional(),
});
export type Comparability = z.infer<typeof comparabilitySchema>;

export const termRecordSchema = z.object({
  termId: z.string().min(1),
  productId: z.string().min(1),
  /** Customer-facing product name, as the source page names it. */
  product: z.string().min(1),
  bank: bankSchema,
  track: trackSchema,
  kind: termKindSchema,
  label: z.string().min(1),
  value: termValueSchema,
  unit: termUnitSchema,
  frequency: termFrequencySchema.optional(),
  conditions: z.array(z.string().min(1)),
  comparability: comparabilitySchema,
  /** Exact text from the source chunk, or empty when it wasn't found there. */
  quote: z.string(),
  provenance: provenanceSchema,
  verification: z.object({
    quoteFound: z.boolean(),
    reviewedBy: z.string().min(1).optional(),
    reviewedAt: z.iso.datetime({ offset: true }).optional(),
  }),
});
export type TermRecord = z.infer<typeof termRecordSchema>;

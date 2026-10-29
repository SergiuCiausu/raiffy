import { z } from "zod";

/*
 * Relationship pricing and counter-offers (raiffy-spec/docs/shared/pricing.md), in integer bani and basis points.
 * In the POC every rule, band, competitor offer and client profile is synthetic sample data (convex/seed/pricing.ts),
 * labelled as such; the pricing team's real rules replace them through the console later. Prices stay indicative
 * until the bank's systems issue an offer.
 */

export const RISK_BANDS = ["A", "B", "C", "D"] as const;
export const riskBandSchema = z.enum(RISK_BANDS);

const governance = { version: z.string(), validFrom: z.iso.date(), owner: z.string(), reviewBy: z.iso.date(), synthetic: z.literal(true) };

export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("salaryDomiciled") }),
  z.object({ kind: z.literal("depositsAtLeast"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("holdsProduct"), productId: z.string() }),
  z.object({ kind: z.literal("riskBand"), in: z.array(riskBandSchema).min(1) }),
  z.object({ kind: z.literal("amountAtLeast"), amount: z.number().int().positive() }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export const pricingRuleSchema = z.object({
  productId: z.string(),
  product: z.string(),
  productType: z.enum(["personal_loan", "mortgage"]),
  baseRateBps: z.number().int().min(0),
  /** The product's own fees: one upfront (analysis or origination) and one per instalment. */
  fees: z.object({ upfront: z.number().int().min(0), upfrontLabel: z.string(), monthly: z.number().int().min(0) }),
  adjustments: z.array(z.object({
    id: z.string(),
    label: z.string(),
    condition: conditionSchema,
    /** Negative for a discount. */
    deltaBps: z.number().int(),
    /** What the client must take or keep to get it; its cost always goes into the line's total and DAE. */
    requires: z.array(z.object({ productId: z.string(), label: z.string(), monthlyCost: z.number().int().min(0) })).default([]),
  })),
  /** Indicative affordability cap: payments on all debts over net income. */
  maxDebtRatioBps: z.number().int().positive(),
  sourceLabel: z.string(),
  ...governance,
});
export type PricingRule = z.infer<typeof pricingRuleSchema>;

export const leverSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feeWaiver"), fee: z.literal("upfront") }),
  z.object({ kind: z.literal("marginCut"), maxDeltaBps: z.number().int().positive() }),
]);
export type Lever = z.infer<typeof leverSchema>;

export const APPROVAL_LEVELS = ["specialist", "branchManager", "pricingCommittee"] as const;
export const approvalLevelSchema = z.enum(APPROVAL_LEVELS);
export type ApprovalLevel = z.infer<typeof approvalLevelSchema>;

/** Internal: what Raiffy may offer on its own, and who decides beyond it. Never shown to the customer or the model. */
export const counterOfferBandSchema = z.object({
  id: z.string(),
  productId: z.string(),
  segment: z.object({
    riskBand: z.array(riskBandSchema).optional(),
    salaryDomiciled: z.boolean().optional(),
    amountRange: z.tuple([z.number().int().min(0), z.number().int().positive()]).optional(),
  }),
  levers: z.array(leverSchema).min(1),
  escalation: z.array(z.object({ level: approvalLevelSchema, upToDeltaBps: z.number().int().positive().optional() })).min(1),
  validityDays: z.number().int().positive().default(7),
  ...governance,
});
export type CounterOfferBand = z.infer<typeof counterOfferBandSchema>;

/** What pricing reads, built only from what "What Raiffy can see" allows. `unknown` lists what was switched off. */
export const clientProfileSchema = z.object({
  salaryDomiciled: z.boolean(),
  monthlyIncome: z.number().int().min(0).optional(),
  deposits: z.number().int().min(0),
  products: z.array(z.string()),
  riskBand: riskBandSchema.optional(),
  obligations: z.number().int().min(0),
  unknown: z.array(z.enum(["account", "savings"])),
});
export type ClientProfile = z.infer<typeof clientProfileSchema>;

export const personalOfferSchema = z.object({
  id: z.string(),
  productId: z.string(),
  rateBps: z.number().int().min(0),
  upfrontFee: z.number().int().min(0),
  monthlyFee: z.number().int().min(0),
  amount: z.number().int().positive(),
  months: z.number().int().positive(),
  origin: z.enum(["band", "specialist"]),
  issuedBy: z.object({ name: z.string(), role: z.string() }).optional(),
  conditions: z.array(z.string()),
  validUntil: z.iso.date(),
});
export type PersonalOffer = z.infer<typeof personalOfferSchema>;

export const competitorOfferSchema = z.object({
  id: z.string(),
  bank: z.string(),
  product: z.string(),
  productType: z.enum(["personal_loan", "mortgage"]),
  amount: z.number().int().positive(),
  months: z.number().int().positive(),
  rateBps: z.number().int().min(0),
  upfrontFee: z.number().int().min(0),
  monthlyFee: z.number().int().min(0),
  /** Mandatory insurance or package, per month. */
  requiredMonthly: z.number().int().min(0).default(0),
  /** official_store: a document in the store (sample in the preview). client_claim: typed by the customer, never enough for a counter-offer. */
  source: z.enum(["official_store", "client_secci", "client_claim"]),
  sourceLabel: z.string(),
  verifiedAt: z.iso.date(),
  synthetic: z.boolean(),
});
export type CompetitorOffer = z.infer<typeof competitorOfferSchema>;

/** One priced line: the cost of every condition and required product is inside its monthly, total and DAE. */
export const priceLineSchema = z.object({
  id: z.string(),
  label: z.string(),
  rateBps: z.number().int(),
  upfrontFee: z.number().int(),
  monthlyFee: z.number().int(),
  monthly: z.number().int(),
  totalPayable: z.number().int(),
  daeBps: z.number().int(),
  /** Adjustment IDs this line depends on. */
  conditions: z.array(z.string()),
  /** The client already meets every condition of this line. */
  qualifies: z.boolean(),
  requiredProducts: z.array(z.object({ label: z.string(), monthlyCost: z.number().int() })),
});
export type PriceLine = z.infer<typeof priceLineSchema>;

export const quoteSchema = z.object({
  productId: z.string(),
  product: z.string(),
  amount: z.number().int(),
  months: z.number().int(),
  /** Without any condition: always shown next to a conditional price, with equal weight. */
  unconditional: priceLineSchema,
  /** One line per condition the client could meet, cheapest first. */
  conditional: z.array(priceLineSchema),
  /** The price this client would actually get today: a valid personal offer, else the conditions they meet. */
  current: priceLineSchema,
  personalOffer: personalOfferSchema.optional(),
  /** A personal offer that has run out: the quote fell back to list pricing. */
  expiredOffer: personalOfferSchema.optional(),
  /** Switched off in "What Raiffy can see": the price could be better than shown. */
  couldBeBetter: z.boolean(),
  ruleVersion: z.string(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const NEGOTIATION_RESOLUTIONS = ["not_needed", "band", "escalate", "evidence_needed", "affordability"] as const;

export const leverAppliedSchema = z.object({ kind: z.enum(["feeWaiver", "marginCut"]), label: z.string(), deltaBps: z.number().int().optional(), amount: z.number().int().optional() });

export const negotiationSchema = z.object({
  resolution: z.enum(NEGOTIATION_RESOLUTIONS),
  quote: quoteSchema,
  competitor: competitorOfferSchema.extend({ totalPayable: z.number().int(), monthly: z.number().int(), daeBps: z.number().int() }),
  /** Ours minus theirs, in total payable, before any counter-offer. Negative: ours is cheaper. */
  gap: z.number().int(),
  /** An automatic counter-offer inside the band. */
  offer: z.object({
    levers: z.array(leverAppliedSchema).min(1),
    line: priceLineSchema,
    validUntil: z.iso.date(),
  }).optional(),
  /** Internal, for the log and the review case only: never given to the model or shown to the customer. */
  internal: z.object({
    bandId: z.string().nullable(),
    level: approvalLevelSchema.nullable(),
    neededCutBps: z.number().int().nullable(),
    segment: z.string(),
  }),
});
export type Negotiation = z.infer<typeof negotiationSchema>;

/**
 * The price card, built by code from a pricing result the answer cited (never filled by the model). No band
 * details. `logId` lets the chat ask for a review or record the (simulated) outcome.
 */
export const offerBlockSchema = z.object({
  type: z.literal("offer"),
  synthetic: z.literal(true),
  sourceUrl: z.string(),
  competitorUrl: z.string().optional(),
  logId: z.string().optional(),
  resolution: z.enum([...NEGOTIATION_RESOLUTIONS, "quote"]),
  quote: quoteSchema,
  competitor: z.object({
    bank: z.string(), sourceLabel: z.string(), source: z.enum(["official_store", "client_secci", "client_claim"]),
    rateBps: z.number().int(), upfrontFee: z.number().int(), monthly: z.number().int(), totalPayable: z.number().int(), daeBps: z.number().int(),
  }).optional(),
  offer: z.object({ levers: z.array(leverAppliedSchema), line: priceLineSchema, validUntil: z.iso.date() }).optional(),
});
export type OfferBlock = z.infer<typeof offerBlockSchema>;

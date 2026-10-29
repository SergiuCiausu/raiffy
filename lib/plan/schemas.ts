import { z } from "zod";
import { TERM_GAP_REASONS } from "../catalog/terms";
import { trackSchema } from "../rag/schemas";
import { scheduleRowSchema } from "../calc/schedule";

/*
 * PlanSummary (raiffy-spec/docs/shared/plan-summary-handoff.md): an indicative simulation laid out like the bank's
 * standard information form. Money is integer bani and rates are integer basis points. Text the UI shows comes as
 * keys with values, formatted with Intl on screen; the only free text is the customer's own goal.
 * The prototypes (chat.html, plan.html) render this shape with mock data.
 */

/** The commission lines every plan for a product lists, in order. A line is a key the UI translates. */
export const COMMISSION_KEYS = ["origination_fee", "administration_fee", "account_package", "insurance", "early_repayment_fee"] as const;
export const commissionKeySchema = z.enum(COMMISSION_KEYS);
export type CommissionKey = z.infer<typeof commissionKeySchema>;

/**
 * charged: counted in the total. none: a reviewed catalog value of zero. if_used: charged only when the customer
 * does something (repays early). missing: not confirmed by the catalog, shown as "Not confirmed", never as zero.
 */
export const commissionBasisSchema = z.enum(["charged", "none", "if_used", "missing"]);

export const commissionSchema = z.object({
  key: commissionKeySchema,
  /** The catalog record the line comes from. Absent only when the basis is "missing". */
  termId: z.string().min(1).optional(),
  /** Bani, for charged and none. Null when it depends on use or isn't confirmed. */
  amount: z.number().int().min(0).nullable(),
  basis: commissionBasisSchema,
  frequency: z.enum(["once", "monthly"]).optional(),
  /** What the value depends on, as the catalog states it. */
  conditions: z.array(z.string()),
});
export type Commission = z.infer<typeof commissionSchema>;

export const planSourceSchema = z.object({
  termId: z.string().min(1),
  url: z.url(),
  collectedAt: z.string().min(1),
  /** Absent for a figure cited from a page in the chat (figuresFrom "cited_page"): nobody has reviewed it. */
  reviewBy: z.iso.date().optional(),
  reviewedAt: z.string().min(1).optional(),
});
export type PlanSource = z.infer<typeof planSourceSchema>;

export const planRouteSchema = z.object({
  key: z.string().min(1),
  productId: z.string().min(1),
  termMonths: z.number().int().positive(),
  /** Bani a month with monthly fees; null when the route doesn't fit. */
  monthly: z.number().int().nullable(),
  /** Interest plus every fee, in bani; null when the route doesn't fit. */
  cost: z.number().int().nullable(),
  fits: z.boolean(),
  chosen: z.boolean(),
  recommended: z.boolean(),
  /** Why it doesn't fit, or how it differs: keys the UI translates. */
  note: z.string().min(1).optional(),
});
export type PlanRoute = z.infer<typeof planRouteSchema>;

export const ASSUMPTION_KEYS = ["first_payment_date", "fixed_rate_whole_term", "rate_within_range", "rate_assumed_constant", "repaid_on_schedule", "monthly_interest_rounding", "optional_insurance_excluded"] as const;
export const MISSING_KEYS = ["affordability_not_checked", "credit_assessment", "conditional_fee_unconfirmed", "cited_fee_not_counted", "not_in_reviewed_catalog"] as const;

export const planNoteSchema = z.object({
  key: z.enum([...ASSUMPTION_KEYS, ...MISSING_KEYS]),
  /** The values a note needs: a date, a rate in bps, the commission it is about. */
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type PlanNote = z.infer<typeof planNoteSchema>;

export const VERIFICATION_LEVELS = ["none", "pending_review", "confirmed", "edited", "returned"] as const;
export const planVerificationSchema = z.object({
  level: z.enum(VERIFICATION_LEVELS),
  /** A check given to an earlier version: the plan changed after it. */
  changed: z.boolean().optional(),
  forVersion: z.number().int().positive().optional(),
  reviewer: z.object({ id: z.string().min(1), name: z.string().min(1), role: z.string().min(1) }).optional(),
  reviewedAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().optional(),
  requestId: z.string().min(1).optional(),
});
export type PlanVerification = z.infer<typeof planVerificationSchema>;

export const planSummarySchema = z.object({
  id: z.string().regex(/^PS-\d{3,8}$/),
  /** Plans are never edited in place: each change is a new version. */
  version: z.number().int().positive(),
  conversationId: z.string().min(1),
  track: trackSchema,
  label: z.literal("indicative"),
  /**
   * catalog: every figure from the reviewed catalog. cited_page: the demo fallback, from the rate and fees the chat's
   * simulation cited from a public page that turn (lib/plan/cited.ts), labelled as such and never reviewed.
   */
  figuresFrom: z.enum(["catalog", "cited_page"]).default("catalog"),
  createdAt: z.iso.datetime({ offset: true }),
  goal: z.object({
    /** The customer's own words. */
    summary: z.string().min(1).max(200),
    productId: z.string().min(1),
    product: z.string().min(1),
    amount: z.number().int().positive(),
    termMonths: z.number().int().positive(),
  }),
  terms: z.object({
    annualRateBps: z.number().int().min(0).max(10_000),
    /** assumed_constant: the cited page didn't say the rate is fixed, so the plan assumes it stays the same. */
    rateType: z.enum(["fixed", "assumed_constant"]),
    rateTermId: z.string().min(1),
    /**
     * When the bank publishes only a range ("5,55% – 17,95%") and sets each customer's rate within it. The plan is
     * then figured at the highest rate, so it never understates the cost, and `figures.atLowest` gives the other end.
     */
    rateRange: z.object({ minBps: z.number().int().min(0).max(10_000), maxBps: z.number().int().min(0).max(10_000) }).optional(),
    upfrontFee: z.number().int().min(0),
    monthlyFee: z.number().int().min(0),
    firstPaymentDate: z.iso.date(),
  }),
  figures: z.object({
    /** What the customer pays each month, monthly fees included. */
    monthly: z.number().int(),
    instalment: z.number().int(),
    interest: z.number().int(),
    fees: z.number().int(),
    /** Principal, interest and every fee. */
    total: z.number().int(),
    /** As a fraction. Costs not in the catalog (optional insurance) are not counted. */
    dae: z.number().min(0),
    commissions: z.array(commissionSchema).min(1),
    /** The same loan at the lowest rate of terms.rateRange. */
    atLowest: z.object({ annualRateBps: z.number().int().min(0).max(10_000), monthly: z.number().int(), interest: z.number().int(), total: z.number().int(), dae: z.number().min(0) }).optional(),
  }),
  routes: z.array(planRouteSchema).min(1),
  affordability: z.object({
    income: z.number().int().positive(),
    obligations: z.number().int().min(0),
    /** (monthly + obligations) / income, in basis points. */
    debtShareBps: z.number().int().min(0),
    /** income − obligations − monthly, in bani; can be negative. */
    leftEachMonth: z.number().int(),
  }).nullable(),
  repaymentSchedule: z.array(scheduleRowSchema).min(1),
  assumptions: z.array(planNoteSchema),
  missing: z.array(planNoteSchema),
  /** Every catalog value the plan used, so a later catalog change can be detected per version. */
  sources: z.array(planSourceSchema).min(1),
  verification: planVerificationSchema,
  handoff: z.object({
    target: z.enum(["smart_mobile", "business_lead"]),
    productId: z.string().min(1),
    amount: z.number().int().positive(),
    termMonths: z.number().int().positive(),
  }),
});
export type PlanSummary = z.infer<typeof planSummarySchema>;

/** Why a plan can't be built. The catalog reasons come from get_product_terms; the rest are plan-specific. */
export const PLAN_GAP_REASONS = [
  ...TERM_GAP_REASONS,
  "not_found",
  "wrong_product",
  "wrong_kind",
  "wrong_unit",
  "floor_value",
  "ceiling_value",
  "range_value",
  "not_a_number",
  "not_fixed_rate",
  "frequency_mismatch",
  "missing_charge",
  "amount_below_limit",
  "amount_above_limit",
  "term_below_limit",
  "term_above_limit",
  "unknown_route",
] as const;
export const planGapSchema = z.object({
  /** Which part of the plan needed the value. */
  role: z.enum(["rate", "commission", "amount_limit", "term_limit", "recommendation"]),
  commission: commissionKeySchema.optional(),
  termId: z.string().optional(),
  reason: z.enum(PLAN_GAP_REASONS),
});
export type PlanGap = z.infer<typeof planGapSchema>;

export const buildPlanResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), plan: planSummarySchema }),
  z.object({ status: z.literal("unavailable"), gaps: z.array(planGapSchema).min(1) }),
]);
export type BuildPlanResult = z.infer<typeof buildPlanResultSchema>;

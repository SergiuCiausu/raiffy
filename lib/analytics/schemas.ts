import { z } from "zod";

/**
 * Chat analytics records (docs/shared/console.md → Analytics). Pseudonymous by design: a conversation
 * key and a customer key, never a name, CNP, IBAN or balance. The console only ever sees aggregates.
 */

/** The account data Raiffy can read, one key per row of the account-data table. */
export const DATA_SOURCES = [
  "loans", // existing Raiffeisen loans and credit cards
  "limits", // overdraft and card limits, and the amount used
  "productsHeld", // current account, package, cards, insurance attached to loans
  "preApproved", // bank-issued pre-approved offers
  "deposits", // deposits and savings
  "feesCharged", // the fee line, amount, date and product
  "ageResidency",
  "idStatus", // identity verification status
  "contractEvents", // applied, signed, withdrawn, repaid
  "transactions", // income and spending from account statements
] as const;
export const dataSourceSchema = z.enum(DATA_SOURCES);
export type DataSource = z.infer<typeof dataSourceSchema>;

export const INTENTS = ["newLoan", "refinancing", "earlyRepayment", "cashNeed", "savings", "feeQuestion", "eligibility", "other"] as const;
export const intentSchema = z.enum(INTENTS);

export const trackSchema = z.enum(["personal", "business"]);
export const entrySchema = z.enum(["web", "smartMobile"]);

const base = {
  at: z.iso.datetime({ offset: true }),
  conversationKey: z.string().min(1),
  customerKey: z.string().min(1),
  track: trackSchema,
  entry: entrySchema,
};

/** One assistant answer, written by the pipeline after delivery. */
export const answerTraceSchema = z.object({
  ...base,
  intent: intentSchema,
  dataUsed: z.array(dataSourceSchema),
  evaluatorLoops: z.number().int().min(0).max(2),
  fallback: z.boolean(),
  escalated: z.boolean(),
  staleBlocked: z.boolean(),
});
export type AnswerTrace = z.infer<typeof answerTraceSchema>;

/** Things that happen around answers: checks run, reminders, offers, applications, contracts. */
export const outcomeEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("affordabilityCheck"), askedCustomer: z.boolean(), limitsChangedResult: z.boolean() }),
  z.object({ ...base, kind: z.literal("reminder"), reminder: z.enum(["fixedRateEnding", "depositMaturity"]), stage: z.enum(["sent", "opened", "acted"]) }),
  z.object({ ...base, kind: z.literal("qualifyShown") }),
  z.object({ ...base, kind: z.literal("hiddenCostCaught") }),
  z.object({ ...base, kind: z.literal("feeExplained"), feeLine: z.string(), productId: z.string(), resolved: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal("offer"),
    productId: z.string(),
    stage: z.enum(["shown", "opened", "applied", "expired"]),
    /** Pre-approved offers are issued by the bank; anything else is a defect. */
    source: z.enum(["bank", "computed"]),
    /** List rate minus offer rate, in percentage points. */
    rateGapPts: z.number(),
  }),
  z.object({ ...base, kind: z.literal("depositGoal"), stage: z.enum(["created", "progressShown"]) }),
  z.object({ ...base, kind: z.literal("eligibilityLimit"), reason: z.enum(["maxAgeAtEnd", "residency"]), productId: z.string() }),
  z.object({
    ...base,
    kind: z.literal("application"),
    productId: z.string(),
    channel: z.enum(["digital", "branch"]),
    branchReason: z.enum(["idNotVerified", "documents", "customerChoice"]).optional(),
  }),
  z.object({ ...base, kind: z.literal("contract"), productId: z.string(), status: z.enum(["applied", "signed", "withdrawn", "repaid"]) }),
  z.object({ ...base, kind: z.literal("raiffeisenOnlyDefault") }),
  /** One entry of the money-saved ledger: lei saved against the customer's previous or alternative option. */
  z.object({ ...base, kind: z.literal("moneySaved"), lei: z.number().min(0) }),
]);
export type OutcomeEvent = z.infer<typeof outcomeEventSchema>;

/** The smallest group of distinct customers any analytics count may show (the `analytics-min` parameter). */
export const ANALYTICS_MIN_GROUP = 10;

export const analyticsFilterSchema = z.object({
  from: z.iso.date(),
  /** Inclusive. */
  to: z.iso.date(),
  track: trackSchema.optional(),
  entry: entrySchema.optional(),
  /** Counts below this are suppressed (k-anonymity). Passed in from the parameters, not hardcoded. */
  minCount: z.number().int().min(1),
});
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;

/** A suppressed count is null. Rates are null when their denominator is suppressed. */
const count = z.number().int().nullable();
const rate = z.number().min(0).max(1).nullable();
const reminderFunnel = z.object({ sent: count, opened: count, acted: count });

export const analyticsSummarySchema = z.object({
  kpis: z.object({
    conversations: count,
    answers: count,
    accountDataShare: rate,
    offerTakeUp: rate,
    digitalShare: rate,
    moneySavedLei: z.number().nullable(),
  }),
  daily: z.array(z.object({ date: z.iso.date(), answers: z.number().int(), conversations: z.number().int() })),
  dataUsage: z.array(z.object({ source: dataSourceSchema, answers: count, share: rate })),
  affordability: z.object({
    checks: count, withoutAsking: count, limitsChanged: count,
    refinancing: count, earlyRepayment: count, cashNeed: count,
    fixedRateReminder: reminderFunnel,
  }),
  pricing: z.object({ qualifyShown: count, hiddenCostCaught: count, feeExplanations: count }),
  offers: z.object({
    funnel: z.object({ shown: count, opened: count, applied: count }),
    expired: count,
    avgRateGapPts: z.number().nullable(),
    bankSourcedShare: rate,
    byProduct: z.array(z.object({ productId: z.string(), shown: count, applied: count })),
  }),
  savings: z.object({ goalsCreated: count, progressShown: count, maturityReminder: reminderFunnel }),
  fees: z.object({ questions: count, resolvedShare: rate, top: z.array(z.object({ feeLine: z.string(), productId: z.string(), count })) }),
  eligibility: z.object({ maxAgeAtEnd: count, residency: count, byProduct: z.array(z.object({ productId: z.string(), count })) }),
  channel: z.object({
    digital: count, branch: count,
    branchReasons: z.array(z.object({ reason: z.enum(["idNotVerified", "documents", "customerChoice"]), count })),
  }),
  contracts: z.object({
    funnel: z.object({ applied: count, signed: count, withdrawn: count, repaid: count }),
    raiffeisenOnlyDefaults: count,
    moneySaved: z.object({ totalLei: z.number().nullable(), medianLei: z.number().nullable(), customers: count }),
  }),
  quality: z.object({ firstPassShare: rate, fallbacks: count, escalations: count, staleBlocks: count }),
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

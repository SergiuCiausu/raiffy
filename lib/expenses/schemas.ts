import { z } from "zod";
import { holdingsSchema, SWITCHES } from "../bank/schemas";

/*
 * Account data for get_expense_summary (contract: lib/agent/prompt.ts). In the POC every account is a synthetic
 * sample persona (convex/seed/demoPersonas.ts), clearly labelled as sample data; real read-only account data
 * connects later through an authenticated adapter with the same shapes. Money is integer bani; outflows are negative.
 */

export const CATEGORIES = [
  "groceries", "housing", "utilities", "transport", "dining", "shopping", "health", "entertainment", "subscriptions", "travel",
  "cash", "fees", "debt", "savings", "salary", "other_income",
] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

export const transactionSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  amount: z.number().int(),
  kind: z.enum(["card_payment", "atm_withdrawal", "transfer_in", "transfer_out", "standing_order", "loan_payment", "fee", "interest"]),
  category: categorySchema,
  /** A generic description, never a real merchant: "Streaming service", "Supermarket". */
  label: z.string(),
  /** The same subscription or standing order across months. */
  recurringKey: z.string().optional(),
  /** A card payment in another currency: the conversion cost charged on it. */
  fxFee: z.number().int().min(0).optional(),
  /** A cash withdrawal: at a Raiffeisen ATM or another bank's. */
  ownAtm: z.boolean().optional(),
});
export type Transaction = z.infer<typeof transactionSchema>;

/** A synthetic customer: the figures that drive the generated statements. */
export const personaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  summary: z.string(),
  monthlyIncome: z.number().int().min(0),
  balances: z.object({ current: z.number().int(), savings: z.number().int().min(0), deposits: z.number().int().min(0) }),
  overdraft: z.object({ limit: z.number().int().positive(), used: z.number().int().min(0), rateBps: z.number().int().min(0) }).optional(),
  loans: z.array(z.object({ label: z.string(), monthly: z.number().int().positive(),
    /** A loan elsewhere that this Raiffeisen product would refinance: not counted against affordability for it. */
    replacedBy: z.string().optional() })),
  recurring: z.array(z.object({
    key: z.string(), label: z.string(), category: categorySchema, amount: z.number().int().positive(), day: z.number().int().min(1).max(28),
    kind: z.enum(["card_payment", "standing_order"]),
    /** Months ago it started (0 = this month); absent = before the history. */
    startedMonthsAgo: z.number().int().min(0).optional(),
    /** A price change in the month this many months ago. */
    priceChange: z.object({ monthsAgo: z.number().int().min(0), from: z.number().int().positive() }).optional(),
  })),
  /** Card spending per month by category, split into a few payments. */
  monthlySpending: z.partialRecord(categorySchema, z.number().int().min(0)),
  atm: z.object({ ownPerMonth: z.number().int().min(0), otherPerMonth: z.number().int().min(0), amount: z.number().int().positive(), otherFee: z.number().int().min(0) }),
  /** What relationship pricing reads (docs/shared/pricing.md ClientProfile): from the account switch only. */
  relationship: z.object({ salaryDomiciled: z.boolean(), riskBand: z.enum(["A", "B", "C", "D"]).optional(), products: z.array(z.string()) }).optional(),
  /** The loan this sample customer is asking about, for the negotiation demo. */
  request: z.object({ productId: z.string(), amount: z.number().int().positive(), months: z.number().int().positive() }).optional(),
  /** Card payments in euros in some months, with the conversion cost. */
  foreignSpending: z.array(z.object({ monthsAgo: z.number().int().min(0), amount: z.number().int().positive(), fxFeeBps: z.number().int().min(0), payments: z.number().int().positive() })),
  /** The customer's Raiffeisen holdings as Smart Mobile shows them (lib/bank/schemas.ts), for get_holdings. */
  holdings: holdingsSchema.optional(),
});
export type Persona = z.infer<typeof personaSchema>;

/** What the customer lets Raiffy see ("What Raiffy can see"). Everything is off until switched on. */
export const accessSwitchesSchema = z.object(Object.fromEntries(SWITCHES.map((k) => [k, z.boolean()])) as Record<(typeof SWITCHES)[number], z.ZodBoolean>);
export type AccessSwitches = z.infer<typeof accessSwitchesSchema>;

export const expensePeriodSchema = z.enum(["last_complete_month", "last_three_complete_months"]);
export type ExpensePeriod = z.infer<typeof expensePeriodSchema>;

export const INSIGHT_KINDS = ["overdraftCost", "atmFees", "fxCardFees", "idleCash", "subscriptions"] as const;
export const insightSchema = z.object({
  kind: z.enum(INSIGHT_KINDS),
  /** Figures in bani or counts, keyed by name; the text is written from these. */
  figures: z.record(z.string(), z.number()),
  /** Which switches it needed. */
  needs: z.array(z.enum(SWITCHES)),
});
export type Insight = z.infer<typeof insightSchema>;

export const expenseSummarySchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  /** Always true in the POC: the figures come from a sample persona, not a real account. */
  synthetic: z.literal(true),
  persona: z.string(),
  period: z.object({ kind: expensePeriodSchema, from: z.iso.date(), to: z.iso.date(), months: z.number().int().positive() }),
  /** The "account" switch: balance, and the overdraft's limit, use and interest. */
  account: z.object({
    currentBalance: z.number().int(),
    overdraft: z.object({ limit: z.number().int(), used: z.number().int(), interestLastMonth: z.number().int() }).optional(),
  }).optional(),
  /** The "transactions" switch: money in and out, as monthly averages over the period. */
  flows: z.object({ income: z.number().int(), outgoings: z.number().int(), debtPayments: z.number().int(), feesAndInterest: z.number().int() }).optional(),
  savings: z.object({ savings: z.number().int(), deposits: z.number().int() }).optional(),
  /** The "transactions" switch: card and regular spending. */
  spending: z.object({
    /** Monthly average per category, largest first, with the change against the period before. */
    byCategory: z.array(z.object({ category: categorySchema, amount: z.number().int(), previous: z.number().int() })),
    total: z.number().int(),
    subscriptions: z.array(z.object({ label: z.string(), amount: z.number().int(), startedMonthsAgo: z.number().int().optional(), previousAmount: z.number().int().optional() })),
    atmOther: z.object({ count: z.number().int(), fees: z.number().int() }),
    fxFees: z.number().int(),
  }).optional(),
  insights: z.array(insightSchema),
  /** Switched off, so not read: the answer should say these weren't used. */
  notUsed: z.array(z.enum(SWITCHES)),
  reason: z.enum(["no_persona", "all_switches_off"]).optional(),
});
export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;

/**
 * The spending card, built by code from a summary the answer cited (never filled by the model). Figures in bani;
 * the chat formats them. `sourceUrl` matches the summary's source chip.
 */
export const spendingBlockSchema = z.object({
  type: z.literal("spending"),
  synthetic: z.literal(true),
  period: z.object({ from: z.iso.date(), to: z.iso.date(), months: z.number().int().positive() }),
  sourceUrl: z.string(),
  income: z.number().int().optional(),
  outgoings: z.number().int().optional(),
  total: z.number().int().optional(),
  categories: z.array(z.object({ category: categorySchema, amount: z.number().int(), previous: z.number().int() })).max(8),
  insights: z.array(insightSchema),
  notUsed: z.array(z.enum(SWITCHES)),
});
export type SpendingBlock = z.infer<typeof spendingBlockSchema>;

export function spendingBlock(summary: ExpenseSummary, sourceUrl: string): SpendingBlock | null {
  if (summary.status !== "ok" || (!summary.spending && !summary.flows)) return null;
  return spendingBlockSchema.parse({
    type: "spending", synthetic: true, period: { from: summary.period.from, to: summary.period.to, months: summary.period.months }, sourceUrl,
    ...(summary.flows ? { income: summary.flows.income, outgoings: summary.flows.outgoings } : {}),
    ...(summary.spending ? { total: summary.spending.total } : {}),
    categories: (summary.spending?.byCategory ?? []).slice(0, 8),
    insights: summary.insights,
    notUsed: summary.notUsed,
  });
}

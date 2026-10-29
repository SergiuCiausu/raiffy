import { z } from "zod";

/*
 * A customer's Raiffeisen holdings as Smart Mobile shows them (docs/shared/smart-mobile.md): accounts, savings,
 * term deposits, loans, cards and bank-issued pre-approved offers. In the POC every customer is synthetic sample
 * data (convex/seed/demoPersonas.ts), labelled as such everywhere; a real read-only adapter returns the same shapes.
 *
 * Each holding has a stable reference ("loan_casa1"), the way the app passes a reference and never data, and links
 * to the real Raiffeisen product page in the catalog (`products` table) so an answer can cite both. Money is integer
 * bani, rates basis points. Dates are relative to today (days or months), so the sample data never goes stale.
 */

/** "What Raiffy can see": the six switches Smart Mobile shows. Everything is off until switched on. */
export const SWITCHES = ["account", "transactions", "savings", "offers", "loans", "cards"] as const;
export type Switch = (typeof SWITCHES)[number];

const refOf = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]+$`));
const product = {
  /** A Raiffeisen product in the catalog, for its page and published terms. */
  productId: z.string().startsWith("raiffeisen:"),
  /** How Smart Mobile names it, in English: "Casa Ta mortgage". */
  name: z.string().min(1),
};
const bani = z.number().int();
const bps = z.number().int().min(0).max(10_000);

export const currentAccountSchema = z.object({
  ref: refOf("acc"), ...product,
  /** Masked, never a full IBAN. */
  ibanMask: z.string().regex(/^••\d{4}$/),
  balance: bani,
  overdraft: z.object({ limit: bani.positive(), used: bani.min(0), rateBps: bps, renewsInDays: z.number().int().min(0) }).optional(),
  package: z.object({ name: z.string(), monthlyFee: bani.min(0) }).optional(),
});

export const savingsAccountSchema = z.object({ ref: refOf("sav"), ...product, balance: bani.min(0), rateBps: bps });

export const depositSchema = z.object({
  ref: refOf("dep"), ...product,
  amount: bani.positive(),
  currency: z.enum(["RON", "EUR"]),
  rateBps: bps,
  termMonths: z.number().int().positive(),
  maturesInDays: z.number().int().min(0),
  renewal: z.enum(["automatic", "none"]),
});

export const loanSchema = z.object({
  ref: refOf("loan"), ...product,
  kind: z.enum(["mortgage", "personal_loan", "refinancing"]),
  principal: bani.positive(),
  outstanding: bani.positive(),
  monthly: bani.positive(),
  rate: z.object({
    type: z.enum(["fixed", "variable", "fixed_then_variable"]),
    rateBps: bps,
    /** fixed_then_variable: months of the fixed period still to run. */
    fixedMonthsLeft: z.number().int().min(0).optional(),
    /** What the rate becomes after the fixed period, as the contract states it: "IRCC + 2.49 points". */
    afterFixed: z.string().optional(),
  }),
  startedMonthsAgo: z.number().int().min(0),
  termMonths: z.number().int().positive(),
  paymentDay: z.number().int().min(1).max(28),
  /** The early-repayment fee in the contract, as a share of the amount repaid; 0 when there is none. */
  earlyRepaymentFeeBps: bps,
});

export const cardSchema = z.object({
  ref: refOf("card"), ...product,
  type: z.enum(["debit", "credit"]),
  mask: z.string().regex(/^•••• \d{4}$/),
  limit: bani.positive().optional(),
  used: bani.min(0).optional(),
  annualFee: bani.min(0).optional(),
  annualFeeDueInDays: z.number().int().min(0).optional(),
  /** Payments with the card in the last 12 months. */
  usesLastYear: z.number().int().min(0),
});

/** A pre-approved offer the bank issued to this customer (never one Raiffy works out). */
export const preApprovedSchema = z.object({
  ref: refOf("offer"), ...product,
  maxAmount: bani.positive(),
  rateBps: bps,
  fee: bani.min(0),
  minMonths: z.number().int().positive(),
  maxMonths: z.number().int().positive(),
  validForDays: z.number().int().min(0),
});

export const holdingsSchema = z.object({
  currentAccounts: z.array(currentAccountSchema).min(1),
  savingsAccounts: z.array(savingsAccountSchema),
  deposits: z.array(depositSchema),
  loans: z.array(loanSchema),
  cards: z.array(cardSchema),
  offers: z.array(preApprovedSchema),
  /** What eligibility reads: age, residency and whether the customer can sign digitally. */
  profile: z.object({ age: z.number().int().min(18).max(100), residency: z.enum(["RO", "EU", "non_EU"]), idVerified: z.boolean() }),
});
export type Holdings = z.infer<typeof holdingsSchema>;
export type HoldingsInput = z.input<typeof holdingsSchema>;

export const HOLDING_KINDS = ["accounts", "savings", "loans", "cards", "offers", "profile"] as const;
export type HoldingKind = (typeof HOLDING_KINDS)[number];
/** Which switch each kind needs. Savings accounts and deposits are one switch, as in Smart Mobile. */
export const KIND_SWITCH: Record<HoldingKind, Switch> = { accounts: "account", savings: "savings", loans: "loans", cards: "cards", offers: "offers", profile: "account" };

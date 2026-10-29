import { z } from "zod";
import { TERM_GAP_REASONS } from "../catalog/terms";
import { termFrequencySchema, termUnitSchema } from "../catalog/schemas";

/*
 * The comparison table's fixed rows (chat.html's bank comparison card). Every comparison of the same products has
 * the same rows in the same order, whether they come from the reviewed catalog or from the model's cited facts.
 * Values are language-neutral: numbers with units, formatted with Intl in the UI. A cell is a value with its source,
 * "not confirmed" (the catalog has the term but can't vouch for it) or "not in the sources". Missing is never zero.
 */

export const ROW_GROUPS = {
  cost: ["total_cost", "monthly_payment", "dae", "interest_rate"],
  amounts: ["amount", "term"],
  commissions: ["origination_fee", "administration_fee", "early_repayment_fee", "insurance"],
  documents: ["documents_always", "documents_sometimes", "documents_online"],
} as const;
export type RowGroup = keyof typeof ROW_GROUPS;
export const ROW_KEYS = Object.values(ROW_GROUPS).flat() as RowKey[];
export type RowKey = (typeof ROW_GROUPS)[RowGroup][number];
export const rowKeySchema = z.enum(ROW_KEYS as [RowKey, ...RowKey[]]);
export const rowGroupSchema = z.enum(Object.keys(ROW_GROUPS) as [RowGroup, ...RowGroup[]]);

/** A cost question shows cost, amounts and commissions; a documents question shows only the documents (user decision). */
export const FOCUS_GROUPS = { costs: ["cost", "amounts", "commissions"], documents: ["documents"] } as const satisfies Record<string, readonly RowGroup[]>;
export const focusSchema = z.enum(["costs", "documents"]);
export type Focus = z.infer<typeof focusSchema>;

/** The deciding row, in order of preference. Lower wins on each. */
export const DECIDING_ROWS = ["total_cost", "dae", "interest_rate"] as const satisfies readonly RowKey[];

export const NOT_CONFIRMED_REASONS = [...TERM_GAP_REASONS, "rate_not_exact", "fee_not_confirmed"] as const;

export const cellValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact"), amount: z.number().int() }),
  z.object({ type: z.literal("range"), min: z.number().int(), max: z.number().int() }),
  z.object({ type: z.literal("from"), min: z.number().int() }),
  z.object({ type: z.literal("up_to"), max: z.number().int() }),
  /** Conditions that aren't one number, or a model fact as the model wrote it (already English). */
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
]);
export type CellValue = z.infer<typeof cellValueSchema>;

export const cellSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("value"),
    value: cellValueSchema,
    unit: termUnitSchema,
    frequency: termFrequencySchema.optional(),
    /** Where the value comes from: the catalog term's page or the cited search result. Null only for a model fact without a number. */
    source: z.object({ url: z.string().min(1), collectedAt: z.string().optional() }).nullable(),
    termId: z.string().nullable(),
    /** Monthly payment and total cost, calculated here from exact reviewed terms. */
    computed: z.boolean(),
  }),
  z.object({ state: z.literal("not_confirmed"), reason: z.enum(NOT_CONFIRMED_REASONS), termId: z.string().nullable() }),
  z.object({ state: z.literal("not_in_sources") }),
]);
export type Cell = z.infer<typeof cellSchema>;

export const compareProductSchema = z.object({
  productId: z.string().min(1).nullable(),
  name: z.string().min(1),
  provider: z.string().min(1).optional(),
  isRaiffeisen: z.boolean(),
});
export type CompareProduct = z.infer<typeof compareProductSchema>;

export const compareRowSchema = z.object({
  key: rowKeySchema,
  /** One cell per product, in the products' order. */
  cells: z.array(cellSchema),
});
export type CompareRow = z.infer<typeof compareRowSchema>;

export const compareTableSchema = z.object({
  focus: focusSchema,
  products: z.array(compareProductSchema).min(2).max(4),
  groups: z.array(z.object({ key: rowGroupSchema, rows: z.array(compareRowSchema).min(1) })),
  /** The row the comparison is decided on, when one is shown. */
  deciding: rowKeySchema.nullable(),
  /** The product with the lowest value on the deciding row: only when every value there is exact and comparable. */
  best: z.number().int().min(0).nullable(),
  /** Customer amount and term the payment rows were calculated for. */
  scenario: z.object({ amount: z.number().int().positive(), months: z.number().int().positive() }).nullable(),
  /** The customer gave an amount and term, but no product has an exact reviewed rate to calculate a payment from. */
  paymentUnavailable: z.boolean(),
});
export type CompareTable = z.infer<typeof compareTableSchema>;

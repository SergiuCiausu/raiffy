import { z } from "zod";
import type { Citable } from "../rag/answer";
import { allowedValues } from "../rag/numbers";
import { fromFacts, mergeTables } from "./rows";
import { compareTableSchema, focusSchema, type Cell, type CompareTable } from "./schemas";

/*
 * The comparison card as a code-built UI block (like the spending and price cards): the fixed rows of lib/compare,
 * from the reviewed catalog through compare_products and from the model's cited comparison facts. It replaces the
 * model's own comparison card, so every comparison has the same rows. A value shows only with a source the answer
 * cites; anything else reads "Not in the sources".
 */

export const compareBlockSchema = z.object({
  type: z.literal("compare_table"),
  title: z.string().min(1).max(80),
  table: compareTableSchema,
  /** The model's recommendation from its comparison card, checked like every card (lib/agent/blocks.ts). */
  recommendation: z.object({ option: z.string(), reasons: z.array(z.string()).min(1).max(3), whenOther: z.string() }).optional(),
});
export type CompareBlock = z.infer<typeof compareBlockSchema>;

export const compareProductsRequestSchema = z.object({
  /** Catalog product IDs, exactly the products the customer named, in their order. */
  productIds: z.array(z.string().min(1).max(200)).min(2).max(4),
  focus: focusSchema,
  /** The customer's own amount in lei and term in months, only when they gave them. */
  amountLei: z.number().positive().max(10_000_000).optional(),
  months: z.number().int().min(1).max(600).optional(),
}).strict();
export type CompareProductsRequest = z.infer<typeof compareProductsRequestSchema>;

/** The customer's amount and term in bani and months, only when both appear in the customer's own words. */
export function groundedScenario(req: CompareProductsRequest, customerTexts: readonly string[]): { amount: number; months: number } | null {
  if (req.amountLei === undefined || req.months === undefined) return null;
  const stated = allowedValues(customerTexts);
  const said = (n: number) => stated.has(String(n));
  // "5 years" grounds 60 months
  const monthsSaid = said(req.months) || (req.months % 12 === 0 && said(req.months / 12));
  return said(req.amountLei) && monthsSaid ? { amount: Math.round(req.amountLei * 100), months: req.months } : null;
}

const ROW_TEXT: Record<string, string> = {
  total_cost: "Total cost", monthly_payment: "Monthly payment", dae: "DAE in the bank's example", interest_rate: "Interest rate",
  amount: "Amount", term: "Repayment term", origination_fee: "Analysis fee", administration_fee: "Administration fee",
  early_repayment_fee: "Early repayment fee", insurance: "Insurance", documents_always: "Always asked",
  documents_sometimes: "Sometimes asked", documents_online: "Needed to apply online",
};
const num = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const unitText = (n: number, unit: string) =>
  unit === "bps" ? `${num(n / 100)}%` : unit === "minor_ron" ? `${num(n / 100)} lei` : unit === "minor_eur" ? `${num(n / 100)} euro`
  : unit === "months" ? `${n} months` : num(n);

/** One cell in English, as the model may quote it. Uses the same wording as the card. */
export function cellText(cell: Cell): string {
  if (cell.state === "not_confirmed") return "not confirmed";
  if (cell.state === "not_in_sources") return "not in the sources";
  const v = cell.value;
  const none = v.type === "exact" && cell.unit === "minor_ron" && v.amount === 0;
  const s = v.type === "exact" ? (none ? "none" : unitText(v.amount, cell.unit))
    : v.type === "range" ? `${unitText(v.min, cell.unit)} to ${unitText(v.max, cell.unit)}`
    : v.type === "from" ? `from ${unitText(v.min, cell.unit)}` : v.type === "up_to" ? `up to ${unitText(v.max, cell.unit)}` : v.text;
  const freq = cell.frequency && !none ? { once: " once", monthly: " a month", yearly: " a year" }[cell.frequency] : "";
  return `${s}${freq}${cell.computed ? " (calculated for the customer's amount and term)" : ""}`;
}

/** One citable per product, so citing a product covers its column of the card. */
export function compareCitables(table: CompareTable): Citable[] {
  return table.products.flatMap((p, i): Citable[] => {
    const rows = table.groups.flatMap((g) => g.rows.map((r) => ({ key: r.key, cell: r.cells[i]! })));
    const cited = rows.find((r) => r.cell.state === "value" && r.cell.source);
    if (!cited || cited.cell.state !== "value" || !cited.cell.source) return [];
    return [{
      chunkId: `compare:${p.productId ?? p.name}`,
      label: `${p.name} (${p.provider ?? ""}) compared`,
      url: cited.cell.source.url,
      text: [`${p.name}${p.provider ? `, ${p.provider}` : ""}, from the reviewed catalog:`,
        ...rows.map((r) => `${ROW_TEXT[r.key]}: ${cellText(r.cell)}.`),
        ...(table.paymentUnavailable ? ["No monthly payment: the rate is published as a range, so it depends on the bank's assessment."] : [])].join("\n"),
      collectedAt: cited.cell.source.collectedAt ?? new Date(0).toISOString(),
      sectionType: "table", score: 1,
    }];
  });
}

/** A value whose source the answer doesn't cite can't show: it reads "Not in the sources", so no figure appears without one. */
export function keepCited(table: CompareTable, cited: (url: string) => boolean): CompareTable {
  const groups = table.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r,
    cells: r.cells.map((c): Cell => c.state === "value" && c.source && !cited(c.source.url) ? { state: "not_in_sources" } : c) })) }))
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.cells.some((c) => c.state !== "not_in_sources")) })).filter((g) => g.rows.length);
  const lit = table.deciding && groups.some((g) => g.rows.some((r) => r.key === table.deciding && r.cells.every((c) => c.state === "value")));
  return compareTableSchema.parse({ ...table, groups, best: lit ? table.best : null, deciding: lit || !table.deciding ? table.deciding : null });
}

type ComparisonCard = {
  type: "comparison"; title: string;
  options: { name: string; provider?: string; isRaiffeisen: boolean; facts: { label: string; value: string; source?: string }[] }[];
  recommendation?: CompareBlock["recommendation"];
};

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Which of the host table's products an option of the model's card is: by bank, then by name. Null when it doesn't line up. */
function alignOptions(table: CompareTable, card: ComparisonCard): number[] | null {
  const taken = new Set<number>();
  const order = card.options.map((o) => {
    const i = table.products.findIndex((p, k) => !taken.has(k) && (
      (o.isRaiffeisen && p.isRaiffeisen)
      || (!!o.provider && !!p.provider && fold(o.provider) === fold(p.provider))
      || fold(p.name).includes(fold(o.name)) || fold(o.name).includes(fold(p.name))));
    if (i >= 0) taken.add(i);
    return i;
  });
  return order.length === table.products.length && order.every((i) => i >= 0) ? order : null;
}

/**
 * The comparison block for this answer: the host table (compare_products) with the model's cited facts filling its gaps,
 * or the model's facts alone. Model comparison cards it replaces are returned in `replaced`.
 */
export function comparisonBlock(input: {
  host: CompareTable | null; cards: readonly unknown[]; cited: (url: string) => boolean;
}): { block: CompareBlock | null; replaced: number } {
  const card = input.cards.find((c): c is ComparisonCard => !!c && typeof c === "object" && (c as { type?: unknown }).type === "comparison");
  const replaced = input.cards.filter((c) => !!c && typeof c === "object" && (c as { type?: unknown }).type === "comparison").length;
  let table: CompareTable | null = null;
  let title = card?.title;
  if (input.host && input.host.groups.length) {
    table = input.host;
    const order = card ? alignOptions(input.host, card) : null;
    if (card && order && card.options.length) {
      // Reorder the card's options to the host's products, keeping the customer's names for them
      const options = input.host.products.map((_, i) => card.options[order.indexOf(i)]!);
      const facts = fromFacts({ options, focus: input.host.focus });
      table = mergeTables({ ...input.host, products: input.host.products.map((p, i) => ({ ...p, name: options[i]!.name })) }, facts);
    }
  } else if (card) {
    table = fromFacts({ options: card.options });
  }
  if (!table) return { block: null, replaced: 0 };
  table = keepCited(table, input.cited);
  if (!table.groups.length) return { block: null, replaced: 0 };
  title ??= table.products.map((p) => p.name).join(" vs ");
  // The recommendation stays only when it names a product on the card
  const rec = card?.recommendation && table.products.some((p) => p.name === card.recommendation!.option) ? card.recommendation : undefined;
  return { block: compareBlockSchema.parse({ type: "compare_table", title: title.slice(0, 80), table, ...(rec ? { recommendation: rec } : {}) }), replaced };
}

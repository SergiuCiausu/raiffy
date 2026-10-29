import { z } from "zod";
import { repaymentSchedule } from "../calc/schedule";
import { comparable, gapReason } from "../catalog/terms";
import { termRecordSchema, type TermRecord } from "../catalog/schemas";
import {
  compareProductSchema, compareTableSchema, DECIDING_ROWS, FOCUS_GROUPS, focusSchema, ROW_GROUPS,
  type Cell, type CompareProduct, type CompareRow, type CompareTable, type Focus, type RowGroup, type RowKey,
} from "./schemas";

/*
 * Builds the comparison table from the reviewed catalog (fromCatalog) or from the model's cited card facts
 * (fromFacts), and fills one from the other (mergeTables). Pure: records, facts and dates come in as arguments.
 * Monthly payment and total cost are calculated only from an exact, reviewed rate and confirmed fees; a range
 * never becomes a number.
 */

/** Which row a catalog term fills, from its kind and its ID or label. Terms that fill no row return null. */
export function rowForTerm(r: Pick<TermRecord, "kind" | "termId" | "label">): RowKey | null {
  const name = `${r.termId.split("#")[1] ?? ""} ${r.label}`.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  switch (r.kind) {
    case "interest_rate": return "interest_rate";
    case "dae": return "dae";
    case "term": return "term";
    case "limit": return /suma|amount|plafon|valoare/.test(name) ? "amount" : null;
    case "fee":
      if (/analiz|acordare|origination|procesare/.test(name)) return "origination_fee";
      if (/administr/.test(name)) return "administration_fee";
      if (/anticip|early/.test(name)) return "early_repayment_fee";
      if (/asigur|insurance/.test(name)) return "insurance";
      return null;
    case "document":
      if (/online|digital/.test(name)) return "documents_online";
      if (/uneori|optional|conditi|sometimes/.test(name)) return "documents_sometimes";
      return "documents_always";
    default: return null;
  }
}

/** Fact labels, English or Romanian, in the order they are tried. More specific rows come first. */
const LABEL_ROWS: Record<Focus, [RegExp, RowKey][]> = {
  costs: [
    [/total (cost|payable|to repay|amount (payable|to repay))|cost total|total de plata/, "total_cost"],
    [/monthly (payment|instal)|rata lunara|payment a month/, "monthly_payment"],
    [/\b(dae|apr)\b/, "dae"],
    [/early|anticipat|prepay/, "early_repayment_fee"],
    [/insurance|asigur/, "insurance"],
    [/analys|analiz|origination|arrangement|acordare|processing|application fee/, "origination_fee"],
    [/administr|management fee|monthly fee/, "administration_fee"],
    [/interest|\brate\b|dobanda/, "interest_rate"],
    [/amount|suma|\blimit\b|borrow up to|max(imum)? (loan|credit)/, "amount"],
    [/\bterm\b|period|perioada|duration|durata|repayment time/, "term"],
  ],
  documents: [
    [/online|digital|in the app/, "documents_online"],
    [/sometimes|may be|might|uneori|conditional|if /, "documents_sometimes"],
    [/always|required|needed|documents|acte|\bid\b/, "documents_always"],
  ],
};
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Which row a model fact fills under a focus, or null when its label names none of them. */
export function rowForLabel(label: string, focus: Focus): RowKey | null {
  const text = fold(label);
  return LABEL_ROWS[focus].find(([re]) => re.test(text))?.[1] ?? null;
}

/** The focus a set of fact labels points at: documents only when more labels name documents than costs. */
export function focusOfLabels(labels: readonly string[]): Focus {
  const docs = labels.filter((l) => rowForLabel(l, "documents") && !rowForLabel(l, "costs")).length;
  const costs = labels.filter((l) => rowForLabel(l, "costs")).length;
  return docs > costs ? "documents" : "costs";
}

type Grid = Map<RowKey, Cell[]>;
const EMPTY: Cell = { state: "not_in_sources" };

/**
 * Rows in the fixed order for the focus. A row where no product has a value or a confirmation gap is dropped,
 * and so is a group left without rows.
 */
function finish(input: {
  focus: Focus; products: CompareProduct[]; grid: Grid; scenario: CompareTable["scenario"]; paymentUnavailable: boolean;
  comparableOn: (row: RowKey) => boolean;
}): CompareTable {
  const groups: CompareTable["groups"] = [];
  for (const g of FOCUS_GROUPS[input.focus] as readonly RowGroup[]) {
    const rows: CompareRow[] = [];
    for (const key of ROW_GROUPS[g] as readonly RowKey[]) {
      const cells = input.grid.get(key);
      if (cells?.some((c) => c.state !== "not_in_sources")) rows.push({ key, cells });
    }
    if (rows.length) groups.push({ key: g, rows });
  }
  const shown = new Map(groups.flatMap((g) => g.rows.map((r) => [r.key, r.cells] as const)));
  const deciding = DECIDING_ROWS.find((k) => shown.has(k)) ?? null;
  let best: number | null = null;
  if (deciding && input.comparableOn(deciding)) {
    const amounts = shown.get(deciding)!.map((c) => (c.state === "value" && c.value.type === "exact" ? c.value.amount : null));
    if (amounts.every((a) => a !== null)) {
      const min = Math.min(...(amounts as number[]));
      // A tie lights nobody: the yellow light means one option is cheaper
      if (amounts.filter((a) => a === min).length === 1) best = amounts.indexOf(min);
    }
  }
  return compareTableSchema.parse({
    focus: input.focus, products: input.products, groups, deciding, best,
    scenario: input.scenario, paymentUnavailable: input.paymentUnavailable,
  });
}

function catalogCell(r: TermRecord | undefined, now: number): Cell {
  if (!r) return EMPTY;
  const gap = gapReason(r, now);
  if (gap) return { state: "not_confirmed", reason: gap, termId: r.termId };
  if (r.value.type === "unavailable") return { state: "not_confirmed", reason: "stated_missing", termId: r.termId };
  return {
    state: "value", value: r.value, unit: r.unit, ...(r.frequency ? { frequency: r.frequency } : {}),
    source: { url: r.provenance.url, collectedAt: r.provenance.collectedAt }, termId: r.termId, computed: false,
  };
}

/** A fee that is confirmed as an exact lei amount, zero when the catalog says none; null when it isn't confirmed. */
function confirmedFee(cell: Cell, frequency: "once" | "monthly"): number | null {
  if (cell.state !== "value" || cell.value.type !== "exact" || cell.unit !== "minor_ron") return null;
  if (cell.frequency && cell.frequency !== frequency) return null;
  return cell.value.amount;
}

export const fromCatalogInputSchema = z.object({
  products: z.array(compareProductSchema.extend({ productId: z.string().min(1) })).min(2).max(4),
  records: z.array(termRecordSchema),
  now: z.number(),
  focus: focusSchema,
  /** The customer's own amount (bani) and term, for the payment rows. */
  scenario: z.object({ amount: z.number().int().positive(), months: z.number().int().min(1).max(600) }).nullable().default(null),
  /** First instalment date for the payment calculation. Required with a scenario. */
  firstPaymentDate: z.iso.date().optional(),
});
export type FromCatalogInput = z.input<typeof fromCatalogInputSchema>;

/** The table from catalog terms only. Unreviewed, stale, unquoted and stated-missing terms read "Not confirmed". */
export function fromCatalog(raw: FromCatalogInput): CompareTable {
  const input = fromCatalogInputSchema.parse(raw);
  if (input.scenario && !input.firstPaymentDate) throw new Error("first_payment_date_required");
  const grid: Grid = new Map();
  const picked = new Map<string, TermRecord>();
  const put = (key: RowKey, i: number, cell: Cell) => {
    const cells = grid.get(key) ?? input.products.map(() => EMPTY);
    cells[i] = cell;
    grid.set(key, cells);
  };
  input.products.forEach((p, i) => {
    for (const r of input.records) {
      if (r.productId !== p.productId) continue;
      const key = rowForTerm(r);
      if (!key || picked.has(`${key}|${i}`)) continue;
      picked.set(`${key}|${i}`, r);
      put(key, i, catalogCell(r, input.now));
    }
  });

  let paymentUnavailable = false;
  if (input.scenario && input.focus === "costs") {
    const { amount, months } = input.scenario;
    let any = false;
    input.products.forEach((_, i) => {
      const rate = grid.get("interest_rate")?.[i] ?? EMPTY;
      const upfront = confirmedFee(grid.get("origination_fee")?.[i] ?? EMPTY, "once");
      const monthlyFee = confirmedFee(grid.get("administration_fee")?.[i] ?? EMPTY, "monthly");
      const rateRecord = picked.get(`interest_rate|${i}`);
      let gap: Cell | null = null;
      if (rate.state !== "value") gap = rate.state === "not_confirmed" ? rate : { state: "not_confirmed", reason: "not_in_catalog", termId: null };
      else if (rate.value.type !== "exact" || rate.unit !== "bps") gap = { state: "not_confirmed", reason: "rate_not_exact", termId: rate.termId };
      else if (upfront === null || monthlyFee === null) gap = { state: "not_confirmed", reason: "fee_not_confirmed", termId: null };
      if (gap) { put("monthly_payment", i, gap); put("total_cost", i, gap); return; }
      const s = repaymentSchedule({
        principal: amount, months, annualRateBps: (rate as Extract<Cell, { state: "value" }> & { value: { type: "exact" } }).value.amount,
        upfrontFee: upfront!, monthlyFee: monthlyFee!, firstPaymentDate: input.firstPaymentDate!,
      });
      const source = { url: rateRecord!.provenance.url, collectedAt: rateRecord!.provenance.collectedAt };
      put("monthly_payment", i, { state: "value", value: { type: "exact", amount: s.monthly }, unit: "minor_ron", frequency: "monthly", source, termId: null, computed: true });
      put("total_cost", i, { state: "value", value: { type: "exact", amount: s.totals.payable }, unit: "minor_ron", source, termId: null, computed: true });
      any = true;
    });
    // Payment rows made only of "not confirmed" add nothing; the card says once why there is no payment
    if (!any) { grid.delete("monthly_payment"); grid.delete("total_cost"); paymentUnavailable = true; }
  }

  return finish({
    focus: input.focus, products: input.products, grid, scenario: input.scenario, paymentUnavailable,
    comparableOn: (row) => {
      // Calculated rows share the customer's amount and term; a catalog row compares only like with like
      if (row === "total_cost" || row === "monthly_payment") return true;
      const recs = input.products.map((_, i) => picked.get(`${row}|${i}`));
      return recs.every((r): r is TermRecord => !!r) && recs.every((r) => comparable(recs[0]!, r));
    },
  });
}

export const cardFactsInputSchema = z.object({
  options: z.array(z.object({
    name: z.string().min(1), provider: z.string().min(1).optional(), isRaiffeisen: z.boolean(),
    facts: z.array(z.object({ label: z.string().min(1), value: z.string().min(1), source: z.string().min(1).optional() })),
  })).min(2).max(4),
  focus: focusSchema.optional(),
});
export type CardFactsInput = z.input<typeof cardFactsInputSchema>;

/**
 * The same table from a comparison card the model built: each fact goes to the row its label names, as text.
 * Facts that name no row are left out. No yellow light: free text isn't a comparable figure.
 */
export function fromFacts(raw: CardFactsInput): CompareTable {
  const input = cardFactsInputSchema.parse(raw);
  const focus = input.focus ?? focusOfLabels(input.options.flatMap((o) => o.facts.map((f) => f.label)));
  const grid: Grid = new Map();
  input.options.forEach((o, i) => {
    for (const f of o.facts) {
      const key = rowForLabel(f.label, focus);
      if (!key) continue;
      const cells = grid.get(key) ?? input.options.map(() => EMPTY);
      if (cells[i]!.state !== "not_in_sources") continue;
      cells[i] = { state: "value", value: { type: "text", text: f.value }, unit: "none", source: f.source ? { url: f.source } : null, termId: null, computed: false };
      grid.set(key, cells);
    }
  });
  const products = input.options.map((o) => ({ productId: null, name: o.name, ...(o.provider ? { provider: o.provider } : {}), isRaiffeisen: o.isRaiffeisen }));
  return finish({ focus, products, grid, scenario: null, paymentUnavailable: false, comparableOn: () => false });
}

/**
 * Catalog first, then search: a cell the primary table has (a value or a confirmation gap) stays; a cell it lacks
 * takes the secondary's value. Both tables must list the same products in the same order and share a focus.
 */
export function mergeTables(primary: CompareTable, secondary: CompareTable): CompareTable {
  if (primary.products.length !== secondary.products.length || primary.focus !== secondary.focus) throw new Error("tables_not_aligned");
  const grid: Grid = new Map();
  const fromPrimary = new Set<string>();
  for (const g of primary.groups) for (const r of g.rows) {
    grid.set(r.key, [...r.cells]);
    r.cells.forEach((c, i) => c.state !== "not_in_sources" && fromPrimary.add(`${r.key}|${i}`));
  }
  for (const g of secondary.groups) for (const r of g.rows) {
    const cells = grid.get(r.key) ?? primary.products.map(() => EMPTY);
    r.cells.forEach((c, i) => { if (!fromPrimary.has(`${r.key}|${i}`)) cells[i] = c; });
    grid.set(r.key, cells);
  }
  return finish({
    focus: primary.focus, products: primary.products, grid, scenario: primary.scenario, paymentUnavailable: primary.paymentUnavailable,
    // The light stays only where the catalog lit it and search filled nothing on that row
    comparableOn: (row) => row === primary.deciding && primary.best !== null && grid.get(row)!.every((_, i) => fromPrimary.has(`${row}|${i}`)),
  });
}

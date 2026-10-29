import { z } from "zod";
import { freshness } from "../rag/provenance";
import type { Track } from "../rag/schemas";
import { type Comparability, type TermKind, type TermRecord, termKindSchema, termRecordSchema } from "./schemas";

/*
 * get_product_terms (contract: lib/agent/prompt.ts). Pure: the Convex handler loads the records for the caller's
 * track and passes them in with the clock. Only fresh, quoted and reviewed values are usable; everything else is
 * listed as unavailable with a reason, so missing is never read as zero.
 */

export const TERM_GAP_REASONS = ["unknown_product", "not_in_catalog", "stated_missing", "stale", "quote_not_found", "unreviewed"] as const;

export const termGapSchema = z.object({
  productId: z.string(),
  termId: z.string().optional(),
  label: z.string().optional(),
  kind: termKindSchema.optional(),
  reason: z.enum(TERM_GAP_REASONS),
});
export type TermGap = z.infer<typeof termGapSchema>;

export const termComparisonSchema = z.object({
  kind: termKindSchema,
  comparable: z.boolean(),
  termIds: z.array(z.string()).min(2),
  /** Why the values can't be set side by side: different term, rate type, insurance or currency. */
  reason: z.literal("comparability_mismatch").optional(),
});

export const productTermsResultSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  products: z.array(z.object({
    productId: z.string(), product: z.string(), bank: termRecordSchema.shape.bank, terms: z.array(termRecordSchema),
  })),
  unavailable: z.array(termGapSchema),
  comparisons: z.array(termComparisonSchema),
  reason: z.enum(["no_usable_terms"]).optional(),
});
export type ProductTermsResult = z.infer<typeof productTermsResultSchema>;

/** Words in the tool query that narrow it to some kinds of term, in English and Romanian. */
const KIND_WORDS: Record<TermKind, RegExp> = {
  interest_rate: /\b(rate|interest|dobân?d|dobanzi|dobânzi)/i,
  dae: /\b(dae|apr|annual percentage|total cost)/i,
  fee: /\b(fee|commission|comision|charge|cost)/i,
  limit: /\b(limit|max(imum)?|amount|sum[aă]|down ?payment|avans)/i,
  term: /\b(term|period|perioad|duration|months|luni|grace|grație|gratie)/i,
  eligibility: /\b(eligib|condition|condiți|conditi|require)/i,
  document: /\b(document|acte|paperwork)/i,
  benefit: /\b(benefit|instal?ments?|rate fără|advantage|avantaj)/i,
};

export function requestedKinds(query: string): TermKind[] {
  return (Object.keys(KIND_WORDS) as TermKind[]).filter((kind) => KIND_WORDS[kind].test(query));
}

/** Why a record can't be used, or null when it can. Reviewing is what makes a value verified. */
export function gapReason(record: TermRecord, now: number): TermGap["reason"] | null {
  if (record.value.type === "unavailable") return "stated_missing";
  if (freshness(record.provenance.reviewBy, now) === "stale") return "stale";
  if (!record.verification.quoteFound) return "quote_not_found";
  if (!record.verification.reviewedBy) return "unreviewed";
  return null;
}

const comparabilityKey = (c: Comparability) =>
  JSON.stringify([c.category, c.termMonths ?? null, c.currency ?? null, c.insuranceIncluded ?? null, c.rateType ?? null]);

export function comparable(a: TermRecord, b: TermRecord): boolean {
  return a.kind === b.kind && a.unit === b.unit && comparabilityKey(a.comparability) === comparabilityKey(b.comparability);
}

function compare(usable: TermRecord[]): ProductTermsResult["comparisons"] {
  const out: ProductTermsResult["comparisons"] = [];
  for (const kind of new Set(usable.map((r) => r.kind))) {
    const ofKind = usable.filter((r) => r.kind === kind);
    if (new Set(ofKind.map((r) => r.productId)).size < 2) continue;
    const groups = new Map<string, TermRecord[]>();
    for (const r of ofKind) {
      const key = comparabilityKey(r.comparability) + r.unit;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const lonely: TermRecord[] = [];
    for (const group of groups.values()) {
      if (new Set(group.map((r) => r.productId)).size >= 2) out.push({ kind, comparable: true, termIds: group.map((r) => r.termId) });
      else lonely.push(...group);
    }
    if (lonely.length >= 2 && new Set(lonely.map((r) => r.productId)).size >= 2) {
      out.push({ kind, comparable: false, termIds: lonely.map((r) => r.termId), reason: "comparability_mismatch" });
    }
  }
  return out;
}

export function buildProductTermsResult(input: {
  track: Track;
  query: string;
  productIds: string[];
  records: TermRecord[];
  now: number;
}): ProductTermsResult {
  const kinds = requestedKinds(input.query);
  const wanted = (r: TermRecord) => !kinds.length || kinds.includes(r.kind);
  const products: ProductTermsResult["products"] = [];
  const unavailable: TermGap[] = [];

  for (const productId of [...new Set(input.productIds)]) {
    const all = input.records.filter((r) => r.productId === productId && r.track === input.track);
    if (!all.length) { unavailable.push({ productId, reason: "unknown_product" }); continue; }
    const terms: TermRecord[] = [];
    for (const record of all.filter(wanted)) {
      const reason = gapReason(record, input.now);
      if (reason) unavailable.push({ productId, termId: record.termId, label: record.label, kind: record.kind, reason });
      else terms.push(record);
    }
    for (const kind of kinds) {
      if (!all.some((r) => r.kind === kind)) unavailable.push({ productId, kind, reason: "not_in_catalog" });
    }
    products.push({ productId, product: all[0]!.product, bank: all[0]!.bank, terms });
  }

  const usable = products.flatMap((p) => p.terms);
  return productTermsResultSchema.parse({
    status: usable.length ? "ok" : "unavailable",
    products,
    unavailable,
    comparisons: compare(usable),
    ...(usable.length ? {} : { reason: "no_usable_terms" }),
  });
}

import { z } from "zod";
import type { Citable } from "../rag/answer";
import { BANKS, type Bank, type PublicCollection, scopeField, type Track } from "../rag/schemas";
import { termValueText } from "../rag/tools";
import { PRODUCT_KINDS, type ProductKind, type ProductRecord } from "./products";
import { rateTypeSchema, TERM_KINDS, type TermRecord } from "./schemas";
import { gapReason } from "./terms";

/*
 * query_catalog: the database layer in front of the vector search. Typed filters over the product list and the term
 * catalog, never free-form queries, so the model can't widen its scope or invent a field. The host fixes the track and
 * which banks the turn may read; the model only narrows within that.
 *
 * Reviewed terms come back as reviewed. Terms nobody has reviewed yet come back too, labelled as dated public figures
 * copied from the bank's page, with the exact source text (the demo rule for search results, CLAUDE.md). Missing, stale
 * or unquoted terms never come back as values: they are listed as gaps.
 */

export const catalogQuerySchema = z.object({
  /** products: which products exist (names, kinds, links). terms: their rates, fees, limits, terms and conditions. */
  find: z.enum(["products", "terms"]),
  banks: z.array(z.enum(BANKS)).min(1).max(3).optional(),
  productKind: z.enum(PRODUCT_KINDS).optional(),
  productIds: z.array(z.string().min(1).max(200)).min(1).max(8).optional(),
  termKinds: z.array(z.enum(TERM_KINDS)).min(1).max(4).optional(),
  currency: z.enum(["RON", "EUR"]).optional(),
  termMonths: z.number().int().min(1).max(600).optional(),
  rateType: rateTypeSchema.optional(),
  /** terms only: order by the value, lowest or highest first. Values in different units never mix. */
  sort: z.enum(["lowest", "highest"]).optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** What the turn may read: its track and the banks its collections allow (Raiffeisen from bank docs, others from competitor docs). */
export type CatalogScope = { track: Track; collections: readonly PublicCollection[] };

export function banksInScope(scope: CatalogScope): Bank[] {
  return BANKS.filter((b) => scope.collections.includes(b === "raiffeisen" ? "bank_product_docs" : "competitor_docs"));
}

/** The term catalog's categories ("mortgage_fixed_3y") as the product kinds the chat uses. */
export function termProductKind(record: TermRecord): ProductKind {
  const c = record.comparability.category;
  return (PRODUCT_KINDS as readonly string[]).includes(c) ? c as ProductKind : c.startsWith("mortgage") ? "mortgage" : "other";
}

export type CatalogTermRow = { record: TermRecord; reviewed: boolean };
export type CatalogGap = { termId: string; productId: string; label: string; reason: string };
export type CatalogResult =
  | { find: "products"; products: ProductRecord[]; total: number }
  | { find: "terms"; terms: CatalogTermRow[]; gaps: CatalogGap[]; total: number };

/** Products visible to the turn: in its track, from a collection it may read. Guides and FAQ pages are not products. */
export function queryProducts(products: readonly ProductRecord[], q: CatalogQuery, scope: CatalogScope): CatalogResult {
  const fields = scope.collections.filter((c) => c !== "banking_help").map((c) => scopeField(scope.track, c));
  const banks = banksInScope(scope).filter((b) => !q.banks || q.banks.includes(b));
  const hits = products.filter((p) => !p.guide && fields.some((f) => p[f]) && banks.includes(p.bank)
    && (!q.productKind || p.kind === q.productKind) && (!q.productIds || q.productIds.includes(p.productId)));
  return { find: "products", products: hits.slice(0, q.limit), total: hits.length };
}

/** One number to sort a value by: the exact amount, the bottom of a range or "from", the top of "up to". */
function sortValue(r: TermRecord): number | null {
  const v = r.value;
  return v.type === "exact" ? v.amount : v.type === "range" || v.type === "from" ? v.min : v.type === "up_to" ? v.max : null;
}

export function queryTerms(records: readonly TermRecord[], q: CatalogQuery, scope: CatalogScope, now: number): CatalogResult {
  const banks = banksInScope(scope).filter((b) => !q.banks || q.banks.includes(b));
  const matching = records.filter((r) => r.track === scope.track && banks.includes(r.bank)
    && (!q.productKind || termProductKind(r) === q.productKind) && (!q.productIds || q.productIds.includes(r.productId))
    && (!q.termKinds || q.termKinds.includes(r.kind)) && (!q.currency || !r.comparability.currency || r.comparability.currency === q.currency)
    && (!q.termMonths || !r.comparability.termMonths || r.comparability.termMonths === q.termMonths)
    && (!q.rateType || !r.comparability.rateType || r.comparability.rateType === q.rateType));
  const gaps: CatalogGap[] = [];
  const rows: CatalogTermRow[] = [];
  for (const record of matching) {
    const reason = gapReason(record, now);
    if (reason && reason !== "unreviewed") gaps.push({ termId: record.termId, productId: record.productId, label: record.label, reason });
    else rows.push({ record, reviewed: reason === null });
  }
  if (q.sort) {
    // Sorted within a unit; values without a number go last, in catalog order.
    const sign = q.sort === "lowest" ? 1 : -1;
    rows.sort((a, b) => {
      const va = sortValue(a.record), vb = sortValue(b.record);
      if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
      return a.record.unit.localeCompare(b.record.unit) || sign * (va - vb);
    });
  }
  return { find: "terms", terms: rows.slice(0, q.limit), gaps, total: rows.length };
}

/** The rows as citable results. A term's citable carries its value and the exact source text, so the number check accepts it. */
export function catalogCitables(result: CatalogResult): Citable[] {
  if (result.find === "products") return result.products.map((p): Citable => ({
    chunkId: `product:${p.productId}`,
    label: p.product,
    url: p.url,
    text: [`Product in the catalog: ${p.product} (${p.bank}, ${p.kind.replace(/_/g, " ")}${p.category ? `, listed under "${p.category}"` : ""}).`,
      ...(p.summary ? [`From its page: ${p.summary}`] : [])].join("\n"),
    collectedAt: p.collectedAt,
    sectionType: "overview",
    score: 1,
  }));
  return result.terms.map(({ record: t, reviewed }): Citable => ({
    chunkId: `term:${t.termId}`,
    label: `${t.product}: ${t.label}`,
    url: t.provenance.url,
    text: [
      reviewed ? `Catalog term ${t.termId} (${t.kind}), reviewed ${t.verification.reviewedAt?.slice(0, 10) ?? ""}.`
        : `Catalog term ${t.termId} (${t.kind}), not reviewed yet: a dated public figure copied from the bank's page on ${t.provenance.collectedAt.slice(0, 10)}. Say so when you use it.`,
      `${t.product} (${t.bank}). ${t.label}: ${termValueText(t)}.`,
      ...(t.conditions.length ? [`Conditions: ${t.conditions.join("; ")}.`] : []),
      ...(t.quote ? [`Source text: ${t.quote}`] : []),
    ].join("\n"),
    collectedAt: t.provenance.collectedAt,
    sectionType: t.kind === "fee" ? "fees" : t.kind === "interest_rate" || t.kind === "dae" ? "interest_rates" : t.kind === "eligibility" ? "eligibility" : "table",
    score: 1,
  }));
}

/** What the catalog holds no usable value for, for the model to say plainly. Not citable. */
export function catalogNote(result: CatalogResult): string | null {
  const more = result.total > (result.find === "products" ? result.products.length : result.terms.length);
  const parts = [
    ...(result.find === "terms" && result.gaps.length ? [`Not usable from the catalog (don't estimate these): ${result.gaps.slice(0, 8).map((g) => `${g.productId} ${g.label}: ${g.reason}`).join("; ")}.`] : []),
    ...(more ? [`${result.total} rows matched; narrow the filters to see the rest.`] : []),
    ...(result.total === 0 ? ["The catalog has nothing for these filters: use search_knowledge for this."] : []),
  ];
  return parts.length ? parts.join(" ") : null;
}

/**
 * The query the host runs before the model on catalog-shaped questions, so the database is the first layer in code, not
 * only in the prompt. Null when the question isn't one the catalog can answer first.
 */
export function prefetchQuery(input: { inquiry: string | null; productKind?: string | null; banks?: readonly string[] }): CatalogQuery | null {
  const kind = (PRODUCT_KINDS as readonly string[]).includes(input.productKind ?? "") ? input.productKind as ProductKind : undefined;
  const banks = (input.banks ?? []).filter((b): b is Bank => (BANKS as readonly string[]).includes(b));
  const base = { ...(kind ? { productKind: kind } : {}), ...(banks.length ? { banks } : {}) };
  switch (input.inquiry) {
    case "listing": return catalogQuerySchema.parse({ find: "products", ...base, limit: 12 });
    case "product_comparison": return kind ? catalogQuerySchema.parse({ find: "terms", ...base, limit: 12 }) : null;
    case "fees_statements": return kind ? catalogQuerySchema.parse({ find: "terms", ...base, termKinds: ["fee"], limit: 10 }) : null;
    case "product_explanation": return kind ? catalogQuerySchema.parse({ find: "terms", ...base, limit: 10 }) : null;
    default: return null;
  }
}

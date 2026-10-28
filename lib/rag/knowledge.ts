import { z } from "zod";
import { tokenize } from "./normalize";
import { buildProvenance, provenanceSchema } from "./provenance";
import { planQuery } from "./query";
import {
  bankSchema,
  docTypeSchema,
  PUBLIC_COLLECTIONS,
  type PublicCollection,
  publicCollectionSchema,
  type SearchHit,
  sectionTypeSchema,
  segmentSchema,
} from "./schemas";
import { resultTitle } from "./titles";

/** Coverage notes a search can attach, as fixed codes the composer and the model can explain. */
export const KNOWLEDGE_GAPS = [
  "no_results",
  "fewer_results_than_requested",
  "stale_excluded",
  /** A Raiffeisen cost question found no fee section: full fees live in shared tariff PDFs. */
  "fees_in_shared_tariff_pdfs",
  /** ING's fee and rate PDFs were not collected (robots.txt), so ING costs and APRs may be missing. */
  "ing_pdfs_not_collected",
] as const;
export type KnowledgeGap = (typeof KNOWLEDGE_GAPS)[number];

export const UNAVAILABLE_REASONS = ["collection_not_connected", "unknown_collection", "stale_sources"] as const;

export const passageSchema = z.object({
  passageId: z.string().min(1),
  collection: publicCollectionSchema,
  bank: bankSchema,
  /** Display title: "Bank · product · section" or "Bank · document kind: title". */
  title: z.string().min(1),
  product: z.string().optional(),
  productId: z.string().optional(),
  segment: segmentSchema.optional(),
  sectionType: sectionTypeSchema,
  docType: docTypeSchema.optional(),
  text: z.string().min(1),
  provenance: provenanceSchema,
  score: z.number(),
});
export type Passage = z.infer<typeof passageSchema>;

export const searchKnowledgeResultSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  /** The collection that was asked for, echoed back even when it isn't a known one. */
  collection: z.string().min(1).max(64),
  passages: z.array(passageSchema),
  coverage: z.object({
    requested: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    gaps: z.array(z.enum(KNOWLEDGE_GAPS)),
  }),
  reason: z.enum(UNAVAILABLE_REASONS).optional(),
});
export type SearchKnowledgeResult = z.infer<typeof searchKnowledgeResultSchema>;

export function isPublicCollection(collection: string): collection is PublicCollection {
  return (PUBLIC_COLLECTIONS as readonly string[]).includes(collection);
}

/** How many candidates to ask the search for, so stale ones can be dropped without coming up short. */
export function candidateCount(limit: number): number {
  return Math.min(limit * 2, 10);
}

export function unavailableResult(
  collection: string,
  reason: (typeof UNAVAILABLE_REASONS)[number],
  requested: number,
  gaps: KnowledgeGap[] = [],
): SearchKnowledgeResult {
  return searchKnowledgeResultSchema.parse({
    status: "unavailable",
    collection: collection.slice(0, 64) || "unknown",
    passages: [],
    coverage: { requested, returned: 0, gaps },
    reason,
  });
}

export function toPassage(hit: SearchHit, collection: PublicCollection, now: number): Passage {
  return passageSchema.parse({
    passageId: hit.chunkId,
    collection,
    bank: hit.bank,
    title: resultTitle(hit),
    ...(hit.product ? { product: hit.product } : {}),
    ...(hit.productId ? { productId: hit.productId } : {}),
    ...(hit.segment ? { segment: hit.segment } : {}),
    sectionType: hit.sectionType,
    ...(hit.docType ? { docType: hit.docType } : {}),
    text: hit.text,
    provenance: buildProvenance({
      bank: hit.bank,
      url: hit.url,
      chunkId: hit.chunkId,
      collectedAt: hit.scrapedAt,
      volatility: "volatile",
      now,
    }),
    score: hit.score,
  });
}

/**
 * Turn ranked hits from one collection into the tool result: fresh passages only (stale ones are dropped and
 * counted), at most `limit`, with the coverage gaps a reader needs to know about.
 */
export function buildKnowledgeResult(input: {
  collection: PublicCollection;
  query: string;
  limit: number;
  hits: readonly SearchHit[];
  now: number;
}): SearchKnowledgeResult {
  const { collection, query, limit, hits, now } = input;
  const all = hits.map((hit) => toPassage(hit, collection, now));
  const fresh = all.filter((p) => p.provenance.status === "fresh");
  const staleCount = all.length - fresh.length;
  if (all.length > 0 && fresh.length === 0) return unavailableResult(collection, "stale_sources", limit, ["stale_excluded"]);

  const passages = fresh.slice(0, limit);
  const gaps: KnowledgeGap[] = [];
  if (passages.length === 0) gaps.push("no_results");
  else if (passages.length < limit) gaps.push("fewer_results_than_requested");
  if (staleCount > 0) gaps.push("stale_excluded");

  const intents = planQuery(query).intents;
  const asksCost = intents.includes("cost");
  const asksRate = intents.includes("interest");
  if (collection === "bank_product_docs" && asksCost) {
    const hasFees = passages.some((p) => p.sectionType === "fees" || p.sectionType === "fee_table" || p.docType === "tarife");
    if (!hasFees) gaps.push("fees_in_shared_tariff_pdfs");
  }
  if (collection === "competitor_docs" && (asksCost || asksRate)) {
    const aboutIng = tokenize(query).includes("ing") || passages.some((p) => p.bank === "ing");
    if (aboutIng) gaps.push("ing_pdfs_not_collected");
  }

  return searchKnowledgeResultSchema.parse({
    status: "ok",
    collection,
    passages,
    coverage: { requested: limit, returned: passages.length, gaps },
  });
}

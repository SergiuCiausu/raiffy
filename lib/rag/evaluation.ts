import { z } from "zod";
import { KNOWLEDGE_GAPS, type SearchKnowledgeResult } from "./knowledge";
import { PUBLIC_COLLECTIONS, type RagChunkDoc, scopeField, segmentSchema, TRACKS, trackSchema } from "./schemas";
import { TRACK_SEGMENTS } from "./visibility";

/**
 * One retrieval test case.
 * - hit: a passage in the top `limit` must come from `expectedUrlContains` and contain `expectedTextContains`.
 * - coverage: the result must report every gap in `expectGaps`.
 * - isolation: an adversarial query for the other track; passes when nothing out of scope comes back.
 * Every kind also fails on any isolation violation (see `isolationViolations`).
 */
export const retrievalCaseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["hit", "coverage", "isolation"]),
  question: z.string().min(1),
  track: trackSchema,
  collection: z.string().min(1),
  lang: z.enum(["en", "ro"]).default("en"),
  expectedUrlContains: z.string().min(1).optional(),
  expectedTextContains: z.string().min(1).optional(),
  expectGaps: z.array(z.enum(KNOWLEDGE_GAPS)).optional(),
  tags: z.array(z.string()).default([]),
}).refine((c) => c.kind !== "hit" || (c.expectedUrlContains && c.expectedTextContains), "hit cases need an expected URL and text")
  .refine((c) => c.kind !== "coverage" || (c.expectGaps && c.expectGaps.length > 0), "coverage cases need expected gaps");
export type RetrievalCase = z.infer<typeof retrievalCaseSchema>;

export type RetrievalScore = {
  id: string;
  kind: RetrievalCase["kind"];
  pass: boolean;
  /** 1-based rank of the expected passage, for hit cases. */
  hitRank: number | null;
  /** 1-based rank of the first passage from the expected page, for hit cases (right page, maybe another chunk). */
  pageRank: number | null;
  status: SearchKnowledgeResult["status"];
  gaps: string[];
  violations: string[];
  top: { bank: string; segment: string | null; sectionType: string; url: string }[];
};

/** Anything in a result that belongs to another track or collection. Corporate content is never allowed. */
export function isolationViolations(c: Pick<RetrievalCase, "track" | "collection">, result: SearchKnowledgeResult): string[] {
  const allowed = TRACK_SEGMENTS[c.track];
  const out: string[] = [];
  if (result.collection !== c.collection) out.push(`result collection ${result.collection} != ${c.collection}`);
  for (const p of result.passages) {
    if (p.collection !== c.collection) out.push(`${p.passageId}: collection ${p.collection}`);
    if (p.segment === "corporate") out.push(`${p.passageId}: corporate segment`);
    else if (p.segment && !allowed.includes(p.segment)) out.push(`${p.passageId}: segment ${p.segment} outside ${c.track}`);
    if (c.collection === "competitor_docs" && p.bank === "raiffeisen") out.push(`${p.passageId}: Raiffeisen in competitor_docs`);
    if (c.collection !== "competitor_docs" && p.bank !== "raiffeisen") out.push(`${p.passageId}: ${p.bank} in ${c.collection}`);
    if (c.collection === "banking_help" && p.sectionType !== "faq") out.push(`${p.passageId}: ${p.sectionType} in banking_help`);
  }
  return out;
}

export function scoreRetrievalCase(c: RetrievalCase, result: SearchKnowledgeResult): RetrievalScore {
  const violations = isolationViolations(c, result);
  let hitRank: number | null = null;
  let pageRank: number | null = null;
  if (c.kind === "hit") {
    const rank = (index: number) => (index >= 0 ? index + 1 : null);
    const onPage = (p: SearchKnowledgeResult["passages"][number]) => p.provenance.url.includes(c.expectedUrlContains!);
    hitRank = rank(result.passages.findIndex((p) => onPage(p) && p.text.includes(c.expectedTextContains!)));
    pageRank = rank(result.passages.findIndex(onPage));
  }
  const gapsOk = (c.expectGaps ?? []).every((gap) => result.coverage.gaps.includes(gap));
  const pass = violations.length === 0 && (c.kind === "hit" ? hitRank !== null : c.kind === "coverage" ? gapsOk : true);
  return {
    id: c.id,
    kind: c.kind,
    pass,
    hitRank,
    pageRank,
    status: result.status,
    gaps: result.coverage.gaps,
    violations,
    top: result.passages.map((p) => ({ bank: p.bank, segment: p.segment ?? null, sectionType: p.sectionType, url: p.provenance.url })),
  };
}

type AuditedDoc = Pick<RagChunkDoc, "chunkId" | "bank" | "sourceType" | "sectionType"> & { segment?: string } &
  Record<ReturnType<typeof scopeField>, boolean>;

/** Data-level invariants for one stored chunk (corporate never visible, segments and banks in their collections). */
export function auditChunk(doc: AuditedDoc): string[] {
  const out: string[] = [];
  const flags = TRACKS.flatMap((track) => PUBLIC_COLLECTIONS.map((collection) => ({ track, collection, on: doc[scopeField(track, collection)] })));
  const on = flags.filter((f) => f.on);
  if (on.length === 0) out.push(`${doc.chunkId}: stored but in no track or collection`);
  if (doc.segment === "corporate" && on.length) out.push(`${doc.chunkId}: corporate chunk is visible`);
  const segment = doc.segment === undefined ? undefined : segmentSchema.safeParse(doc.segment);
  if (segment && !segment.success) out.push(`${doc.chunkId}: unknown segment ${doc.segment}`);
  for (const f of on) {
    if (doc.sourceType === "product_page" && segment?.success && !TRACK_SEGMENTS[f.track].includes(segment.data)) {
      out.push(`${doc.chunkId}: segment ${doc.segment} visible in ${f.track}`);
    }
    if (f.collection === "competitor_docs" && doc.bank === "raiffeisen") out.push(`${doc.chunkId}: Raiffeisen in competitor_docs`);
    if (f.collection !== "competitor_docs" && doc.bank !== "raiffeisen") out.push(`${doc.chunkId}: ${doc.bank} in ${f.collection}`);
    if (f.collection === "banking_help" && doc.sectionType !== "faq") out.push(`${doc.chunkId}: ${doc.sectionType} in banking_help`);
    if (f.collection === "banking_help" && !doc[scopeField(f.track, "bank_product_docs")]) {
      out.push(`${doc.chunkId}: banking_help without bank_product_docs in ${f.track}`);
    }
  }
  return out;
}

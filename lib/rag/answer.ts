import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { Passage } from "./knowledge";
import { findUngroundedNumbers } from "./numbers";
import { type DocType, docTypeSchema, type SectionType, sectionTypeSchema } from "./schemas";

/** A fragment the model saw as a search_result block, in the order it saw it. Citations point into this list. */
export type Citable = {
  chunkId: string;
  label: string;
  url: string;
  text: string;
  collectedAt: string;
  sectionType: SectionType;
  docType?: DocType;
  score: number;
};

export function citableFromPassage(passage: Passage): Citable {
  return {
    chunkId: passage.passageId,
    label: passage.title,
    url: passage.provenance.url,
    text: passage.text,
    collectedAt: passage.provenance.collectedAt,
    sectionType: passage.sectionType,
    ...(passage.docType ? { docType: passage.docType } : {}),
    score: passage.score,
  };
}

export const ragSourceSchema = z.object({
  id: z.string(),
  url: z.url(),
  title: z.string(),
  /** Collection date of the snapshot (YYYY-MM-DD), shown as "information from ...". */
  collectedOn: z.iso.date(),
  sectionType: sectionTypeSchema,
  docType: docTypeSchema.optional(),
  chunkIds: z.array(z.string()).min(1),
});
export type RagSource = z.infer<typeof ragSourceSchema>;

export const ragSegmentSchema = z.object({
  text: z.string(),
  sourceIds: z.array(z.string()),
});

export const ragAnswerSchema = z.object({
  status: z.enum(["answered", "no_results", "refused", "failed_checks"]),
  text: z.string(),
  segments: z.array(ragSegmentSchema),
  sources: z.array(ragSourceSchema),
  checks: z.object({
    /** Numbers absent from the segment's valid cited fragments and their collection dates. */
    ungroundedNumbers: z.array(z.string()),
    /** Segments that state a number but cite nothing. */
    uncitedSegmentsWithNumbers: z.number().int().nonnegative(),
    /** Additive diagnostic: absent on older responses and when every citation index is valid. */
    invalidCitationIndexes: z.number().int().nonnegative().optional(),
    attempts: z.number().int().positive(),
  }),
  model: z.string(),
  promptVersion: z.string(),
  /** The searches the agent ran, in order. */
  searches: z.array(z.object({
    query: z.string(),
    collection: z.string(),
    status: z.enum(["ok", "unavailable"]),
    results: z.number().int().nonnegative(),
  })),
  /** Every fragment shown to the model, in the order it saw them. */
  retrieval: z.array(
    z.object({
      chunkId: z.string(),
      score: z.number(),
      denseRank: z.number().int().optional(),
      lexicalRank: z.number().int().optional(),
    }),
  ),
});
export type RagAnswer = z.infer<typeof ragAnswerSchema>;

export type CitedSegment = { text: string; hitIndexes: number[] };

/** The text blocks of a response, each with the search results it cites (by request order). */
export function citedSegments(content: readonly BetaContentBlock[]): CitedSegment[] {
  const segments: CitedSegment[] = [];
  for (const block of content) {
    if (block.type !== "text") continue;
    const hitIndexes = (block.citations ?? [])
      .filter((c) => c.type === "search_result_location")
      .map((c) => c.search_result_index);
    segments.push({ text: block.text, hitIndexes: [...new Set(hitIndexes)] });
  }
  return segments;
}

/** Turn cited segments into answer text, per-segment source ids and one source per cited page. */
export function assembleCitations(segments: readonly CitedSegment[], hits: readonly Citable[]) {
  const sources: RagSource[] = [];
  const idByUrl = new Map<string, string>();
  const out = segments.map((segment) => {
    const sourceIds: string[] = [];
    for (const index of segment.hitIndexes) {
      const hit = hits[index];
      if (!hit) continue;
      let id = idByUrl.get(hit.url);
      if (!id) {
        id = `src-${sources.length + 1}`;
        idByUrl.set(hit.url, id);
        sources.push({
          id,
          url: hit.url,
          title: hit.label,
          collectedOn: hit.collectedAt.slice(0, 10),
          sectionType: hit.sectionType,
          ...(hit.docType ? { docType: hit.docType } : {}),
          chunkIds: [hit.chunkId],
        });
      } else {
        const source = sources.find((s) => s.id === id)!;
        if (!source.chunkIds.includes(hit.chunkId)) source.chunkIds.push(hit.chunkId);
      }
      if (!sourceIds.includes(id)) sourceIds.push(id);
    }
    return { text: segment.text, sourceIds };
  });
  return { text: out.map((s) => s.text).join("").trim(), segments: out, sources };
}

/**
 * Numeric presence is checked per cited fragment, never against the question or unrelated hits.
 * This is not a verifier of financial meaning, units, product identity or semantic entailment.
 * Keep the question argument for compatibility with existing callers.
 */
/** `trustedTexts` are calculator results: their numbers may appear in any segment, cited or not. */
export function checkNumbers(segments: readonly CitedSegment[], hits: readonly Citable[], trustedTexts: readonly string[] = []) {
  const ungroundedNumbers: string[] = [];
  let uncitedSegmentsWithNumbers = 0;
  let invalidCitationIndexes = 0;
  for (const segment of segments) {
    const citedHits: Citable[] = [];
    for (const index of segment.hitIndexes) {
      const hit = Number.isInteger(index) && index >= 0 ? hits[index] : undefined;
      if (hit) citedHits.push(hit);
      else invalidCitationIndexes++;
    }
    const allowed = [...citedHits.flatMap((hit) => [hit.text, hit.collectedAt.slice(0, 10)]), ...trustedTexts];
    ungroundedNumbers.push(...findUngroundedNumbers(segment.text, allowed));
    if (!citedHits.length && findUngroundedNumbers(segment.text, trustedTexts).length > 0) uncitedSegmentsWithNumbers++;
  }
  return {
    ungroundedNumbers,
    uncitedSegmentsWithNumbers,
    ...(invalidCitationIndexes ? { invalidCitationIndexes } : {}),
  };
}

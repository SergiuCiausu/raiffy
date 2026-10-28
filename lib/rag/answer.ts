import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { findUngroundedNumbers } from "./numbers";
import { resultTitle } from "./prompt";
import { docTypeSchema, sectionTypeSchema, type SearchHit } from "./schemas";

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
    /** Numbers in the text that no retrieved fragment, the question or the collection date contains. */
    ungroundedNumbers: z.array(z.string()),
    /** Segments that state a number but cite nothing. */
    uncitedSegmentsWithNumbers: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
  }),
  model: z.string(),
  promptVersion: z.string(),
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
export function assembleCitations(segments: readonly CitedSegment[], hits: readonly SearchHit[]) {
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
          title: resultTitle(hit),
          collectedOn: hit.scrapedAt.slice(0, 10),
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

/** Deterministic output checks: every number grounded, and no number stated without a citation. */
export function checkNumbers(segments: readonly CitedSegment[], hits: readonly SearchHit[], question: string) {
  const allowed = [...hits.map((hit) => hit.text), question, ...hits.map((hit) => hit.scrapedAt.slice(0, 10))];
  const text = segments.map((s) => s.text).join("");
  const ungroundedNumbers = findUngroundedNumbers(text, allowed);
  const uncitedSegmentsWithNumbers = segments.filter(
    (s) => s.hitIndexes.length === 0 && findUngroundedNumbers(s.text, [question, ...allowed.slice(-hits.length)]).length > 0,
  ).length;
  return { ungroundedNumbers, uncitedSegmentsWithNumbers };
}

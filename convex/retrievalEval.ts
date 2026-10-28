import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { searchKnowledgeForTrack } from "./knowledge";
import { auditChunk, retrievalCaseSchema, type RetrievalScore, scoreRetrievalCase } from "../lib/rag/evaluation";
import { PUBLIC_COLLECTIONS, scopeField, TRACKS } from "../lib/rag/schemas";

/**
 * Run retrieval cases through the search_knowledge handler: `pnpm rag:eval` (scripts/eval-retrieval.ts).
 * Internal, so only the deploy key can call it. The CLI can't act as a user on internal functions, so this skips
 * the identity check; convex/knowledge.test.ts covers that check.
 */
export const run = internalAction({
  args: { cases: v.array(v.any()), limit: v.optional(v.number()) },
  handler: async (ctx, { cases, limit = 5 }): Promise<RetrievalScore[]> => {
    const scores: RetrievalScore[] = [];
    for (const raw of cases) {
      const c = retrievalCaseSchema.parse(raw);
      const result = await searchKnowledgeForTrack(ctx, c.track, { collection: c.collection, query: c.question, limit });
      scores.push(scoreRetrievalCase(c, result));
    }
    return scores;
  },
});

export const auditPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("ragChunks").paginate(paginationOpts);
    const counts: Record<string, number> = {};
    const violations: string[] = [];
    for (const doc of page.page) {
      violations.push(...auditChunk(doc));
      for (const track of TRACKS) {
        for (const collection of PUBLIC_COLLECTIONS) {
          const field = scopeField(track, collection);
          if (doc[field]) counts[field] = (counts[field] ?? 0) + 1;
        }
      }
      if (!doc.embedded) counts.notEmbedded = (counts.notEmbedded ?? 0) + 1;
    }
    return { checked: page.page.length, counts, violations, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Data-level isolation audit over every stored chunk: `pnpm exec convex run retrievalEval:audit`. */
export const audit = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; counts: Record<string, number>; violations: string[] }> => {
    let cursor: string | null = null;
    let checked = 0;
    const counts: Record<string, number> = {};
    const violations: string[] = [];
    for (;;) {
      const page: { checked: number; counts: Record<string, number>; violations: string[]; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.retrievalEval.auditPage, { paginationOpts: { numItems: 100, cursor } });
      checked += page.checked;
      for (const [key, n] of Object.entries(page.counts)) counts[key] = (counts[key] ?? 0) + n;
      violations.push(...page.violations);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { checked, counts, violations: violations.slice(0, 200) };
  },
});

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, type ActionCtx, internalQuery } from "./_generated/server";
import { embedTexts } from "./openai";
import { toSearchText } from "../lib/rag/normalize";
import { planQuery, withFocus } from "../lib/rag/query";
import { PUBLIC_COLLECTIONS, scopeField, SEARCH_FOCUS, searchArgsSchema, type SearchArgs, type SearchHit } from "../lib/rag/schemas";
import { rankHits, type StoredChunk } from "../lib/rag/search";
import { requireAgentScope } from "./agentAuth";
import { NO_TRACE, type Trace } from "./trace";

const CANDIDATES = 64;

export const trackArg = v.union(v.literal("personal"), v.literal("business"));
const focusArg = v.union(...SEARCH_FOCUS.map((focus) => v.literal(focus)));
export const collectionArg = v.union(...PUBLIC_COLLECTIONS.map((c) => v.literal(c)));

/** Keyword leg: full-text search over the folded text, scoped to one track and collection. */
export const textSearch = internalQuery({
  args: { terms: v.string(), track: trackArg, collection: collectionArg, limit: v.number() },
  handler: async (ctx, { terms, track, collection, limit }) => {
    if (!terms.trim()) return [];
    const field = scopeField(track, collection);
    const docs = await ctx.db
      .query("ragChunks")
      .withSearchIndex("search_text", (q) => q.search("searchText", terms).eq(field, true))
      .take(limit);
    return docs.map((doc) => doc._id);
  },
});

/** Loads chunks without their vectors. */
export const getChunks = internalQuery({
  args: { ids: v.array(v.id("ragChunks")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs
      .filter((doc): doc is Doc<"ragChunks"> => doc !== null)
      .map(({ embedding: _e, searchText: _s, _creationTime: _c, ...rest }) => rest);
  },
});

/** Hybrid search: OpenAI vector leg plus keyword leg, both scoped to one track and collection, fused in code. */
export async function searchChunks(ctx: ActionCtx, input: SearchArgs): Promise<SearchHit[]> {
  await requireAgentScope(ctx, input.track);
  return hybridSearch(ctx, input);
}

/** The same search without the identity check. Internal callers only (the retrieval eval). */
export async function hybridSearch(ctx: ActionCtx, input: SearchArgs, t: Trace = NO_TRACE): Promise<SearchHit[]> {
  const { question, track, collection, k, focus } = searchArgsSchema.parse(input);
  const plan = withFocus(planQuery(question), focus);
  const field = scopeField(track, collection);
  const terms = plan.lexicalTerms.map(toSearchText).join(" ");
  const started = Date.now();

  const [dense, lexicalIds] = await Promise.all([
    t.time("rag.embed", () => embedTexts([question]), (v) => ({ model: "text-embedding-3-small", dimensions: v[0]?.length ?? 0 }))
      .then(([vector]) => t.time("rag.vector", () => ctx.vectorSearch("ragChunks", "by_embedding", {
        vector: vector!,
        limit: CANDIDATES,
        filter: (q) => q.eq(field, true),
      }), (r) => ({ index: "by_embedding", filter: field, hits: r.length, topScores: r.slice(0, 3).map((x) => Math.round(x._score * 1000) / 1000) }))),
    t.time("rag.keyword", () => ctx.runQuery(internal.rag.textSearch, {
      terms,
      track,
      collection,
      limit: CANDIDATES,
    }), (r) => ({ index: "search_text", filter: field, hits: r.length, terms: t.text(terms) })),
  ]);

  const denseIds = dense.map((result) => result._id);
  const ids = [...new Set<Id<"ragChunks">>([...denseIds, ...lexicalIds])];
  const docs = await ctx.runQuery(internal.rag.getChunks, { ids });
  const byId = new Map<string, StoredChunk>(docs.map((doc) => [doc._id, doc as StoredChunk]));
  const hits = rankHits(denseIds, lexicalIds, byId, plan, { k });
  t.step("rag.ranked", { ms: Date.now() - started, focus, merged: ids.length, loaded: docs.length, kept: hits.length,
    top: hits.slice(0, 5).map((h) => ({ chunk: h.chunkId, bank: h.bank, section: h.sectionType, score: Math.round(h.score * 1000) / 1000, dense: h.denseRank, keyword: h.lexicalRank })) });
  return hits;
}

/** Retrieval only (used by starter/eval.py --backend convex). Public product data, no customer data. */
export const search = action({
  args: {
    question: v.string(),
    track: trackArg,
    collection: v.optional(collectionArg),
    k: v.optional(v.number()),
    focus: v.optional(focusArg),
  },
  handler: async (ctx, args): Promise<SearchHit[]> => searchChunks(ctx, args),
});

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, type ActionCtx, internalQuery } from "./_generated/server";
import { toSearchText } from "../lib/rag/normalize";
import { planQuery } from "../lib/rag/query";
import { searchArgsSchema, type SearchArgs, type SearchHit } from "../lib/rag/schemas";
import { rankHits, type StoredChunk } from "../lib/rag/search";
import { visibilityField } from "../lib/rag/visibility";

const CANDIDATES = 32;

const trackArg = v.union(v.literal("personal"), v.literal("business"));

/** Keyword leg: full-text search over the folded text, scoped to the track. */
export const textSearch = internalQuery({
  args: { terms: v.string(), track: trackArg, limit: v.number() },
  handler: async (ctx, { terms, track, limit }) => {
    if (!terms.trim()) return [];
    const field = visibilityField(track);
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

/** Embeds a question with the same model the chunks were indexed with (local service, see tools/rag). */
async function embedQuery(question: string): Promise<number[]> {
  const url = process.env.EMBEDDINGS_URL ?? "http://127.0.0.1:8765";
  const response = await fetch(`${url}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texts: [question], kind: "query" }),
  });
  if (!response.ok) throw new Error(`Embedding service returned ${response.status}`);
  const body = (await response.json()) as { vectors: number[][] };
  const vector = body.vectors[0];
  if (!vector) throw new Error("Embedding service returned no vector");
  return vector;
}

export async function searchChunks(ctx: ActionCtx, input: SearchArgs): Promise<SearchHit[]> {
  const { question, track, k } = searchArgsSchema.parse(input);
  const plan = planQuery(question);
  const field = visibilityField(track);

  const [dense, lexicalIds] = await Promise.all([
    embedQuery(question).then((vector) =>
      ctx.vectorSearch("ragChunks", "by_embedding", {
        vector,
        limit: CANDIDATES,
        filter: (q) => q.eq(field, true),
      }),
    ),
    ctx.runQuery(internal.rag.textSearch, {
      terms: plan.lexicalTerms.map(toSearchText).join(" "),
      track,
      limit: CANDIDATES,
    }),
  ]);

  const denseIds = dense.map((result) => result._id);
  const ids = [...new Set<Id<"ragChunks">>([...denseIds, ...lexicalIds])];
  const docs = await ctx.runQuery(internal.rag.getChunks, { ids });
  const byId = new Map<string, StoredChunk>(docs.map((doc) => [doc._id, doc as StoredChunk]));
  return rankHits(denseIds, lexicalIds, byId, plan, { k });
}

/** Hybrid search over the public product chunks, scoped to the caller's track. Public data only. */
export const search = action({
  args: { question: v.string(), track: trackArg, k: v.optional(v.number()) },
  handler: async (ctx, args): Promise<SearchHit[]> => searchChunks(ctx, args),
});

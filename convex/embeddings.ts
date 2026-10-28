import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { EMBEDDING_MODEL, embedTexts } from "./openai";

const BATCH = 64;
const SAVE_BATCH = 16;
/** Stop well before the action time limit and continue in a fresh scheduled run. */
const TIME_BUDGET_MS = 5 * 60 * 1000;

export const pendingBatch = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const docs = await ctx.db
      .query("ragChunks")
      .withIndex("by_embedded", (q) => q.eq("embedded", false))
      .take(limit);
    return docs.map((doc) => ({ _id: doc._id, text: doc.text }));
  },
});

export const saveEmbeddings = internalMutation({
  args: {
    model: v.string(),
    items: v.array(v.object({ id: v.id("ragChunks"), embedding: v.array(v.float64()) })),
  },
  handler: async (ctx, { model, items }) => {
    for (const { id, embedding } of items) {
      await ctx.db.patch(id, { embedding, embeddingModel: model, embedded: true });
    }
  },
});

export const pendingCount = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("ragChunks").withIndex("by_embedded", (q) => q.eq("embedded", false)).collect()).length,
});

/**
 * Embed every chunk that has no vector yet, in batches.
 *   pnpm exec convex run embeddings:embedPending
 */
export const embedPending = internalAction({
  args: {},
  handler: async (ctx): Promise<{ embedded: number; scheduledMore: boolean }> => {
    const started = Date.now();
    let embedded = 0;
    while (Date.now() - started < TIME_BUDGET_MS) {
      const batch = await ctx.runQuery(internal.embeddings.pendingBatch, { limit: BATCH });
      if (batch.length === 0) return { embedded, scheduledMore: false };
      const vectors = await embedTexts(batch.map((doc) => doc.text));
      const items = batch.map((doc, i) => ({ id: doc._id, embedding: vectors[i]! }));
      // Each vector write also updates the vector index and its six filter fields: keep transactions small.
      for (let start = 0; start < items.length; start += SAVE_BATCH) {
        await ctx.runMutation(internal.embeddings.saveEmbeddings, {
          model: EMBEDDING_MODEL,
          items: items.slice(start, start + SAVE_BATCH),
        });
      }
      embedded += batch.length;
    }
    await ctx.scheduler.runAfter(0, internal.embeddings.embedPending, {});
    return { embedded, scheduledMore: true };
  },
});

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalQuery, mutation } from "./_generated/server";
import { requireAgentScope } from "./agentAuth";
import { writeAudit } from "./audit";
import { requirePermission } from "./roles";
import { getProductTermsInputSchema } from "../lib/agent/prompt";
import type { TermRecord } from "../lib/catalog/schemas";
import { buildProductTermsResult, type ProductTermsResult } from "../lib/catalog/terms";
import type { Track } from "../lib/rag/schemas";

const track = v.union(v.literal("personal"), v.literal("business"));

/** The catalog records of some products in one track, without Convex's system fields. */
export const termsFor = internalQuery({
  args: { track, productIds: v.array(v.string()) },
  handler: async (ctx, { track, productIds }): Promise<TermRecord[]> => {
    const rows = await Promise.all([...new Set(productIds)].slice(0, 6).map((productId) =>
      ctx.db.query("productTerms").withIndex("by_track_product", (q) => q.eq("track", track).eq("productId", productId)).collect()));
    return rows.flat().map(({ _id, _creationTime, ...record }) => record);
  },
});

/**
 * The get_product_terms tool handler (contract: lib/agent/prompt.ts). The track comes from the caller's
 * authenticated session, never from the tool input. Not yet offered to the live agent: every record starts
 * unreviewed, so it would return only unavailable terms until a reviewer signs values off.
 */
export async function getProductTerms(ctx: ActionCtx, track: Track, rawInput: unknown, now: number = Date.now()): Promise<ProductTermsResult> {
  await requireAgentScope(ctx, track);
  const input = getProductTermsInputSchema.parse(rawInput);
  const records: TermRecord[] = await ctx.runQuery(internal.catalog.termsFor, { track, productIds: input.productIds });
  return buildProductTermsResult({ track, query: input.query, productIds: input.productIds, records, now });
}

/** A reviewer confirms a value against its quote and source. Only a located quote can be signed off. */
export const markReviewed = mutation({
  args: { termId: v.string(), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { termId, note }) => {
    const caller = await requirePermission(ctx, "change.publish");
    const row = await ctx.db.query("productTerms").withIndex("by_termId", (q) => q.eq("termId", termId)).unique();
    if (!row) throw new ConvexError("term_unavailable");
    if (row.value.type === "unavailable" || !row.verification.quoteFound) throw new ConvexError("quote_not_found");
    await ctx.db.patch(row._id, {
      verification: { ...row.verification, reviewedBy: caller.clerkUserId, reviewedAt: new Date().toISOString() },
    });
    await writeAudit(ctx, caller, { action: "catalog.term_reviewed", details: { termId }, note });
    return null;
  },
});

import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireAgentThread } from "./agentAuth";
import { HANDOFF_PREVIEW_MESSAGES, HANDOFF_REASONS, handoffPreview, handoffReference } from "../lib/agent/handoff";

const reason = v.union(...HANDOFF_REASONS.map((r) => v.literal(r)));
const MAX_REQUESTS_PER_DAY = 5;

/** The answer the button sits under, checked to belong to the signed-in customer, and the messages to share. */
async function answerAndPreview(ctx: QueryCtx, messageId: Id<"ragMessages">) {
  const message = await ctx.db.get(messageId);
  if (!message) throw new ConvexError("conversation_unavailable");
  const thread = await requireAgentThread(ctx, message.threadId);
  if (message.role !== "assistant" || message.status === "streaming") throw new ConvexError("request_unavailable");
  const rows = await ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).order("desc").take(40);
  const customer = rows.filter((m) => m.role === "user" && m._creationTime < message._creationTime)
    .slice(0, HANDOFF_PREVIEW_MESSAGES).reverse().map((m) => m.text);
  return { message, thread, preview: handoffPreview(customer) };
}

/** What the adviser would receive for this answer, and the request if the customer already sent it. */
export const forMessage = query({
  args: { messageId: v.id("ragMessages") },
  handler: async (ctx, { messageId }) => {
    const { preview } = await answerAndPreview(ctx, messageId);
    const sent = await ctx.db.query("handoffRequests").withIndex("by_message", (q) => q.eq("messageId", messageId)).first();
    return { preview, request: sent ? { reference: sent.reference, status: sent.status, createdAt: sent.createdAt } : null };
  },
});

/**
 * Records the customer's request for an adviser. Only the customer can start it, and only after seeing the preview;
 * the status stays "requested", because no adviser queue is connected yet. Repeating it returns the same request.
 */
export const request = mutation({
  args: { messageId: v.id("ragMessages"), reason },
  handler: async (ctx, { messageId, reason }) => {
    const { thread, preview } = await answerAndPreview(ctx, messageId);
    const existing = await ctx.db.query("handoffRequests").withIndex("by_message", (q) => q.eq("messageId", messageId)).first();
    if (existing) return { reference: existing.reference, status: existing.status, createdAt: existing.createdAt };
    if (!preview.length) throw new ConvexError("nothing_to_share");
    const now = Date.now();
    const recent = await ctx.db.query("handoffRequests")
      .withIndex("by_owner", (q) => q.eq("ownerKey", thread.ownerKey!).gte("createdAt", now - 24 * 60 * 60 * 1000)).take(MAX_REQUESTS_PER_DAY);
    if (recent.length >= MAX_REQUESTS_PER_DAY) throw new ConvexError("handoff_limit_reached");
    const sent = { reference: handoffReference(Math.random), status: "requested" as const, createdAt: now };
    await ctx.db.insert("handoffRequests", { ownerKey: thread.ownerKey!, track: thread.track, organizationKey: thread.organizationKey ?? null,
      threadId: thread._id, messageId, reason, summary: preview, ...sent });
    return sent;
  },
});

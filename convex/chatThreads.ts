import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAgentScope, requireAgentThread } from "./agentAuth";
import { MAX_PINS, pinInputSchema, pinnableKinds, threadTitleSchema } from "../lib/agent/chat-pins";

/*
 * The customer's own edits to their chats: renaming one, and pinning answer cards to the Context panel. Every call
 * checks identity first and works only on threads that identity owns (convex/agentAuth.ts).
 */

const trackArg = v.union(v.literal("personal"), v.literal("business"));

export const rename = mutation({
  args: { threadId: v.id("ragThreads"), title: v.string() },
  handler: async (ctx, { threadId, title }) => {
    await requireAgentThread(ctx, threadId);
    const parsed = threadTitleSchema.safeParse(title);
    if (!parsed.success) throw new ConvexError("title_invalid");
    await ctx.db.patch(threadId, { title: parsed.data });
    return { title: parsed.data };
  },
});

const pinView = v.object({
  id: v.id("chatPins"), threadId: v.id("ragThreads"), messageId: v.id("ragMessages"),
  kind: v.string(), title: v.string(), meta: v.string(), createdAt: v.number(),
});

/** The customer's pins on this track, newest first. Pins whose chat is gone are left out. */
export const listPins = query({
  args: { track: trackArg }, returns: v.array(pinView),
  handler: async (ctx, { track }) => {
    const scope = await requireAgentScope(ctx, track);
    const pins = await ctx.db.query("chatPins")
      .withIndex("by_owner_scope", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey))
      .order("desc").take(MAX_PINS);
    const live = await Promise.all(pins.map(async (p) => (await ctx.db.get(p.threadId)) ? p : null));
    return live.flatMap((p) => p ? [{ id: p._id, threadId: p.threadId, messageId: p.messageId, kind: p.kind, title: p.title, meta: p.meta, createdAt: p.createdAt }] : []);
  },
});

/** Pins one answer's card. The answer must belong to the customer and carry a card of that kind; pinning twice is a no-op. */
export const pin = mutation({
  args: { messageId: v.id("ragMessages"), kind: v.string(), title: v.string(), meta: v.string() },
  handler: async (ctx, { messageId, ...input }) => {
    // Authenticate before looking up a supplied ID
    if (!await ctx.auth.getUserIdentity()) throw new ConvexError("authentication_required");
    const message = await ctx.db.get(messageId);
    if (!message) throw new ConvexError("pin_unavailable");
    const thread = await requireAgentThread(ctx, message.threadId);
    const parsed = pinInputSchema.safeParse(input);
    if (!parsed.success) throw new ConvexError("pin_invalid");
    const blocks: unknown[] = Array.isArray(message.answer?.ui?.blocks) ? message.answer.ui.blocks : [];
    if (message.role !== "assistant" || !pinnableKinds(blocks).includes(parsed.data.kind)) throw new ConvexError("pin_unavailable");
    const existing = await ctx.db.query("chatPins").withIndex("by_message", (q) => q.eq("messageId", messageId)).first();
    if (existing) return { id: existing._id };
    const scope = { ownerKey: thread.ownerKey!, track: thread.track, organizationKey: thread.organizationKey ?? null };
    const count = (await ctx.db.query("chatPins").withIndex("by_owner_scope", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey)).take(MAX_PINS)).length;
    if (count >= MAX_PINS) throw new ConvexError("pin_limit");
    const id = await ctx.db.insert("chatPins", { ...scope, threadId: thread._id, messageId, ...parsed.data, createdAt: Date.now() });
    return { id };
  },
});

export const unpin = mutation({
  args: { pinId: v.id("chatPins") },
  handler: async (ctx, { pinId }) => {
    if (!await ctx.auth.getUserIdentity()) throw new ConvexError("authentication_required");
    const row = await ctx.db.get(pinId);
    if (!row) return { removed: false };
    const scope = await requireAgentScope(ctx, row.track);
    if (row.ownerKey !== scope.ownerKey || row.organizationKey !== scope.organizationKey) throw new ConvexError("pin_unavailable");
    await ctx.db.delete(pinId);
    return { removed: true };
  },
});

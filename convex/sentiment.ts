import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAgentThread } from "./agentAuth";
import { requireRole } from "./roles";
import { MESSAGE_RETENTION_DAYS, retentionExpiry } from "../lib/agent/memory-store";
import { ABOUT_LABELS, FEEDBACK_REASONS, SENTIMENT_LABELS, summarizeSentiment, type SentimentEvent } from "../lib/analytics/sentiment";
import { analyticsMinGroup } from "./analyticsConfig";

/*
 * Chat sentiment (lib/analytics/sentiment.ts). Jev labels every customer message; the run records the labels here,
 * with pseudonymous keys and what Raiffy's previous answer was. Thumbs on answers land in answerFeedback. Only admins
 * read it, and only as aggregates: a single chat is looked at through Reviews.
 */


/** A one-way key: the same customer or thread always gives the same key, and the key never gives the identity back. */
export async function pseudonym(kind: "customer" | "conversation", value: string): Promise<string> {
  const salt = process.env.ANALYTICS_KEY_SALT ?? "";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`raiffy-analytics:${kind}:${salt}:${value}`)));
  return [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function keysOf(thread: Doc<"ragThreads">) {
  return { conversationKey: await pseudonym("conversation", thread._id), customerKey: await pseudonym("customer", thread.ownerKey ?? thread._id) };
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** What Raiffy's previous answer was when the customer wrote, from the stored messages. Reads text only to compare it. */
export async function afterOf(ctx: MutationCtx, source: Doc<"ragMessages">): Promise<SentimentEvent["after"]> {
  const earlier = (await ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", source.threadId)).collect())
    .filter((m) => m._creationTime < source._creationTime);
  const question = normalize(source.text);
  if (question.length >= 12 && earlier.some((m) => m.role === "user" && normalize(m.text) === question)) return "repeat";
  const previous = earlier.filter((m) => m.role === "assistant").at(-1);
  if (!previous) return "first";
  if (previous.status === "stopped") return "stopped";
  if (previous.status === "failed") return "failed";
  const answer = previous.answer as { status?: string; routing?: { handler?: string } } | undefined;
  if (answer?.routing?.handler === "clarify") return "menu";
  if (answer?.status && answer.status !== "answered") return "unavailable";
  return "answered";
}

export const record = internalMutation({
  args: {
    messageId: v.id("ragMessages"),
    inquiry: v.string(),
    sentiment: v.union(...SENTIMENT_LABELS.map((x) => v.literal(x))),
    about: v.union(...ABOUT_LABELS.map((x) => v.literal(x))),
    confidence: v.number(),
  },
  handler: async (ctx, { messageId, ...labels }) => {
    const message = await ctx.db.get(messageId);
    const source = message?.requestMessageId ? await ctx.db.get(message.requestMessageId) : null;
    const thread = source ? await ctx.db.get(source.threadId) : null;
    if (!source || !thread) return null;
    const now = Date.now();
    await ctx.db.insert("sentimentEvents", {
      ...await keysOf(thread), at: new Date(now).toISOString(), track: thread.track, entry: "web",
      ...labels, after: await afterOf(ctx, source), expiresAt: retentionExpiry(now, MESSAGE_RETENTION_DAYS),
    });
    return null;
  },
});

/** A thumbs up or down on an answer the caller can see, with an optional reason for a thumbs down. */
export const rate = mutation({
  args: { messageId: v.id("ragMessages"), vote: v.union(v.literal("up"), v.literal("down")), reason: v.optional(v.union(...FEEDBACK_REASONS.map((x) => v.literal(x)))) },
  handler: async (ctx, { messageId, vote, reason }) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.role !== "assistant" || message.status !== "done") throw new ConvexError("message_unavailable");
    const thread = await requireAgentThread(ctx, message.threadId);
    const now = Date.now();
    await ctx.db.insert("answerFeedback", {
      ...await keysOf(thread), at: new Date(now).toISOString(), track: thread.track, entry: "web",
      answerKey: await pseudonym("conversation", messageId), vote, reason: vote === "down" ? reason : undefined,
      expiresAt: retentionExpiry(now, MESSAGE_RETENTION_DAYS),
    });
    return null;
  },
});

/** Aggregates for the Console's Sentiment page. Admins only; groups under the minimum come back as null. */
export const summary = query({
  args: {
    from: v.string(), to: v.string(),
    track: v.optional(v.union(v.literal("personal"), v.literal("business"))),
    entry: v.optional(v.union(v.literal("web"), v.literal("smartMobile"))),
    minCount: v.optional(v.number()),
  },
  handler: async (ctx, { minCount, ...filter }) => {
    await requireRole(ctx, "admin");
    const range = (q: { gte: (f: "at", x: string) => { lt: (f: "at", x: string) => unknown } }) => q.gte("at", filter.from).lt("at", `${filter.to}￿`);
    const now = Date.now();
    const [events, feedback] = await Promise.all([
      ctx.db.query("sentimentEvents").withIndex("by_at", range as never).take(20_000),
      ctx.db.query("answerFeedback").withIndex("by_at", range as never).take(20_000),
    ]);
    const live = <T extends { expiresAt: number }>(rows: T[]) => rows.filter((r) => r.expiresAt > now).map(({ expiresAt: _e, ...r }) => r);
    // The Console's `analytics-min` (docs/shared/console.md → Analytics): a request may raise it, never lower it.
    const min = analyticsMinGroup();
    return { ...summarizeSentiment(live(events) as never, live(feedback) as never, { ...filter, minCount: Math.max(min, Math.floor(minCount ?? min)) }), minCount: min };
  },
});

/** Removes labels past their conversation's retention. */
export const removeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const table of ["sentimentEvents", "answerFeedback"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_expires", (q) => q.lt("expiresAt", now)).take(500);
      for (const r of rows) await ctx.db.delete(r._id as Id<typeof table>);
    }
    return null;
  },
});

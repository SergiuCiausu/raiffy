import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireRole } from "./roles";
import { keysOf } from "./sentiment";
import { MESSAGE_RETENTION_DAYS, retentionExpiry } from "../lib/agent/memory-store";
import { analyticsMinGroup } from "./analyticsConfig";
import { summarize } from "../lib/analytics/summarize";
import { traceFields } from "../lib/analytics/trace";

/*
 * Answer traces for the Console's Analytics page (lib/analytics). The run records one row per delivered answer with
 * pseudonymous keys; only admins read them, and only as aggregates with small groups hidden. Outcome events (offers,
 * applications, contracts, reminders) aren't connected yet, so those sections stay empty.
 */

const status = v.union(v.literal("answered"), v.literal("no_results"), v.literal("refused"), v.literal("failed_checks"));

export const record = internalMutation({
  args: {
    messageId: v.id("ragMessages"),
    inquiry: v.union(v.string(), v.null()),
    handler: v.string(),
    status,
    attempts: v.number(),
    tools: v.array(v.object({ name: v.string(), kinds: v.optional(v.array(v.string())) })),
  },
  handler: async (ctx, { messageId, ...input }) => {
    const message = await ctx.db.get(messageId);
    const thread = message ? await ctx.db.get(message.threadId) : null;
    if (!message || !thread || message.status !== "done") return null;
    const now = Date.now();
    await ctx.db.insert("answerTraces", {
      ...await keysOf(thread), at: new Date(now).toISOString(), track: thread.track, entry: "web",
      ...traceFields(input), expiresAt: retentionExpiry(now, MESSAGE_RETENTION_DAYS),
    });
    return null;
  },
});

/** Aggregates for the Analytics page. Admins only; a request may raise the minimum group size, never lower it. */
export const summary = query({
  args: {
    from: v.string(), to: v.string(),
    track: v.optional(v.union(v.literal("personal"), v.literal("business"))),
    entry: v.optional(v.union(v.literal("web"), v.literal("smartMobile"))),
    minCount: v.optional(v.number()),
  },
  handler: async (ctx, { minCount, ...filter }) => {
    await requireRole(ctx, "admin");
    const now = Date.now();
    const rows = await ctx.db.query("answerTraces").withIndex("by_at", (q) => q.gte("at", filter.from).lt("at", `${filter.to}￿`)).take(50_000);
    const answers = rows.filter((r) => r.expiresAt > now).map(({ _id, _creationTime, expiresAt, ...a }) => a);
    const min = analyticsMinGroup();
    return { ...summarize(answers, [], { ...filter, minCount: Math.max(min, Math.floor(minCount ?? min)) }), minCount: min };
  },
});

/** Removes traces past their conversation's retention. */
export const removeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("answerTraces").withIndex("by_expires", (q) => q.lt("expiresAt", Date.now())).take(500);
    for (const r of rows) await ctx.db.delete(r._id);
    return null;
  },
});

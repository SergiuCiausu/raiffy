import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { requireMemoryScope } from "./memoryAuth";
import { memoryTrack } from "./memoryValidators";
import { classifierInputSchema } from "../lib/agent/jev";
import { sameMemoryScope, screenMemorySource } from "../lib/agent/memory-store";
import { jevTransportResultSchema, type JevTransportResult } from "../lib/agent/jev-transport";
import { requestJev } from "./jevTransport";

/** Reads only dev-demo provenance until the real auth/PII conversation adapter is accepted. */
export const classifierInput = internalQuery({
  args: { track: memoryTrack, sourceMessageId: v.id("messages") },
  returns: v.object({ message: v.string(), recentContext: v.string() }),
  handler: async (ctx, args) => {
    const scope = await requireMemoryScope(ctx, args.track);
    const source = await ctx.db.get(args.sourceMessageId);
    if (!source || !sameMemoryScope(scope, source) || source.expiresAt <= Date.now()) throw new ConvexError("source_unavailable");
    const conversation = await ctx.db.get(source.conversationId);
    if (!conversation || !sameMemoryScope(scope, conversation) || conversation.expiresAt <= Date.now()) throw new ConvexError("source_unavailable");
    if (!source.memoryEligible || !screenMemorySource(source.maskedText).memoryEligible) throw new ConvexError("privacy_screening_required");
    const recent = await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", source.conversationId)).order("desc").take(10);
    const context = recent.filter((m) => m._id !== source._id && m.createdAt <= source.createdAt && m._creationTime < source._creationTime
      && m.expiresAt > Date.now() && sameMemoryScope(scope, m) && m.memoryEligible && screenMemorySource(m.maskedText).memoryEligible)
      .reverse().map((m) => m.maskedText).join("\n").slice(-2000);
    return classifierInputSchema.parse({ message: source.maskedText, recentContext: context });
  },
});

export const classify = internalAction({
  args: { track: memoryTrack, sourceMessageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, args): Promise<JevTransportResult> => {
    await requireMemoryScope(ctx, args.track);
    if (process.env.RAIFFY_JEV_ENABLED !== "true") return jevTransportResultSchema.parse({ status: "unavailable", reason: "disabled" });
    let input;
    try { input = await ctx.runQuery(internal.jev.classifierInput, args); }
    catch (error) {
      const reason = error instanceof Error && error.message.includes("privacy_screening_required") ? "privacy_screening_required" : "source_unavailable";
      return jevTransportResultSchema.parse({ status: "unavailable", reason });
    }
    return jevTransportResultSchema.parse(await requestJev(input, { enabled: true, apiKey: process.env.TYPESAFE_API_KEY }));
  },
});

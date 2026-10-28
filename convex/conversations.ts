import { z } from "zod";
import { v, ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireMemoryScope } from "./memoryAuth";
import { memoryTrack } from "./memoryValidators";
import { MESSAGE_RETENTION_DAYS, recordedMemorySourceSchema, retentionExpiry, sameMemoryScope, screenMemorySource } from "../lib/agent/memory-store";

/** Minimal memory provenance, not a general transcript API. Only the trusted pipeline can call it. */
export const recordCustomerMessage = internalMutation({
  args: { track: memoryTrack, text: v.string(), conversationId: v.optional(v.id("conversations")) },
  returns: v.object({ conversationId: v.id("conversations"), messageId: v.id("messages"), memoryEligible: v.boolean() }),
  handler: async (ctx, args) => {
    const scope = await requireMemoryScope(ctx, args.track, true);
    const input = z.object({ track: z.enum(["personal", "business"]), text: z.string().trim().min(1).max(4000), conversationId: z.string().optional() }).strict().parse(args);
    const now = Date.now();
    const expiresAt = retentionExpiry(now, MESSAGE_RETENTION_DAYS);
    let conversationId = args.conversationId;
    if (conversationId) {
      const conversation = await ctx.db.get(conversationId);
      if (!conversation || !sameMemoryScope(scope, conversation) || conversation.expiresAt <= now) throw new ConvexError("conversation_unavailable");
      await ctx.db.patch(conversationId, { expiresAt });
    } else {
      conversationId = await ctx.db.insert("conversations", { ...scope, createdAt: now, expiresAt });
    }
    const screened = screenMemorySource(input.text);
    const messageId = await ctx.db.insert("messages", { ...scope, conversationId, role: "customer", ...screened, createdAt: now, expiresAt });
    recordedMemorySourceSchema.parse({ conversationId, messageId, memoryEligible: screened.memoryEligible });
    return { conversationId, messageId, memoryEligible: screened.memoryEligible };
  },
});

import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { requireMemoryScope } from "./memoryAuth";
import { DEMO_MEMORY_OWNER } from "../lib/agent/memory-store";

/** Fixed synthetic fixture, admin-only. No real customer data or model calls. */
export const proposeFixture = internalAction({
  args: {}, returns: v.object({ proposalId: v.string(), messageId: v.string(), conversationId: v.string() }),
  handler: async (ctx): Promise<{ proposalId: string; messageId: string; conversationId: string }> => {
    const scope = await requireMemoryScope(ctx, "personal", true);
    if (scope.ownerKey !== DEMO_MEMORY_OWNER) throw new ConvexError("demo_only");
    const text = "I am saving for a car over the next two years.";
    const source = await ctx.runMutation(internal.conversations.recordCustomerMessage, { track: "personal", text });
    const proposal = await ctx.runMutation(internal.memory.propose, {
      track: "personal", operation: "remember", kind: "goal", text, customerQuote: text, sourceMessageId: source.messageId,
    });
    return { proposalId: proposal.id, messageId: source.messageId, conversationId: source.conversationId };
  },
});

import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Paid agent calls require a real authenticated identity, including on a demo deployment. */
export async function requireAgentScope(ctx: Pick<QueryCtx, "auth">, track: "personal" | "business") {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("authentication_required");
  const organizationKey = track === "business" && typeof identity.org_id === "string" && identity.org_id.trim()
    ? identity.org_id : null;
  if (track === "business" && !organizationKey) throw new ConvexError("organization_required");
  return { ownerKey: identity.tokenIdentifier, track, organizationKey };
}

export async function requireAgentThread(ctx: Pick<QueryCtx, "auth" | "db">, threadId: Id<"ragThreads">) {
  // Authenticate before looking up a supplied ID. Legacy unowned threads are never adopted implicitly.
  if (!await ctx.auth.getUserIdentity()) throw new ConvexError("authentication_required");
  const thread = await ctx.db.get(threadId);
  if (!thread) throw new ConvexError("conversation_unavailable");
  const scope = await requireAgentScope(ctx, thread.track);
  if (thread.ownerKey !== scope.ownerKey || thread.organizationKey !== scope.organizationKey) {
    throw new ConvexError("conversation_unavailable");
  }
  return thread;
}

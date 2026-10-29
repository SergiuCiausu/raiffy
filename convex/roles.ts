import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import type { QueryCtx } from "./_generated/server";
import { atLeast, can, parseRole, type Action, type Role } from "../lib/auth/roles";

/*
 * Role checks for public functions. The role is the "role" claim of the Clerk "convex" JWT template
 * (publicMetadata.role), verified by Convex with the token. The users table only mirrors it; never authorize from it.
 */

export type Caller = { identity: UserIdentity; role: Role; clerkUserId: string };

export async function requireUser(ctx: Pick<QueryCtx, "auth">): Promise<Caller> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("authentication_required");
  return { identity, role: parseRole(identity.role), clerkUserId: identity.subject };
}

export async function requireRole(ctx: Pick<QueryCtx, "auth">, min: Role): Promise<Caller> {
  const caller = await requireUser(ctx);
  if (!atLeast(caller.role, min)) throw new ConvexError("forbidden");
  return caller;
}

export async function requirePermission(ctx: Pick<QueryCtx, "auth">, action: Action): Promise<Caller> {
  const caller = await requireUser(ctx);
  if (!can(caller.role, action)) throw new ConvexError("forbidden");
  return caller;
}

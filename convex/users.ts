import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePermission, requireUser } from "./roles";
import { role } from "./schema";
import { writeAudit } from "./audit";

/** Skip the write when nothing changed and the user was seen recently, so every page load isn't a mutation. */
const SEEN_REFRESH_MS = 60 * 60 * 1000;

const userView = v.object({
  clerkUserId: v.string(), role, email: v.optional(v.string()), name: v.optional(v.string()),
  firstSeenAt: v.number(), lastSeenAt: v.number(),
});

/** Called by the app once signed in. Upserts the mirror row and returns the caller's role from the token. */
export const ensure = mutation({
  args: {}, returns: v.object({ role }),
  handler: async (ctx) => {
    const { identity, role: callerRole, clerkUserId } = await requireUser(ctx);
    const now = Date.now();
    const email = identity.email ?? undefined;
    const name = identity.name ?? undefined;
    const row = await ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    if (!row) {
      await ctx.db.insert("users", { clerkUserId, tokenIdentifier: identity.tokenIdentifier, role: callerRole, email, name, firstSeenAt: now, lastSeenAt: now });
    } else if (row.role !== callerRole || row.email !== email || row.name !== name || now - row.lastSeenAt > SEEN_REFRESH_MS) {
      await ctx.db.patch(row._id, { role: callerRole, email, name, lastSeenAt: now });
    }
    return { role: callerRole };
  },
});

/** The caller's own role, for showing or hiding UI. Not a substitute for checks in the functions themselves. */
export const me = query({
  args: {}, returns: v.object({ clerkUserId: v.string(), role }),
  handler: async (ctx) => {
    const { clerkUserId, role: callerRole } = await requireUser(ctx);
    return { clerkUserId, role: callerRole };
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) }, returns: v.array(userView),
  handler: async (ctx, { limit = 100 }) => {
    await requirePermission(ctx, "users.manage");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new ConvexError("user_limit_invalid");
    const rows = await ctx.db.query("users").order("desc").take(limit);
    return rows.map(({ clerkUserId, role, email, name, firstSeenAt, lastSeenAt }) => ({ clerkUserId, role, email, name, firstSeenAt, lastSeenAt }));
  },
});

/**
 * Records a role change an admin has just made in Clerk (the Next server action writes publicMetadata, then calls this).
 * Updates the mirror right away; the target's own token carries the new role within about a minute.
 */
export const recordRoleChange = mutation({
  args: { targetUserId: v.string(), from: role, to: role, note: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, { targetUserId, from, to, note }) => {
    const caller = await requirePermission(ctx, "users.manage");
    if (from === to) throw new ConvexError("role_unchanged");
    const row = await ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", targetUserId)).unique();
    if (row) await ctx.db.patch(row._id, { role: to });
    await writeAudit(ctx, caller, { action: "user.role_changed", targetUserId, details: { from, to }, note });
    return null;
  },
});

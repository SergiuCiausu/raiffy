import { ConvexError, v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { requirePermission, type Caller } from "./roles";
import { role } from "./schema";

const NOTE_MAX = 500;

/** Call from inside the mutation that performs the privileged action, so the record and the change commit together. */
export async function writeAudit(
  ctx: Pick<MutationCtx, "db">, caller: Caller,
  entry: { action: string; targetUserId?: string; details?: Record<string, string>; note?: string },
) {
  const note = entry.note?.trim() || undefined;
  if (note && note.length > NOTE_MAX) throw new ConvexError("audit_note_too_long");
  await ctx.db.insert("auditLog", { actorUserId: caller.clerkUserId, actorRole: caller.role, ...entry, note, at: Date.now() });
}

const entryView = v.object({
  actorUserId: v.string(), actorRole: role, action: v.string(), targetUserId: v.optional(v.string()),
  details: v.optional(v.record(v.string(), v.string())), note: v.optional(v.string()), at: v.number(),
});

/** Newest first, optionally for one user. */
export const list = query({
  args: { targetUserId: v.optional(v.string()), limit: v.optional(v.number()) }, returns: v.array(entryView),
  handler: async (ctx, { targetUserId, limit = 100 }) => {
    await requirePermission(ctx, "audit.read");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new ConvexError("audit_limit_invalid");
    const rows = targetUserId
      ? await ctx.db.query("auditLog").withIndex("by_target", (q) => q.eq("targetUserId", targetUserId)).order("desc").take(limit)
      : await ctx.db.query("auditLog").withIndex("by_at").order("desc").take(limit);
    return rows.map(({ _id, _creationTime, ...entry }) => entry);
  },
});

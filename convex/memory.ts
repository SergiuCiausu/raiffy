import { z } from "zod";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireMemoryScope } from "./memoryAuth";
import { memoryChangeResult, memoryKind, memoryTrack, memoryView, proposalView } from "./memoryValidators";
import { memoryRecordSchema } from "../lib/agent/memory";
import {
  memoryChangeResultSchema, memoryDeleteResultSchema, memoryListSchema, sameMemoryScope, verifyMemoryEvidence,
  type MemoryScope,
} from "../lib/agent/memory-store";

const MAX_MEMORIES = 100;
const BATCH_SIZE = 100;

function unavailable(): never { throw new ConvexError("memory_unavailable"); }
async function sourceFor(ctx: MutationCtx, scope: MemoryScope, id: Id<"messages">, now: number) {
  const source = await ctx.db.get(id);
  if (!source || !sameMemoryScope(scope, source) || source.role !== "customer") unavailable();
  const conversation = await ctx.db.get(source.conversationId);
  if (!conversation || !sameMemoryScope(scope, conversation) || conversation.expiresAt <= now) unavailable();
  return source;
}
function evidence(proposal: Doc<"memoryProposals">, source: Doc<"messages">, now: number) {
  return verifyMemoryEvidence({
    proposal: { operation: proposal.operation, kind: proposal.kind, text: proposal.text, sourceMessageId: proposal.sourceMessageId,
      customerQuote: proposal.customerQuote, ...(proposal.replacesMemoryId ? { replacesMemoryId: proposal.replacesMemoryId } : {}) },
    source: { maskedText: source.maskedText, memoryEligible: source.memoryEligible, createdAt: source.createdAt, expiresAt: source.expiresAt }, now,
  });
}
async function revokeSource(ctx: MutationCtx, id: Id<"messages">, scope: MemoryScope) {
  const source = await ctx.db.get(id);
  if (source && sameMemoryScope(scope, source)) await ctx.db.patch(id, { memoryEligible: false });
}
/** No embeddings or private caches exist yet. Attach their deletion here before adding either. */
async function deleteMemory(ctx: MutationCtx, row: Doc<"userMemories">, preserveProposalId?: Id<"memoryProposals">) {
  await revokeSource(ctx, row.sourceMessageId, row);
  for (const proposal of await ctx.db.query("memoryProposals").withIndex("by_memory", (q) => q.eq("memoryId", row._id)).collect()) await ctx.db.delete(proposal._id);
  for (const proposal of await ctx.db.query("memoryProposals").withIndex("by_replacement", (q) => q.eq("replacesMemoryId", row._id)).collect()) {
    if (proposal._id !== preserveProposalId) await ctx.db.delete(proposal._id);
  }
  await ctx.db.delete(row._id);
}

export const propose = internalMutation({
  args: {
    track: memoryTrack, operation: v.union(v.literal("remember"), v.literal("update")), kind: memoryKind,
    text: v.string(), sourceMessageId: v.id("messages"), customerQuote: v.string(), replacesMemoryId: v.optional(v.id("userMemories")),
  },
  returns: memoryChangeResult,
  handler: async (ctx, { track, ...proposal }) => {
    const scope = await requireMemoryScope(ctx, track, true);
    const now = Date.now();
    const source = await sourceFor(ctx, scope, proposal.sourceMessageId, now);
    const checked = verifyMemoryEvidence({ proposal, source: { maskedText: source.maskedText, memoryEligible: source.memoryEligible, createdAt: source.createdAt, expiresAt: source.expiresAt }, now });
    let replacesUpdatedAt: number | undefined;
    if (proposal.replacesMemoryId) {
      const previous = await ctx.db.get(proposal.replacesMemoryId);
      if (!previous || !sameMemoryScope(scope, previous) || previous.status !== "active" || previous.expiresAt <= now) unavailable();
      replacesUpdatedAt = previous.updatedAt;
    }
    const pending = await ctx.db.query("memoryProposals").withIndex("by_scope_status", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey).eq("status", "pending")).take(MAX_MEMORIES);
    const duplicate = pending.find((p) => p.expiresAt > now && p.sourceMessageId === proposal.sourceMessageId && p.kind === proposal.kind
      && p.text === proposal.text && p.operation === proposal.operation && p.replacesMemoryId === proposal.replacesMemoryId);
    if (duplicate) return memoryChangeResultSchema.parse({ status: "proposed", id: duplicate._id });
    // Reject replay of a confirmed source, rather than renewing a dated claim.
    const existing = await ctx.db.query("memoryProposals").withIndex("by_source", (q) => q.eq("sourceMessageId", source._id)).take(MAX_MEMORIES);
    if (existing.some((p) => p.status === "confirmed" && p.kind === proposal.kind && p.text === proposal.text)) throw new ConvexError("memory_already_saved");
    if (pending.length >= MAX_MEMORIES) throw new ConvexError("memory_limit_reached");
    const id = await ctx.db.insert("memoryProposals", {
      ...scope, ...checked.proposal, operation: proposal.operation, sourceMessageId: proposal.sourceMessageId,
      replacesMemoryId: proposal.replacesMemoryId, replacesUpdatedAt, status: "pending", createdAt: now, expiresAt: checked.proposalExpiresAt,
    });
    return memoryChangeResultSchema.parse({ status: "proposed", id });
  },
});

export const confirm = mutation({
  args: { track: memoryTrack, proposalId: v.id("memoryProposals") }, returns: memoryChangeResult,
  handler: async (ctx, args) => {
    const scope = await requireMemoryScope(ctx, args.track, true);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || !sameMemoryScope(scope, proposal) || proposal.expiresAt <= Date.now()) unavailable();
    const now = Date.now();
    if (proposal.status === "confirmed") {
      const saved = proposal.memoryId ? await ctx.db.get(proposal.memoryId) : null;
      if (!saved || !sameMemoryScope(scope, saved) || saved.expiresAt <= now || saved.status !== "active") unavailable();
      return memoryChangeResultSchema.parse({ status: "saved", id: saved._id });
    }
    const source = await sourceFor(ctx, scope, proposal.sourceMessageId, now);
    const checked = evidence(proposal, source, now);
    if (proposal.replacesMemoryId) {
      const previous = await ctx.db.get(proposal.replacesMemoryId);
      if (!previous || !sameMemoryScope(scope, previous) || previous.status !== "active" || previous.expiresAt <= now || previous.updatedAt !== proposal.replacesUpdatedAt) unavailable();
      // Deletion also clears other pending updates based on the old version.
      await deleteMemory(ctx, previous, proposal._id);
    } else {
      const active = await ctx.db.query("userMemories").withIndex("by_scope_status", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey).eq("status", "active")).take(MAX_MEMORIES);
      if (active.length >= MAX_MEMORIES) throw new ConvexError("memory_limit_reached");
    }
    const saved = {
      ...scope, kind: proposal.kind, text: proposal.text, sourceMessageId: proposal.sourceMessageId, consentEventId: proposal._id,
      status: "active" as const, statedAt: source.createdAt, updatedAt: now, expiresAt: checked.expiresAt,
    };
    const { statedAt: _statedAt, ...record } = saved;
    memoryRecordSchema.parse({ ...record, id: "pending" });
    const id = await ctx.db.insert("userMemories", saved);
    await ctx.db.patch(proposal._id, { status: "confirmed", confirmedAt: now, memoryId: id, expiresAt: checked.expiresAt });
    return memoryChangeResultSchema.parse({ status: "saved", id });
  },
});

export const reject = mutation({
  args: { track: memoryTrack, proposalId: v.id("memoryProposals") }, returns: memoryChangeResult,
  handler: async (ctx, args) => {
    const scope = await requireMemoryScope(ctx, args.track);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || !sameMemoryScope(scope, proposal) || proposal.status !== "pending") unavailable();
    await revokeSource(ctx, proposal.sourceMessageId, scope);
    await ctx.db.delete(proposal._id);
    return memoryChangeResultSchema.parse({ status: "rejected", id: args.proposalId });
  },
});

export const listMine = query({
  args: { track: memoryTrack }, returns: v.object({ memories: v.array(memoryView), proposals: v.array(proposalView) }),
  handler: async (ctx, { track }) => {
    const scope = await requireMemoryScope(ctx, track);
    const now = Date.now();
    const memories = await ctx.db.query("userMemories").withIndex("by_scope_status", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey).eq("status", "active")).collect();
    const proposals = await ctx.db.query("memoryProposals").withIndex("by_scope_status", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey).eq("status", "pending")).collect();
    return memoryListSchema.parse({
      memories: memories.filter((m) => m.expiresAt > now && m.updatedAt <= now && m.statedAt <= now)
        .map((m) => ({ id: m._id, kind: m.kind, text: m.text, statedAt: m.statedAt, updatedAt: m.updatedAt, expiresAt: m.expiresAt })),
      proposals: proposals.filter((p) => p.expiresAt > now && p.createdAt <= now)
        .map((p) => ({ id: p._id, operation: p.operation, kind: p.kind, text: p.text, customerQuote: p.customerQuote, createdAt: p.createdAt, expiresAt: p.expiresAt })),
    });
  },
});

export const forgetOne = mutation({
  args: { track: memoryTrack, memoryId: v.id("userMemories") }, returns: memoryChangeResult,
  handler: async (ctx, args) => {
    const scope = await requireMemoryScope(ctx, args.track);
    const row = await ctx.db.get(args.memoryId);
    if (!row || !sameMemoryScope(scope, row)) unavailable();
    await deleteMemory(ctx, row);
    return memoryChangeResultSchema.parse({ status: "forgotten", id: args.memoryId });
  },
});

export const forgetAll = mutation({
  args: { track: memoryTrack }, returns: v.object({ memoriesDeleted: v.number(), proposalsDeleted: v.number() }),
  handler: async (ctx, { track }) => {
    const scope = await requireMemoryScope(ctx, track);
    const memories = await ctx.db.query("userMemories").withIndex("by_scope_status", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey)).collect();
    const proposals = await ctx.db.query("memoryProposals").withIndex("by_scope_status", (q) => q.eq("ownerKey", scope.ownerKey).eq("track", scope.track).eq("organizationKey", scope.organizationKey)).collect();
    for (const proposal of proposals) { await revokeSource(ctx, proposal.sourceMessageId, scope); await ctx.db.delete(proposal._id); }
    for (const memory of memories) { await revokeSource(ctx, memory.sourceMessageId, scope); await ctx.db.delete(memory._id); }
    return memoryDeleteResultSchema.parse({ memoriesDeleted: memories.length, proposalsDeleted: proposals.length });
  },
});

/** Deployment-owned housekeeping, intentionally has no caller/owner argument. Runs even when writes are off. */
export const removeExpired = internalMutation({
  args: {}, returns: v.object({ removed: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now(); let removed = 0; let more = false;
    const memories = await ctx.db.query("userMemories").withIndex("by_expiry", (q) => q.lte("expiresAt", now)).take(BATCH_SIZE);
    for (const row of memories) { await deleteMemory(ctx, row); removed++; }
    const proposals = await ctx.db.query("memoryProposals").withIndex("by_expiry", (q) => q.lte("expiresAt", now)).take(BATCH_SIZE);
    for (const row of proposals) { await revokeSource(ctx, row.sourceMessageId, row); await ctx.db.delete(row._id); removed++; }
    const messages = await ctx.db.query("messages").withIndex("by_expiry", (q) => q.lte("expiresAt", now)).take(BATCH_SIZE);
    for (const row of messages) { await ctx.db.delete(row._id); removed++; }
    const conversations = await ctx.db.query("conversations").withIndex("by_expiry", (q) => q.lte("expiresAt", now)).take(BATCH_SIZE);
    for (const row of conversations) { await ctx.db.delete(row._id); removed++; }
    more = [memories, proposals, messages, conversations].some((rows) => rows.length === BATCH_SIZE);
    if (more) await ctx.scheduler.runAfter(0, internal.memory.removeExpired, {});
    return z.object({ removed: z.number().int().nonnegative(), more: z.boolean() }).strict().parse({ removed, more });
  },
});

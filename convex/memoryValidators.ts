import { v } from "convex/values";

export const memoryTrack = v.union(v.literal("personal"), v.literal("business"));
export const memoryKind = v.union(v.literal("goal"), v.literal("preference"), v.literal("constraint"), v.literal("stated_financial"));
export const memoryScopeFields = { ownerKey: v.string(), track: memoryTrack, organizationKey: v.union(v.string(), v.null()) };
export const memoryView = v.object({ id: v.string(), kind: memoryKind, text: v.string(), statedAt: v.number(), updatedAt: v.number(), expiresAt: v.number() });
export const proposalView = v.object({ id: v.string(), operation: v.union(v.literal("remember"), v.literal("update")), kind: memoryKind, text: v.string(), customerQuote: v.string(), createdAt: v.number(), expiresAt: v.number() });
export const memoryChangeResult = v.object({ status: v.union(v.literal("proposed"), v.literal("saved"), v.literal("rejected"), v.literal("forgotten")), id: v.string() });

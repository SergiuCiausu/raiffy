import { makeFunctionReference } from "convex/server";
import type { Role } from "@/lib/roles";

/* Typed references to ../convex/users.ts, mirrored for the same reason as agent-api.ts. Keep them in step. */
export type AuditEntry = {
  actorUserId: string; actorRole: Role; action: string; targetUserId?: string;
  details?: Record<string, string>; note?: string; at: number;
};

export const auditApi = {
  list: makeFunctionReference<"query", { targetUserId?: string; limit?: number }, AuditEntry[]>("audit:list"),
};

export const usersApi = {
  ensure: makeFunctionReference<"mutation", Record<string, never>, { role: Role }>("users:ensure"),
  recordRoleChange: makeFunctionReference<"mutation", { targetUserId: string; from: Role; to: Role; note?: string }, null>("users:recordRoleChange"),
};

/* Sample customers for testers (../convex/accounts.ts): admins assign one per user; the assignment is audited. */
export type SampleAssignments = {
  users: { clerkUserId: string; assigned: string | null; inUse: string | null; assignedAt: number | null }[];
  personas: { id: string; label: string; summary: string }[];
};

export const sampleApi = {
  assignments: makeFunctionReference<"query", Record<string, never>, SampleAssignments>("accounts:assignments"),
  assignSample: makeFunctionReference<"mutation", { targetUserId: string; persona: string | null; note?: string }, null>("accounts:assignSample"),
};

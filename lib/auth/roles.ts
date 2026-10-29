import { z } from "zod";

/*
 * App roles and what each may do. The role comes from Clerk publicMetadata.role, carried as a claim in the
 * "convex" JWT template and the session token. Pure: callers pass the raw claim in; nothing here reads a token.
 * Permissions follow raiffy-spec/docs/shared/console.md → Roles and approval.
 */

export const roleSchema = z.enum(["member", "operator", "admin"]);
export type Role = z.infer<typeof roleSchema>;

const RANK: Record<Role, number> = { member: 0, operator: 1, admin: 2 };

/** Missing, misspelled or tampered values fall back to the least privileged role. Matching is exact. */
export function parseRole(value: unknown): Role {
  const parsed = roleSchema.safeParse(value);
  return parsed.success ? parsed.data : "member";
}

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export const actionSchema = z.enum([
  "chat.use",             // own chats and memories
  "hardLimits.read",      // behavior rules in code, read-only for everyone in the console
  "catalog.read",         // products, their values and review dates, read-only
  "review.answer",        // confirm or edit a customer answer from the review queue
  "change.propose",       // products, pricing rules, parameters, knowledge, prompts, regulations
  "change.publish",       // publish without a second approval
  "change.approve",       // approve or reject an operator's proposal
  "eval.decide",          // accept or reject draft eval cases
  "counterOffer.decide",  // only up to the role's approval level, see canApproveAt
  "users.manage",         // users and roles, through Clerk
  "audit.read",
]);
export type Action = z.infer<typeof actionSchema>;

const MIN_ROLE: Record<Action, Role> = {
  "chat.use": "member",
  "hardLimits.read": "operator",
  "catalog.read": "operator",
  "review.answer": "operator",
  "change.propose": "operator",
  "change.publish": "admin",
  "change.approve": "admin",
  "eval.decide": "admin",
  "counterOffer.decide": "operator",
  "users.manage": "admin",
  "audit.read": "admin",
};

export function can(role: Role, action: Action): boolean {
  return atLeast(role, MIN_ROLE[action]);
}

/** An operator's change waits for an admin; an admin's change is published directly. */
export function changeOutcome(role: Role): "pending_approval" | "published" | null {
  if (!can(role, "change.propose")) return null;
  return can(role, "change.publish") ? "published" : "pending_approval";
}

/* Escalated counter-offers: the bank's approval levels, lowest first (docs/shared/pricing.md) */
export const approvalLevelSchema = z.enum(["specialist", "branchManager", "pricingCommittee"]);
export type ApprovalLevel = z.infer<typeof approvalLevelSchema>;

const LEVEL_RANK: Record<ApprovalLevel, number> = { specialist: 0, branchManager: 1, pricingCommittee: 2 };
const MAX_LEVEL: Record<Role, ApprovalLevel | null> = { member: null, operator: "specialist", admin: "pricingCommittee" };

/** In the POC operators decide at the specialist level and admins at any level. */
export function canApproveAt(role: Role, level: ApprovalLevel): boolean {
  const max = MAX_LEVEL[role];
  return max !== null && LEVEL_RANK[level] <= LEVEL_RANK[max];
}

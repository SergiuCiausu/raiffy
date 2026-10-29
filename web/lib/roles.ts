/*
 * Mirror of ../lib/auth/roles.ts (role names, ranking and permissions). The web app is built on its own
 * (turbopack.root is web/), so it can't import the root lib. roles.test.ts fails if the two drift apart.
 */

export const ROLES = ["member", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { member: 0, operator: 1, admin: 2 };

/** Missing, misspelled or tampered values fall back to the least privileged role. Matching is exact. */
export function parseRole(value: unknown): Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? (value as Role) : "member";
}

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export const ACTIONS = [
  "chat.use", "hardLimits.read", "catalog.read", "review.answer", "change.propose", "change.publish",
  "change.approve", "eval.decide", "counterOffer.decide", "users.manage", "audit.read",
] as const;
export type Action = (typeof ACTIONS)[number];

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

export const ROLE_LABEL: Record<Role, string> = { member: "Member", operator: "Operator", admin: "Admin" };

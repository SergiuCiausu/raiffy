import { z } from "zod";
import { ROLES, type Role } from "./roles";

/*
 * The Users and roles table saves every pending edit at once (admin.html#users). This module checks a batch before
 * anything is written: the shape, your own role, and that at least one admin remains. Each change is then applied
 * on its own by the server action, so one failure never blocks the rest.
 */

export const MAX_BATCH = 100;
export const NOTE_MAX = 500;

export const userChangeSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLES).optional(),
  /** A sample customer ID, or null to clear it */
  sample: z.string().min(1).nullable().optional(),
}).strict().refine((c) => c.role !== undefined || c.sample !== undefined, "empty_change");

export const userChangesSchema = z.object({
  changes: z.array(userChangeSchema).min(1).max(MAX_BATCH),
  note: z.string().trim().max(NOTE_MAX).optional(),
}).strict();

export type UserChange = z.infer<typeof userChangeSchema>;
export type ChangeResult = { userId: string; ok: true } | { userId: string; ok: false; error: string };

/**
 * Role changes that may go ahead. Your own role and any demotion that would leave no admin are refused, counting
 * the whole batch: two admins can't demote each other's last colleague in one save.
 */
export function checkRoleChanges(changes: UserChange[], current: Map<string, Role>, callerId: string): Map<string, string> {
  const refused = new Map<string, string>();
  let admins = [...current.values()].filter((r) => r === "admin").length;
  for (const c of changes) {
    if (c.role === undefined) continue;
    const from = current.get(c.userId);
    if (c.userId === callerId) { refused.set(c.userId, "You can’t change your own role. Ask another admin."); continue; }
    if (from === undefined) { refused.set(c.userId, "That user no longer exists."); continue; }
    if (from === "admin" && c.role !== "admin") {
      if (admins <= 1) { refused.set(c.userId, "This is the only admin left. Make someone else an admin first."); continue; }
      admins--;
    }
    if (from !== "admin" && c.role === "admin") admins++;
  }
  return refused;
}

/** How many separate changes a batch makes (a row may change its role and its sample customer). */
export const countChanges = (changes: UserChange[]) => changes.reduce((n, c) => n + (c.role !== undefined ? 1 : 0) + (c.sample !== undefined ? 1 : 0), 0);

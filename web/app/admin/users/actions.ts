"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { parseRole, type Role } from "@/lib/roles";
import { checkRoleChanges, userChangesSchema, type ChangeResult } from "@/lib/user-changes";
import { sampleApi, usersApi } from "@/lib/users-api";

export type SaveResult = { results: ChangeResult[] } | { error: string };

/*
 * Admin only. Saves the Users and roles table's pending edits in one go, with one reason for all of them. Each change
 * is applied on its own, so a failure leaves the rest saved:
 * - a role goes to Clerk publicMetadata (merged, other keys kept), then to the Convex audit log, which re-checks the
 *   caller is admin; if the audit write fails the Clerk change is rolled back, so no role change goes unrecorded;
 * - a sample customer goes to Convex accounts:assignSample, which writes its own audit entry in the same transaction.
 * The target's tokens pick up a new role within about a minute.
 */
export async function saveUserChanges(input: unknown): Promise<SaveResult> {
  const caller = await requirePermission("users.manage");
  const parsed = userChangesSchema.safeParse(input);
  if (!parsed.success) return { error: "Those changes couldn’t be read. Reload the page and try again." };
  const { changes, note } = parsed.data;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const token = await (await auth()).getToken({ template: "convex" });
  if (!url || !token) return { error: "The audit log isn’t reachable, so nothing was changed." };
  const convex = new ConvexHttpClient(url);
  convex.setAuth(token);

  const clerk = await clerkClient();
  const { data } = await clerk.users.getUserList({ limit: 500 });
  const current = new Map<string, Role>(data.map((u) => [u.id, parseRole(u.publicMetadata.role)]));
  const refused = checkRoleChanges(changes, current, caller.userId);

  const results: ChangeResult[] = [];
  for (const c of changes) {
    const error = refused.get(c.userId)
      ?? (c.role !== undefined ? await applyRole(clerk, convex, c.userId, current.get(c.userId)!, c.role, note) : null)
      ?? (c.sample !== undefined ? await applySample(convex, c.userId, c.sample, note) : null);
    results.push(error ? { userId: c.userId, ok: false, error } : { userId: c.userId, ok: true });
  }
  if (results.some((r) => r.ok)) revalidatePath("/admin/users");
  return { results };
}

type Clerk = Awaited<ReturnType<typeof clerkClient>>;

async function applyRole(clerk: Clerk, convex: ConvexHttpClient, targetUserId: string, from: Role, to: Role, note?: string): Promise<string | null> {
  if (from === to) return null;
  try {
    await clerk.users.updateUserMetadata(targetUserId, { publicMetadata: { role: to } });
  } catch {
    return "That user no longer exists.";
  }
  try {
    await convex.mutation(usersApi.recordRoleChange, { targetUserId, from, to, note });
    return null;
  } catch (error) {
    await clerk.users.updateUserMetadata(targetUserId, { publicMetadata: { role: from } });
    console.error("users:recordRoleChange failed; role change rolled back", error);
    return "The role change couldn’t be recorded, so it was undone. Try again.";
  }
}

async function applySample(convex: ConvexHttpClient, targetUserId: string, persona: string | null, note?: string): Promise<string | null> {
  try {
    await convex.mutation(sampleApi.assignSample, { targetUserId, persona, note });
    return null;
  } catch (error) {
    if (String(error).includes("user_never_signed_in")) return "They haven’t opened Raiffy yet. Assign a sample customer once they have.";
    console.error("accounts:assignSample failed", error);
    return "The sample customer didn’t save. Try again.";
  }
}

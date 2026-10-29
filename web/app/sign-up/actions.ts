"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

/*
 * Runs once a new account is signed in. Records the default "member" role if none is set yet, and copies the
 * sign-up consents from unsafeMetadata (writable by the browser) into publicMetadata (server-only) with a server
 * timestamp. updateUserMetadata merges, so other publicMetadata keys are kept.
 */
export async function recordSignUpConsents(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const update: Record<string, unknown> = {};
  if (user.publicMetadata.role === undefined) update.role = "member";
  const c = (user.unsafeMetadata as { consents?: Record<string, unknown> }).consents;
  if (!user.publicMetadata.consents && c?.terms === true) {
    update.consents = { terms: true, share: true, marketing: c.marketing === true, recordedAt: new Date().toISOString() };
  }
  if (Object.keys(update).length) await client.users.updateUserMetadata(userId, { publicMetadata: update });
}

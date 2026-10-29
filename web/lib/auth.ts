import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { atLeast, can, parseRole, type Action, type Role } from "@/lib/roles";

/*
 * Server-side role checks for pages and server actions. The role is the session token's metadata.role claim
 * (Clerk publicMetadata.role). Convex checks the same role again from its own JWT; these never replace that.
 */

export async function getCaller(): Promise<{ userId: string; role: Role } | null> {
  const { userId, sessionClaims } = await auth();
  return userId ? { userId, role: parseRole(sessionClaims?.metadata?.role) } : null;
}

/** For pages: signed-out callers go to sign-in, signed-in callers without the role go to their chat. */
export async function requirePageRole(min: Role) {
  const caller = await getCaller();
  if (!caller) redirect("/sign-in");
  if (!atLeast(caller.role, min)) redirect("/chat");
  return caller;
}

/** For server actions, which are reachable by direct POST: throw instead of redirecting. */
export async function requirePermission(action: Action) {
  const caller = await getCaller();
  if (!caller) throw new Error("authentication_required");
  if (!can(caller.role, action)) throw new Error("forbidden");
  return caller;
}

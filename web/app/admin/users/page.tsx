import type { Metadata } from "next";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { Suspense } from "react";
import "@/styles/generated/staff-admin.css";
import { UsersAndRoles, type UserRow } from "@/components/staff/UsersAndRoles";
import { requirePageRole } from "@/lib/auth";
import { parseRole } from "@/lib/roles";
import { auditApi, sampleApi, type AuditEntry, type SampleAssignments } from "@/lib/users-api";

export const metadata: Metadata = { title: "Users and roles · Raiffy" };

/* Reads the audit log as the signed-in admin; Convex checks the role again */
async function recentChanges(): Promise<AuditEntry[] | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const token = await (await auth()).getToken({ template: "convex" });
  if (!url || !token) return null;
  const convex = new ConvexHttpClient(url);
  convex.setAuth(token);
  return convex.query(auditApi.list, { limit: 20 }).catch(() => null);
}

/* Each user's assigned sample customer, read the same way */
async function sampleAssignments(): Promise<SampleAssignments | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const token = await (await auth()).getToken({ template: "convex" });
  if (!url || !token) return null;
  const convex = new ConvexHttpClient(url);
  convex.setAuth(token);
  return convex.query(sampleApi.assignments, {}).catch(() => null);
}

export default function AdminUsersPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Setup is incomplete</h1><p>Authentication must be configured first.</p></main>;
  }
  // Per-request data (the session, Clerk users, the audit log) renders inside Suspense, outside the static shell
  return (
    <Suspense fallback={<main className="agent-setup" role="status">Loading users…</main>}>
      <Users />
    </Suspense>
  );
}

/* admin.html's console shell and table, over Clerk users and the Convex audit log */
async function Users() {
  const caller = await requirePageRole("admin");
  const clerk = await clerkClient();
  const [{ data: users, totalCount }, log, samples, me] = await Promise.all([
    clerk.users.getUserList({ limit: 100, orderBy: "-created_at" }),
    recentChanges(),
    sampleAssignments(),
    currentUser(),
  ]);
  const rows: UserRow[] = users.map((u) => {
    const consents = u.publicMetadata.consents as { marketing?: boolean; recordedAt?: string } | undefined;
    return {
      id: u.id, name: u.fullName || "", email: u.primaryEmailAddress?.emailAddress ?? "", role: parseRole(u.publicMetadata.role),
      createdAt: u.createdAt, lastActiveAt: u.lastActiveAt ?? null,
      marketing: consents ? { value: consents.marketing === true, at: consents.recordedAt ?? null } : null,
    };
  });
  return (
    <div className="pg-staff-admin">
      <UsersAndRoles users={rows} totalCount={totalCount} log={log} samples={samples} selfId={caller.userId}
        me={{ name: me?.fullName || me?.primaryEmailAddress?.emailAddress || "Admin", title: "Admin" }} />
    </div>
  );
}

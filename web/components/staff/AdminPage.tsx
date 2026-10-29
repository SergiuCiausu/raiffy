import { Suspense, type ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import "@/styles/generated/staff-admin.css";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import { requirePageRole } from "@/lib/auth";

/*
 * The server frame of an admin page that reads Convex live: setup check, the admin role check (Convex checks it again
 * on every read), the signed-in person for the sidebar, and the page scope class for the generated admin.html styles.
 */

export type StaffMe = { name: string; title: string };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export function AdminPage({ loading, children }: { loading: string; children: (me: StaffMe) => ReactNode }) {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Setup is incomplete</h1><p>Authentication must be configured first.</p></main>;
  }
  // Per-request data (the session) renders inside Suspense, outside the static shell
  return (
    <Suspense fallback={<main className="agent-setup" role="status">{loading}</main>}>
      <Gate url={CONVEX_URL} render={children} />
    </Suspense>
  );
}

async function Gate({ url, render }: { url: string; render: (me: StaffMe) => ReactNode }) {
  await requirePageRole("admin");
  const user = await currentUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Admin";
  return (
    <div className="pg-staff-admin">
      <ConvexClientProvider url={url}>{render({ name, title: "Admin" })}</ConvexClientProvider>
    </div>
  );
}

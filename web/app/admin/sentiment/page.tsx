import type { Metadata } from "next";
import { Suspense } from "react";
import { currentUser } from "@clerk/nextjs/server";
import "@/styles/generated/staff-admin.css";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import { SentimentDashboard } from "@/components/staff/SentimentDashboard";
import { requirePageRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Sentiment · Raiffy Admin" };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export default function SentimentPage() {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Setup is incomplete</h1><p>Authentication must be configured first.</p></main>;
  }
  return (
    <Suspense fallback={<main className="agent-setup" role="status">Loading sentiment…</main>}>
      <Sentiment url={CONVEX_URL} />
    </Suspense>
  );
}

/* admin.html#sentiment for admins; Convex checks the role again on every read */
async function Sentiment({ url }: { url: string }) {
  await requirePageRole("admin");
  const user = await currentUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Admin";
  return (
    <div className="pg-staff-admin">
      <ConvexClientProvider url={url}><SentimentDashboard me={{ name, title: "Admin" }} /></ConvexClientProvider>
    </div>
  );
}

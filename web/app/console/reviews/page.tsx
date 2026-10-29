import type { Metadata } from "next";
import { Suspense } from "react";
import { currentUser } from "@clerk/nextjs/server";
import "@/styles/generated/console.css";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import { ReviewsConsole } from "@/components/staff/ReviewsConsole";
import { requirePageRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Reviews · Raiffy Console" };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export default function ReviewsPage() {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Setup is incomplete</h1><p>Authentication must be configured first.</p></main>;
  }
  return (
    <Suspense fallback={<main className="agent-setup" role="status">Loading reviews…</main>}>
      <Reviews url={CONVEX_URL} />
    </Suspense>
  );
}

/* console.html#reviews for operators and admins; Convex checks the role again for every read and decision */
async function Reviews({ url }: { url: string }) {
  const caller = await requirePageRole("operator");
  const user = await currentUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Specialist";
  return (
    <div className="pg-console">
      <ConvexClientProvider url={url}><ReviewsConsole me={{ name, role: caller.role }} /></ConvexClientProvider>
    </div>
  );
}

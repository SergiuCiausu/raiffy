import type { Metadata } from "next";
import { Suspense } from "react";
import { currentUser } from "@clerk/nextjs/server";
import "@/styles/generated/console.css";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import { CalendarConsole } from "@/components/staff/CalendarConsole";
import { requirePageRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Calendar · Raiffy Console" };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export default function CalendarPage() {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Setup is incomplete</h1><p>Authentication must be configured first.</p></main>;
  }
  return (
    <Suspense fallback={<main className="agent-setup" role="status">Loading the calendar…</main>}>
      <Calendar url={CONVEX_URL} />
    </Suspense>
  );
}

/* console.html#calendar for operators and admins; Convex checks the role again for every read and change */
async function Calendar({ url }: { url: string }) {
  const caller = await requirePageRole("operator");
  const user = await currentUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Specialist";
  return (
    <div className="pg-console">
      <ConvexClientProvider url={url}><CalendarConsole me={{ name, role: caller.role }} /></ConvexClientProvider>
    </div>
  );
}

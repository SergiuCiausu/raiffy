import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { AgentChat } from "@/components/agent/AgentChat";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import "@/styles/generated/chat.css";
import "@/styles/agent.css";

export const metadata: Metadata = {
  title: "Your calls · Raiffy",
  description: "Calls you booked with a Raiffeisen specialist.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/* Your calls: the chat shell with the customer's booked calls in the thread's place, as a list. Convex scopes `bookings:mine` to them. */
export default function CallsPage() {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Chat setup is incomplete</h1><p>The secure banking chat is waiting for authentication configuration.</p></main>;
  }
  return (
    <Suspense>
      <SecureCalls url={CONVEX_URL} />
    </Suspense>
  );
}

async function SecureCalls({ url }: { url: string }) {
  await auth.protect();
  return <ConvexClientProvider url={url}><AgentChat view="calls" /></ConvexClientProvider>;
}

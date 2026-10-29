import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { AgentChat } from "@/components/agent/AgentChat";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import "@/styles/generated/chat.css";
import "@/styles/agent.css";

export const metadata: Metadata = {
  title: "Your plans · Raiffy",
  description: "Plans you built from a simulation, and the ones a specialist checked.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/* chat.html#plans: the chat shell with the customer's plans in the thread's place. Convex scopes `plans:mine` to them. */
export default function PlansPage() {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Chat setup is incomplete</h1><p>The secure banking chat is waiting for authentication configuration.</p></main>;
  }
  return (
    <Suspense>
      <SecurePlans url={CONVEX_URL} />
    </Suspense>
  );
}

async function SecurePlans({ url }: { url: string }) {
  await auth.protect();
  return <ConvexClientProvider url={url}><AgentChat view="plans" /></ConvexClientProvider>;
}

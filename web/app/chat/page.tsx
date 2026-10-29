import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { AgentChat } from "@/components/agent/AgentChat";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import "@/styles/generated/chat.css";
import "@/styles/agent.css";
import "@/styles/voice.css";
import "@/components/ui/siri-orb.css";
import { logChatError, logChatWarning } from "@/lib/chat-log";

export const metadata: Metadata = {
  title: "Raiffy",
  description: "Chat with Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

/** As in chat.html: the on-screen keyboard shrinks the layout (and 100dvh), so the composer stays above it on Android. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export default function ChatPage() {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    logChatError("setup incomplete", { missing: [!CONVEX_URL && "NEXT_PUBLIC_CONVEX_URL", !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"].filter(Boolean) });
    return <main className="agent-setup"><h1>Chat setup is incomplete</h1><p>The secure banking chat is waiting for authentication configuration.</p></main>;
  }
  // The Convex client is per visitor (its connection id is random), so it renders per request, not in the static shell
  return (
    <Suspense>
      <SecureChat url={CONVEX_URL} />
    </Suspense>
  );
}

async function SecureChat({ url }: { url: string }) {
  const { userId } = await auth();
  if (!userId) logChatWarning("no Clerk session on the server, redirecting to sign-in");
  await auth.protect();
  return <ConvexClientProvider url={url}><AgentChat /></ConvexClientProvider>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentChat } from "@/components/agent/AgentChat";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import { ChatApp } from "@/components/chat/ChatApp";
import "@/styles/generated/chat.css";
import "@/styles/agent.css";

export const metadata: Metadata = {
  title: "Raiffy",
  description: "Chat with Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

/* With a Convex deployment configured, the chat talks to the real agent; without one it shows the scripted demo. */
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export default function ChatPage() {
  if (!CONVEX_URL) return <ChatApp />;
  // The Convex client is per visitor (its connection id is random), so it renders per request, not in the static shell
  return (
    <Suspense>
      <ConvexClientProvider url={CONVEX_URL}>
        <AgentChat />
      </ConvexClientProvider>
    </Suspense>
  );
}

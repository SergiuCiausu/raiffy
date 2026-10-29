"use client";

import { useEffect } from "react";
import { errorInfo, logChatError } from "@/lib/chat-log";
import "@/styles/agent.css";

/** Anything that throws while /chat renders, including a failed Convex query, lands here and is logged once. */
export default function ChatError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { logChatError("page crashed while rendering", errorInfo(error)); }, [error]);
  return (
    <main className="agent-setup" role="alert">
      <h1>The chat couldn’t load</h1>
      <p>Your conversations are safe. Try again, or come back in a moment.</p>
      <button type="button" className="agent-retry" onClick={retry}>Try again</button>
    </main>
  );
}

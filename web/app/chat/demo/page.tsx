import type { Metadata } from "next";
import { ChatApp } from "@/components/chat/ChatApp";
import "@/styles/generated/chat.css";

export const metadata: Metadata = {
  title: "Raiffy",
  description: "Scripted demo of the Raiffy chat: comparisons, simulations and advisor booking, no backend needed.",
};

/* The scripted chat from chat.html, always available for demos, whatever the backend's state. */
export default function ChatDemoPage() {
  return <ChatApp />;
}

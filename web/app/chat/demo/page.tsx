import type { Metadata, Viewport } from "next";
import { ChatApp } from "@/components/chat/ChatApp";
import "@/styles/generated/chat.css";

/** As in chat.html: the on-screen keyboard shrinks the layout (and 100dvh), so the composer stays above it on Android. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export const metadata: Metadata = {
  title: "Raiffy",
  description: "Scripted demo of the Raiffy chat: comparisons, simulations and advisor booking, no backend needed.",
};

/* The scripted chat from chat.html, always available for demos, whatever the backend's state. */
export default function ChatDemoPage() {
  return <ChatApp />;
}

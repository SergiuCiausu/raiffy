import type { Metadata } from "next";
import { ChatApp } from "@/components/chat/ChatApp";
import "@/styles/generated/chat.css";

export const metadata: Metadata = {
  title: "Raiffy",
  description: "Concept chat with Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function ChatPage() {
  return <ChatApp />;
}

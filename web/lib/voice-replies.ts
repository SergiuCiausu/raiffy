/** Voice playback follows the exact checked reply allocated to the user's Send, never old history or drafts. */
export type VoiceReplyMessage = { _id: string; role: string; text: string; status?: string; answer?: { status: string; text: string } };
export type VoiceReplyDecision = { kind: "wait" } | { kind: "cancel" } | { kind: "speak"; messageId: string; text: string };
export function voiceReplyDecision(messageId: string, messages: readonly VoiceReplyMessage[]): VoiceReplyDecision {
  const message = messages.find(m => m._id === messageId && m.role === "assistant");
  if (!message || message.status === "streaming") return { kind: "wait" };
  if (message.status === "failed" || message.status === "stopped" || !message.answer
    || ["refused", "failed_checks"].includes(message.answer.status)) return { kind: "cancel" };
  const text = spokenAnswer(message.answer.text);
  return text ? { kind: "speak", messageId, text } : { kind: "cancel" };
}

/** Remove presentation markup, retaining the complete checked words and financial figures. */
export function spokenAnswer(text: string): string {
  return text.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1").trim();
}

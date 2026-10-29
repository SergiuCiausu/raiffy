import { describe, expect, it } from "vitest";
import { spokenAnswer, voiceReplyDecision, type VoiceReplyMessage } from "./voice-replies";
import { playbackInput, speechInput } from "./voice";

const checked: VoiceReplyMessage = { _id: "reply", role: "assistant", status: "done", text: "old draft", answer: { status: "answered", text: "Checked final response." } };
describe("voice handoff to the current authenticated chat", () => {
  it("waits for its allocated reply instead of reading history or model drafts", () => {
    expect(voiceReplyDecision("new", [checked])).toEqual({ kind: "wait" });
    expect(voiceReplyDecision("reply", [{ ...checked, status: "streaming" }])).toEqual({ kind: "wait" });
    expect(voiceReplyDecision("reply", [{ ...checked, role: "user" }])).toEqual({ kind: "wait" });
    expect(voiceReplyDecision("reply", [checked])).toEqual({ kind: "speak", messageId: "reply", text: "Checked final response." });
  });
  it.each(["failed", "stopped"])("does not narrate a %s reply", status => {
    expect(voiceReplyDecision("reply", [{ ...checked, status }])).toEqual({ kind: "cancel" });
  });
  it.each(["failed_checks", "refused"])("does not narrate an answer with status %s", status => {
    expect(voiceReplyDecision("reply", [{ ...checked, answer: { status, text: "Withheld draft" } }])).toEqual({ kind: "cancel" });
  });
  it("retains amounts and dates while removing presentation markup", () => {
    expect(spokenAnswer("## Your options\n- **Keep 8,500 lei** for 12 months.\n- Read [the terms](https://example.com/terms)."))
      .toBe("Your options\nKeep 8,500 lei for 12 months.\nRead the terms.");
  });
  it("can read a full on-device reply without widening the Python endpoint input", () => {
    expect(playbackInput.safeParse({ text: "x".repeat(5000) }).success).toBe(true);
    expect(playbackInput.safeParse({ text: "x".repeat(12001) }).success).toBe(false);
    expect(speechInput.safeParse({ text: "x".repeat(2001) }).success).toBe(false);
  });
});

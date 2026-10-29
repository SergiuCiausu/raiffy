import type { Message, Reply, UiAction } from "./agent-api";

/*
 * Follow-up suggestions above the composer (DESIGN.md → Follow-up suggestions; chat.html `setChips`). They come from
 * the latest finished answer only, so older answers keep their sources and actions but no stale questions.
 */

export type Suggestion = { label: string; prompt: string; reply?: Reply };

/** Pressing a reply: a follow-up is plain text; a choice or "skip" also tells the server which offer was taken. */
export function replyFor(a: UiAction): Reply | undefined {
  return a.kind === "choose" ? { kind: "choose", inquiry: a.inquiry } : a.kind === "skip_inputs" ? { kind: "skip_inputs" } : undefined;
}

export function suggestionsFor(messages: readonly Message[]): Suggestion[] {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || (last.status && last.status !== "done")) return [];
  const seen = new Set<string>();
  return (last.answer?.ui?.actions ?? []).flatMap((a) => {
    if (a.kind === "handoff" || seen.has(a.prompt)) return [];
    seen.add(a.prompt);
    const reply = replyFor(a);
    return [{ label: a.label, prompt: a.prompt, ...(reply ? { reply } : {}) }];
  });
}

/**
 * Tab on the composer: an empty box takes the first suggestion, a box holding suggestion n takes n + 1, and after the
 * last one (or over the customer's own text) Tab moves focus as usual, so this returns null.
 */
export function nextSuggestion(suggestions: readonly Suggestion[], text: string): number | null {
  if (!suggestions.length) return null;
  const v = text.trim();
  if (!v) return 0;
  const at = suggestions.findIndex((s) => s.prompt === v);
  return at >= 0 && at < suggestions.length - 1 ? at + 1 : null;
}

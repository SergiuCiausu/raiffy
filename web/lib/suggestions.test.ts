import { describe, expect, it } from "vitest";
import type { Message, UiAction } from "./agent-api";
import { nextSuggestion, suggestionsFor } from "./suggestions";

const actions: UiAction[] = [
  { kind: "followup", label: "Add my down payment", prompt: "My down payment is" },
  { kind: "choose", label: "Check what I can afford", prompt: "Check what I can afford", inquiry: "affordability" },
  { kind: "skip_inputs", label: "Skip, show typical examples", prompt: "Show typical examples" },
  { kind: "handoff", label: "Talk to a specialist", reason: "customer_request" } as UiAction,
];
const answer = (status?: Message["status"], acts = actions) =>
  ({ _id: "m2", role: "assistant", text: "", status, answer: { ui: { blocks: [], actions: acts } } }) as unknown as Message;
const question = { _id: "m1", role: "user", text: "Which loan?" } as unknown as Message;

describe("follow-up suggestions", () => {
  it("come from the latest finished answer, without the handoff, keeping each choice's reply", () => {
    expect(suggestionsFor([question, answer("done")])).toEqual([
      { label: "Add my down payment", prompt: "My down payment is" },
      { label: "Check what I can afford", prompt: "Check what I can afford", reply: { kind: "choose", inquiry: "affordability" } },
      { label: "Skip, show typical examples", prompt: "Show typical examples", reply: { kind: "skip_inputs" } },
    ]);
    expect(suggestionsFor([question, answer(undefined)])).toHaveLength(3);
  });

  it("disappear while a reply streams, after it stops or fails, and once the customer asks again", () => {
    for (const status of ["streaming", "stopped", "failed"] as const) expect(suggestionsFor([question, answer(status)])).toEqual([]);
    expect(suggestionsFor([question, answer("done"), question])).toEqual([]);
    expect(suggestionsFor([])).toEqual([]);
  });

  it("drops a repeated prompt so Tab never lands on the same text twice", () => {
    const twice = [actions[0]!, { ...actions[0]!, label: "Down payment" } as UiAction];
    expect(suggestionsFor([answer("done", twice)])).toHaveLength(1);
  });

  it("Tab fills the first suggestion, then the next, then lets focus move on", () => {
    const s = suggestionsFor([answer("done")]);
    expect(nextSuggestion(s, "")).toBe(0);
    expect(nextSuggestion(s, " My down payment is ")).toBe(1);
    expect(nextSuggestion(s, "Show typical examples")).toBeNull();
    expect(nextSuggestion(s, "my own question")).toBeNull();
    expect(nextSuggestion([], "")).toBeNull();
  });
});

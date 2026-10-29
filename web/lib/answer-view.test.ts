import { describe, expect, it } from "vitest";
import { answerView } from "./answer-view";

const text = (view: ReturnType<typeof answerView>) =>
  view.pieces.map((p) => (p.kind === "text" ? p.runs.map((r) => (r.bold ? `[${r.text}]` : r.text)).join("") : "<cards>")).join("|");

describe("answerView", () => {
  it("shows bold without its markers and list markers as bullets, keeping citations at segment ends", () => {
    const view = answerView([{ text: "Hi **Ana**, two options:\n- **Loan** first\n", sourceIds: ["s1"] }, { text: "- 3 * 2 stays", sourceIds: [] }]);
    expect(text(view)).toBe("Hi [Ana], two options:\n• [Loan] first\n|• 3 * 2 stays");
    expect(view.pieces[0]).toMatchObject({ from: 0, to: 34, sourceIds: ["s1"] });
    expect(view.length).toBe(47);
  });

  it("replaces the route list with the cards and drops its line breaks and citations", () => {
    const intro = "Here are your routes:\n";
    const list = "- **A** — first.\n- **B** (recommended) — second.\n";
    const view = answerView([{ text: intro, sourceIds: [] }, { text: list, sourceIds: ["s1"] }, { text: "\nWant more detail?", sourceIds: ["s2"] }],
      { start: intro.length, end: intro.length + list.length });
    expect(text(view)).toBe("Here are your routes:|<cards>|Want more detail?");
    expect(view.pieces[1]).toEqual({ kind: "routes", at: 21 });
    expect(view.pieces[2]).toMatchObject({ from: 21, to: view.length, sourceIds: ["s2"] });
  });

  it("splits a segment the list starts inside", () => {
    const all = "Options:\n- **A** — one.\n- **B** — two.\nPick one?";
    const view = answerView([{ text: all, sourceIds: ["s1"] }], { start: all.indexOf("- **A**"), end: all.indexOf("Pick") });
    expect(text(view)).toBe("Options:|<cards>|Pick one?");
    expect(view.pieces.map((p) => (p.kind === "text" ? p.sourceIds : "cards"))).toEqual([[], "cards", ["s1"]]);
  });
});

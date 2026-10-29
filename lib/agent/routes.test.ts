import { describe, expect, it } from "vitest";
import { routesFromAnswer } from "./routes";

const seg = (text: string, sourceIds: string[] = []) => ({ text, sourceIds });

describe("routesFromAnswer", () => {
  it("turns the checked route list into cards and keeps the list's range and sources", () => {
    const intro = "Here are your routes:\n";
    const segments = [
      seg(intro),
      seg("- **Save first** (recommended) — use your own savings. Main risk: it takes time. Why: you buy next year.\n"),
      seg("- **Personal needs loan (credit de nevoi personale)** — a loan for personal spending. Main risk: a fixed instalment.", ["s1"]),
      seg("\n- **Overdraft:** interest only on what you use. Main risk: meant for short gaps.", ["s2"]),
      seg("\n\nWould you like more detail?"),
    ];
    const block = routesFromAnswer(segments)!;
    expect(block).toMatchObject({ type: "routes", state: "partial", start: intro.length });
    expect(segments.map((s) => s.text).join("").slice(block.end)).toBe("\nWould you like more detail?");
    expect(block.routes).toEqual([
      { title: "Save first", recommended: true, summary: "use your own savings.", mainRisk: "it takes time.", why: "you buy next year.", sourceIds: [] },
      { title: "Personal needs loan (credit de nevoi personale)", recommended: false, summary: "a loan for personal spending.", mainRisk: "a fixed instalment.", sourceIds: ["s1"] },
      { title: "Overdraft", recommended: false, summary: "interest only on what you use.", mainRisk: "meant for short gaps.", sourceIds: ["s2"] },
    ]);
  });

  it("reads a marker inside the bold name and keeps exactly one recommendation", () => {
    const block = routesFromAnswer([seg("- **Savings account (recommended):** easy access. Why: it's for emergencies.\n- **Term deposit** (recommended) — locked for a term.")])!;
    expect(block.routes.map((r) => [r.title, r.recommended, r.why])).toEqual([
      ["Savings account", true, "it's for emergencies."],
      ["Term deposit", false, undefined],
    ]);
  });

  it("prefers the list that carries the recommendation and ignores a single item", () => {
    const text = "- **Renewal:** it renews.\n- **Top-ups:** allowed.\n\nRoutes:\n- **A** — first.\n- **B** (recommended) — second.";
    expect(routesFromAnswer([seg(text)])!.routes.map((r) => r.title)).toEqual(["A", "B"]);
    expect(routesFromAnswer([seg("- **Only one** — a single route.\nPlain text after.")])).toBeNull();
    expect(routesFromAnswer([seg("No list at all.")])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { UiBlock } from "./agent-api";
import { pinFor } from "./chat-api";

const block = (b: object) => b as UiBlock;

describe("pinFor", () => {
  it("names the first pinnable card, after any callouts or forms", () => {
    expect(pinFor([
      block({ type: "callout", state: "ready", text: "x", sourceIds: [] }),
      block({ type: "simulation", title: "Repayment simulation", product: "Credit de nevoi personale", ratePercent: 5.55, source: "s", months: 60 }),
      block({ type: "checklist", title: "Documents", items: [] }),
    ])).toEqual({ kind: "simulation", title: "Repayment simulation", meta: "Repayment simulation · 60 months" });
  });

  it("describes comparisons by what they compare, never by a figure", () => {
    expect(pinFor([block({ type: "comparison", title: "Loan vs overdraft", options: [{ name: "Personal loan", isRaiffeisen: true, facts: [] }, { name: "Overdraft", isRaiffeisen: true, facts: [] }] })]))
      .toEqual({ kind: "comparison", title: "Loan vs overdraft", meta: "Personal loan vs Overdraft" });
  });

  it("skips text-derived routes and answers with no card", () => {
    expect(pinFor([block({ type: "routes", state: "partial", start: 0, end: 1, routes: [] })])).toBeNull();
    expect(pinFor([])).toBeNull();
  });
});

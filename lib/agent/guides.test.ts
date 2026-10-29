import { describe, expect, it } from "vitest";
import { answerGuide, LIST_MAX_ITEMS } from "./guides";
import { bankingIntent, defaultScope, familyOf } from "./confidence";

describe("pattern 12, list and overview", () => {
  it("gives listing answers the list shape, by pattern or by scope", () => {
    for (const plan of [{ inquiry: "listing" as const, scope: null }, { inquiry: "product_explanation" as const, scope: "list" as const }]) {
      const guide = answerGuide(plan)!;
      expect(guide).toContain("pattern 12");
      expect(guide).toContain(`up to ${LIST_MAX_ITEMS}`);
      expect(guide).toMatch(/\*\*bold\*\*/);
      expect(guide).toMatch(/end with one short question/i);
    }
  });

  it("leaves other patterns on the core prompt", () => {
    expect(answerGuide({ inquiry: "product_explanation", scope: "detail" })).toBeNull();
    expect(answerGuide({ inquiry: null, scope: null })).toBeNull();
  });

  it("defaults to the list scope and sits with the explaining patterns", () => {
    expect(defaultScope("listing")).toBe("list");
    expect(defaultScope("listing", true)).toBe("compare");
    expect(familyOf("listing")).toBe("explaining");
  });

  it("hints listing from English and Romanian wording, and not from a plain explanation", () => {
    for (const m of ["What types of accounts do you offer?", "Which documents do I need?", "List the card fees", "Ce tipuri de carduri aveți?", "Ce acte îmi trebuie?"]) {
      expect(bankingIntent(m)).toContain("listing");
    }
    expect(bankingIntent("How does the Flexidepozit work?")).not.toContain("listing");
  });
});

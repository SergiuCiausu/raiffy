import { describe, expect, it } from "vitest";
import { planQuery } from "./query";

describe("planQuery", () => {
  it("expands English banking terms into the Romanian words the pages use", () => {
    const plan = planQuery("What's the APR on the eMAG credit card?");
    expect(plan.lexicalTerms).toEqual(expect.arrayContaining(["apr", "emag", "credit", "card", "dae"]));
    expect(plan.intents).toContain("interest");
  });

  it("prefers the longest matching phrase", () => {
    const plan = planQuery("What is the monthly payment for a personal loan?");
    expect(plan.lexicalTerms).toEqual(expect.arrayContaining(["rata", "lunara", "nevoi", "personale"]));
  });

  it("leaves Romanian questions mostly as they are", () => {
    const plan = planQuery("Ce documente îmi trebuie pentru overdraft?");
    expect(plan.lexicalTerms.slice(0, 2)).toEqual(["documente", "overdraft"]);
    expect(plan.intents).toEqual(["documents"]);
    expect(plan.preferredSections).toEqual(["required_documents"]);
  });

  it("marks cost questions and prefers fee sections and tariff PDFs", () => {
    const plan = planQuery("cat ma costa pe luna contul Zero Simplu, ce comision are?");
    expect(plan.intents).toContain("cost");
    expect(plan.preferredSections).toEqual(expect.arrayContaining(["fees", "fee_table", "pdf"]));
    expect(plan.preferredDocType).toBe("tarife");
  });

  it("never returns more than the search-term cap", () => {
    const words = "fee interest card loan deposit account savings mortgage insurance documents age income salary";
    expect(planQuery(`${words} ${words}`).lexicalTerms.length).toBeLessThanOrEqual(16);
  });

  it("returns no intents for a neutral question", () => {
    expect(planQuery("Tell me about Smart Mobile").intents).toEqual([]);
  });
});

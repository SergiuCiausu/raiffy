import { describe, expect, it } from "vitest";
import { planQuery, withFocus } from "./query";

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

  it("keeps product names, bank names and terms ahead of translations in long English questions", () => {
    const plan = planQuery("What is the maximum administration fee and fixed interest rate for the BCR George personal loan over 60 months without insurance?");
    expect(plan.lexicalTerms).toEqual(expect.arrayContaining(["bcr", "george", "60", "administrare"]));
    expect(plan.banks).toEqual(["bcr"]);
  });
});

describe("withFocus", () => {
  it("adds the focus sections to a neutral plan", () => {
    const plan = withFocus(planQuery("Visa Gold debit card"), "costs");
    expect(plan.intents).toEqual(["cost"]);
    expect(plan.preferredSections).toEqual(expect.arrayContaining(["fees", "fee_table", "pdf"]));
    expect(plan.preferredDocType).toBe("tarife");
  });

  it("leaves the plan alone for any, or when the intent is already there", () => {
    const plan = planQuery("documente overdraft");
    expect(withFocus(plan, "any")).toBe(plan);
    expect(withFocus(plan, "documents")).toBe(plan);
  });
});

import { describe, expect, it } from "vitest";
import { checkCards, showCardsTool, type CardsCheck } from "./blocks";

const RZB = "https://www.raiffeisen.ro/persoane-fizice/credite/credit-nevoi-personale";
const BT = "https://www.bancatransilvania.ro/credite/credit-nevoi-personale";
const evidence = [
  { url: RZB, text: "Credit de nevoi personale: suma maxima 250.000 lei, perioada 6-60 luni, DAE 9,26%.", collectedAt: "2026-10-20T00:00:00Z" },
  { url: BT, text: "Credit nevoi personale: pana la 200.000 lei, perioada pana la 60 luni.", collectedAt: "2026-10-21T00:00:00Z" },
];
const ok = (r: ReturnType<typeof checkCards>) => { if ("error" in r) throw new Error(r.error); return r as CardsCheck; };

describe("answer cards from the model", () => {
  it("keeps figures copied from the cited result, in either number format, and records the sources used", () => {
    const r = ok(checkCards({ cards: [{ type: "comparison", title: "Personal loans compared", options: [
      { name: "Raiffeisen personal loan", isRaiffeisen: true, facts: [{ label: "Maximum amount", value: "250,000 lei", source: RZB }, { label: "APR", value: "9.26%", source: RZB }] },
      { name: "BT personal loan", provider: "Banca Transilvania", isRaiffeisen: false, facts: [{ label: "Maximum amount", value: "200,000 lei", source: BT }] },
    ], recommendation: { option: "Raiffeisen personal loan", reasons: ["It covers the amount you asked about"], whenOther: "BT may suit you if you already bank there." } }] }, evidence));
    expect(r.dropped).toEqual([]);
    expect(r.urls.sort()).toEqual([BT, RZB].sort());
    expect(r.cards[0]).toMatchObject({ type: "comparison", recommendation: { option: "Raiffeisen personal loan" } });
  });

  it("drops a figure that its source doesn't contain, or that has no source, but keeps the rest of the card", () => {
    const r = ok(checkCards({ cards: [{ type: "keyFacts", title: "Raiffeisen personal loan", facts: [
      { label: "Term", value: "6 to 60 months", source: RZB },
      { label: "APR", value: "7.5%", source: RZB },
      { label: "Monthly payment", value: "about 1,050 lei" },
      { label: "Maximum amount", value: "200,000 lei", source: RZB },
    ] }] }, evidence));
    expect(r.cards[0]).toMatchObject({ facts: [{ label: "Term" }] });
    expect(r.dropped).toHaveLength(3);
  });

  it("lets cards repeat the customer's own figures but nothing computed from them", () => {
    const r = ok(checkCards({ cards: [{ type: "routes", title: "Ways to fund 50,000 lei", routes: [
      { name: "Personal loan", summary: "One loan with a fixed schedule", fit: "Covers the 50,000 lei you mentioned", facts: [{ label: "Term", value: "up to 60 months", source: RZB }] },
      { name: "Use savings first", summary: "Borrow less by using savings", fit: "Lowers what you borrow", facts: [] },
      { name: "Overdraft", summary: "Flexible but costlier", fit: "About 833 lei a month", facts: [] },
    ], recommendation: { option: "Personal loan", reasons: ["A fixed schedule suits a one-off amount"], whenOther: "Savings first fits if you can wait." } }] }, evidence, ["50000", "50"]));
    expect(r.cards[0]).toMatchObject({ type: "routes", routes: [{ name: "Personal loan" }, { name: "Use savings first" }] });
    expect(r.dropped.join(" ")).toContain("833");
  });

  it("drops a recommendation that names an option not on the card, and rejects malformed input outright", () => {
    const r = ok(checkCards({ cards: [{ type: "comparison", title: "Compared", options: [
      { name: "A", isRaiffeisen: true, facts: [{ label: "Term", value: "6-60 months", source: RZB }] },
      { name: "B", isRaiffeisen: false, facts: [{ label: "Term", value: "up to 60 months", source: BT }] },
    ], recommendation: { option: "C", reasons: ["x"], whenOther: "y" } }] }, evidence));
    expect(r.cards[0]).toMatchObject({ recommendation: undefined });
    expect(checkCards({ cards: [{ type: "comparison", title: "Only one", options: [] }] }, evidence)).toHaveProperty("error");
    expect(checkCards({ cards: [{ type: "keyFacts", title: "x", facts: [{ label: "a", value: "1%", source: "https://elsewhere.example" }] }] }, evidence)).toMatchObject({ cards: [] });
  });

  it("rejects a pasted sentence as a fact value, and accepts a figure rewritten in English number format", () => {
    const long = { label: "Amount", value: "between 500 and 50.000 de Euro (echivalentul in Lei) paid out in lei", source: RZB };
    expect(checkCards({ cards: [{ type: "keyFacts", title: "Loan", facts: [long] }] }, evidence)).toHaveProperty("error");
    const r = ok(checkCards({ cards: [{ type: "keyFacts", title: "Loan", facts: [{ label: "Maximum amount", value: "250,000 lei", source: RZB }, { label: "APR", value: "9.26%", source: RZB }] }] }, evidence));
    expect(r.dropped).toEqual([]);
  });

  it("publishes a JSON Schema tool definition without the $schema key", () => {
    const tool = showCardsTool();
    expect(tool.name).toBe("show_cards");
    expect(tool.input_schema).toMatchObject({ type: "object" });
    expect(tool.input_schema).not.toHaveProperty("$schema");
  });
});

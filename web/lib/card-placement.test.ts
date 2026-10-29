import { describe, expect, it } from "vitest";
import { blockEnd, cardUrls, placeCards } from "./card-placement";
import { parseAnswer, segmentCites } from "./markup";

const sources = [{ id: "src-1", url: "https://bank.ro/loan" }, { id: "src-2", url: "https://bank.ro/savings" }];
const parsed = (segments: { text: string; sourceIds: string[] }[]) => parseAnswer(segments.map((s) => s.text).join(""), segmentCites(segments)).blocks;

describe("placing answer cards in the answer", () => {
  const blocks = parsed([
    { text: "Here are your options.\n\n", sourceIds: [] },
    { text: "The loan's rate is fixed.", sourceIds: ["src-1"] },
    { text: "\n\nSavings pay less but stay available.", sourceIds: ["src-2"] },
  ]);

  it("puts a card after the first paragraph citing one of its sources, in the cards' order", () => {
    const loan = { type: "facts", facts: [{ label: "Rate", sourceUrl: "https://bank.ro/loan" }] };
    const savings = { type: "facts", facts: [{ label: "Rate", sourceUrl: "https://bank.ro/savings" }] };
    expect(placeCards(blocks, [savings, loan], sources)).toEqual([2, 1]);
  });

  it("puts a card citing nothing in the text after the lead-in, and keeps cards after the text when there is none", () => {
    expect(placeCards(blocks, [{ type: "checklist", items: [] }], sources)).toEqual([0]);
    expect(placeCards([], [{ type: "checklist" }], sources)).toEqual([-1]);
  });

  it("puts every card after a paragraph ending in a colon, unless that colon introduces a list", () => {
    const intro = parsed([{ text: "I recommend the loan.\n\nHere they are side by side:", sourceIds: ["src-2"] }]);
    expect(placeCards(intro, [{ sourceUrl: "https://bank.ro/savings" }], sources)).toEqual([1]);
    const listTitle = parsed([{ text: "Conditions to check:\n- Income\n- Age\n\nThe rate is fixed.", sourceIds: ["src-1"] }]);
    expect(placeCards(listTitle, [{ sourceUrl: "https://bank.ro/loan" }], sources)).toEqual([2]);
  });

  it("finds source URLs anywhere in a card, and where each paragraph ends in the visible text", () => {
    expect([...cardUrls({ a: [{ b: "https://bank.ro/loan" }], c: "https://other.ro", d: 3 }, new Set(sources.map((s) => s.url)))]).toEqual(["https://bank.ro/loan"]);
    expect(blocks.map(blockEnd)).toEqual([22, 48, 85]); // `plain` keeps one break between paragraphs
  });
});

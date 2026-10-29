import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { assembleCitations, citableFromPassage, checkNumbers, citedSegments, ragAnswerSchema } from "./answer";
import { buildKnowledgeResult, toPassage } from "./knowledge";
import { toSearchResult, toToolResult } from "./prompt";
import type { SearchHit } from "./schemas";

const NOW = Date.parse("2026-11-01T12:00:00Z");

const hit = (id: string, url: string, text: string): SearchHit => ({
  chunkId: id,
  text,
  embedded: true,
  bank: "raiffeisen",
  personal_bank_product_docs: true,
  personal_competitor_docs: false,
  personal_banking_help: false,
  business_bank_product_docs: false,
  business_competitor_docs: false,
  business_banking_help: false,
  sourceType: "product_page",
  sectionType: "interest_rates",
  url,
  scrapedAt: "2026-10-28T07:45:27+00:00",
  product: "Depozite la termen",
  heading: "Dobânzi",
  score: 0.03,
});

const searchHits = [
  hit("d#1", "https://www.raiffeisen.ro/depozite.html", "Depozite la termen\nDobânzi\n3 luni: dobândă 4.70% pe an"),
  hit("d#2", "https://www.raiffeisen.ro/depozite.html", "Depozite la termen\n6 luni: dobândă 5.60% pe an"),
  hit("f#1", "https://www.raiffeisen.ro/fresh.html", "Fresh Money\n4 luni: 6.20%"),
];
const passages = searchHits.map((h) => toPassage(h, "bank_product_docs", NOW));
const hits = passages.map(citableFromPassage);

const citation = (index: number) => ({
  type: "search_result_location" as const,
  cited_text: "x",
  source: hits[index]!.url,
  title: "t",
  search_result_index: index,
  start_block_index: 0,
  end_block_index: 1,
});

const response = [
  { type: "text", text: "The 3-month deposit in lei pays 4.70% a year", citations: [citation(0)] },
  { type: "text", text: ", and 6 months pays 5.60%", citations: [citation(1)] },
  { type: "text", text: ". Fresh Money pays 6.20% for 4 months.", citations: [citation(2)] },
] as unknown as BetaContentBlock[];

describe("prompt building", () => {
  it("splits a chunk into one citable block per line, after the collection date", () => {
    const result = toSearchResult(passages[0]!);
    expect(result.content.map((b) => b.text)).toEqual([
      "Collected on 2026-10-28.", "Depozite la termen", "Dobânzi", "3 luni: dobândă 4.70% pe an",
    ]);
    expect(result.citations).toEqual({ enabled: true });
    expect(result.title).toBe("Raiffeisen Bank · Depozite la termen · Dobânzi");
  });

  it("returns only search results in a tool result, or a note when there are none", () => {
    const found = buildKnowledgeResult({ collection: "bank_product_docs", query: "depozit", limit: 3, hits: searchHits, now: NOW });
    const withHits = toToolResult("t1", found);
    expect(Array.isArray(withHits.content) && withHits.content.every((b) => b.type === "search_result")).toBe(true);
    const none = buildKnowledgeResult({ collection: "bank_product_docs", query: "depozit", limit: 3, hits: [], now: NOW });
    expect(toToolResult("t2", none).content).toMatch(/No results/);
    const memory = toToolResult("t3", { ...none, status: "unavailable", collection: "user_memory", reason: "collection_not_connected" });
    expect(memory.content).toMatch(/user_memory collection is unavailable/);
  });
});

describe("answer assembly", () => {
  it("maps citations to one source per page and keeps segment order", () => {
    const assembled = assembleCitations(citedSegments(response), hits);
    expect(assembled.text).toBe("The 3-month deposit in lei pays 4.70% a year, and 6 months pays 5.60%. Fresh Money pays 6.20% for 4 months.");
    expect(assembled.sources.map((s) => [s.id, s.chunkIds])).toEqual([["src-1", ["d#1", "d#2"]], ["src-2", ["f#1"]]]);
    expect(assembled.segments.map((s) => s.sourceIds)).toEqual([["src-1"], ["src-1"], ["src-2"]]);
    expect(assembled.sources[0]!.collectedOn).toBe("2026-10-28");
  });

  it("passes grounded numbers and flags invented ones", () => {
    expect(checkNumbers(citedSegments(response), hits)).toEqual({ ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0 });
    const invented = [{ type: "text", text: "It pays 7.10% if you wait 9 months.", citations: null }] as unknown as BetaContentBlock[];
    const checks = checkNumbers(citedSegments(invented), hits);
    expect(checks.ungroundedNumbers).toEqual(["7.10", "9"]);
    expect(checks.uncitedSegmentsWithNumbers).toBe(1);
  });

  it("rejects a value found only in an unrelated retrieved fragment", () => {
    expect(checkNumbers([{ text: "The deposit pays 6.20%.", hitIndexes: [0] }], hits).ungroundedNumbers).toEqual(["6.20"]);
  });

  it("accepts calculator results in any segment, cited or not", () => {
    const calculator = '{"inputs":{"netMonthlyIncome":4500},"maxNewInstalment":1800}';
    expect(checkNumbers([{ text: "Up to 1,800 lei of your 4,500 lei can go to instalments.", hitIndexes: [] }], hits, [calculator]))
      .toEqual({ ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0 });
  });

  it("lets the answer repeat the customer's own inputs, cited or not, but nothing derived from them", () => {
    const figures = ["50000", "50", "60"]; // "50k euro over 60 months", as parsed by lib/agent/inputs
    expect(checkNumbers([{ text: "For a loan of 50,000 lei over 60 months, see the conditions.", hitIndexes: [0] }], hits, figures).ungroundedNumbers).toEqual([]);
    expect(checkNumbers([{ text: "You asked about 50k euro, so take 50.000 lei as an example.", hitIndexes: [] }], hits, figures))
      .toMatchObject({ ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0 });
    expect(checkNumbers([{ text: "That is about 833 lei a month.", hitIndexes: [] }], hits, figures).ungroundedNumbers).toEqual(["833"]);
  });

  it("does not let the customer's question establish a financial number", () => {
    expect(checkNumbers([{ text: "It pays 7.10%.", hitIndexes: [0] }], hits).ungroundedNumbers).toEqual(["7.10"]);
    expect(checkNumbers([{ text: "It pays 7.10%.", hitIndexes: [] }], hits)).toMatchObject({
      ungroundedNumbers: ["7.10"], uncitedSegmentsWithNumbers: 1,
    });
  });

  it("requires numeric evidence for each segment's own citation", () => {
    expect(checkNumbers([
      { text: "It pays 4.70%.", hitIndexes: [0] },
      { text: "Another deposit pays 4.70%.", hitIndexes: [2] },
    ], hits).ungroundedNumbers).toEqual(["4.70"]);
  });

  it.each([-1, 0.5, 99, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid citation index %s even without numbers", (index) => {
    expect(checkNumbers([{ text: "A banking fact.", hitIndexes: [index] }], hits)).toMatchObject({ invalidCitationIndexes: 1 });
  });

  it("does not let an invalid citation stand in for valid evidence", () => {
    expect(checkNumbers([{ text: "It pays 4.70%.", hitIndexes: [99] }], hits)).toEqual({
      ungroundedNumbers: ["4.70"], uncitedSegmentsWithNumbers: 1, invalidCitationIndexes: 1,
    });
    expect(checkNumbers([{ text: "It pays 4.70%.", hitIndexes: [0, 99] }], hits)).toEqual({
      ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, invalidCitationIndexes: 1,
    });
  });

  it("accepts a cited collection date without allowing an unrelated snapshot's date", () => {
    expect(checkNumbers([{ text: "Collected on 2026-10-28.", hitIndexes: [0] }], hits)).toEqual({
      ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0,
    });
    const distinctDate = { ...hits[0]!, collectedAt: "2025-09-17T00:00:00Z" };
    expect(checkNumbers([{ text: "Collected on 2026-10-28.", hitIndexes: [0] }], [distinctDate, hits[1]!]).ungroundedNumbers).toEqual(["2026", "10", "28"]);
  });

  it("produces an answer the schema accepts", () => {
    const assembled = assembleCitations(citedSegments(response), hits);
    expect(() => ragAnswerSchema.parse({
      ...assembled,
      status: "answered",
      checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 },
      model: "claude-sonnet-5-5",
      promptVersion: "rag-agent@3",
      searches: [{ query: "dobanda depozit", collection: "bank_product_docs", status: "ok", results: 3 }],
      retrieval: [{ chunkId: "d#1", score: 0.03 }],
    })).not.toThrow();
  });
});

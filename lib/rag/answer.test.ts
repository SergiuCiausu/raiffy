import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { assembleCitations, checkNumbers, citedSegments, ragAnswerSchema } from "./answer";
import { buildUserContent, toSearchResult } from "./prompt";
import type { SearchHit } from "./schemas";

const hit = (id: string, url: string, text: string): SearchHit => ({
  chunkId: id,
  text,
  embeddingModel: "test",
  visiblePersonal: true,
  visibleBusiness: false,
  sourceType: "product_page",
  sectionType: "interest_rates",
  url,
  scrapedAt: "2026-10-28T07:45:27+00:00",
  product: "Depozite la termen",
  heading: "Dobânzi",
  score: 0.03,
});

const hits = [
  hit("d#1", "https://www.raiffeisen.ro/depozite.html", "Depozite la termen\nDobânzi\n3 luni: dobândă 4.70% pe an"),
  hit("d#2", "https://www.raiffeisen.ro/depozite.html", "Depozite la termen\n6 luni: dobândă 5.60% pe an"),
  hit("f#1", "https://www.raiffeisen.ro/fresh.html", "Fresh Money\n4 luni: 6.20%"),
];

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
  it("splits a chunk into one citable block per line, with citations on", () => {
    const result = toSearchResult(hits[0]!);
    expect(result.content.map((b) => b.text)).toEqual(["Depozite la termen", "Dobânzi", "3 luni: dobândă 4.70% pe an"]);
    expect(result.citations).toEqual({ enabled: true });
    expect(result.title).toBe("Depozite la termen · Dobânzi");
  });

  it("puts a dated header first and the question last", () => {
    const content = buildUserContent({ question: "Rate?", hits, firstTurn: true });
    expect(content[0]).toMatchObject({ type: "text" });
    expect((content[0] as { text: string }).text).toContain("2026-10-28");
    expect(content.filter((b) => b.type === "search_result")).toHaveLength(3);
    expect((content.at(-1) as { text: string }).text).toMatch(/AI assistant[\s\S]*Customer question: Rate\?/);
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
    expect(checkNumbers(citedSegments(response), hits, "q")).toEqual({ ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0 });
    const invented = [{ type: "text", text: "It pays 7.10% if you wait 9 months.", citations: null }] as unknown as BetaContentBlock[];
    const checks = checkNumbers(citedSegments(invented), hits, "q");
    expect(checks.ungroundedNumbers).toEqual(["7.10", "9"]);
    expect(checks.uncitedSegmentsWithNumbers).toBe(1);
  });

  it("produces an answer the schema accepts", () => {
    const assembled = assembleCitations(citedSegments(response), hits);
    expect(() => ragAnswerSchema.parse({
      ...assembled,
      status: "answered",
      checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 },
      model: "claude-sonnet-5-5",
      promptVersion: "rag-answer@1",
      retrieval: [{ chunkId: "d#1", score: 0.03, denseRank: 1 }],
    })).not.toThrow();
  });
});

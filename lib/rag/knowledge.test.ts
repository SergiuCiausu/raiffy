import { describe, expect, it } from "vitest";
import { buildKnowledgeResult, candidateCount, isPublicCollection, toPassage, unavailableResult } from "./knowledge";
import type { SearchHit } from "./schemas";

const FRESH = Date.parse("2026-11-01T12:00:00Z");
const LATER = Date.parse("2026-12-15T12:00:00Z");

const hit = (id: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  chunkId: id,
  bank: "raiffeisen",
  text: `Raiffeisen Bank: text ${id}`,
  embedded: true,
  personal_bank_product_docs: true,
  personal_competitor_docs: false,
  personal_banking_help: false,
  business_bank_product_docs: false,
  business_competitor_docs: false,
  business_banking_help: false,
  sourceType: "product_page",
  sectionType: "description",
  url: `https://www.raiffeisen.ro/${id}.html`,
  scrapedAt: "2026-10-28T07:45:27+00:00",
  product: "Card de credit Raiffeisen Standard",
  productId: `raiffeisen:${id}`,
  segment: "persoane fizice",
  score: 0.03,
  ...extra,
});

describe("toPassage", () => {
  it("carries provenance with the review date and the computed status", () => {
    const passage = toPassage(hit("a"), "bank_product_docs", FRESH);
    expect(passage).toMatchObject({
      passageId: "a",
      collection: "bank_product_docs",
      bank: "raiffeisen",
      title: "Raiffeisen Bank · Card de credit Raiffeisen Standard · Description",
      provenance: { url: "https://www.raiffeisen.ro/a.html", chunkId: "a", reviewBy: "2026-11-27", status: "fresh" },
    });
    expect(toPassage(hit("a"), "bank_product_docs", LATER).provenance.status).toBe("stale");
  });
});

describe("buildKnowledgeResult", () => {
  const base = { collection: "bank_product_docs" as const, query: "Card de credit Standard", now: FRESH };

  it("returns at most limit fresh passages in rank order", () => {
    const result = buildKnowledgeResult({ ...base, limit: 2, hits: [hit("a"), hit("b"), hit("c")] });
    expect(result.status).toBe("ok");
    expect(result.passages.map((p) => p.passageId)).toEqual(["a", "b"]);
    expect(result.coverage).toEqual({ requested: 2, returned: 2, gaps: [] });
  });

  it("drops stale passages, counts them, and backfills from the extra candidates", () => {
    const old = hit("old", { scrapedAt: "2026-09-01T00:00:00+00:00" });
    const result = buildKnowledgeResult({ ...base, limit: 2, hits: [old, hit("a"), hit("b")] });
    expect(result.passages.map((p) => p.passageId)).toEqual(["a", "b"]);
    expect(result.coverage.gaps).toEqual(["stale_excluded"]);
  });

  it("is unavailable when every candidate is stale", () => {
    const result = buildKnowledgeResult({ ...base, limit: 3, now: LATER, hits: [hit("a"), hit("b")] });
    expect(result).toMatchObject({ status: "unavailable", reason: "stale_sources", passages: [] });
    expect(result.coverage.gaps).toEqual(["stale_excluded"]);
  });

  it("reports no results and short result lists", () => {
    expect(buildKnowledgeResult({ ...base, limit: 3, hits: [] }).coverage.gaps).toEqual(["no_results"]);
    expect(buildKnowledgeResult({ ...base, limit: 3, hits: [hit("a")] }).coverage.gaps).toEqual(["fewer_results_than_requested"]);
  });

  it("flags Raiffeisen cost questions answered without any fee section", () => {
    const query = "What fee does the Standard credit card have?";
    const noFees = buildKnowledgeResult({ ...base, query, limit: 1, hits: [hit("a")] });
    expect(noFees.coverage.gaps).toContain("fees_in_shared_tariff_pdfs");
    const withTariff = buildKnowledgeResult({
      ...base, query, limit: 1, hits: [hit("t", { sourceType: "pdf", sectionType: "pdf", docType: "tarife", title: "Tarife" })],
    });
    expect(withTariff.coverage.gaps).not.toContain("fees_in_shared_tariff_pdfs");
  });

  it("flags missing ING fee and rate PDFs for ING cost or rate questions only", () => {
    const ing = hit("ing", { bank: "ing", url: "https://ing.ro/x" });
    const rate = buildKnowledgeResult({ collection: "competitor_docs", query: "ING personal loan APR", limit: 1, hits: [ing], now: FRESH });
    expect(rate.coverage.gaps).toContain("ing_pdfs_not_collected");
    const plain = buildKnowledgeResult({ collection: "competitor_docs", query: "ING Go account", limit: 1, hits: [ing], now: FRESH });
    expect(plain.coverage.gaps).not.toContain("ing_pdfs_not_collected");
    const bcr = hit("bcr", { bank: "bcr", url: "https://www.bcr.ro/x" });
    const bcrRate = buildKnowledgeResult({ collection: "competitor_docs", query: "BCR card DAE", limit: 1, hits: [bcr], now: FRESH });
    expect(bcrRate.coverage.gaps).not.toContain("ing_pdfs_not_collected");
  });
});

describe("collections", () => {
  it("knows which collections are public", () => {
    expect(isPublicCollection("bank_product_docs")).toBe(true);
    expect(isPublicCollection("user_memory")).toBe(false);
    expect(isPublicCollection("everything")).toBe(false);
  });

  it("builds unavailable results that never carry passages", () => {
    expect(unavailableResult("user_memory", "collection_not_connected", 3)).toEqual({
      status: "unavailable",
      collection: "user_memory",
      passages: [],
      coverage: { requested: 3, returned: 0, gaps: [] },
      reason: "collection_not_connected",
    });
  });

  it("over-fetches candidates within the search cap", () => {
    expect(candidateCount(3)).toBe(6);
    expect(candidateCount(5)).toBe(10);
  });
});

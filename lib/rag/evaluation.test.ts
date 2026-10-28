import { describe, expect, it } from "vitest";
import { auditChunk, retrievalCaseSchema, scoreRetrievalCase } from "./evaluation";
import { buildKnowledgeResult } from "./knowledge";
import type { SearchHit } from "./schemas";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const noFlags = {
  personal_bank_product_docs: false, personal_competitor_docs: false, personal_banking_help: false,
  business_bank_product_docs: false, business_competitor_docs: false, business_banking_help: false,
};
const hit = (id: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  chunkId: id, bank: "raiffeisen", text: `text ${id} 4.70%`, embedded: true, ...noFlags, personal_bank_product_docs: true,
  sourceType: "product_page", sectionType: "interest_rates", url: `https://www.raiffeisen.ro/${id}.html`,
  scrapedAt: "2026-10-28T07:45:27+00:00", product: "Depozite", segment: "persoane fizice", score: 0.03, ...extra,
});
const result = (hits: SearchHit[], collection: "bank_product_docs" | "competitor_docs" | "banking_help" = "bank_product_docs", query = "q") =>
  buildKnowledgeResult({ collection, query, limit: 5, hits, now: NOW });

describe("scoreRetrievalCase", () => {
  const hitCase = retrievalCaseSchema.parse({
    id: "h1", kind: "hit", question: "rate?", track: "personal", collection: "bank_product_docs",
    expectedUrlContains: "/b.html", expectedTextContains: "4.70%",
  });

  it("finds the rank of the expected passage", () => {
    const score = scoreRetrievalCase(hitCase, result([hit("a"), hit("b")]));
    expect(score).toMatchObject({ pass: true, hitRank: 2, pageRank: 2, violations: [] });
  });

  it("fails a hit case whose source isn't returned", () => {
    expect(scoreRetrievalCase(hitCase, result([hit("a")])).pass).toBe(false);
    // Right page, another chunk.
    expect(scoreRetrievalCase(hitCase, result([hit("b", { text: "other" })]))).toMatchObject({ pass: false, hitRank: null, pageRank: 1 });
  });

  it("fails any case that returns content from the other track or corporate", () => {
    const business = hit("b", { segment: "IMM" });
    const score = scoreRetrievalCase(hitCase, result([business]));
    expect(score.pass).toBe(false);
    expect(score.violations).toEqual(["b: segment IMM outside personal"]);
    expect(scoreRetrievalCase(hitCase, result([hit("c", { segment: "corporate" })])).violations).toEqual(["c: corporate segment"]);
  });

  it("checks banks and section types against the collection", () => {
    const iso = retrievalCaseSchema.parse({ id: "i", kind: "isolation", question: "q", track: "personal", collection: "banking_help" });
    const score = scoreRetrievalCase(iso, result([hit("x", { bank: "ing" })], "banking_help"));
    expect(score.violations).toEqual(["x: ing in banking_help", "x: interest_rates in banking_help"]);
  });

  it("passes a coverage case only when every expected gap is reported", () => {
    const coverage = retrievalCaseSchema.parse({
      id: "c", kind: "coverage", question: "ING personal loan APR", track: "personal", collection: "competitor_docs",
      expectGaps: ["ing_pdfs_not_collected"],
    });
    const ing = hit("ing", { bank: "ing", url: "https://ing.ro/x" });
    expect(scoreRetrievalCase(coverage, result([ing], "competitor_docs", "ING personal loan APR")).pass).toBe(true);
    expect(scoreRetrievalCase(coverage, result([ing], "competitor_docs", "ING Go account")).pass).toBe(false);
  });

  it("rejects malformed cases", () => {
    expect(() => retrievalCaseSchema.parse({ id: "x", kind: "hit", question: "q", track: "personal", collection: "bank_product_docs" })).toThrow();
    expect(() => retrievalCaseSchema.parse({ id: "x", kind: "coverage", question: "q", track: "personal", collection: "competitor_docs" })).toThrow();
  });
});

describe("auditChunk", () => {
  const doc = (extra: Partial<Parameters<typeof auditChunk>[0]>) => ({
    chunkId: "c", bank: "raiffeisen" as const, sourceType: "product_page" as const, sectionType: "faq" as const,
    segment: "persoane fizice" as const, ...noFlags, ...extra,
  });

  it("accepts a consistent chunk", () => {
    expect(auditChunk(doc({ personal_bank_product_docs: true, personal_banking_help: true }))).toEqual([]);
  });

  it("flags every inconsistency", () => {
    expect(auditChunk(doc({}))).toEqual(["c: stored but in no track or collection"]);
    expect(auditChunk(doc({ segment: "corporate", personal_bank_product_docs: true }))).toContain("c: corporate chunk is visible");
    expect(auditChunk(doc({ segment: "IMM", personal_bank_product_docs: true }))).toEqual(["c: segment IMM visible in personal"]);
    expect(auditChunk(doc({ bank: "ing", personal_bank_product_docs: true }))).toEqual(["c: ing in bank_product_docs"]);
    expect(auditChunk(doc({ personal_competitor_docs: true }))).toEqual(["c: Raiffeisen in competitor_docs"]);
    expect(auditChunk(doc({ sectionType: "fees", personal_bank_product_docs: true, personal_banking_help: true })))
      .toEqual(["c: fees in banking_help"]);
    expect(auditChunk(doc({ personal_banking_help: true }))).toEqual(["c: banking_help without bank_product_docs in personal"]);
  });
});

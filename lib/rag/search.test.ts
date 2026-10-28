import { describe, expect, it } from "vitest";
import { planQuery } from "./query";
import { rankHits, type StoredChunk } from "./search";

const chunk = (id: string, sectionType: StoredChunk["sectionType"], docType?: StoredChunk["docType"]): StoredChunk => ({
  _id: id,
  chunkId: `chunk-${id}`,
  text: `text ${id}`,
  embedded: true,
  bank: "raiffeisen",
  personal_bank_product_docs: true,
  personal_competitor_docs: false,
  personal_banking_help: false,
  business_bank_product_docs: false,
  business_competitor_docs: false,
  business_banking_help: false,
  sourceType: docType ? "pdf" : "product_page",
  sectionType,
  url: `https://www.raiffeisen.ro/${id}.html`,
  scrapedAt: "2026-10-28T07:45:27+00:00",
  ...(docType ? { docType } : {}),
});

const docs = new Map([
  ["a", chunk("a", "description")],
  ["b", chunk("b", "fee_table")],
  ["c", chunk("c", "pdf", "tarife")],
]);

describe("rankHits", () => {
  it("returns the top k hits without the internal id, with ranks", () => {
    const hits = rankHits(["a", "b"], ["b"], docs, planQuery("Tell me about it"), { k: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ chunkId: "chunk-b", denseRank: 2, lexicalRank: 1 });
    expect(hits[0]).not.toHaveProperty("_id");
  });

  it("lifts fee sections and tariff PDFs for cost questions on near-ties", () => {
    const neutral = rankHits(["a", "c", "b"], [], docs, planQuery("Tell me about the card"), { k: 3 });
    expect(neutral.map((h) => h.chunkId)).toEqual(["chunk-a", "chunk-c", "chunk-b"]);
    const cost = rankHits(["a", "c", "b"], [], docs, planQuery("What fee does the card have?"), { k: 3 });
    expect(cost[0]!.chunkId).toBe("chunk-c");
  });

  it("drops ids it has no document for", () => {
    expect(rankHits(["x", "a"], [], docs, planQuery("q"), { k: 5 }).map((h) => h.chunkId)).toEqual(["chunk-a"]);
  });
});

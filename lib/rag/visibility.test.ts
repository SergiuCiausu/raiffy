import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "../agent/route";
import { type Bank, PUBLIC_COLLECTIONS, type RawChunk, scopeField, type Segment } from "./schemas";
import { buildProductSegments, collectionsOf, deriveScopeFlags, deriveVisibility } from "./visibility";

const page = (bank: Bank, product: string, segment: Segment, extra: Partial<RawChunk["metadata"]> = {}): RawChunk => ({
  id: `${bank}:${product}#overview-0`,
  text: `${bank}: ${product}`,
  metadata: {
    bank,
    bank_name: bank,
    source_type: "product_page",
    section_type: "overview",
    url: `https://example.ro/${encodeURIComponent(product)}`,
    scraped_at: "2026-10-28T07:45:27+00:00",
    status: "active",
    product,
    segment,
    ...extra,
  },
});

const pdf = (bank: Bank, linked: string[]): RawChunk["metadata"] => ({
  bank,
  bank_name: bank,
  source_type: "pdf",
  section_type: "pdf",
  url: "https://example.ro/doc.pdf",
  scraped_at: "2026-10-28T07:47:16+00:00",
  doc_type: "tarife",
  title: "Tarife",
  linked_products: linked,
});

const chunks = [
  page("raiffeisen", "Card de debit", "persoane fizice"),
  page("raiffeisen", "Card premium", "premium banking"),
  page("raiffeisen", "Overdraft IMM", "IMM"),
  page("raiffeisen", "Custodie", "corporate"),
  page("bcr", "Credit firma", "business (micro, IMM, corporate)"),
  page("bcr", "Card de debit", "micro"),
];
const segments = buildProductSegments(chunks);

describe("deriveVisibility", () => {
  it("maps segments to tracks, including the mixed BCR business segment and micro", () => {
    expect(deriveVisibility(chunks[0]!.metadata, segments)).toEqual({ personal: true, business: false });
    expect(deriveVisibility(chunks[1]!.metadata, segments)).toEqual({ personal: true, business: false });
    expect(deriveVisibility(chunks[2]!.metadata, segments)).toEqual({ personal: false, business: true });
    expect(deriveVisibility(chunks[4]!.metadata, segments)).toEqual({ personal: false, business: true });
    expect(deriveVisibility(chunks[5]!.metadata, segments)).toEqual({ personal: false, business: true });
  });

  it("hides corporate pages from both tracks", () => {
    expect(deriveVisibility(chunks[3]!.metadata, segments)).toEqual({ personal: false, business: false });
  });

  it("gives a PDF the tracks of the same bank's products that link to it", () => {
    expect(deriveVisibility(pdf("raiffeisen", ["Card de debit"]), segments)).toEqual({ personal: true, business: false });
    expect(deriveVisibility(pdf("raiffeisen", ["Overdraft IMM", "Card de debit"]), segments))
      .toEqual({ personal: true, business: true });
    // Same product name at another bank is a different product.
    expect(deriveVisibility(pdf("bcr", ["Card de debit"]), segments)).toEqual({ personal: false, business: true });
  });

  it("hides a PDF whose linked products are unknown", () => {
    expect(deriveVisibility(pdf("ing", ["Nu exista"]), segments)).toEqual({ personal: false, business: false });
    expect(deriveVisibility(pdf("raiffeisen", []), segments)).toEqual({ personal: false, business: false });
  });
});

describe("collectionsOf", () => {
  it("puts Raiffeisen in bank_product_docs, its FAQs also in banking_help, and other banks in competitor_docs", () => {
    expect(collectionsOf(chunks[0]!.metadata)).toEqual(["bank_product_docs"]);
    expect(collectionsOf({ ...chunks[0]!.metadata, section_type: "faq" })).toEqual(["bank_product_docs", "banking_help"]);
    expect(collectionsOf({ ...chunks[5]!.metadata, section_type: "faq" })).toEqual(["competitor_docs"]);
  });

  it("drops withdrawn products from every collection", () => {
    expect(collectionsOf({ ...chunks[4]!.metadata, status: "withdrawn" })).toEqual([]);
  });

  it("only uses collection names the agent route plan knows", () => {
    for (const collection of PUBLIC_COLLECTIONS) expect(COLLECTIONS).toContain(collection);
  });
});

describe("deriveScopeFlags", () => {
  it("sets exactly the track and collection pairs a chunk belongs to", () => {
    const faq = deriveScopeFlags({ ...chunks[0]!.metadata, section_type: "faq" }, segments);
    expect(Object.entries(faq).filter(([, v]) => v).map(([k]) => k).sort())
      .toEqual(["personal_bank_product_docs", "personal_banking_help"]);
    const competitor = deriveScopeFlags(chunks[4]!.metadata, segments);
    expect(Object.entries(competitor).filter(([, v]) => v).map(([k]) => k)).toEqual(["business_competitor_docs"]);
    const corporate = deriveScopeFlags(chunks[3]!.metadata, segments);
    expect(Object.values(corporate).some(Boolean)).toBe(false);
  });

  it("names fields track_collection", () => {
    expect(scopeField("business", "banking_help")).toBe("business_banking_help");
  });
});

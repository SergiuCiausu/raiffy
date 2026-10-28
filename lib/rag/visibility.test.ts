import { describe, expect, it } from "vitest";
import type { RawChunk } from "./schemas";
import { buildProductSegments, deriveVisibility, visibilityField } from "./visibility";

const page = (product: string, segment: NonNullable<RawChunk["metadata"]["segment"]>): RawChunk => ({
  id: `${product}#overview-0`,
  text: `${product} — overview`,
  metadata: {
    source_type: "product_page",
    section_type: "overview",
    url: `https://www.raiffeisen.ro/${encodeURIComponent(product)}.html`,
    scraped_at: "2026-10-28T07:45:27+00:00",
    product,
    segment,
  },
});

const pdf = (linked: string[]): RawChunk["metadata"] => ({
  source_type: "pdf",
  section_type: "pdf",
  url: "https://www.raiffeisen.ro/content/dam/doc.pdf",
  scraped_at: "2026-10-28T07:47:16+00:00",
  doc_type: "tarife",
  title: "Tarife",
  linked_products: linked,
});

const chunks = [
  page("Card de debit", "persoane fizice"),
  page("Card premium", "premium banking"),
  page("Overdraft IMM", "IMM"),
  page("Custodie", "corporate"),
];
const segments = buildProductSegments(chunks);

describe("deriveVisibility", () => {
  it("follows the segment of a product page", () => {
    expect(deriveVisibility(chunks[0]!.metadata, segments)).toEqual({ visiblePersonal: true, visibleBusiness: false });
    expect(deriveVisibility(chunks[1]!.metadata, segments)).toEqual({ visiblePersonal: true, visibleBusiness: false });
    expect(deriveVisibility(chunks[2]!.metadata, segments)).toEqual({ visiblePersonal: false, visibleBusiness: true });
  });

  it("hides corporate pages from both tracks", () => {
    expect(deriveVisibility(chunks[3]!.metadata, segments)).toEqual({ visiblePersonal: false, visibleBusiness: false });
  });

  it("gives a PDF the tracks of the products that link to it", () => {
    expect(deriveVisibility(pdf(["Card de debit"]), segments)).toEqual({ visiblePersonal: true, visibleBusiness: false });
    expect(deriveVisibility(pdf(["Overdraft IMM", "Card de debit"]), segments)).toEqual({
      visiblePersonal: true,
      visibleBusiness: true,
    });
    expect(deriveVisibility(pdf(["Custodie"]), segments)).toEqual({ visiblePersonal: false, visibleBusiness: false });
  });

  it("hides a PDF whose linked products are unknown", () => {
    expect(deriveVisibility(pdf(["Nu exista"]), segments)).toEqual({ visiblePersonal: false, visibleBusiness: false });
    expect(deriveVisibility(pdf([]), segments)).toEqual({ visiblePersonal: false, visibleBusiness: false });
  });
});

describe("visibilityField", () => {
  it("maps a track to its index field", () => {
    expect(visibilityField("personal")).toBe("visiblePersonal");
    expect(visibilityField("business")).toBe("visibleBusiness");
  });
});

import type { Bank, DocType, SearchHit, SectionType } from "./schemas";

const SECTION_TITLES: Record<SectionType, string> = {
  overview: "Overview",
  features: "Features and benefits",
  description: "Description",
  fees: "Fees",
  fee_table: "Fees and rates",
  rate_table: "Interest rates table",
  table: "Table",
  interest_rates: "Interest rates",
  eligibility: "Eligibility",
  required_documents: "Required documents",
  faq: "FAQ",
  representative_example: "Representative example",
  pdf: "Document",
};

const DOC_TITLES: Record<DocType, string> = {
  tarife: "Fees and commissions",
  dobanzi: "Interest rates",
  contract: "Contract",
  fisa: "Product information sheet",
  regulament: "Campaign rules",
  ghid: "Guide",
  termeni: "Terms and conditions",
  altele: "Document",
};

export const BANK_NAMES: Record<Bank, string> = { raiffeisen: "Raiffeisen Bank", ing: "ING Bank", bcr: "BCR" };

type Titled = Pick<SearchHit, "bank" | "sourceType" | "sectionType" | "docType" | "title" | "pageStart" | "pageEnd" | "product" | "heading">;

/** "Bank · product · section" for pages, "Bank · document kind: title, p. N" for PDFs. */
export function resultTitle(hit: Titled): string {
  const bank = BANK_NAMES[hit.bank];
  if (hit.sourceType === "pdf") {
    const kind = hit.docType ? DOC_TITLES[hit.docType] : SECTION_TITLES.pdf;
    const pages = hit.pageStart ? `, p. ${hit.pageStart}${hit.pageEnd && hit.pageEnd !== hit.pageStart ? `-${hit.pageEnd}` : ""}` : "";
    return `${bank} · ${kind}: ${hit.title ?? "document"}${pages}`;
  }
  return `${bank} · ${hit.product ?? "product"} · ${hit.heading ?? SECTION_TITLES[hit.sectionType]}`;
}

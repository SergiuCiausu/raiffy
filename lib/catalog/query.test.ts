import { describe, expect, it } from "vitest";
import type { ProductRecord } from "./products";
import { catalogCitables, catalogNote, catalogQuerySchema, prefetchQuery, queryProducts, queryTerms } from "./query";
import type { TermRecord } from "./schemas";
import { findUngroundedNumbers } from "../rag/numbers";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const personal = { track: "personal" as const, collections: ["bank_product_docs" as const, "competitor_docs" as const] };
const ownOnly = { track: "personal" as const, collections: ["bank_product_docs" as const] };
const q = (raw: object) => catalogQuerySchema.parse(raw);

const term = (over: Partial<TermRecord> & Pick<TermRecord, "termId" | "productId">): TermRecord => ({
  product: "Depozit", bank: "raiffeisen", track: "personal", kind: "interest_rate", label: "3 luni, standard",
  value: { type: "exact", amount: 470 }, unit: "bps", conditions: [],
  comparability: { category: "term_deposit", termMonths: 3, currency: "RON", rateType: "fixed" },
  quote: "dobândă 4,70% pe an",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/d.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" },
  ...over,
});
const rf = term({ termId: "rf#3", productId: "rf" });
const rfUnreviewed = term({ termId: "rf#6", productId: "rf", label: "6 luni", value: { type: "exact", amount: 520 }, quote: "dobândă 5,20% pe an",
  comparability: { ...rf.comparability, termMonths: 6 }, verification: { quoteFound: true } });
const ing = term({ termId: "ing#3", productId: "ing", bank: "ing", value: { type: "exact", amount: 350 }, quote: "3,50%" });
const missing = term({ termId: "bcr#3", productId: "bcr", bank: "bcr", value: { type: "unavailable", reason: "not stated" } });
const mortgage = term({ termId: "rf-casa#3y", productId: "rf-casa", product: "Casa Ta", label: "Fixă 3 ani", comparability: { category: "mortgage_fixed_3y" } });
const records = [rf, rfUnreviewed, ing, missing, mortgage];

const product = (over: Partial<ProductRecord> & Pick<ProductRecord, "productId" | "bank">): ProductRecord => ({
  product: "Flexicredit", kind: "personal_loan", url: "https://www.raiffeisen.ro/p.html", collectedAt: "2026-10-28T07:45:27+00:00", summary: "", guide: false,
  personal_bank_product_docs: over.bank === "raiffeisen", personal_competitor_docs: over.bank !== "raiffeisen", personal_banking_help: false,
  business_bank_product_docs: false, business_competitor_docs: false, business_banking_help: false, ...over,
});

describe("queryTerms", () => {
  it("returns reviewed and unreviewed terms, marking which is which, and lists missing ones as gaps, never as values", () => {
    const r = queryTerms(records, q({ find: "terms", productKind: "term_deposit" }), personal, NOW);
    if (r.find !== "terms") throw new Error();
    expect(r.terms.map((t) => [t.record.termId, t.reviewed])).toEqual([["rf#3", true], ["rf#6", false], ["ing#3", true]]);
    expect(r.gaps).toEqual([{ termId: "bcr#3", productId: "bcr", label: "3 luni, standard", reason: "stated_missing" }]);
  });

  it("reads competitors only when the turn may read competitor documents, whatever banks the model asks for", () => {
    const r = queryTerms(records, q({ find: "terms", banks: ["ing", "raiffeisen"] }), ownOnly, NOW);
    if (r.find !== "terms") throw new Error();
    expect(new Set(r.terms.map((t) => t.record.bank))).toEqual(new Set(["raiffeisen"]));
    expect(queryTerms(records, q({ find: "terms" }), { ...personal, track: "business" }, NOW).total).toBe(0);
  });

  it("filters by term and kind, maps catalog categories to product kinds, and sorts lowest first", () => {
    const sorted = queryTerms(records, q({ find: "terms", productKind: "term_deposit", sort: "lowest" }), personal, NOW);
    if (sorted.find !== "terms") throw new Error();
    expect(sorted.terms.map((t) => t.record.termId)).toEqual(["ing#3", "rf#3", "rf#6"]);
    const six = queryTerms(records, q({ find: "terms", termMonths: 6 }), personal, NOW);
    if (six.find !== "terms") throw new Error();
    expect(six.terms.map((t) => t.record.termId)).toEqual(["rf#6", "rf-casa#3y"]);
    const mortgages = queryTerms(records, q({ find: "terms", productKind: "mortgage" }), personal, NOW);
    expect(mortgages.total).toBe(1);
  });

  it("makes citables whose text carries every figure, and says when a figure isn't reviewed", () => {
    const r = queryTerms([rf, rfUnreviewed], q({ find: "terms" }), personal, NOW);
    const [reviewed, unreviewed] = catalogCitables(r);
    expect(reviewed!.chunkId).toBe("term:rf#3");
    expect(reviewed!.text).toContain("reviewed 2026-10-28");
    expect(unreviewed!.text).toContain("not reviewed yet: a dated public figure copied from the bank's page on 2026-10-28");
    expect(findUngroundedNumbers("The 6-month deposit pays 5.20% a year.", [unreviewed!.text])).toEqual([]);
  });

  it("rejects a query that tries to pass something the schema doesn't know", () => {
    expect(catalogQuerySchema.safeParse({ find: "terms", track: "business" }).success).toBe(false);
    expect(catalogQuerySchema.safeParse({ find: "everything" }).success).toBe(false);
  });
});

describe("queryProducts", () => {
  const products = [
    product({ productId: "rf-loan", bank: "raiffeisen" }),
    product({ productId: "rf-guide", bank: "raiffeisen", guide: true }),
    product({ productId: "rf-card", bank: "raiffeisen", kind: "credit_card", product: "Card de credit Raiffeisen Platinum", summary: "Până la 9 rate fără dobândă." }),
    product({ productId: "ing-loan", bank: "ing", product: "ING Personal" }),
  ];

  it("lists products in scope, without guide pages, filtered by kind", () => {
    const r = queryProducts(products, q({ find: "products", productKind: "personal_loan" }), personal);
    if (r.find !== "products") throw new Error();
    expect(r.products.map((p) => p.productId)).toEqual(["rf-loan", "ing-loan"]);
    const own = queryProducts(products, q({ find: "products" }), ownOnly);
    if (own.find !== "products") throw new Error();
    expect(own.products.map((p) => p.productId)).toEqual(["rf-loan", "rf-card"]);
  });

  it("cites a product with its page and summary, and tells the model when nothing matched", () => {
    const r = queryProducts(products, q({ find: "products", productKind: "credit_card" }), personal);
    expect(catalogCitables(r)[0]).toMatchObject({ chunkId: "product:rf-card", url: "https://www.raiffeisen.ro/p.html" });
    expect(catalogCitables(r)[0]!.text).toContain("Până la 9 rate fără dobândă.");
    expect(catalogNote(queryProducts(products, q({ find: "products", productKind: "mortgage" }), personal))).toContain("use search_knowledge");
  });
});

describe("prefetchQuery", () => {
  it("reads the catalog first for listings, and for comparisons, fees and explanations of a known product kind", () => {
    expect(prefetchQuery({ inquiry: "listing" })).toMatchObject({ find: "products" });
    expect(prefetchQuery({ inquiry: "listing", productKind: "credit_card", banks: ["raiffeisen"] })).toMatchObject({ productKind: "credit_card", banks: ["raiffeisen"] });
    expect(prefetchQuery({ inquiry: "product_comparison", productKind: "term_deposit", banks: ["ing", "bcr"] })).toMatchObject({ find: "terms", productKind: "term_deposit" });
    expect(prefetchQuery({ inquiry: "fees_statements", productKind: "current_account" })).toMatchObject({ termKinds: ["fee"] });
    expect(prefetchQuery({ inquiry: "product_comparison" })).toBeNull();
    expect(prefetchQuery({ inquiry: "purchase_goal", productKind: "personal_loan" })).toBeNull();
    expect(prefetchQuery({ inquiry: "listing", productKind: "spaceship", banks: ["nasa"] })).toEqual(catalogQuerySchema.parse({ find: "products", limit: 12 }));
  });
});

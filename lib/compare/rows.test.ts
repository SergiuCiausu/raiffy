import { describe, expect, it } from "vitest";
import type { TermRecord } from "../catalog/schemas";
import { focusOfLabels, fromCatalog, fromFacts, mergeTables, rowForLabel, rowForTerm } from "./rows";
import type { CompareTable } from "./schemas";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const RZB = "raiffeisen:persoane-fizice__produsele-noastre__credite__credit-de-nevoi-personale-fara-ipoteca";
const BCR = "bcr:persoane-fizice__credite__credit-george";
const reviewed = { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-29T00:30:00Z" };
const term = (productId: string, slug: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${productId}#${slug}`, productId, product: productId.startsWith("bcr") ? "Credit George" : "Flexicredit",
  bank: productId.startsWith("bcr") ? "bcr" : "raiffeisen", track: "personal", kind: "fee", label: slug,
  value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" }, quote: "q",
  provenance: { bank: productId.startsWith("bcr") ? "bcr" : "raiffeisen", url: `https://${productId.split(":")[0]}.ro/loan`, collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2099-01-01", status: "fresh" },
  verification: reviewed, ...over,
});
// The catalog as imported on 2026-10-29: both rates are ranges, the DAE examples differ
const CATALOG: TermRecord[] = [
  term(RZB, "interval-dobanda", { kind: "interest_rate", value: { type: "range", min: 555, max: 1795 }, unit: "bps" }),
  term(RZB, "suma-maxima", { kind: "limit", value: { type: "up_to", max: 5_000_000 }, unit: "minor_eur" }),
  term(RZB, "perioada", { kind: "term", value: { type: "up_to", max: 60 }, unit: "months" }),
  term(RZB, "comision-de-analiza", { value: { type: "exact", amount: 20_000 }, frequency: "once" }),
  term(RZB, "comision-de-administrare", { value: { type: "exact", amount: 500 }, frequency: "monthly" }),
  term(RZB, "dae-in-exemplu", { kind: "dae", value: { type: "exact", amount: 949 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", termMonths: 60 } }),
  term(BCR, "interval-dobanda", { kind: "interest_rate", value: { type: "range", min: 629, max: 1499 }, unit: "bps" }),
  term(BCR, "suma-maxima", { kind: "limit", value: { type: "up_to", max: 25_000_000 } }),
  term(BCR, "perioada", { kind: "term", value: { type: "up_to", max: 60 }, unit: "months" }),
  term(BCR, "comision-de-analiza", { value: { type: "exact", amount: 20_000 }, frequency: "once" }),
  term(BCR, "comision-de-administrare", { value: { type: "exact", amount: 0 }, frequency: "monthly" }),
  term(BCR, "dae-in-exemplu", { kind: "dae", value: { type: "range", min: 994, max: 1641 }, unit: "bps" }),
];
const PRODUCTS = [
  { productId: RZB, name: "Flexicredit", provider: "Raiffeisen", isRaiffeisen: true },
  { productId: BCR, name: "Credit George", provider: "BCR", isRaiffeisen: false },
];
const rowKeys = (t: CompareTable) => t.groups.map((g) => [g.key, g.rows.map((r) => r.key)]);
const row = (t: CompareTable, key: string) => t.groups.flatMap((g) => g.rows).find((r) => r.key === key)!;

describe("mapping terms and labels to rows", () => {
  it("places the imported catalog's terms", () => {
    expect(CATALOG.map(rowForTerm)).toEqual(["interest_rate", "amount", "term", "origination_fee", "administration_fee", "dae",
      "interest_rate", "amount", "term", "origination_fee", "administration_fee", "dae"]);
    expect(rowForTerm({ kind: "eligibility", termId: "x#grad-indatorare", label: "Grad de îndatorare" })).toBeNull();
    expect(rowForTerm({ kind: "fee", termId: "x#comision-rambursare-anticipata", label: "Rambursare anticipată" })).toBe("early_repayment_fee");
  });

  it("reads the model's labels in English and Romanian, the specific row first", () => {
    expect(rowForLabel("APR (DAE), 30,000 lei over 5 years", "costs")).toBe("dae");
    expect(rowForLabel("Interest rate", "costs")).toBe("interest_rate");
    expect(rowForLabel("Monthly payment, 50,000 lei over 18 months", "costs")).toBe("monthly_payment");
    expect(rowForLabel("Comision de analiză", "costs")).toBe("origination_fee");
    expect(rowForLabel("Early repayment fee", "costs")).toBe("early_repayment_fee");
    expect(rowForLabel("Maximum amount", "costs")).toBe("amount");
    expect(rowForLabel("Repayment period", "costs")).toBe("term");
    expect(rowForLabel("Always asked", "documents")).toBe("documents_always");
    expect(rowForLabel("Sometimes asked", "documents")).toBe("documents_sometimes");
    expect(rowForLabel("Needed to apply online", "documents")).toBe("documents_online");
    expect(rowForLabel("Branch opening hours", "costs")).toBeNull();
  });

  it("tells a documents comparison from a cost comparison", () => {
    expect(focusOfLabels(["Always asked", "Sometimes asked", "Needed to apply online"])).toBe("documents");
    expect(focusOfLabels(["Interest rate", "Analysis fee", "Always asked"])).toBe("costs");
  });
});

describe("the table from the catalog", () => {
  it("shows cost, amounts and commissions in a fixed order, and no payment from a range", () => {
    const t = fromCatalog({ products: PRODUCTS, records: CATALOG, now: NOW, focus: "costs" });
    expect(rowKeys(t)).toEqual([
      ["cost", ["dae", "interest_rate"]], ["amounts", ["amount", "term"]], ["commissions", ["origination_fee", "administration_fee"]],
    ]);
    expect(row(t, "interest_rate").cells[0]).toMatchObject({ state: "value", value: { type: "range", min: 555, max: 1795 }, unit: "bps" });
    expect(row(t, "administration_fee").cells[1]).toMatchObject({ state: "value", value: { type: "exact", amount: 0 }, frequency: "monthly" });
    expect(row(t, "amount").cells[0]).toMatchObject({ unit: "minor_eur" });
    // Different DAE examples aren't comparable, and BCR's is a range: no yellow light
    expect(t).toMatchObject({ deciding: "dae", best: null, paymentUnavailable: false });
  });

  it("says the payment needs an exact rate when the customer gave an amount and a term", () => {
    const t = fromCatalog({ products: PRODUCTS, records: CATALOG, now: NOW, focus: "costs",
      scenario: { amount: 3_000_000, months: 60 }, firstPaymentDate: "2026-12-01" });
    expect(rowKeys(t)[0]).toEqual(["cost", ["dae", "interest_rate"]]);
    expect(t).toMatchObject({ paymentUnavailable: true, scenario: { amount: 3_000_000, months: 60 } });
  });

  it("calculates payment and total cost from an exact reviewed rate and confirmed fees, and lights the cheaper", () => {
    const exact = CATALOG.map((r) => r.kind === "interest_rate"
      ? { ...r, value: { type: "exact" as const, amount: r.productId === RZB ? 790 : 999 } } : r);
    const t = fromCatalog({ products: PRODUCTS, records: exact, now: NOW, focus: "costs",
      scenario: { amount: 3_000_000, months: 60 }, firstPaymentDate: "2026-12-01" });
    expect(rowKeys(t)[0]).toEqual(["cost", ["total_cost", "monthly_payment", "dae", "interest_rate"]]);
    const [rzb, bcr] = row(t, "total_cost").cells;
    expect(rzb).toMatchObject({ state: "value", computed: true, unit: "minor_ron", source: { url: "https://raiffeisen.ro/loan" } });
    expect(bcr).toMatchObject({ state: "value", computed: true });
    expect(t).toMatchObject({ deciding: "total_cost", best: 0, paymentUnavailable: false });
    // 60 payments, a 200 lei analysis fee and 5 lei a month: more than the 30,000 lei borrowed
    expect(rzb!.state === "value" && rzb!.value.type === "exact" && rzb!.value.amount).toBeGreaterThan(3_000_000 + 20_000 + 60 * 500);
  });

  it("marks unreviewed, stale, unquoted and stated-missing terms 'not confirmed', never zero", () => {
    const records = CATALOG.map((r) => {
      if (r.termId === `${BCR}#comision-de-analiza`) return { ...r, verification: { quoteFound: true } };
      if (r.termId === `${BCR}#comision-de-administrare`) return { ...r, provenance: { ...r.provenance, reviewBy: "2026-10-01" } };
      if (r.termId === `${BCR}#dae-in-exemplu`) return { ...r, value: { type: "unavailable" as const, reason: "indisponibil" } };
      return r;
    });
    const t = fromCatalog({ products: PRODUCTS, records, now: NOW, focus: "costs" });
    expect(row(t, "origination_fee").cells[1]).toEqual({ state: "not_confirmed", reason: "unreviewed", termId: `${BCR}#comision-de-analiza` });
    expect(row(t, "administration_fee").cells[1]).toMatchObject({ state: "not_confirmed", reason: "stale" });
    expect(row(t, "dae").cells[1]).toMatchObject({ state: "not_confirmed", reason: "stated_missing" });
  });

  it("drops rows no product has, and shows a missing term as 'not in the sources'", () => {
    const t = fromCatalog({ products: PRODUCTS, records: CATALOG.filter((r) => r.termId !== `${BCR}#perioada`), now: NOW, focus: "costs" });
    expect(row(t, "term").cells[1]).toEqual({ state: "not_in_sources" });
    expect(rowKeys(t).flatMap(([, rows]) => rows)).not.toContain("insurance");
  });

  it("shows only documents for a documents question", () => {
    const t = fromCatalog({ products: PRODUCTS, records: CATALOG, now: NOW, focus: "documents" });
    expect(t.groups).toEqual([]);
  });
});

describe("the table from the model's card", () => {
  // The card in the screenshot: Raiffeisen Flexicredit vs BCR George loan, documents only
  const DOCS = {
    options: [
      { name: "Flexicredit", provider: "Raiffeisen", isRaiffeisen: true, facts: [
        { label: "Always asked", value: "ID + ANAF income consent", source: "https://raiffeisen.ro/acte" },
        { label: "Sometimes asked", value: "Income proof", source: "https://raiffeisen.ro/acte" }] },
      { name: "George loan", provider: "BCR", isRaiffeisen: false, facts: [
        { label: "Needed to apply online", value: "ID + income proof", source: "https://bcr.ro/george" }] },
    ],
  };

  it("keeps a documents card to the document rows", () => {
    const t = fromFacts(DOCS);
    expect(t.focus).toBe("documents");
    expect(rowKeys(t)).toEqual([["documents", ["documents_always", "documents_sometimes", "documents_online"]]]);
    expect(row(t, "documents_always").cells).toEqual([
      { state: "value", value: { type: "text", text: "ID + ANAF income consent" }, unit: "none", source: { url: "https://raiffeisen.ro/acte" }, termId: null, computed: false },
      { state: "not_in_sources" },
    ]);
    expect(t.best).toBeNull();
  });

  it("puts cost facts in the fixed order, whatever order the model wrote them in", () => {
    const t = fromFacts({ options: [
      { name: "Flexicredit", isRaiffeisen: true, facts: [{ label: "Analysis fee", value: "200 lei", source: "https://r.ro" }, { label: "DAE", value: "9.49%", source: "https://r.ro" }] },
      { name: "Credit George", isRaiffeisen: false, facts: [{ label: "Interest rate", value: "6.29% – 14.99%", source: "https://b.ro" }] },
    ] });
    expect(rowKeys(t)).toEqual([["cost", ["dae", "interest_rate"]], ["commissions", ["origination_fee"]]]);
  });
});

describe("catalog first, then search", () => {
  it("fills what the catalog lacks and keeps what it confirmed or flagged", () => {
    const catalog = fromCatalog({ products: PRODUCTS, records: CATALOG.filter((r) => r.productId === RZB), now: NOW, focus: "costs" });
    const search = fromFacts({ focus: "costs", options: [
      { name: "Flexicredit", isRaiffeisen: true, facts: [{ label: "Interest rate", value: "5.55%", source: "https://elsewhere.ro" }] },
      { name: "Credit George", isRaiffeisen: false, facts: [{ label: "Interest rate", value: "6.29% – 14.99%", source: "https://bcr.ro/george" },
        { label: "Early repayment fee", value: "0.5%", source: "https://bcr.ro/george" }] },
    ] });
    const t = mergeTables(catalog, search);
    expect(row(t, "interest_rate").cells[0]).toMatchObject({ value: { type: "range", min: 555, max: 1795 } }); // the catalog wins
    expect(row(t, "interest_rate").cells[1]).toMatchObject({ value: { type: "text", text: "6.29% – 14.99%" } });
    expect(row(t, "early_repayment_fee").cells).toEqual([{ state: "not_in_sources" }, expect.objectContaining({ state: "value" })]);
    expect(t.best).toBeNull();
    expect(() => mergeTables(catalog, fromFacts({ focus: "documents", options: [
      { name: "A", isRaiffeisen: true, facts: [{ label: "Always asked", value: "ID" }] }, { name: "B", isRaiffeisen: false, facts: [] }] }))).toThrow("tables_not_aligned");
  });
});

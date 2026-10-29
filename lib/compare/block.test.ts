import { describe, expect, it } from "vitest";
import type { TermRecord } from "../catalog/schemas";
import { cellText, compareBlockSchema, compareCitables, comparisonBlock, groundedScenario, keepCited } from "./block";
import { fromCatalog } from "./rows";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const RZB = "raiffeisen:personal-loan";
const BCR = "bcr:credit-george";
const RZB_URL = "https://www.raiffeisen.ro/loan.html";
const BCR_URL = "https://www.bcr.ro/credit-george";
const term = (productId: string, slug: string, over: Partial<TermRecord>): TermRecord => {
  const bank = productId.startsWith("bcr") ? "bcr" : "raiffeisen";
  return {
    termId: `${productId}#${slug}`, productId, product: bank === "bcr" ? "Credit George" : "Credit de nevoi personale", bank, track: "personal",
    kind: "fee", label: slug, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
    comparability: { category: "personal_loan", currency: "RON" }, quote: "q",
    provenance: { bank, url: bank === "bcr" ? BCR_URL : RZB_URL, collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2099-01-01", status: "fresh" },
    verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-29T00:30:00Z" }, ...over,
  };
};
const RECORDS = [
  term(RZB, "interval-dobanda", { kind: "interest_rate", value: { type: "range", min: 555, max: 1795 }, unit: "bps" }),
  term(RZB, "comision-de-analiza", { value: { type: "exact", amount: 20_000 }, frequency: "once" }),
  term(RZB, "comision-de-administrare", { value: { type: "exact", amount: 500 }, frequency: "monthly" }),
  term(BCR, "interval-dobanda", { kind: "interest_rate", value: { type: "range", min: 629, max: 1499 }, unit: "bps" }),
  term(BCR, "comision-de-analiza", { value: { type: "exact", amount: 20_000 }, frequency: "once" }),
  term(BCR, "comision-de-administrare", { value: { type: "exact", amount: 0 }, frequency: "monthly" }),
];
const PRODUCTS = [
  { productId: RZB, name: "Credit de nevoi personale", provider: "Raiffeisen", isRaiffeisen: true },
  { productId: BCR, name: "Credit George", provider: "BCR", isRaiffeisen: false },
];
const host = () => fromCatalog({ products: PRODUCTS, records: RECORDS, now: NOW, focus: "costs" });
const all = () => true;
const rowsOf = (b: { table: { groups: { rows: { key: string }[] }[] } }) => b.table.groups.flatMap((g) => g.rows.map((r) => r.key));

describe("the customer's amount and term", () => {
  const req = { productIds: [RZB, BCR], focus: "costs" as const, amountLei: 30000, months: 60 };
  it("count only when the customer said them, years included", () => {
    expect(groundedScenario(req, ["Compare them for 30,000 lei over 5 years"])).toEqual({ amount: 3_000_000, months: 60 });
    expect(groundedScenario(req, ["Compare them for 30.000 lei over 60 months"])).toEqual({ amount: 3_000_000, months: 60 });
    expect(groundedScenario(req, ["Compare Flexicredit and Credit George"])).toBeNull();
    expect(groundedScenario({ ...req, months: undefined }, ["30,000 lei"])).toBeNull();
  });
});

describe("what the model can cite", () => {
  it("writes each cell as the card shows it", () => {
    const t = host();
    const rate = t.groups[0]!.rows[0]!.cells[0]!;
    expect(cellText(rate)).toBe("5.55% to 17.95%");
    const fee = t.groups.find((g) => g.key === "commissions")!.rows.find((r) => r.key === "administration_fee")!;
    expect(fee.cells.map(cellText)).toEqual(["5 lei a month", "none"]);
    expect(cellText({ state: "not_confirmed", reason: "unreviewed", termId: null })).toBe("not confirmed");
  });

  it("gives one citable per product, on its page, with every row", () => {
    const c = compareCitables(host());
    expect(c.map((x) => [x.chunkId, x.url])).toEqual([[`compare:${RZB}`, RZB_URL], [`compare:${BCR}`, BCR_URL]]);
    expect(c[0]!.text).toContain("Interest rate: 5.55% to 17.95%.");
    expect(c[0]!.text).toContain("Analysis fee: 200 lei once.");
    expect(c[1]!.text).toContain("Administration fee: none.");
  });
});

describe("only cited values show", () => {
  it("turns a value whose page the answer doesn't cite into 'not in the sources'", () => {
    const t = keepCited(host(), (url) => url === RZB_URL);
    const rate = t.groups[0]!.rows.find((r) => r.key === "interest_rate")!;
    expect(rate.cells[1]).toEqual({ state: "not_in_sources" });
    expect(keepCited(host(), () => false).groups).toEqual([]);
  });
});

describe("the comparison block", () => {
  // The screenshot's card: the model's own documents comparison, no catalog table
  const docsCard = {
    type: "comparison", title: "Documents: Raiffeisen vs BCR personal loan",
    options: [
      { name: "Flexicredit", provider: "Raiffeisen", isRaiffeisen: true, facts: [
        { label: "Always asked", value: "ID + ANAF income consent", source: RZB_URL }, { label: "Sometimes asked", value: "Income proof", source: RZB_URL }] },
      { name: "George loan", provider: "BCR", isRaiffeisen: false, facts: [{ label: "Needed to apply online", value: "ID + income proof", source: BCR_URL }] },
    ],
  };

  it("puts the model's documents card into the document rows and replaces it", () => {
    const { block, replaced } = comparisonBlock({ host: null, cards: [docsCard], cited: all });
    expect(replaced).toBe(1);
    expect(compareBlockSchema.parse(block)).toMatchObject({ type: "compare_table", title: "Documents: Raiffeisen vs BCR personal loan" });
    expect(rowsOf(block!)).toEqual(["documents_always", "documents_sometimes", "documents_online"]);
  });

  it("shows the catalog table, named as the customer named the products, with the model's facts in its gaps", () => {
    const costCard = {
      type: "comparison", title: "Flexicredit vs Credit George",
      options: [
        // The model listed BCR first: it lines up by bank, not by position
        { name: "Credit George", provider: "BCR", isRaiffeisen: false, facts: [{ label: "Early repayment fee", value: "0.5% of the amount repaid", source: BCR_URL },
          { label: "Interest rate", value: "6%", source: BCR_URL }] },
        { name: "Flexicredit", provider: "Raiffeisen", isRaiffeisen: true, facts: [] },
      ],
      recommendation: { option: "Flexicredit", reasons: ["A fixed rate for the whole term."], whenOther: "Credit George fits better if you want no monthly fee." },
    };
    const { block } = comparisonBlock({ host: host(), cards: [costCard], cited: all });
    expect(block!.table.products.map((p) => p.name)).toEqual(["Flexicredit", "Credit George"]);
    expect(rowsOf(block!)).toEqual(["interest_rate", "origination_fee", "administration_fee", "early_repayment_fee"]);
    const rate = block!.table.groups[0]!.rows[0]!.cells[1]!;
    expect(rate).toMatchObject({ value: { type: "range", min: 629, max: 1499 } }); // the catalog wins over the model's "6%"
    expect(block!.recommendation?.option).toBe("Flexicredit");
  });

  it("shows the catalog table alone when the model made no card, and nothing when nothing is cited", () => {
    expect(comparisonBlock({ host: host(), cards: [], cited: all }).block?.title).toBe("Credit de nevoi personale vs Credit George");
    expect(comparisonBlock({ host: host(), cards: [], cited: () => false })).toEqual({ block: null, replaced: 0 });
    expect(comparisonBlock({ host: null, cards: [{ type: "keyFacts" }], cited: all })).toEqual({ block: null, replaced: 0 });
  });

  it("drops a recommendation that names no product on the card", () => {
    const card = { ...docsCard, recommendation: { option: "Some other loan", reasons: ["x"], whenOther: "y" } };
    expect(comparisonBlock({ host: null, cards: [card], cited: all }).block?.recommendation).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { TermRecord } from "./schemas";
import { buildProductTermsResult, comparable, requestedKinds } from "./terms";

const NOW = Date.parse("2026-10-28T12:00:00Z");

const term = (over: Partial<TermRecord> & Pick<TermRecord, "termId" | "productId">): TermRecord => ({
  product: "Depozit", bank: "raiffeisen", track: "personal", kind: "interest_rate", label: "3 luni, standard",
  value: { type: "exact", amount: 470 }, unit: "bps", conditions: [],
  comparability: { category: "term_deposit", termMonths: 3, currency: "RON", rateType: "fixed" },
  quote: "dobândă 4.70% pe an",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/d.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" },
  ...over,
});

const rf = term({ termId: "rf#3", productId: "rf" });
const ing = term({ termId: "ing#3", productId: "ing", bank: "ing", value: { type: "exact", amount: 350 } });
const ingBonus = term({ termId: "ing#3b", productId: "ing", bank: "ing", comparability: { ...ing.comparability, rateType: "promo" } });
const run = (productIds: string[], records: TermRecord[], query = "interest rate", now = NOW) =>
  buildProductTermsResult({ track: "personal", query, productIds, records, now });

describe("get_product_terms", () => {
  it("returns fresh, quoted and reviewed values", () => {
    const result = run(["rf"], [rf]);
    expect(result.status).toBe("ok");
    expect(result.products[0]!.terms).toEqual([rf]);
    expect(result.unavailable).toEqual([]);
  });

  it("lists an unreviewed value as unavailable", () => {
    const result = run(["rf"], [{ ...rf, verification: { quoteFound: true } }]);
    expect(result).toMatchObject({ status: "unavailable", reason: "no_usable_terms" });
    expect(result.unavailable).toEqual([{ productId: "rf", termId: "rf#3", label: "3 luni, standard", kind: "interest_rate", reason: "unreviewed" }]);
  });

  it("lists a value past its review date as stale", () => {
    expect(run(["rf"], [rf], "rate", Date.parse("2026-11-28T00:00:00Z")).unavailable[0]!.reason).toBe("stale");
  });

  it("never turns a stated gap into a number", () => {
    const gap = term({ termId: "rf#fee", productId: "rf", kind: "fee", label: "Comisioane", value: { type: "unavailable", reason: "nu apare pe pagină" }, unit: "none" });
    const result = run(["rf"], [gap], "fees");
    expect(result.products[0]!.terms).toEqual([]);
    expect(result.unavailable[0]).toMatchObject({ reason: "stated_missing", kind: "fee" });
  });

  it("names requested kinds the catalog doesn't hold and unknown products", () => {
    const result = run(["rf", "nope"], [rf], "rate and fees");
    expect(result.unavailable).toEqual(expect.arrayContaining([
      { productId: "rf", kind: "fee", reason: "not_in_catalog" },
      { productId: "nope", reason: "unknown_product" },
    ]));
  });

  it("returns nothing from another track", () => {
    const business = { ...rf, track: "business" as const };
    expect(run(["rf"], [business]).unavailable).toEqual([{ productId: "rf", reason: "unknown_product" }]);
  });

  it("compares only values with matching terms, rate type and currency", () => {
    const result = run(["rf", "ing"], [rf, ing, ingBonus]);
    expect(result.comparisons).toEqual([{ kind: "interest_rate", comparable: true, termIds: ["rf#3", "ing#3"] }]);
    expect(comparable(rf, ingBonus)).toBe(false);
    const sixMonths = { ...ing, termId: "ing#6", comparability: { ...ing.comparability, termMonths: 6 } };
    expect(run(["rf", "ing"], [rf, sixMonths]).comparisons).toEqual([
      { kind: "interest_rate", comparable: false, termIds: ["rf#3", "ing#6"], reason: "comparability_mismatch" },
    ]);
  });

  it("reads the kinds a query asks for in English and Romanian", () => {
    expect(requestedKinds("What is the DAE and the analysis fee?")).toEqual(["dae", "fee"]);
    expect(requestedKinds("dobânda și comisionul de administrare")).toEqual(["interest_rate", "fee"]);
    expect(requestedKinds("tell me about it")).toEqual([]);
  });
});

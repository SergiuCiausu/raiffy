import { describe, expect, it } from "vitest";
import type { TermRecord } from "./schemas";
import { checkChange, quoteNumbers, quoteShowsValue, sameValue, snapshotOf } from "./changes";

const TODAY = "2026-10-29";
const term = (over: Partial<TermRecord> = {}): TermRecord => ({
  termId: "rf-rate", productId: "rf", product: "Credit", bank: "raiffeisen", track: "personal", kind: "interest_rate", label: "Dobândă",
  value: { type: "exact", amount: 790 }, unit: "bps", conditions: [],
  comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" },
  quote: "dobândă fixă 7,90%",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/c.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true },
  ...over,
});
const input = (over: Record<string, unknown> = {}) => ({
  value: { type: "exact", amount: 750 }, quote: "dobândă fixă 7,50%", url: "https://www.raiffeisen.ro/c.html", reviewBy: "2027-01-31", note: "", ...over,
});

describe("checkChange", () => {
  it("accepts a new value with its source and a review date ahead", () => {
    expect(checkChange(term(), input(), TODAY, false)).toMatchObject({ ok: true, kind: "edit" });
  });

  it("treats the same value with a fresh review date as re-confirming it", () => {
    expect(checkChange(term(), input({ value: { type: "exact", amount: 790 }, quote: "dobândă fixă 7,90%" }), TODAY, true)).toMatchObject({ ok: true, kind: "confirm" });
  });

  it("refuses a change that changes nothing, unless the value needs review", () => {
    const same = input({ value: { type: "exact", amount: 790 }, quote: "dobândă fixă 7,90%", reviewBy: "2026-11-27" });
    expect(checkChange(term(), same, TODAY, true)).toEqual({ ok: false, reason: "no_change" });
    const later = input({ value: { type: "exact", amount: 790 }, quote: "dobândă fixă 7,90%" });
    expect(checkChange(term(), later, TODAY, false)).toEqual({ ok: false, reason: "no_change" });
  });

  it("refuses bad values, a missing quote, a non-https source and review dates out of range", () => {
    expect(checkChange(term(), input({ value: { type: "range", min: 900, max: 500 } }), TODAY, false)).toEqual({ ok: false, reason: "value_invalid" });
    expect(checkChange(term(), input({ value: { type: "exact", amount: -1 } }), TODAY, false)).toEqual({ ok: false, reason: "value_invalid" });
    expect(checkChange(term(), input({ value: { type: "exact", amount: 7.5 } }), TODAY, false)).toEqual({ ok: false, reason: "value_invalid" });
    expect(checkChange(term(), input({ value: { type: "unavailable", reason: "x" } }), TODAY, false)).toEqual({ ok: false, reason: "value_invalid" });
    expect(checkChange(term(), input({ quote: "  " }), TODAY, false)).toEqual({ ok: false, reason: "quote_missing" });
    expect(checkChange(term(), input({ url: "http://www.raiffeisen.ro/c.html" }), TODAY, false)).toEqual({ ok: false, reason: "url_invalid" });
    expect(checkChange(term(), input({ reviewBy: TODAY }), TODAY, false)).toEqual({ ok: false, reason: "review_date_invalid" });
    expect(checkChange(term(), input({ reviewBy: "2029-01-01" }), TODAY, false)).toEqual({ ok: false, reason: "review_date_invalid" });
  });
});

describe("quotes", () => {
  it("reads numbers in Romanian and English style", () => {
    expect(quoteNumbers("dobândă 7,90%, minim 1.500 lei")).toEqual(expect.arrayContaining([7.9, 1500]));
    expect(quoteNumbers("up to 60 months, 1,500 lei")).toEqual(expect.arrayContaining([60, 1500]));
  });

  it("checks the quote states every figure of the value", () => {
    expect(quoteShowsValue({ type: "exact", amount: 790 }, "bps", "dobândă fixă 7,90%")).toBe(true);
    expect(quoteShowsValue({ type: "exact", amount: 750 }, "bps", "dobândă fixă 7,90%")).toBe(false);
    expect(quoteShowsValue({ type: "range", min: 100_000, max: 25_000_000 }, "minor_ron", "între 1.000 și 250.000 lei")).toBe(true);
    expect(quoteShowsValue({ type: "exact", amount: 0 }, "minor_ron", "fără comision de administrare")).toBe(true);
  });

  it("compares values whatever their key order, and snapshots what a change replaces", () => {
    expect(sameValue({ type: "range", min: 1, max: 2 }, { max: 2, min: 1, type: "range" } as never)).toBe(true);
    expect(snapshotOf(term())).toEqual({ value: { type: "exact", amount: 790 }, quote: "dobândă fixă 7,90%", url: "https://www.raiffeisen.ro/c.html", reviewBy: "2026-11-27" });
  });
});

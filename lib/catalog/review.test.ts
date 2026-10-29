import { describe, expect, it } from "vitest";
import { TERM_KINDS, type TermRecord } from "./schemas";
import { groupOf, productReview, reviewState, termUse } from "./review";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const TODAY = "2026-10-28";

const term = (over: Partial<TermRecord> & Pick<TermRecord, "termId">): TermRecord => ({
  productId: "rf", product: "Credit", bank: "raiffeisen", track: "personal", kind: "interest_rate", label: "Dobândă",
  value: { type: "exact", amount: 790 }, unit: "bps", conditions: [],
  comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" },
  quote: "dobândă fixă 7,90%",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/c.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" },
  ...over,
});

describe("reviewState", () => {
  it("is stale the day after the review date, due inside the window, ok before it", () => {
    expect(reviewState("2026-10-27", TODAY, 14)).toBe("stale");
    expect(reviewState("2026-10-28", TODAY, 14)).toBe("due");
    expect(reviewState("2026-11-11", TODAY, 14)).toBe("due");
    expect(reviewState("2026-11-12", TODAY, 14)).toBe("ok");
  });

  it("rejects dates that aren't ISO days", () => {
    expect(() => reviewState("27/11/2026", TODAY, 14)).toThrow();
  });
});

describe("termUse", () => {
  it("follows the get_product_terms gap rule", () => {
    expect(termUse(term({ termId: "a" }), NOW)).toBe("usable");
    expect(termUse(term({ termId: "b", verification: { quoteFound: true } }), NOW)).toBe("unreviewed");
    expect(termUse(term({ termId: "c", verification: { quoteFound: false } }), NOW)).toBe("quote_not_found");
    expect(termUse(term({ termId: "d", value: { type: "unavailable", reason: "lipsă" }, unit: "none" }), NOW)).toBe("stated_missing");
  });
});

describe("productReview", () => {
  it("counts usable, unreviewed, due and stale values and finds the earliest review date", () => {
    const r = productReview([
      term({ termId: "a" }),
      term({ termId: "b", kind: "fee", verification: { quoteFound: true }, provenance: { ...term({ termId: "x" }).provenance, reviewBy: "2026-11-05" } }),
      term({ termId: "c", kind: "limit", provenance: { ...term({ termId: "x" }).provenance, reviewBy: "2026-10-20" } }),
    ], TODAY, NOW, 14);
    expect(r).toMatchObject({ terms: 3, usable: 1, unreviewed: 1, due: 1, stale: 1, nextReviewBy: "2026-10-20", headlineTermId: "a" });
  });

  it("prefers a usable interest rate as the headline, and never a text value", () => {
    const text = term({ termId: "t", value: { type: "text", text: "de la 5,55%" }, unit: "none" });
    const unreviewed = term({ termId: "u", verification: { quoteFound: true } });
    const usable = term({ termId: "v" });
    expect(productReview([text, unreviewed, usable], TODAY, NOW, 14).headlineTermId).toBe("v");
    expect(productReview([text, unreviewed], TODAY, NOW, 14).headlineTermId).toBe("u");
    expect(productReview([text], TODAY, NOW, 14).headlineTermId).toBeNull();
  });

  it("has no dates or headline without values", () => {
    expect(productReview([], TODAY, NOW, 14)).toEqual({ terms: 0, usable: 0, unreviewed: 0, due: 0, stale: 0, nextReviewBy: null, headlineTermId: null });
  });
});

describe("groupOf", () => {
  it("puts every kind in a group", () => {
    for (const kind of TERM_KINDS) expect(groupOf(kind)).toBeTruthy();
  });
});

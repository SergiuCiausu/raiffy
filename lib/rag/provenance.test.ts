import { describe, expect, it } from "vitest";
import { buildProvenance, freshness, reviewByFor } from "./provenance";

const collectedAt = "2026-10-28T07:45:27+00:00";
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

describe("reviewByFor", () => {
  it("adds 30 days for volatile values and 90 for stable ones", () => {
    expect(reviewByFor(collectedAt, "volatile")).toBe("2026-11-27");
    expect(reviewByFor(collectedAt, "stable")).toBe("2027-01-26");
  });

  it("uses the source's own end date when it comes first", () => {
    expect(reviewByFor(collectedAt, "volatile", "2026-11-15")).toBe("2026-11-15");
    expect(reviewByFor(collectedAt, "volatile", "2027-03-01")).toBe("2026-11-27");
  });
});

describe("freshness", () => {
  it("is fresh through the review day and stale after it", () => {
    expect(freshness("2026-11-27", day("2026-11-27"))).toBe("fresh");
    expect(freshness("2026-11-27", day("2026-11-28"))).toBe("stale");
  });
});

describe("buildProvenance", () => {
  it("builds a validated record with the computed status", () => {
    const p = buildProvenance({
      bank: "ing", url: "https://ing.ro/x", chunkId: "ing:x#faq-1", collectedAt, volatility: "volatile", now: day("2026-12-01"),
    });
    expect(p).toEqual({
      bank: "ing", url: "https://ing.ro/x", chunkId: "ing:x#faq-1", collectedAt, reviewBy: "2026-11-27", status: "stale",
    });
  });
});

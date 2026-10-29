import { describe, expect, it } from "vitest";
import { formOf, quoteShowsValue, valueOf } from "./catalog-api";

describe("the catalog value editor", () => {
  it("shows stored values in the units people type", () => {
    expect(formOf({ type: "exact", amount: 940 }, "bps")).toMatchObject({ type: "exact", a: "9.4" });
    expect(formOf({ type: "range", min: 100_000, max: 25_000_000 }, "minor_ron")).toMatchObject({ type: "range", a: "1000", b: "250000" });
    expect(formOf({ type: "up_to", max: 60 }, "months")).toMatchObject({ type: "up_to", a: "60" });
    expect(formOf({ type: "unavailable", reason: "x" }, "bps")).toMatchObject({ type: "exact", a: "" });
  });

  it("stores what people type, and refuses what can't be stored", () => {
    expect(valueOf({ type: "exact", a: "9,25", b: "", text: "" }, "bps")).toEqual({ type: "exact", amount: 925 });
    expect(valueOf({ type: "range", a: "1 000", b: "250000", text: "" }, "minor_ron")).toEqual({ type: "range", min: 100_000, max: 25_000_000 });
    expect(valueOf({ type: "range", a: "10", b: "5", text: "" }, "months")).toBeNull();
    expect(valueOf({ type: "exact", a: "-1", b: "", text: "" }, "months")).toBeNull();
    expect(valueOf({ type: "exact", a: "7.5", b: "", text: "" }, "months")).toBeNull();
    expect(valueOf({ type: "text", a: "", b: "", text: "  " }, "none")).toBeNull();
  });

  it("checks the quote the same way the backend does (lib/catalog/changes.test.ts)", () => {
    expect(quoteShowsValue({ type: "exact", amount: 790 }, "bps", "dobândă fixă 7,90%")).toBe(true);
    expect(quoteShowsValue({ type: "exact", amount: 750 }, "bps", "dobândă fixă 7,90%")).toBe(false);
    expect(quoteShowsValue({ type: "range", min: 100_000, max: 25_000_000 }, "minor_ron", "între 1.000 și 250.000 lei")).toBe(true);
    expect(quoteShowsValue({ type: "exact", amount: 0 }, "minor_ron", "fără comision de administrare")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { findQuote, spellings } from "./quote";
import type { TermRecord } from "./schemas";
import { buildSeedRecords, parseCsv, parseRoNumber, parseSeedRows, parseSeedValue, type SeedChunk, statedEndIn } from "./seed";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const URL_LOAN = "https://www.raiffeisen.ro/ro/persoane-fizice/produsele-noastre/credite/credit-de-nevoi-personale-fara-ipoteca.html";
const HEADER = "categorie,indicator,banca,valoare,valoare_numerica,conditii,url_sursa,data_colectarii";

const chunk = (text: string, over: Partial<SeedChunk> = {}): SeedChunk => ({
  chunkId: "raiffeisen:loan#fees-1", text, url: URL_LOAN, scrapedAt: "2026-10-28T07:45:27+00:00",
  productId: "raiffeisen:loan", product: "Ai planuri? E ușor când ai bani", ...over,
});

describe("parseCsv", () => {
  it("keeps commas and doubled quotes inside quoted fields and drops the BOM", () => {
    expect(parseCsv('﻿a,b\r\n"4,70%","say ""hi"""\n')).toEqual([["a", "b"], ["4,70%", 'say "hi"']]);
  });
});

describe("parseRoNumber", () => {
  it.each([["50.000", 50000], ["5,55", 5.55], ["2.000", 2000], ["12,1", 12.1], ["200", 200]])("%s → %d", (text, n) => {
    expect(parseRoNumber(text)).toBe(n);
  });
});

describe("parseSeedValue", () => {
  it.each([
    ["4,70%", { value: { type: "exact", amount: 470 }, unit: "bps" }],
    ["5,55% – 17,95%", { value: { type: "range", min: 555, max: 1795 }, unit: "bps" }],
    ["de la 5,05%", { value: { type: "from", min: 505 }, unit: "bps" }],
    ["până la 6%", { value: { type: "up_to", max: 600 }, unit: "bps" }],
    ["200 lei", { value: { type: "exact", amount: 20000 }, unit: "minor_ron" }],
    ["5 lei / lună", { value: { type: "exact", amount: 500 }, unit: "minor_ron", frequency: "monthly" }],
    ["0 lei", { value: { type: "exact", amount: 0 }, unit: "minor_ron" }],
    ["2.000 – 200.000 lei", { value: { type: "range", min: 200000, max: 20000000 }, unit: "minor_ron" }],
    ["până la echivalentul a 50.000 euro", { value: { type: "up_to", max: 5000000 }, unit: "minor_eur" }],
    ["până la 5 ani (60 de luni)", { value: { type: "up_to", max: 60 }, unit: "months" }],
    ["1 – 5 ani", { value: { type: "range", min: 12, max: 60 }, unit: "months" }],
    ["3 – 30 de ani", { value: { type: "range", min: 36, max: 360 }, unit: "months" }],
    ["Până la 45 de zile", { value: { type: "up_to", max: 45 }, unit: "days" }],
  ])("reads %s", (raw, expected) => {
    expect(parseSeedValue(raw)).toEqual(expected);
  });

  it("keeps a missing value missing, never zero", () => {
    for (const raw of ["indisponibil", "nu apare pe pagină", "nespecificat pe pagină (maximum 85% din valoarea investiției)"]) {
      expect(parseSeedValue(raw).value).toEqual({ type: "unavailable", reason: raw });
    }
  });

  it("leaves anything it can't read exactly as text", () => {
    expect(parseSeedValue("IRCC + 2,30%").value).toEqual({ type: "text", text: "IRCC + 2,30%" });
    expect(parseSeedValue("0 lei cu convenție salarială ING; altfel 200 lei").value.type).toBe("text");
  });
});

describe("quote verifier", () => {
  it("accepts either decimal mark and a dropped trailing zero", () => {
    expect(spellings("4,70")).toEqual(expect.arrayContaining(["4,70", "4.70", "4,7", "4.7"]));
  });

  it("needs every number of the value in one chunk", () => {
    const chunks = [chunk("Rata este 5.55% pe an."), chunk("Rata de dobânda fixa este cuprinsă între 5.55% si 17.95% /an", { chunkId: "b" })];
    expect(findQuote("5,55% – 17,95%", chunks)?.chunkId).toBe("b");
  });

  it("matches a percentage only to a percentage and never inside a longer number", () => {
    expect(findQuote("4%", [chunk("Depozit pe 4 luni")])).toBeNull();
    expect(findQuote("5,5%", [chunk("dobândă 15,55% pe an")])).toBeNull();
  });
});

describe("statedEndIn", () => {
  it("takes the last date the source states", () => {
    expect(statedEndIn("oferta Yellow Friday, 15.10–26.11.2026")).toBe("2026-11-26");
    expect(statedEndIn("Deschis oricărui client")).toBeUndefined();
  });
});

describe("buildSeedRecords", () => {
  const csv = [
    HEADER,
    `Credit de nevoi personale,Comision de administrare,Raiffeisen,5 lei / lună,,,${URL_LOAN},2026-10-28`,
    `Credit de nevoi personale,DAE în exemplu,Raiffeisen,"9,49%",,"Exemplu inclusiv prima de asigurare de viață (15.10–26.11.2026).",${URL_LOAN},2026-10-28`,
    `Credit de nevoi personale,DAE în exemplu,ING,indisponibil,,,https://ing.ro/credite,2026-10-28`,
    `Credit de nevoi personale,Necunoscut,Raiffeisen,1 leu,,,${URL_LOAN},2026-10-28`,
  ].join("\n");
  const chunks = [chunk("comision de administrare lunar 5 Lei, rata lunara este 961,21 Lei, DAE 9.49% si valoarea totala")];
  const report = buildSeedRecords(parseSeedRows(csv), chunks, NOW);
  const [fee, dae, missing] = report.records as [TermRecord, TermRecord, TermRecord];

  it("builds one dated, unreviewed record per mapped row", () => {
    expect(report.records).toHaveLength(3);
    expect(report.skipped).toEqual(["Raiffeisen · Credit de nevoi personale · Necunoscut"]);
    expect(fee).toMatchObject({
      termId: "raiffeisen:loan#comision-de-administrare", productId: "raiffeisen:loan", kind: "fee", frequency: "monthly",
      value: { type: "exact", amount: 500 }, unit: "minor_ron", verification: { quoteFound: true },
    });
    expect(fee.verification.reviewedBy).toBeUndefined();
  });

  it("names a product by its category when the page title is a slogan", () => {
    expect(fee.product).toBe("Credit de nevoi personale");
  });

  it("ends freshness at a stated campaign end and records insurance in the DAE", () => {
    expect(dae.provenance.reviewBy).toBe("2026-11-26");
    expect(dae.comparability.insuranceIncluded).toBe(true);
    expect(dae.quote).toContain("DAE 9.49%");
  });

  it("keeps a stated gap as unavailable without looking for a quote", () => {
    expect(missing.value).toEqual({ type: "unavailable", reason: "indisponibil" });
    expect(missing.verification.quoteFound).toBe(false);
    expect(report.quoteMissing).toEqual([]);
  });
});

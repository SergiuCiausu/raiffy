import { describe, expect, it } from "vitest";
import { buildProducts, isGuidePage, productKindOf, summaryOf } from "./products";
import type { RawChunk } from "../rag/schemas";

const chunk = (id: string, m: Partial<RawChunk["metadata"]>, text = "Raiffeisen Bank: Product — Credite (persoane fizice)\nDescription."): RawChunk => ({
  id, text, metadata: { bank: "raiffeisen", source_type: "product_page", section_type: "overview", url: "https://www.raiffeisen.ro/ro/persoane-fizice/x.html",
    scraped_at: "2026-10-28T07:45:27+00:00", segment: "persoane fizice", ...m } as RawChunk["metadata"],
});

describe("productKindOf", () => {
  it("reads the kind from the URL, category and name, with mortgages and cards before plain loans", () => {
    expect(productKindOf({ url: "https://www.raiffeisen.ro/ro/persoane-fizice/produsele-noastre/credite/credit-imobiliar-casa-ta.html" })).toBe("mortgage");
    expect(productKindOf({ url: "https://www.bcr.ro/ro/persoane-fizice/carduri/carduri-de-credit/visa-gold", product: "Cardul de credit Visa Gold" })).toBe("credit_card");
    expect(productKindOf({ url: "https://www.bcr.ro/ro/persoane-fizice/credite/credit-george", product: "Creditul George" })).toBe("personal_loan");
    expect(productKindOf({ url: "https://ing.ro/persoane-fizice/economii/depozite", product: "ING Economii și Depozite la termen" })).toBe("term_deposit");
    expect(productKindOf({ url: "https://www.raiffeisen.ro/ro/persoane-fizice/overdraft.html", product: "Overdraft Descoperit de cont" })).toBe("overdraft");
    expect(productKindOf({ url: "https://www.raiffeisen.ro/ro/persoane-fizice/produsele-noastre/credite/credit-de-nevoi-personale-fara-ipoteca.html" })).toBe("personal_loan");
    expect(productKindOf({ url: "https://www.raiffeisen.ro/ro/persoane-fizice/produsele-noastre/credite/credit-de-refinantare-fara-ipoteca.html" })).toBe("personal_loan");
  });

  it("keeps insurance and investments out of the loan, car and savings kinds", () => {
    expect(productKindOf({ url: "https://www.bcr.ro/ro/persoane-fizice/asigurari/descoperit", product: "Asigurarea de viata pentru descoperit de cont" })).toBe("other");
    expect(productKindOf({ url: "https://www.raiffeisen.ro/ro/persoane-fizice/asigurari-auto.html", product: "Asigurări auto" })).toBe("other");
    expect(productKindOf({ url: "https://www.bcr.ro/ro/persoane-fizice/economisire-si-investire/fonduri", product: "Fonduri de investiții prin BCR" })).toBe("other");
  });
});

describe("buildProducts", () => {
  it("makes one row per product page, with its summary, visibility and newest date; hubs and withdrawn products are left out", () => {
    const rows = buildProducts([
      chunk("a#overview-0", { product_id: "raiffeisen:loan", product: "Flexicredit", url: "https://www.raiffeisen.ro/ro/persoane-fizice/credite/flexicredit.html" },
        "Raiffeisen Bank: Flexicredit — Credite (persoane fizice)\nUn credit de nevoi personale cu dobândă fixă."),
      chunk("a#fees-1", { product_id: "raiffeisen:loan", product: "Flexicredit", section_type: "fees", scraped_at: "2026-10-29T07:00:00+00:00",
        url: "https://www.raiffeisen.ro/ro/persoane-fizice/credite/flexicredit.html" }),
      chunk("h#overview-0", { product_id: "raiffeisen:hub", product: "Credite", page_type: "hub" }),
      chunk("w#overview-0", { product_id: "raiffeisen:old", product: "Old", status: "withdrawn" }),
      chunk("c#overview-0", { product_id: "raiffeisen:custody", product: "Custodie", segment: "corporate" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: "raiffeisen:loan", kind: "personal_loan", summary: "Un credit de nevoi personale cu dobândă fixă.",
      collectedAt: "2026-10-29T07:00:00+00:00", guide: false, personal_bank_product_docs: true, business_bank_product_docs: false });
  });

  it("marks guide, FAQ and tips pages, and shortens a long summary at a sentence", () => {
    expect(isGuidePage("https://www.raiffeisen.ro/ro/persoane-fizice/credite/ghid-credit-nevoi-personale.html")).toBe(true);
    expect(isGuidePage("https://www.raiffeisen.ro/ro/persoane-fizice/credite/flexicredit.html")).toBe(false);
    const long = `Title\n${"Prima propoziție este destul de lungă pentru a conta aici. ".repeat(8)}`;
    expect(summaryOf(long).length).toBeLessThanOrEqual(280);
    expect(summaryOf(long).endsWith(".")).toBe(true);
  });
});

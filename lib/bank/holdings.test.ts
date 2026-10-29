import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_PERSONAS, personaById } from "../../convex/seed/demoPersonas";
import { findUngroundedNumbers } from "../rag/numbers";
import { addMonths, holdingsCitables, holdingsNote, holdingsView, resolveHoldings, type Switches } from "./holdings";
import { holdingsSchema } from "./schemas";

const TODAY = "2026-10-29";
const OFF: Switches = { account: false, transactions: false, savings: false, offers: false, loans: false, cards: false };
const ALL: Switches = { account: true, transactions: true, savings: true, offers: true, loans: true, cards: true };
const view = (id: string, switches = ALL, kinds?: Parameters<typeof holdingsView>[0]["kinds"]) =>
  holdingsView({ customer: id, holdings: personaById(id)!.holdings, switches, kinds, today: TODAY });

describe("sample customers", () => {
  it("are ten, each with valid holdings whose balances and Raiffeisen loans match the statements", () => {
    expect(DEMO_PERSONAS).toHaveLength(10);
    expect(new Set(DEMO_PERSONAS.map((p) => p.id)).size).toBe(10);
    for (const p of DEMO_PERSONAS) {
      const h = holdingsSchema.parse(p.holdings);
      expect(p.balances.current).toBe(h.currentAccounts.reduce((s, a) => s + a.balance, 0));
      expect(p.balances.deposits).toBe(h.deposits.reduce((s, d) => s + d.amount, 0));
      for (const l of h.loans) expect(p.loans).toContainEqual({ label: l.name, monthly: l.monthly });
      const refs = [...h.currentAccounts, ...h.savingsAccounts, ...h.deposits, ...h.loans, ...h.cards, ...h.offers].map((x) => x.ref);
      expect(new Set(refs).size).toBe(refs.length);
    }
  });

  const productsFile = "products.import.jsonl";
  it.skipIf(!existsSync(productsFile))("link every holding to a real Raiffeisen product in the catalog", () => {
    const ids = new Set(readFileSync(productsFile, "utf-8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { productId: string }).productId));
    for (const p of DEMO_PERSONAS) {
      const h = p.holdings!;
      for (const x of [...h.currentAccounts, ...h.savingsAccounts, ...h.deposits, ...h.loans, ...h.cards, ...h.offers]) expect(ids, `${p.id} ${x.ref}`).toContain(x.productId);
    }
  });
});

describe("get_holdings", () => {
  it("works dates out from today: a deposit maturing in 6 days, a fixed rate ending in 3 months, months of payments left", () => {
    const deposit = resolveHoldings(personaById("cheaper-competitor")!.holdings!, TODAY).savings.deposits[0]!;
    expect(deposit).toMatchObject({ maturesOn: "2026-11-04", interestAtMaturity: 25_000 });
    const loan = resolveHoldings(personaById("fixed-rate-ending")!.holdings!, TODAY).loans[0]!;
    expect(loan).toMatchObject({ fixedUntil: "2027-01-15", monthsLeft: 267, nextPaymentOn: "2026-11-15", earlyRepaymentFeeToday: 310_000 });
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("reads only the kinds whose switch is on, and names the rest instead of returning them empty", () => {
    const v = view("fixed-rate-ending", { ...OFF, loans: true }, ["loans", "savings", "cards"]);
    expect(v.status).toBe("ok");
    expect(Object.keys(v.holdings)).toEqual(["loans"]);
    expect(v.notUsed).toEqual(["savings", "cards"]);
    expect(holdingsNote(v)).toContain("savings, cards");
    expect(view("fixed-rate-ending", OFF)).toMatchObject({ status: "unavailable", reason: "switched_off", holdings: {} });
    expect(holdingsView({ customer: null, holdings: null, switches: ALL, today: TODAY })).toMatchObject({ status: "unavailable", reason: "no_persona" });
    // Savings accounts and deposits are one switch; age and residency come with the account switch.
    expect(Object.keys(view("near-age-limit", { ...OFF, account: true }).holdings).sort()).toEqual(["accounts", "profile"]);
  });

  it("cites each holding on its own, as sample data with masked numbers, so an answer's figures must come from it", () => {
    const cites = holdingsCitables(view("fixed-rate-ending", ALL, ["loans"]), { "raiffeisen:persoane-fizice__produsele-noastre__credite__credit-imobiliar-casa-ta": "https://www.raiffeisen.ro/casa-ta.html" });
    expect(cites).toHaveLength(1);
    const [loan] = cites;
    expect(loan).toMatchObject({ chunkId: "holding:fixed-rate-ending:loan_fr1", label: "Your Casa Ta mortgage (sample data)", url: "raiffy:account/fixed-rate-ending/loan_fr1" });
    expect(loan!.text).toMatch(/^SAMPLE DATA/);
    expect(loan!.text).toContain("Product page: https://www.raiffeisen.ro/casa-ta.html");
    expect(findUngroundedNumbers("Your fixed rate of 5.49% ends on 2027-01-15; you still owe 310,000.00 lei, at 2,450.00 lei a month.", [loan!.text])).toEqual([]);
    expect(findUngroundedNumbers("Your rate goes up to 7.2% after that.", [loan!.text])).not.toEqual([]);
    for (const p of DEMO_PERSONAS) for (const c of holdingsCitables(view(p.id), {})) expect(c.text).not.toMatch(/RO\d{2}[A-Z]{4}|\b\d{4} ?\d{4} ?\d{4} ?\d{4}\b/);
  });

  it("says when a pre-approved offer and the profile limit what's possible", () => {
    const offer = holdingsCitables(view("competitor-secci", ALL, ["offers"]), {})[0]!;
    expect(offer.text).toContain("Pre-approved by the bank: personal loan up to 30,000.00 lei, at 7.90% a year");
    const profile = holdingsCitables(view("not-verified", ALL, ["profile"]), {})[0]!;
    expect(profile.text).toContain("not verified for digital signing: an application needs a branch visit");
  });
});

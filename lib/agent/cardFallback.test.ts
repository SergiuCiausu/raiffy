import { describe, expect, it } from "vitest";
import { checkCards, type CardsCheck } from "./blocks";
import { guessCards } from "./cardFallback";

const RZB = "https://www.raiffeisen.ro/persoane-fizice/credite/credit-nevoi-personale";
const CARD = "https://www.raiffeisen.ro/persoane-fizice/carduri/visa-classic";
const DEP = "https://www.raiffeisen.ro/persoane-fizice/economisire";
const hits = [
  { url: RZB, label: "Credit de nevoi personale", text: "Dobanda fixa 7,95% pe an, DAE 9,26%, comision de analiza 0 lei.", collectedAt: "2026-10-20T00:00:00Z" },
  { url: CARD, label: "Visa Classic", text: "Comision administrare 2,5 lei/luna. Retragere ATM alte banci 5 lei.", collectedAt: "2026-10-20T00:00:00Z" },
  { url: DEP, label: "Economisire", text: "Cont de economii 3,5% pe an. Depozit la termen 6 luni 5,6% pe an. Acte: carte de identitate, dovada venitului.", collectedAt: "2026-10-20T00:00:00Z" },
];
const ok = (r: ReturnType<typeof checkCards>) => { if ("error" in r) throw new Error(r.error); return r as CardsCheck; };

describe("simulation card", () => {
  const card = { type: "simulation", title: "Repayment simulation", product: "Personal loan", ratePercent: 7.95, source: RZB };

  it("keeps a rate its source prints, and the customer's own amount and term", () => {
    const r = ok(checkCards({ cards: [{ ...card, amount: 30000, months: 36 }] }, hits, ["30000", "36"]));
    expect(r.cards[0]).toMatchObject({ type: "simulation", ratePercent: 7.95, amount: 30000, months: 36 });
    expect(r.urls).toEqual([RZB]);
  });

  it("drops a rate its source doesn't print, and a starting amount the customer never gave", () => {
    expect(ok(checkCards({ cards: [{ ...card, ratePercent: 6.5 }] }, hits)).cards).toEqual([]);
    const r = ok(checkCards({ cards: [{ ...card, amount: 50000 }] }, hits, ["30000"]));
    expect(r.cards[0]).toMatchObject({ type: "simulation" });
    expect(r.cards[0]).not.toHaveProperty("amount", 50000);
  });

  it("never accepts a payment or total from the model", () => {
    const r = checkCards({ cards: [{ ...card, monthly: 939 }] }, hits);
    expect(ok(r).cards[0]).not.toHaveProperty("monthly");
  });
});

describe("server fallback when the model shows no card", () => {
  const seg = (text: string, ...hitIndexes: number[]) => ({ text, hitIndexes });

  it("builds a simulation from a cited interest rate, not the APR, for a loan pattern", () => {
    const guess = guessCards({ inquiry: "purchase_goal", hits, scenario: { amount: 30000 },
      segments: [seg("The **Personal loan** has an APR of 9,26% and a fixed interest rate of 7,95% a year.", 0), seg(" Want to try other amounts?")] });
    expect(guess).toEqual({ cards: [expect.objectContaining({ type: "simulation", product: "Personal loan", ratePercent: 7.95, source: RZB, amount: 30000 })] });
    expect(ok(checkCards(guess, hits, ["30000"])).cards).toHaveLength(1);
  });

  it("builds key facts from bold-labelled list items with cited figures", () => {
    const guess = guessCards({ inquiry: "fees_statements", hits, segments: [
      seg("The Visa Classic card has two main fees:\n"),
      seg("- **Administration:** 2,5 lei a month\n", 1),
      seg("- **Other banks' ATMs:** 5 lei per withdrawal\n", 1),
      seg("- **Contactless:** free"),
    ] });
    const r = ok(checkCards(guess, hits));
    expect(r.cards[0]).toMatchObject({ type: "keyFacts", facts: [{ label: "Administration", source: CARD }, { label: "Other banks' ATMs" }] });
  });

  it("keeps cited facts without figures, so a product explanation gets its key facts", () => {
    const guess = guessCards({ inquiry: "product_explanation", hits, segments: [
      seg("The savings account in short:\n"),
      seg("- **Access:** withdraw any time, without penalties\n", 2),
      seg("- **Who it's for:** anyone with a Raiffeisen current account\n", 2),
      seg("- **Not cited:** no source behind this line\n"),
    ] });
    const r = ok(checkCards(guess, hits));
    expect(r.cards[0]).toMatchObject({ type: "keyFacts", facts: [
      { label: "Access", value: "withdraw any time, without penalties", source: DEP },
      { label: "Who it's for", value: "anyone with a Raiffeisen current account", source: DEP },
    ] });
    expect((r.cards[0] as { facts: unknown[] }).facts).toHaveLength(2);
  });

  it("guesses nothing without a cited figure, for other patterns, or with no pattern", () => {
    expect(guessCards({ inquiry: "purchase_goal", hits, segments: [seg("Rates start at 7,95% a year.")] })).toBeNull();
    expect(guessCards({ inquiry: "security_complaint", hits, segments: [seg("Interest rate 7,95%", 0)] })).toBeNull();
    expect(guessCards({ inquiry: null, hits, segments: [seg("Interest rate 7,95%", 0)] })).toBeNull();
  });
});

describe("simulation with a rate range and the customer's income", () => {
  const REF = "https://www.raiffeisen.ro/persoane-fizice/credite/flexicredit-refinantare";
  const RULES = "https://www.raiffeisen.ro/persoane-fizice/credite/conditii";
  const all = [...hits,
    { url: REF, label: "Flexicredit Refinanțare", text: "Dobanda fixa intre 5,55% si 17,95%. DAE intre 7,88% si 39,4%. Perioada maxima 60 de luni.", collectedAt: "2026-10-20T00:00:00Z" },
    { url: RULES, label: "Conditii de creditare", text: "Gradul maxim de indatorare este de 40% din venitul net.", collectedAt: "2026-10-20T00:00:00Z" },
  ];
  const seg = (text: string, ...hitIndexes: number[]) => ({ text, hitIndexes });
  const base = { type: "simulation", title: "Repayment simulation", product: "Flexicredit Refinanțare", ratePercent: 5.55, source: REF };

  it("keeps both ends of a range, the longest term and a cited debt ratio, all from their sources", () => {
    const r = ok(checkCards({ cards: [{ ...base, rateMaxPercent: 17.95, termMaxMonths: 60, maxDebtRatio: { percent: 40, source: RULES },
      amount: 50000, income: 4000, rateFor: "No personal-loan rate in the sources." }] }, all, ["50000", "4000"]));
    expect(r.cards[0]).toMatchObject({ rateMaxPercent: 17.95, termMaxMonths: 60, maxDebtRatio: { percent: 40 }, amount: 50000, income: 4000,
      rateFor: "No personal-loan rate in the sources." });
    expect(r.urls.sort()).toEqual([REF, RULES].sort());
  });

  it("drops a top rate, term or debt ratio its source doesn't print, and an income the customer didn't give, without logging it", () => {
    const r = ok(checkCards({ cards: [{ ...base, rateMaxPercent: 19.5, termMaxMonths: 84, maxDebtRatio: { percent: 45, source: RULES }, income: 6000 }] }, all, ["4000"]));
    expect(r.cards[0]).toMatchObject({ ratePercent: 5.55 });
    for (const k of ["rateMaxPercent", "termMaxMonths", "maxDebtRatio", "income"]) expect(r.cards[0]).not.toHaveProperty(k, expect.anything());
    expect(r.dropped.join(" ")).not.toContain("6000");
  });

  it("reads the screenshot answer as a range for the product named, never as its lowest rate alone", () => {
    const guess = guessCards({ inquiry: "affordability", hits: all, scenario: { amount: 50000, income: 4000 }, segments: [
      seg("I also found no personal-loan rate for 50000 lei. The only rates I found are for the refinancing loan, Flexicredit Refinanțare: a fixed interest rate between 5.55% and 17.95%, and a DAE between 7.88% and 39.4%", 3),
      seg(". These are dated public figures, not a personal offer."),
    ] });
    const r = ok(checkCards(guess, all, ["50000", "4000"]));
    expect(r.cards[0]).toMatchObject({ type: "simulation", product: "Flexicredit Refinanțare", ratePercent: 5.55, rateMaxPercent: 17.95,
      amount: 50000, income: 4000, rateFor: "The only rates in the sources are for Flexicredit Refinanțare." });
    expect(r.cards[0]).not.toHaveProperty("maxDebtRatio", expect.anything());
  });

  it("adds a debt ratio only when a cited segment states it", () => {
    const guess = guessCards({ inquiry: "affordability", hits: all, segments: [
      seg("A fixed interest rate of 5,55%.", 3), seg(" The maximum debt-to-income ratio is 40%.", 4)] });
    expect(ok(checkCards(guess, all)).cards[0]).toMatchObject({ maxDebtRatio: { percent: 40, source: RULES } });
  });
});

describe("phase 2 fallback cards", () => {
  const seg = (text: string, ...hitIndexes: number[]) => ({ text, hitIndexes });
  const lines = (...ls: string[]) => ls.join("\n");

  it("turns a cited documents list into a checklist when the customer asks what to bring", () => {
    const guess = guessCards({ inquiry: "product_explanation", hits, question: "Ce acte imi trebuie pentru un depozit?", segments: [
      seg(lines("You'll need:", "")), seg(lines("- **ID card:** valid on the day you open it", "- Proof of income", ""), 2), seg(lines("", "Want me to explain the deposit?")),
    ] });
    const r = ok(checkCards(guess, hits));
    expect(r.cards[0]).toMatchObject({ type: "checklist", title: "Documents you'll need",
      items: [{ text: "ID card", detail: "valid on the day you open it", source: DEP }, { text: "Proof of income" }] });
  });

  it("makes no checklist from an uncited list, or when the customer didn't ask for documents or steps", () => {
    const list = lines("- ID card", "- Proof of income");
    expect(guessCards({ inquiry: "product_explanation", hits, question: "What documents do I need?", segments: [seg(list)] })).toBeNull();
    expect(guessCards({ inquiry: "product_explanation", hits, question: "How does it work?", segments: [seg(list, 2)] })).toBeNull();
  });

  it("lists savings options with their cited rates, shortening a long value to its figure", () => {
    const guess = guessCards({ inquiry: "saving_goal", hits, segments: [seg(lines(
      "- **Savings account:** 3,5% a year, and you can take your money out at any time without losing any interest",
      "- **6-month term deposit:** 5,6% a year"), 2)] });
    const r = ok(checkCards(guess, hits));
    expect(r.cards[0]).toMatchObject({ type: "keyFacts", title: "Savings options",
      facts: [{ label: "Savings account", value: "3,5% a year" }, { label: "6-month term deposit", value: "5,6% a year" }] });
  });
});


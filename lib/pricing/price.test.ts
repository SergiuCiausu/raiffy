import { describe, expect, it } from "vitest";
import cases from "../../evals/pricing-negotiation.json";
import { personaById } from "../../convex/seed/demoPersonas";
import { COMPETITOR_OFFERS, COUNTER_OFFER_BANDS, competitorById, PRICING_RULES, ruleFor } from "../../convex/seed/pricing";
import { costLine, negotiate, quote } from "./price";
import { profileFrom } from "./profile";
import { negotiationCitables } from "./text";
import type { PersonalOffer } from "./schemas";

const TODAY = "2026-10-29";
const loan = ruleFor("raiffy-personal-loan")!;
const ALL = { account: true, transactions: false, savings: true, offers: false, loans: false, cards: false };
const profile = (id: string, switches = ALL) => { const p = personaById(id)!; return profileFrom(p, switches, p.request!.productId); };
const run = (id: string, competitorId: string, switches = ALL, offers?: PersonalOffer[]) => {
  const p = personaById(id)!;
  return negotiate({ rule: ruleFor(p.request!.productId)!, bands: COUNTER_OFFER_BANDS, profile: profile(id, switches), competitor: competitorById(competitorId)!,
    amount: p.request!.amount, months: p.request!.months, today: TODAY, offers });
};

describe("evals/pricing-negotiation.json", () => {
  for (const c of cases) it(`${c.id}: ${c.title}`, () => {
    const p = personaById(c.persona)!;
    const switches = { ...ALL, ...c.switches };
    const e = c.expect as { resolution?: string; levers?: string[]; level?: string; currentRateBps?: number; couldBeBetter?: boolean; salaryQualifies?: boolean };
    if (c.competitor) {
      const n = run(c.persona, c.competitor, switches);
      if (e.resolution) expect(n.resolution).toBe(e.resolution);
      if (e.levers) expect(n.offer!.levers.map(l => l.kind)).toEqual(e.levers);
      if (e.level) expect(n.internal.level).toBe(e.level);
      if (e.currentRateBps) expect(n.quote.current.rateBps).toBe(e.currentRateBps);
      if (e.couldBeBetter !== undefined) expect(n.quote.couldBeBetter).toBe(e.couldBeBetter);
    } else {
      const q = quote({ rule: ruleFor(p.request!.productId)!, profile: profile(c.persona, switches), amount: p.request!.amount, months: p.request!.months, today: TODAY });
      expect(q.current.rateBps).toBe(e.currentRateBps);
      expect(q.conditional.find(l => l.id === "salary_domiciled")!.qualifies).toBe(e.salaryQualifies);
    }
  });
});

describe("how prices are shown (pricing.md)", () => {
  it("never gives a conditional price without the unconditional one, and names the condition on the line", () => {
    const q = quote({ rule: loan, profile: profile("new-client"), amount: 800_000, months: 12, today: TODAY });
    expect(q.unconditional).toMatchObject({ id: "unconditional", rateBps: 940, conditions: [] });
    expect(q.conditional.length).toBeGreaterThan(0);
    for (const l of q.conditional) { expect(l.label).toMatch(/^With /); expect(l.conditions.length).toBeGreaterThan(0); }
  });

  it("puts the cost of a required product inside the discounted line's total and DAE", () => {
    const q = quote({ rule: loan, profile: profile("new-client"), amount: 800_000, months: 12, today: TODAY });
    const insured = q.conditional.find(l => l.id === "with_insurance")!;
    expect(insured.monthlyFee).toBe(1_500);
    expect(insured.requiredProducts).toEqual([{ label: "Loan insurance", monthlyCost: 1_500 }]);
    // 0.5 pp off doesn't pay for 15 lei a month: the "discount" must look more expensive
    expect(insured.totalPayable).toBeGreaterThan(q.unconditional.totalPayable);
    expect(insured.daeBps).toBeGreaterThan(q.unconditional.daeBps);
  });

  it("says the price could be better when a switch is off", () => {
    expect(quote({ rule: loan, profile: profile("long-time-client", { ...ALL, savings: false }), amount: 800_000, months: 12, today: TODAY }).couldBeBetter).toBe(true);
    expect(quote({ rule: loan, profile: null, amount: 800_000, months: 12, today: TODAY }).couldBeBetter).toBe(true);
    expect(quote({ rule: loan, profile: profile("long-time-client"), amount: 800_000, months: 12, today: TODAY }).couldBeBetter).toBe(false);
  });

  it("uses a valid personal offer and falls back to list pricing when it has expired, saying so", () => {
    const offer: PersonalOffer = { id: "o1", productId: "raiffy-personal-loan", rateBps: 690, upfrontFee: 0, monthlyFee: 0, amount: 800_000, months: 12,
      origin: "specialist", issuedBy: { name: "Ana M.", role: "Credit specialist" }, conditions: [], validUntil: "2026-11-05" };
    const valid = quote({ rule: loan, profile: profile("new-client"), amount: 800_000, months: 12, today: TODAY, offers: [offer] });
    expect(valid.current).toMatchObject({ rateBps: 690, label: "Offer from a specialist" });
    const expired = quote({ rule: loan, profile: profile("new-client"), amount: 800_000, months: 12, today: TODAY, offers: [{ ...offer, validUntil: "2026-10-20" }] });
    expect(expired.current.rateBps).toBe(940);
    expect(expired.expiredOffer?.id).toBe("o1");
    expect(expired.personalOffer).toBeUndefined();
  });
});

describe("counter-offers (pricing.md)", () => {
  it("compares total cost first and makes no offer when ours already costs less", () => {
    const n = run("competitor-secci", "sample-bank-a-loan");
    expect(n.competitor.rateBps).toBeLessThan(n.quote.current.rateBps);
    expect(n.gap).toBeLessThan(0);
    expect(n.offer).toBeUndefined();
  });

  it("never makes a counter-offer on a typed claim alone", () => {
    const p = personaById("cheaper-competitor")!;
    const claim = { ...competitorById("sample-bank-b-loan")!, source: "client_claim" as const, sourceLabel: "Your message" };
    const n = negotiate({ rule: loan, bands: COUNTER_OFFER_BANDS, profile: profile("cheaper-competitor"), competitor: claim, amount: p.request!.amount, months: p.request!.months, today: TODAY });
    expect(n.resolution).toBe("evidence_needed");
    expect(n.offer).toBeUndefined();
  });

  it("stays inside the band, only for clients with a risk view, valid for the band's days", () => {
    const band = COUNTER_OFFER_BANDS.find(b => b.id === "personal-loan-ab")!;
    const maxCut = band.levers.find(l => l.kind === "marginCut");
    let offers = 0;
    for (const id of ["long-time-client", "new-client", "cheaper-competitor"]) {
      const n = run(id, "sample-bank-b-loan");
      if (n.resolution !== "band") continue;
      offers += 1;
      const cut = n.offer!.levers.find(l => l.kind === "marginCut");
      expect(-(cut?.deltaBps ?? 0)).toBeLessThanOrEqual(maxCut?.kind === "marginCut" ? maxCut.maxDeltaBps : 0);
      expect(n.offer!.validUntil).toBe("2026-11-05");
    }
    expect(offers).toBeGreaterThan(0);
    expect(run("cheaper-competitor", "sample-bank-b-loan", { ...ALL, account: false, savings: false }).offer).toBeUndefined();
  });

  it("uses a margin cut only when the fee waiver isn't enough, and the smallest one", () => {
    const p = personaById("long-time-client")!;
    const comp = { ...COMPETITOR_OFFERS[1]!, rateBps: 690, upfrontFee: 0 };
    const n = negotiate({ rule: loan, bands: COUNTER_OFFER_BANDS, profile: profile("long-time-client"), competitor: comp, amount: p.request!.amount, months: p.request!.months, today: TODAY });
    expect(n.resolution).toBe("band");
    expect(n.offer!.levers.map(l => l.kind)).toEqual(["feeWaiver", "marginCut"]);
    const cut = -n.offer!.levers[1]!.deltaBps!;
    expect(n.offer!.line.totalPayable).toBeLessThanOrEqual(n.competitor.totalPayable);
    const lessCut = costLine(p.request!.amount, p.request!.months, TODAY, { rateBps: 740 - cut + 5, upfrontFee: 0, monthlyFee: 0 });
    expect(lessCut.totalPayable).toBeGreaterThan(n.competitor.totalPayable);
  });

  it("matches the pricing tool to the ban for every lever", () => {
    const n = run("cheaper-competitor", "sample-bank-b-loan");
    const l = n.offer!.line;
    expect(costLine(800_000, 12, TODAY, { rateBps: l.rateBps, upfrontFee: l.upfrontFee, monthlyFee: l.monthlyFee }).totalPayable).toBe(l.totalPayable);
    expect(n.quote.current.totalPayable - l.totalPayable).toBe(24_900);
  });

  it("escalates beyond the band to the lowest level that can approve the gap", () => {
    const n = run("mortgage-refinance", "sample-bank-c-mortgage");
    expect(n.internal).toMatchObject({ bandId: "mortgage-ab", level: "specialist" });
    expect(n.internal.neededCutBps).toBeGreaterThan(20);
    expect(n.offer).toBeUndefined();
  });

  it("checks affordability before any counter-offer", () => {
    const p = personaById("small-loan")!;
    const tight = { ...profile("small-loan")!, riskBand: "A" as const, monthlyIncome: 100_000, obligations: 40_000 };
    const n = negotiate({ rule: loan, bands: COUNTER_OFFER_BANDS, profile: tight, competitor: competitorById("sample-bank-b-loan")!, amount: p.request!.amount, months: p.request!.months, today: TODAY });
    expect(n.resolution).toBe("affordability");
    expect(n.offer).toBeUndefined();
  });

  it("labels every sample rule, band and competitor offer synthetic", () => {
    expect([...PRICING_RULES, ...COUNTER_OFFER_BANDS, ...COMPETITOR_OFFERS].every(x => x.synthetic)).toBe(true);
  });

  it("never puts band limits, the needed cut or the approval level in what the model reads", () => {
    for (const [id, comp] of [["mortgage-refinance", "sample-bank-c-mortgage"], ["small-loan", "sample-bank-b-loan"], ["cheaper-competitor", "sample-bank-b-loan"]] as const) {
      const n = run(id, comp);
      const text = negotiationCitables(n).map(c => c.text).join(" ");
      expect(text).toMatch(/SAMPLE PRICING/);
      expect(text).not.toMatch(/branch manager|pricing committee|band|maxDelta|up to|at most/i);
      if (n.internal.neededCutBps) expect(text).not.toContain(`${(n.internal.neededCutBps / 100).toFixed(2)} pp`);
      if (n.resolution === "escalate") expect(text).toMatch(/never promise|Don't promise/i);
    }
  });
});

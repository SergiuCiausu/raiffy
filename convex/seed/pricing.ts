import type { CompetitorOffer, CounterOfferBand, PricingRule } from "../../lib/pricing/schemas";

/*
 * SAMPLE DATA. Pricing rules, counter-offer bands and competitor offers for the negotiation demo
 * (raiffy-spec/docs/shared/pricing.md → Mock data). None of these are Raiffeisen's or any other bank's real prices;
 * the chat labels every figure from here as sample data, and the pricing team's rules replace them via the console.
 * Money in bani, rates in basis points.
 */

const governance = { version: "pricing@1", validFrom: "2026-10-01", owner: "Pricing team (sample)", reviewBy: "2026-12-31", synthetic: true } as const;

export const PRICING_RULES: readonly PricingRule[] = [
  {
    productId: "raiffy-personal-loan", product: "Personal loan (sample pricing)", productType: "personal_loan",
    baseRateBps: 940, fees: { upfront: 24_900, upfrontLabel: "Origination fee", monthly: 0 },
    adjustments: [
      { id: "salary_domiciled", label: "With salary transfer", condition: { kind: "salaryDomiciled" }, deltaBps: -150, requires: [] },
      { id: "deposits_20k", label: "With 20,000 lei in savings", condition: { kind: "depositsAtLeast", amount: 2_000_000 }, deltaBps: -50, requires: [] },
      // A discount that costs more than it saves must look like it: the insurance is inside the line's total and DAE
      { id: "with_insurance", label: "With loan insurance", condition: { kind: "holdsProduct", productId: "loan-insurance" }, deltaBps: -50,
        requires: [{ productId: "loan-insurance", label: "Loan insurance", monthlyCost: 1_500 }] },
      { id: "risk_cd", label: "Risk surcharge", condition: { kind: "riskBand", in: ["C", "D"] }, deltaBps: 150, requires: [] },
    ],
    maxDebtRatioBps: 4_000, sourceLabel: "Sample pricing rules (preview)", ...governance,
  },
  {
    productId: "raiffy-mortgage", product: "Mortgage refinancing (sample pricing)", productType: "mortgage",
    baseRateBps: 640, fees: { upfront: 100_000, upfrontLabel: "Analysis fee", monthly: 0 },
    adjustments: [
      { id: "salary_domiciled", label: "With salary transfer", condition: { kind: "salaryDomiciled" }, deltaBps: -50,
        requires: [{ productId: "home-insurance", label: "Home insurance", monthlyCost: 4_000 }] },
    ],
    maxDebtRatioBps: 4_000, sourceLabel: "Sample pricing rules (preview)", ...governance,
  },
];

/** Internal: never shown to the customer or the model. */
export const COUNTER_OFFER_BANDS: readonly CounterOfferBand[] = [
  {
    id: "personal-loan-ab", productId: "raiffy-personal-loan", segment: { riskBand: ["A", "B"] },
    levers: [{ kind: "feeWaiver", fee: "upfront" }, { kind: "marginCut", maxDeltaBps: 50 }],
    escalation: [{ level: "specialist", upToDeltaBps: 100 }, { level: "branchManager", upToDeltaBps: 200 }, { level: "pricingCommittee" }],
    validityDays: 7, ...governance,
  },
  {
    id: "mortgage-ab", productId: "raiffy-mortgage", segment: { riskBand: ["A", "B"], amountRange: [10_000_000, 200_000_000] },
    levers: [{ kind: "feeWaiver", fee: "upfront" }, { kind: "marginCut", maxDeltaBps: 20 }],
    escalation: [{ level: "specialist", upToDeltaBps: 30 }, { level: "branchManager", upToDeltaBps: 60 }, { level: "pricingCommittee" }],
    validityDays: 7, ...governance,
  },
];

/** Sample competitor offers standing in for official documents in the store. Not real offers from these banks. */
export const COMPETITOR_OFFERS: readonly CompetitorOffer[] = [
  { id: "sample-bank-a-loan", bank: "Bank A (sample)", product: "Personal loan", productType: "personal_loan", amount: 800_000, months: 12,
    rateBps: 720, upfrontFee: 60_000, monthlyFee: 0, requiredMonthly: 0, source: "official_store", sourceLabel: "Sample competitor offer (preview)", verifiedAt: "2026-10-20", synthetic: true },
  { id: "sample-bank-b-loan", bank: "Bank B (sample)", product: "Personal loan", productType: "personal_loan", amount: 800_000, months: 12,
    rateBps: 740, upfrontFee: 15_000, monthlyFee: 0, requiredMonthly: 0, source: "official_store", sourceLabel: "Sample competitor offer (preview)", verifiedAt: "2026-10-20", synthetic: true },
  { id: "sample-bank-c-mortgage", bank: "Bank C (sample)", product: "Mortgage refinancing", productType: "mortgage", amount: 40_000_000, months: 240,
    rateBps: 570, upfrontFee: 0, monthlyFee: 0, requiredMonthly: 3_000, source: "official_store", sourceLabel: "Sample competitor offer (preview)", verifiedAt: "2026-10-20", synthetic: true },
];

export const ruleFor = (productId: string) => PRICING_RULES.find((r) => r.productId === productId) ?? null;
export const competitorById = (id: string) => COMPETITOR_OFFERS.find((c) => c.id === id) ?? null;

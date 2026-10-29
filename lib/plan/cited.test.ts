import { describe, expect, it } from "vitest";
import { buildCitedPlan, feeLine, leiAmount, type CitedPlanInput } from "./cited";
import { planInvariants } from "./build";
import { demoPlansAllowed } from "./demo";

const URL = "https://www.raiffeisen.ro/ro/persoane-fizice/produsele-noastre/credite/credit-de-nevoi-personale-fara-ipoteca.html";
// The simulation card from a real dev answer: 50,000 lei over 60 months at 5.55% – 17.95%
const INPUT: CitedPlanInput = {
  id: "PS-4001", version: 1, conversationId: "conv_1", track: "personal", now: Date.parse("2026-10-29T10:00:00Z"), createdAt: "2026-10-29T12:00:00+02:00",
  goal: "Fix up the kitchen", productId: `cited:${URL}`, amount: 5_000_000, termMonths: 60, firstPaymentDate: "2026-12-01", recommendedRoute: "term_60",
  citation: {
    product: "Credit de nevoi personale", url: URL, citedAt: "2026-10-29T09:55:00+00:00", ratePercent: 5.55, rateMaxPercent: 17.95, termMaxMonths: 60,
    fees: [{ label: "Analysis fee, one time", value: "200 lei", source: URL }, { label: "Administration fee, monthly", value: "5 lei", source: URL }],
  },
};
const ok = (r: ReturnType<typeof buildCitedPlan>) => { if (r.status !== "ok") throw new Error(JSON.stringify(r.gaps)); return r.plan; };

describe("plans from cited figures (demo fallback)", () => {
  it("figures the plan from the card's rate and fees, labelled as cited and not reviewed", () => {
    const plan = ok(buildCitedPlan(INPUT));
    expect(plan.figuresFrom).toBe("cited_page");
    expect(plan.terms).toMatchObject({ annualRateBps: 1795, rateRange: { minBps: 555, maxBps: 1795 }, rateType: "assumed_constant", upfrontFee: 20_000, monthlyFee: 500 });
    // The bottom of the range is the bank's published example
    expect(Math.abs(plan.figures.atLowest!.monthly - 96_121)).toBeLessThanOrEqual(10);
    expect(planInvariants(plan)).toEqual([]);
    expect(plan.sources).toEqual([{ termId: "cited#rate", url: URL, collectedAt: "2026-10-29T09:55:00+00:00" }]);
    expect(plan.missing.map((m) => m.key)).toEqual(["affordability_not_checked", "not_in_reviewed_catalog", "conditional_fee_unconfirmed", "credit_assessment"]);
    expect(plan.assumptions).toContainEqual({ key: "rate_assumed_constant", params: { rateBps: 1795 } });
    expect(plan.figures.commissions.find((c) => c.key === "early_repayment_fee")).toMatchObject({ basis: "missing", amount: null });
  });

  it("leaves out a fee it can't read strictly and says so, never as zero", () => {
    const plan = ok(buildCitedPlan({ ...INPUT, citation: { ...INPUT.citation, rateMaxPercent: undefined, fees: [{ label: "Analysis fee, one time", value: "1% of the amount" }] } }));
    expect(plan.terms).toMatchObject({ annualRateBps: 555, upfrontFee: 0 });
    expect(plan.terms.rateRange).toBeUndefined();
    expect(plan.figures.commissions.find((c) => c.key === "origination_fee")).toMatchObject({ basis: "missing", amount: null });
    expect(plan.missing).toContainEqual({ key: "cited_fee_not_counted", params: { label: "Analysis fee, one time", value: "1% of the amount" } });
  });

  it("refuses a rate that belongs to another product, and a term past the page's longest", () => {
    expect(buildCitedPlan({ ...INPUT, citation: { ...INPUT.citation, rateFor: "No personal-loan rate in the sources" } })).toMatchObject({ status: "unavailable", gaps: [{ reason: "wrong_product" }] });
    expect(buildCitedPlan({ ...INPUT, termMonths: 72 })).toMatchObject({ status: "unavailable", gaps: [{ reason: "term_above_limit" }] });
  });

  it("reads lei amounts and fee labels strictly", () => {
    expect([leiAmount("200 lei"), leiAmount("1.500 lei"), leiAmount("1,500.50 RON"), leiAmount("12,5 lei"), leiAmount("0,5%"), leiAmount("200–300 lei")]).toEqual([20_000, 150_000, 150_050, 1250, null, null]);
    expect(feeLine("Comision de analiză, unic")).toEqual({ key: "origination_fee", use: "upfront" });
    expect(feeLine("Comision de administrare lunar")).toEqual({ key: "administration_fee", use: "monthly" });
    expect(feeLine("Early repayment fee")).toEqual({ key: "early_repayment_fee", use: "if_used" });
    expect(feeLine("Life insurance, monthly")).toBeNull();
    expect(feeLine("Processing fee")).toBeNull();
  });

  it("is allowed only when switched on for this very deployment", () => {
    const url = "https://diligent-rhinoceros-830.eu-west-1.convex.cloud";
    expect(demoPlansAllowed({ cloudUrl: url, enabled: "true", deploymentUrl: `${url}/` })).toBe(true);
    expect(demoPlansAllowed({ cloudUrl: url, enabled: "true", deploymentUrl: "https://other-1.convex.cloud" })).toBe(false);
    expect(demoPlansAllowed({ cloudUrl: url, enabled: "false", deploymentUrl: url })).toBe(false);
    expect(demoPlansAllowed({ cloudUrl: url, enabled: "true" })).toBe(false);
  });
});

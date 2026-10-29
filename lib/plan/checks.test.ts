import { describe, expect, it } from "vitest";
import type { TermRecord } from "../catalog/schemas";
import { buildPlan, type BuildPlanInput } from "./build";
import { buildCitedPlan } from "./cited";
import { blocksConfirm, planCheckList } from "./checks";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const P = "raiffeisen:personal-loan";
const URL = "https://www.raiffeisen.ro/loan.html";
const record = (id: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${P}#${id}`, productId: P, product: "Credit de nevoi personale", bank: "raiffeisen", track: "personal",
  kind: "fee", label: id, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [], comparability: { category: "personal_loan", currency: "RON" },
  quote: "q", provenance: { bank: "raiffeisen", url: URL, collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "admin", reviewedAt: "2026-10-28T10:00:00Z" }, ...over,
});
const RATE = record("rate", { kind: "interest_rate", label: "Dobândă", value: { type: "range", min: 555, max: 1795 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } });
const FEE = record("fee", { label: "Comision de analiză", value: { type: "exact", amount: 20_000 }, frequency: "once" });
const CAP = record("cap", { kind: "eligibility", label: "Grad de îndatorare", value: { type: "exact", amount: 4000 }, unit: "bps" });
const TEMPLATE = { rateTermId: RATE.termId, rateRange: true, commissions: [{ key: "origination_fee" as const, termId: FEE.termId, use: "upfront" as const }], debtShareCeilingTermId: CAP.termId };
const INPUT: BuildPlanInput = {
  id: "PS-1001", version: 1, conversationId: "c", track: "personal", now: NOW, createdAt: "2026-10-28T12:00:00Z", goal: "Kitchen",
  productId: P, amount: 5_000_000, termMonths: 60, firstPaymentDate: "2026-12-01", recommendedRoute: "term_60", template: TEMPLATE, records: [RATE, FEE, CAP],
};
const plan = (over: Partial<BuildPlanInput> = {}) => { const r = buildPlan({ ...INPUT, ...over }); if (r.status !== "ok") throw new Error(JSON.stringify(r.gaps)); return r.plan; };
const statuses = (list: ReturnType<typeof planCheckList>) => Object.fromEntries(list.map((c) => [c.key, `${c.status}:${c.detail}`]));

describe("planCheckList", () => {
  it("passes a plan whose catalog values haven't changed, and warns where a person must look", () => {
    const list = planCheckList({ plan: plan(), records: [RATE, FEE, CAP], template: TEMPLATE, now: NOW });
    expect(statuses(list)).toEqual({ figures_add_up: "pass:schedule_matches", catalog_current: "pass:current", affordability: "warn:not_checked", rate_range: "warn:rate_set_by_bank" });
    expect(blocksConfirm(list)).toBe(false);
  });

  it("fails when a value the plan used changed since, and warns when its review date passed", () => {
    const edited = { ...FEE, verification: { ...FEE.verification, reviewedAt: "2026-10-29T09:00:00Z" } };
    const changed = planCheckList({ plan: plan(), records: [RATE, edited, CAP], template: TEMPLATE, now: NOW });
    expect(changed.find((c) => c.key === "catalog_current")).toMatchObject({ status: "fail", detail: "changed_since", params: { terms: "Comision de analiză" } });
    expect(blocksConfirm(changed)).toBe(true);
    const later = Date.parse("2026-12-15T12:00:00Z");
    expect(planCheckList({ plan: plan(), records: [RATE, FEE, CAP], template: TEMPLATE, now: later }).find((c) => c.key === "catalog_current")!.status).toBe("warn");
  });

  it("checks the debt share against the product's ceiling when the customer gave income", () => {
    const tight = plan({ affordability: { income: 300_000, obligations: 0 } });
    expect(planCheckList({ plan: tight, records: [RATE, FEE, CAP], template: TEMPLATE, now: NOW }).find((c) => c.key === "affordability")).toMatchObject({ status: "fail", detail: "above_ceiling", params: { ceilingBps: 4000 } });
    const fine = plan({ affordability: { income: 2_000_000, obligations: 0 } });
    expect(planCheckList({ plan: fine, records: [RATE, FEE, CAP], template: TEMPLATE, now: NOW }).find((c) => c.key === "affordability")!.status).toBe("pass");
    expect(planCheckList({ plan: fine, records: [RATE, FEE], template: { ...TEMPLATE, debtShareCeilingTermId: undefined }, now: NOW }).find((c) => c.key === "affordability")!.detail).toBe("no_ceiling");
  });

  it("always warns on a plan from cited figures, which aren't in the catalog", () => {
    const r = buildCitedPlan({ ...INPUT, citation: { product: "Credit", url: URL, citedAt: "2026-10-28T09:00:00Z", ratePercent: 5.55 } });
    if (r.status !== "ok") throw new Error("expected a plan");
    expect(planCheckList({ plan: r.plan, records: [], now: NOW }).find((c) => c.key === "catalog_current")).toMatchObject({ status: "warn", detail: "cited_page" });
  });
});

describe("planState", () => {
  it("puts plans nobody checked, and plans changed after a check, up for a check", async () => {
    const { planState } = await import("./state");
    expect(planState({ level: "none" })).toBe("unchecked");
    expect(planState({ level: "confirmed", changed: true, forVersion: 1 })).toBe("changed");
    expect(planState({ level: "pending_review", forVersion: 2 })).toBe("pending");
    expect(planState({ level: "edited", note: "x" })).toBe("checked");
    expect(planState({ level: "returned", note: "x" })).toBe("checked");
  });
});

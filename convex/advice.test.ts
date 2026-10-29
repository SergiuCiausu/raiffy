import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { adviceStatedOf, compareRoutesTool } from "./advice";
import schema from "./schema";
import type { TermRecord } from "../lib/catalog/schemas";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./catalog.ts": () => import("./catalog"),
  "./calculator.ts": () => import("./calculator"),
  "./advice.ts": () => import("./advice"),
  "./audit.ts": () => import("./audit"),
};
const NOW = Date.parse("2026-10-28T12:00:00Z");
const LOAN = "raiffeisen:personal-loan";
const alice = { subject: "alice", issuer: "https://clerk.test", tokenIdentifier: "https://clerk.test|alice" };
const record = (id: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${LOAN}#${id}`, productId: LOAN, product: "Flexicredit", bank: "raiffeisen", track: "personal",
  kind: "fee", label: id, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" }, quote: "q",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/loan.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "admin", reviewedAt: "2026-10-28T10:00:00Z" }, ...over,
});
const RATE = record("rate", { kind: "interest_rate", value: { type: "exact", amount: 790 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } });
const FEE = record("analysis-fee", { value: { type: "exact", amount: 24_900 }, frequency: "once" });
const TERM = record("term", { kind: "term", value: { type: "range", min: 6, max: 60 }, unit: "months" });
const CEILING = record("grad-indatorare", { kind: "eligibility", value: { type: "exact", amount: 4_000 }, unit: "bps" });

const REQUEST = { loan: { productId: LOAN, rateTermId: RATE.termId, feeTermIds: [FEE.termId], termLimitTermId: TERM.termId }, timing: "now" };
const STATED = { amount: { value: 40_000, source: "customer" as const }, months: { value: 60, source: "customer" as const },
  income: { value: 7_800, source: "customer" as const }, obligations: { value: 650, source: "customer" as const }, monthlySaving: { value: 1_250, source: "customer" as const } };

async function setup(records: TermRecord[] = [RATE, FEE, TERM, CEILING], withTemplate = true) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const r of records) await ctx.db.insert("productTerms", r);
    if (withTemplate) await ctx.db.insert("planTemplates", { track: "personal", productId: LOAN, rateTermId: RATE.termId,
      commissions: [{ key: "origination_fee", termId: FEE.termId, use: "upfront" }], termLimitTermId: TERM.termId,
      debtShareCeilingTermId: CEILING.termId, updatedBy: "admin", updatedAt: NOW });
  });
  return t;
}
const run = (t: ReturnType<typeof convexTest>, input: unknown, stated = STATED) =>
  t.run((ctx) => compareRoutesTool(ctx as unknown as ActionCtx, "personal", input, stated, [], 1, NOW));

describe("compare_routes handler", () => {
  it("rejects an anonymous caller before reading the catalog", async () => {
    await expect(run(await setup(), REQUEST)).rejects.toThrow("authentication_required");
  });

  it("works out the routes, recommends by the rule, and shows the host-built card", async () => {
    const t = (await setup()).withIdentity(alice);
    const out = await run(t as never, REQUEST);
    expect(out.result?.recommendation).toMatchObject({ status: "ok", pick: "loan_60", betterIf: { route: "save_then_borrow" } });
    expect(out.result?.recommendation.reasons.map((r) => r.key)).toContain("debt_share_room");
    expect(out.result?.routes.routes.map((r) => r.key)).toEqual(["loan_60", "loan_48", "save_then_borrow"]);
    expect(out.card).toMatchObject({ type: "routes", recommendation: { option: "Flexicredit, 60 months" } });
    if (!("citables" in out.outcome)) throw new Error("no citable");
    expect(out.outcome.citables[0]!.text).toContain(`Raiffy's recommendation by the rule: "Flexicredit, 60 months".`);
  });

  it("asks for the amount and term when the customer hasn't given them, and never uses defaults", async () => {
    const t = (await setup()).withIdentity(alice);
    const out = await run(t as never, REQUEST, { ...STATED, amount: { value: 10_000, source: "default" } } as never);
    expect(out.result).toBeUndefined();
    expect(out.outcome).toMatchObject({ citables: [], note: expect.stringContaining("ask for the customer's own amount and term") });
  });

  it("asks for timing instead of guessing when saving first is cheaper", async () => {
    const t = (await setup()).withIdentity(alice);
    const out = await run(t as never, { ...REQUEST, timing: "unknown" });
    expect(out.card).toBeUndefined();
    expect(out.result?.recommendation).toMatchObject({ status: "needs_input", needs: ["need_by"] });
  });

  it("recommends nothing when the catalog's rate isn't reviewed", async () => {
    const t = (await setup([{ ...RATE, verification: { quoteFound: true } }, FEE, TERM, CEILING])).withIdentity(alice);
    const out = await run(t as never, REQUEST);
    expect(out.card).toBeUndefined();
    expect(out.result?.recommendation.status).toBe("unavailable");
  });

  it("makes no room claim without the template's stated ceiling", async () => {
    const t = (await setup([RATE, FEE, TERM], false)).withIdentity(alice);
    const out = await run(t as never, REQUEST);
    const keys = out.result?.recommendation.reasons.map((r) => r.key);
    expect(keys).toContain("debt_share");
    expect(keys).not.toContain("debt_share_room");
  });

  it("rejects input outside the contract", async () => {
    const t = (await setup()).withIdentity(alice);
    expect((await run(t as never, { ...REQUEST, rateBps: 100 })).outcome).toMatchObject({ error: expect.stringContaining("Invalid input") });
  });
});

describe("adviceStatedOf", () => {
  it("reads the customer's inputs from the brief, marking defaults", () => {
    const brief = { required: [{ key: "amount", value: 40_000, source: "customer" }], optional: [{ key: "income", value: 5_000, source: "default" }, { key: "purpose", value: "kitchen", source: "customer" }] };
    expect(adviceStatedOf(brief as never)).toEqual({ amount: { value: 40_000, source: "customer" }, income: { value: 5_000, source: "default" } });
  });
});

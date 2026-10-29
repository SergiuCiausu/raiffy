import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import schema from "./schema";
import type { TermRecord } from "../lib/catalog/schemas";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./plans.ts": () => import("./plans"),
  "./audit.ts": () => import("./audit"),
};
const identity = (subject: string, role?: JSONValue) => ({
  subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...(role === undefined ? {} : { role }),
});
const PRODUCT = "raiffeisen:personal-loan";
const reviewed = { quoteFound: true, reviewedBy: "admin", reviewedAt: "2026-10-28T10:00:00Z" };
// Review dates far ahead, so the tests don't depend on today's date
const record = (id: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${PRODUCT}#${id}`, productId: PRODUCT, product: "Credit de nevoi personale", bank: "raiffeisen", track: "personal",
  kind: "fee", label: id, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" }, quote: "rata lunara este 961,21 Lei",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/loan.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2099-01-01", status: "fresh" },
  verification: reviewed, ...over,
});
const RATE = record("rate", { kind: "interest_rate", value: { type: "exact", amount: 555 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } });
const FEE = record("analysis-fee", { value: { type: "exact", amount: 20_000 }, frequency: "once" });
const ADMIN_FEE = record("admin-fee", { value: { type: "exact", amount: 500 }, frequency: "monthly" });
const TEMPLATE = {
  track: "personal", productId: PRODUCT, rateTermId: RATE.termId,
  commissions: [
    { key: "origination_fee", termId: FEE.termId, use: "upfront" },
    { key: "administration_fee", termId: ADMIN_FEE.termId, use: "monthly" },
    { key: "early_repayment_fee", use: "if_used" },
  ],
};
const ASK = { productId: PRODUCT, amount: 5_000_000, termMonths: 60, goal: "Fix up the kitchen" };

async function setup(records: TermRecord[] = [RATE, FEE, ADMIN_FEE]) {
  const t = convexTest(schema, modules);
  const thread = await t.run(async (ctx) => {
    for (const r of records) await ctx.db.insert("productTerms", r);
    return ctx.db.insert("ragThreads", { track: "personal", title: "Kitchen", ownerKey: "https://clerk.test|alice", organizationKey: null });
  });
  await t.withIdentity(identity("admin", "admin")).mutation(anyApi.plans.setTemplate, TEMPLATE);
  return { t, thread, alice: t.withIdentity(identity("alice")), bob: t.withIdentity(identity("bob")) };
}

describe("plan templates", () => {
  it("only an admin can set one, and only with term IDs of that product", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => { for (const r of [RATE, FEE, ADMIN_FEE]) await ctx.db.insert("productTerms", r); });
    await expect(t.mutation(anyApi.plans.setTemplate, TEMPLATE)).rejects.toThrow("authentication_required");
    await expect(t.withIdentity(identity("alice")).mutation(anyApi.plans.setTemplate, TEMPLATE)).rejects.toThrow("forbidden");
    const admin = t.withIdentity(identity("admin", "admin"));
    await expect(admin.mutation(anyApi.plans.setTemplate, { ...TEMPLATE, rateTermId: "raiffeisen:other#rate" })).rejects.toThrow("plan_template_term_unknown");
    await expect(admin.mutation(anyApi.plans.setTemplate, { ...TEMPLATE, track: "business" })).rejects.toThrow("plan_template_term_unknown");
    await admin.mutation(anyApi.plans.setTemplate, TEMPLATE);
    await admin.mutation(anyApi.plans.setTemplate, TEMPLATE);
    const rows = await t.run((ctx) => ctx.db.query("planTemplates").collect());
    expect(rows).toHaveLength(1);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toEqual(["plan.template_set", "plan.template_set"]);
  });
});

describe("plans", () => {
  it("builds a plan from the catalog in the owner's conversation and reads it back", async () => {
    const { alice, thread } = await setup();
    const created = await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK });
    expect(created).toMatchObject({ status: "ok", version: 1 });
    const { plan, latestVersion } = await alice.query(anyApi.plans.get, { planId: created.planId });
    expect(latestVersion).toBe(1);
    expect(plan).toMatchObject({ id: created.planId, conversationId: thread, label: "indicative", goal: { amount: 5_000_000, termMonths: 60 } });
    expect(Math.abs(plan.figures.monthly - 96_121)).toBeLessThanOrEqual(10);
    expect(plan.figures.commissions.find((c: { key: string }) => c.key === "early_repayment_fee")).toMatchObject({ basis: "missing", amount: null });
  });

  it("makes each change a new version of the same plan, and keeps the old ones", async () => {
    const { alice, thread } = await setup();
    const v1 = await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK });
    const v2 = await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK, termMonths: 48 });
    expect([v2.planId, v2.version]).toEqual([v1.planId, 2]);
    expect((await alice.query(anyApi.plans.get, { planId: v1.planId })).plan.goal.termMonths).toBe(48);
    expect((await alice.query(anyApi.plans.get, { planId: v1.planId, version: 1 })).plan.goal.termMonths).toBe(60);
    const list = await alice.query(anyApi.plans.listForThread, { threadId: thread });
    expect(list.map((p: { version: number; termMonths: number }) => [p.version, p.termMonths])).toEqual([[2, 48], [1, 60]]);
  });

  it("carries a specialist's confirmation over as changed after the check", async () => {
    const { t, alice, thread } = await setup();
    const v1 = await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK });
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("planSummaries").collect())[0]!;
      await ctx.db.patch(row._id, { plan: { ...row.plan, verification: { level: "confirmed", reviewer: { id: "u_ana", name: "Ana M.", role: "Credit specialist" }, reviewedAt: "2026-10-28T19:30:00+02:00" } } });
    });
    await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK, amount: 4_000_000 });
    const { plan } = await alice.query(anyApi.plans.get, { planId: v1.planId });
    expect(plan.verification).toMatchObject({ level: "confirmed", changed: true, forVersion: 1 });
    expect((await alice.query(anyApi.plans.listForThread, { threadId: thread }))[0].checked).toBe("changed");
  });

  it("returns the gaps and saves nothing when the catalog can't back the plan", async () => {
    const { t, alice, thread } = await setup([{ ...RATE, value: { type: "range", min: 555, max: 1795 } }, FEE, { ...ADMIN_FEE, verification: { quoteFound: true } }]);
    const result = await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK });
    expect(result).toEqual({ status: "unavailable", gaps: [
      { role: "rate", termId: RATE.termId, reason: "range_value" },
      { role: "commission", commission: "administration_fee", termId: ADMIN_FEE.termId, reason: "unreviewed" },
    ] });
    expect(await t.run((ctx) => ctx.db.query("planSummaries").collect())).toEqual([]);
  });

  it("refuses a product without a template", async () => {
    const { alice, thread } = await setup();
    await expect(alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK, productId: "raiffeisen:overdraft" })).rejects.toThrow("plan_template_unavailable");
  });

  it("keeps plans private to the conversation's owner", async () => {
    const { t, alice, bob, thread } = await setup();
    const { planId } = await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK });
    await expect(t.query(anyApi.plans.get, { planId })).rejects.toThrow("authentication_required");
    await expect(bob.query(anyApi.plans.get, { planId })).rejects.toThrow("plan_unavailable");
    await expect(bob.query(anyApi.plans.get, { planId: "PS-000001" })).rejects.toThrow("plan_unavailable");
    await expect(bob.query(anyApi.plans.listForThread, { threadId: thread })).rejects.toThrow("conversation_unavailable");
    await expect(bob.mutation(anyApi.plans.create, { threadId: thread, ...ASK })).rejects.toThrow("conversation_unavailable");
  });

  it("rejects amounts that aren't whole bani", async () => {
    const { alice, thread } = await setup();
    await expect(alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK, amount: 1000.5 })).rejects.toThrow();
  });
});

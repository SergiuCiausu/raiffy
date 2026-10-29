import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import resend from "@convex-dev/resend/test";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import schema from "./schema";
import type { TermRecord } from "../lib/catalog/schemas";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./plans.ts": () => import("./plans"),
  "./planChecks.ts": () => import("./planChecks"),
  "./planCheckEmails.ts": () => import("./planCheckEmails"),
  "./answerCheckEmails.ts": () => import("./answerCheckEmails"),
  "./audit.ts": () => import("./audit"),
};
const identity = (subject: string, role?: JSONValue) => ({
  subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, name: subject === "op" ? "Ana M." : subject, ...(role === undefined ? {} : { role }),
});
const PRODUCT = "raiffeisen:personal-loan";
const record = (id: string, over: Partial<TermRecord>): TermRecord => ({
  termId: `${PRODUCT}#${id}`, productId: PRODUCT, product: "Credit de nevoi personale", bank: "raiffeisen", track: "personal",
  kind: "fee", label: id, value: { type: "exact", amount: 0 }, unit: "minor_ron", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" }, quote: "5,55% – 17,95%",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/loan.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2099-01-01", status: "fresh" },
  verification: { quoteFound: true, reviewedBy: "admin", reviewedAt: "2026-10-28T10:00:00Z" }, ...over,
});
// The bank's published range: the plan is figured at the top and shows the bottom
const RATE = record("rate", { kind: "interest_rate", value: { type: "range", min: 555, max: 1795 }, unit: "bps", comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" } });
const FEE = record("analysis-fee", { value: { type: "exact", amount: 20_000 }, frequency: "once" });
const TEMPLATE = { track: "personal", productId: PRODUCT, rateTermId: RATE.termId, rateRange: true, commissions: [{ key: "origination_fee", termId: FEE.termId, use: "upfront" }] };
const ASK = { productId: PRODUCT, amount: 5_000_000, termMonths: 60, goal: "Fix up the kitchen" };

async function setup() {
  const t = convexTest(schema, modules);
  resend.register(t);
  const thread = await t.run(async (ctx) => {
    for (const r of [RATE, FEE]) await ctx.db.insert("productTerms", r);
    return ctx.db.insert("ragThreads", { track: "personal", title: "Kitchen", ownerKey: "https://clerk.test|alice", organizationKey: null });
  });
  await t.withIdentity(identity("admin", "admin")).mutation(anyApi.plans.setTemplate, TEMPLATE);
  const alice = t.withIdentity(identity("alice"));
  const { planId } = await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK });
  return { t, thread, planId, alice, bob: t.withIdentity(identity("bob")), op: t.withIdentity(identity("op", "operator")) };
}

describe("plan checks", () => {
  it("sends the customer's latest plan to the queue and shows the decision on the plan", async () => {
    const { planId, alice, op, t } = await setup();
    const { plan } = await alice.query(anyApi.plans.get, { planId });
    expect(plan.terms.rateRange).toEqual({ minBps: 555, maxBps: 1795 });

    const sent = await alice.mutation(anyApi.planChecks.request, { planId, version: 1, note: "Is 17.95% realistic? Call me on 0722 123 456" });
    expect(sent.reference).toMatch(/^PC-[2-9A-Z]{6}$/);
    // Asking again returns the same check
    expect(await alice.mutation(anyApi.planChecks.request, { planId, version: 1 })).toEqual(sent);
    expect((await alice.query(anyApi.plans.get, { planId })).plan.verification).toEqual({ level: "pending_review", forVersion: 1, requestId: sent.reference });

    const { open } = await op.query(anyApi.planChecks.list, {});
    expect(open).toMatchObject([{ reference: sent.reference, product: "Credit de nevoi personale", amount: 5_000_000, termMonths: 60, hasNote: true }]);
    const one = await op.query(anyApi.planChecks.get, { checkId: open[0].id });
    expect(one.note).not.toContain("0722 123 456");
    expect(one.plan.figures.atLowest.monthly).toBeLessThan(one.plan.figures.monthly);

    await expect(op.mutation(anyApi.planChecks.decide, { checkId: open[0].id, decision: "return", note: " " })).rejects.toThrow("note_required");
    await op.mutation(anyApi.planChecks.decide, { checkId: open[0].id, decision: "confirm", note: "Figures match the bank's terms." });
    await expect(op.mutation(anyApi.planChecks.decide, { checkId: open[0].id, decision: "return", note: "x" })).rejects.toThrow("already_decided");
    expect((await alice.query(anyApi.plans.get, { planId })).plan.verification).toMatchObject({
      level: "confirmed", forVersion: 1, reviewer: { name: "Ana M.", role: "Specialist" }, note: "Figures match the bank's terms.",
    });
    expect((await op.query(anyApi.planChecks.list, {})).decided).toHaveLength(1);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.at(-1)).toMatchObject({ actorUserId: "op", action: "planCheck.decide", details: { decision: "confirm", version: "1" } });
  });

  it("confirms with a correction: a note for the customer and an internal reason, figures unchanged", async () => {
    const { planId, alice, op, t } = await setup();
    await alice.mutation(anyApi.planChecks.request, { planId, version: 1 });
    const [{ id }] = (await op.query(anyApi.planChecks.list, {})).open;
    const before = (await alice.query(anyApi.plans.get, { planId })).plan.figures;
    await expect(op.mutation(anyApi.planChecks.decide, { checkId: id, decision: "correct", note: "Early repayment is free in the last year." })).rejects.toThrow("reason_required");
    await op.mutation(anyApi.planChecks.decide, { checkId: id, decision: "correct", note: "Early repayment is free in the last year.", reason: "The page's early repayment condition isn't in the catalog." });
    const { plan } = await alice.query(anyApi.plans.get, { planId });
    expect(plan.verification).toMatchObject({ level: "edited", note: "Early repayment is free in the last year." });
    expect(JSON.stringify(plan)).not.toContain("isn't in the catalog");
    expect(plan.figures).toEqual(before);
    expect(await op.query(anyApi.planChecks.get, { checkId: id })).toMatchObject({ status: "corrected", reason: "The page's early repayment condition isn't in the catalog." });
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.at(-1)).toMatchObject({ action: "planCheck.decide", details: { decision: "correct" } });
  });

  it("shows the automatic checks, and blocks confirming while one fails, but not sending back", async () => {
    const { planId, alice, op, t } = await setup();
    await alice.mutation(anyApi.planChecks.request, { planId, version: 1 });
    const [{ id }] = (await op.query(anyApi.planChecks.list, {})).open;
    const checks = (await op.query(anyApi.planChecks.get, { checkId: id })).checks;
    expect(checks.map((c: { key: string; status: string }) => `${c.key}:${c.status}`)).toEqual(["figures_add_up:pass", "catalog_current:pass", "affordability:warn", "rate_range:warn"]);
    // The fee is re-reviewed after the plan was built
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("productTerms").withIndex("by_termId", (q) => q.eq("termId", FEE.termId)).unique())!;
      await ctx.db.patch(row._id, { verification: { ...row.verification, reviewedAt: "2026-10-30T09:00:00Z" } });
    });
    expect((await op.query(anyApi.planChecks.get, { checkId: id })).checks[1]).toMatchObject({ key: "catalog_current", status: "fail" });
    await expect(op.mutation(anyApi.planChecks.decide, { checkId: id, decision: "confirm" })).rejects.toThrow("checks_failed");
    await op.mutation(anyApi.planChecks.decide, { checkId: id, decision: "return", note: "The fee changed. Rebuild the plan." });
  });

  it("checks only the latest version, only for its owner, and keeps the queue to staff", async () => {
    const { planId, alice, bob, thread } = await setup();
    await expect(bob.mutation(anyApi.planChecks.request, { planId, version: 1 })).rejects.toThrow("plan_unavailable");
    await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK, termMonths: 48 });
    await expect(alice.mutation(anyApi.planChecks.request, { planId, version: 1 })).rejects.toThrow("plan_outdated");
    await expect(alice.query(anyApi.planChecks.list, {})).rejects.toThrow("forbidden");
  });
});

describe("Your plans", () => {
  it("lists the latest version of each of the owner's plans with where it stands", async () => {
    const { planId, thread, alice, bob, op } = await setup();
    expect(await alice.query(anyApi.plans.mine, { track: "personal" })).toMatchObject([{ planId, version: 1, state: "unchecked", check: null, figuresFrom: "catalog", source: "raiffeisen.ro" }]);
    await alice.mutation(anyApi.planChecks.request, { planId, version: 1 });
    expect((await alice.query(anyApi.plans.mine, { track: "personal" }))[0]).toMatchObject({ state: "pending", check: { status: "open", version: 1 } });
    const [{ id }] = (await op.query(anyApi.planChecks.list, {})).open;
    await op.mutation(anyApi.planChecks.decide, { checkId: id, decision: "confirm" });
    expect((await alice.query(anyApi.plans.mine, { track: "personal" }))[0].state).toBe("checked");
    // Rebuilt after the check: one row, the new version, up for a check again
    await alice.mutation(anyApi.plans.create, { threadId: thread, ...ASK, termMonths: 48 });
    const rows = await alice.query(anyApi.plans.mine, { track: "personal" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 2, termMonths: 48, state: "changed" });
    expect(await bob.query(anyApi.plans.mine, { track: "personal" })).toEqual([]);
  });
});

describe("plan checks: e-mails", () => {
  const URL = "https://test-deployment.convex.cloud";
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  // The component's queue would call Resend's API; tests answer for it, so nothing leaves the machine
  const resendApi = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "re_test_1" }] }), { status: 200, headers: { "content-type": "application/json" } })));

  it("records a skipped e-mail where sending is off", async () => {
    vi.useFakeTimers();
    const { t, planId, alice } = await setup();
    await alice.mutation(anyApi.planChecks.request, { planId, version: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [check] = await t.run((ctx) => ctx.db.query("planChecks").collect());
    expect(check!.emails).toEqual([expect.objectContaining({ kind: "received", outcome: "skipped" })]);
  });

  it("sends the confirmation and the decision, and records them without the address", async () => {
    vi.stubEnv("RAIFFY_EMAIL_ENABLED", "true"); vi.stubEnv("RAIFFY_EMAIL_DEPLOYMENT_URL", URL); vi.stubEnv("CONVEX_CLOUD_URL", URL);
    vi.stubEnv("RAIFFY_EMAIL_FROM", "Raiffy <raiffy@example.com>"); vi.stubEnv("RESEND_API_KEY", "re_test"); resendApi();
    vi.useFakeTimers();
    const { t, planId, alice, op } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { clerkUserId: "alice", tokenIdentifier: "https://clerk.test|alice", role: "member", email: "alice@example.com", firstSeenAt: 0, lastSeenAt: 0 }));
    await alice.mutation(anyApi.planChecks.request, { planId, version: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [{ id }] = (await op.query(anyApi.planChecks.list, {})).open;
    await op.mutation(anyApi.planChecks.decide, { checkId: id, decision: "return", note: "Rebuild it with your income." });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const one = await op.query(anyApi.planChecks.get, { checkId: id });
    expect(one.emails).toEqual([
      expect.objectContaining({ kind: "received", outcome: "test" }), expect.objectContaining({ kind: "decided", outcome: "test" }),
    ]);
    expect(JSON.stringify(one.emails)).not.toContain("alice@example.com");
  });
});

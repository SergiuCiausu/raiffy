import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import resend from "@convex-dev/resend/test";
import { internal } from "./_generated/api";
import { anyApi } from "convex/server";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./answerChecks.ts": () => import("./answerChecks"),
  "./answerCheckEmails.ts": () => import("./answerCheckEmails"),
};
const who = (subject: string, role?: string) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, name: subject, ...(role ? { role } : {}) });

async function conversation() {
  const t = convexTest(schema, modules);
  resend.register(t);
  const ids = await t.run(async (ctx) => {
    const threadId = await ctx.db.insert("ragThreads", { track: "personal", title: "Car loan", ownerKey: "https://clerk.test|alice", organizationKey: null });
    await ctx.db.insert("ragMessages", { threadId, role: "user", text: "Can I borrow 50,000 lei? My card is 4111 1111 1111 1111." });
    const messageId = await ctx.db.insert("ragMessages", { threadId, role: "assistant", text: "Here are your routes.\n\nA personal loan fits best.", status: "done",
      answer: { status: "answered", sources: [{ title: "Personal loan", url: "https://www.raiffeisen.ro/loan", collectedOn: "2026-10-01" }],
        routing: { inquiry: "loan_solution", handler: "answer" }, checks: { ungroundedNumbers: [] } } });
    const refusedId = await ctx.db.insert("ragMessages", { threadId, role: "assistant", text: "I can't help with that.", status: "done", answer: { status: "refused" } });
    return { threadId, messageId, refusedId };
  });
  return { t, ...ids };
}

describe("answer checks: the customer side", () => {
  it("records one masked check per answer and shows its status in the thread", async () => {
    const { t, threadId, messageId } = await conversation();
    const alice = t.withIdentity(who("alice"));
    const sent = await alice.mutation(anyApi.answerChecks.request, { messageId, note: "Is the fee right? Call 0722 123 456" });
    expect(sent).toMatchObject({ status: "open", reference: expect.stringMatching(/^AC-[2-9A-Z]{6}$/), reviewer: null, note: null });
    expect(await alice.mutation(anyApi.answerChecks.request, { messageId })).toEqual(sent);

    const [stored, ...rest] = await t.run((ctx) => ctx.db.query("answerChecks").collect());
    expect(rest).toHaveLength(0);
    expect(stored!.snapshot.questions[0]).not.toContain("4111 1111 1111 1111");
    expect(stored!.snapshot.note).not.toContain("0722");
    expect(stored!.snapshot).toMatchObject({ paragraphs: ["Here are your routes.", "A personal loan fits best."], inquiry: "loan_solution" });

    expect(await alice.query(anyApi.answerChecks.forThread, { threadId })).toEqual([{ messageId, ...sent }]);
  });

  it("refuses anonymous callers, other customers, and answers that can't be flagged", async () => {
    const { t, threadId, messageId, refusedId } = await conversation();
    await expect(t.mutation(anyApi.answerChecks.request, { messageId })).rejects.toThrow(/authentication_required/);
    const bob = t.withIdentity(who("bob"));
    await expect(bob.mutation(anyApi.answerChecks.request, { messageId })).rejects.toThrow(/conversation_unavailable/);
    await expect(bob.query(anyApi.answerChecks.forThread, { threadId })).rejects.toThrow(/conversation_unavailable/);
    const alice = t.withIdentity(who("alice"));
    await expect(alice.mutation(anyApi.answerChecks.request, { messageId: refusedId })).rejects.toThrow(/request_unavailable/);
    await expect(alice.mutation(anyApi.answerChecks.request, { messageId, note: "x".repeat(501) })).rejects.toThrow(/note_too_long/);
  });

  it("allows five new checks a day", async () => {
    const { t, threadId } = await conversation();
    const alice = t.withIdentity(who("alice"));
    const ids = await t.run(async (ctx) => Promise.all(Array.from({ length: 6 }, (_, i) =>
      ctx.db.insert("ragMessages", { threadId, role: "assistant", text: `Answer ${i}`, status: "done", answer: { status: "answered" } }))));
    for (const messageId of ids.slice(0, 5)) await alice.mutation(anyApi.answerChecks.request, { messageId });
    await expect(alice.mutation(anyApi.answerChecks.request, { messageId: ids[5] })).rejects.toThrow(/answer_check_limit_reached/);
  });
});

describe("answer checks: the customer's list", () => {
  it("lists only the caller's own checks on the track asked for, newest first", async () => {
    const { t, threadId, messageId } = await conversation();
    const alice = t.withIdentity(who("alice"));
    const later = await t.run((ctx) => ctx.db.insert("ragMessages", { threadId, role: "assistant", text: "Second answer.", status: "done", answer: { status: "answered" } }));
    const first = await alice.mutation(anyApi.answerChecks.request, { messageId });
    const second = await alice.mutation(anyApi.answerChecks.request, { messageId: later });

    const list = await alice.query(anyApi.answerChecks.mine, { track: "personal" });
    expect(list.map((c: { reference: string }) => c.reference)).toEqual([second.reference, first.reference]);
    expect(list[1]).toMatchObject({ threadId, messageId, status: "open" });
    expect(list[1].question).not.toContain("4111 1111 1111 1111");

    expect(await t.withIdentity(who("bob")).query(anyApi.answerChecks.mine, { track: "personal" })).toEqual([]);
    await expect(alice.query(anyApi.answerChecks.mine, { track: "business" })).rejects.toThrow(/organization_required/);
    await expect(t.query(anyApi.answerChecks.mine, { track: "personal" })).rejects.toThrow(/authentication_required/);
  });
});

describe("answer checks: the operator side", () => {
  it("lists and decides only for operators and admins, once, with an audit entry", async () => {
    const { t, threadId, messageId } = await conversation();
    const alice = t.withIdentity(who("alice"));
    await alice.mutation(anyApi.answerChecks.request, { messageId });
    await expect(alice.query(anyApi.answerChecks.list, {})).rejects.toThrow(/forbidden/);

    const ana = t.withIdentity(who("Ana M.", "operator"));
    const { open, decided } = await ana.query(anyApi.answerChecks.list, {});
    expect(decided).toEqual([]);
    expect(open).toHaveLength(1);
    expect(open[0]).not.toHaveProperty("ownerKey");
    const checkId = open[0].id;
    expect((await ana.query(anyApi.answerChecks.get, { checkId })).snapshot.sources).toHaveLength(1);

    await expect(alice.mutation(anyApi.answerChecks.decide, { checkId, decision: "confirm" })).rejects.toThrow(/forbidden/);
    await expect(ana.mutation(anyApi.answerChecks.decide, { checkId, decision: "return" })).rejects.toThrow(/note_required/);
    await ana.mutation(anyApi.answerChecks.decide, { checkId, decision: "correct", note: "The origination fee is 0 lei this month." });
    await expect(t.withIdentity(who("Root", "admin")).mutation(anyApi.answerChecks.decide, { checkId, decision: "confirm" })).rejects.toThrow(/already_decided/);

    const [view] = await alice.query(anyApi.answerChecks.forThread, { threadId });
    expect(view).toMatchObject({ status: "corrected", reviewer: { name: "Ana M.", role: "Specialist" }, note: "The origination fee is 0 lei this month." });
    expect((await ana.query(anyApi.answerChecks.list, {})).decided).toHaveLength(1);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toEqual([expect.objectContaining({ action: "answerCheck.decide", actorRole: "operator", details: expect.objectContaining({ decision: "correct" }) })]);
  });
});

describe("answer checks: e-mails", () => {
  const URL = "https://test-deployment.convex.cloud";
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  // The component's queue would call Resend's API; tests answer for it, so nothing leaves the machine
  const resendApi = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "re_test_1" }] }), { status: 200, headers: { "content-type": "application/json" } })));

  async function sentWithEmail() {
    vi.useFakeTimers();
    const { t, messageId } = await conversation();
    await t.run((ctx) => ctx.db.insert("users", { clerkUserId: "alice", tokenIdentifier: "https://clerk.test|alice", role: "member", email: "alice@example.com", firstSeenAt: 0, lastSeenAt: 0 }));
    await t.withIdentity(who("alice")).mutation(anyApi.answerChecks.request, { messageId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [check] = await t.run((ctx) => ctx.db.query("answerChecks").collect());
    return { t, check: check! };
  }

  it("records a skipped e-mail where sending is off", async () => {
    const { check } = await sentWithEmail();
    expect(check.emailOptIn).toBe(true);
    expect(check.emails).toEqual([expect.objectContaining({ kind: "received", outcome: "skipped", reason: "off" })]);
  });

  it("sends the confirmation and the reply to Resend's test inbox, never the address, until it's live", async () => {
    vi.stubEnv("RAIFFY_EMAIL_ENABLED", "true"); vi.stubEnv("RAIFFY_EMAIL_DEPLOYMENT_URL", URL); vi.stubEnv("CONVEX_CLOUD_URL", URL);
    vi.stubEnv("RAIFFY_EMAIL_FROM", "Raiffy <raiffy@example.com>"); vi.stubEnv("RESEND_API_KEY", "re_test"); resendApi();
    const { t, check } = await sentWithEmail();
    expect(check.emails).toEqual([expect.objectContaining({ kind: "received", outcome: "test", emailId: expect.any(String) })]);

    await t.withIdentity(who("Ana M.", "operator")).mutation(anyApi.answerChecks.decide, { checkId: check._id, decision: "confirm" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = (await t.run((ctx) => ctx.db.get(check._id)))!;
    expect(after.emails!.map((e) => [e.kind, e.outcome])).toEqual([["received", "test"], ["decided", "test"]]);
    expect(JSON.stringify(after)).not.toContain("alice@example.com");
  });

  it("skips a check sent before e-mails began", async () => {
    vi.stubEnv("RAIFFY_EMAIL_ENABLED", "true"); vi.stubEnv("RAIFFY_EMAIL_DEPLOYMENT_URL", URL); vi.stubEnv("CONVEX_CLOUD_URL", URL);
    vi.stubEnv("RAIFFY_EMAIL_FROM", "Raiffy <raiffy@example.com>"); vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.useFakeTimers();
    const { t, messageId } = await conversation();
    await t.withIdentity(who("alice")).mutation(anyApi.answerChecks.request, { messageId });
    const [check] = await t.run((ctx) => ctx.db.query("answerChecks").collect());
    await t.run((ctx) => ctx.db.patch(check!._id, { emailOptIn: undefined, emails: undefined }));
    await t.mutation(internal.answerCheckEmails.send, { checkId: check!._id, kind: "received" });
    expect((await t.run((ctx) => ctx.db.get(check!._id)))!.emails).toEqual([expect.objectContaining({ outcome: "skipped", reason: "opted_out" })]);
  });
});

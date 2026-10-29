import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import schema from "./schema";
import { AUDIENCES, COMPLEXITIES, INQUIRIES, MEMORY_CANDIDATES, MEMORY_OPERATIONS, SCOPES } from "../lib/agent/jev";

const { runAgentMock, embedMock, jevMock, searchMock, slotsMock, fallbackMock } = vi.hoisted(() => ({ runAgentMock: vi.fn(), embedMock: vi.fn(), jevMock: vi.fn(), searchMock: vi.fn(), slotsMock: vi.fn(), fallbackMock: vi.fn() }));
vi.mock("../lib/rag/agent", () => ({ runAgent: runAgentMock }));
vi.mock("./openai", () => ({ embedTexts: embedMock }));
vi.mock("./jevTransport", () => ({ requestJev: jevMock, requestJevSlots: slotsMock }));
vi.mock("./fallbackModel", () => ({ askFallbackModel: fallbackMock }));
vi.mock("./knowledge", () => ({ searchKnowledge: searchMock }));

/** Number of inquiry labels Jev chooses from; split distributions below are built from it. */
const LABELS = Object.keys(INQUIRIES).length;

const choice = (labels: Record<string, string>, selected: string) => {
  const keys = Object.keys(labels); const top = 0.95 * (1 - 1/keys.length) + 1/keys.length;
  return { type: "choice", choice: selected, confidence: 0.95,
    probabilities: Object.fromEntries(keys.map(k => [k, k === selected ? top : (1-top)/(keys.length-1)])) };
};
function classification(inquiry = "product_explanation", scope = "detail") {
  return { model: "jev-1.14.0", answers: {
    inquiry: choice(INQUIRIES, inquiry), scope: choice(SCOPES, scope), complexity: choice(COMPLEXITIES, "simple"),
    audience: choice(AUDIENCES, "unclear"), memory_operation: choice(MEMORY_OPERATIONS, "none"), memory_candidate: choice(MEMORY_CANDIDATES, "none"),
    ...Object.fromEntries(["memory_durable", "special_category", "multi_goal", "crisis", "fraud", "hardship", "aml_evasion", "prompt_injection"].map(k => [k, { type: "noul", noul: 0.01 }])),
  }, usage: { input_tokens: 100, output_tokens: 20 } };
}

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./agent.ts": () => import("./agent"),
  "./rag.ts": () => import("./rag"),
  "./calculator.ts": () => import("./calculator"),
  "./catalog.ts": () => import("./catalog"),
  "./advice.ts": () => import("./advice"),
  "./accounts.ts": () => import("./accounts"),
  "./pricing.ts": () => import("./pricing"),
  "./regulatoryLimits.ts": () => import("./regulatoryLimits"),
  "./memory.ts": () => import("./memory"),
  "./conversations.ts": () => import("./conversations"),
};
const fresh = () => convexTest(schema, modules);
const identity = (subject = "alice", org_id?: string) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...(org_id ? { org_id } : {}) });
const args = { question: "Explain a term deposit.", track: "personal" as const };
const answer = {
  status: "no_results", text: "No verified information is available.", segments: [], sources: [],
  checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 },
  model: "test-model", promptVersion: "test-prompt", searches: [], retrieval: [],
};

beforeEach(() => {
  runAgentMock.mockReset().mockResolvedValue(answer);
  embedMock.mockReset().mockRejectedValue(new Error("mock_embedding_boundary"));
  jevMock.mockReset().mockResolvedValue({ status: "classified", classification: classification() });
  searchMock.mockReset();
  slotsMock.mockReset().mockResolvedValue(null);
  fallbackMock.mockReset().mockResolvedValue(null);
  vi.stubEnv("RAIFFY_JEV_ENABLED", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  // The private-memory demo fallback must never permit paid agent access.
  vi.stubEnv("RAIFFY_DEMO_IDENTITY_ENABLED", "true");
});

describe("UI to Jev to RAG pipeline", () => {
  it("screens stored messages, titles and classifier input before either provider", async () => {
    const t = fresh(); const alice = t.withIdentity(identity());
    const { threadId } = await alice.action(anyApi.agent.ask, { ...args, question: "Email me at alice@example.com about term deposits." });
    const rows = await alice.query(anyApi.agent.listMessages, { threadId });
    expect(JSON.stringify(rows)).not.toContain("alice@example.com");
    expect(jevMock.mock.calls[0]![0].message).toContain("[REDACTED]");
    expect(runAgentMock.mock.calls[0]![0].question).not.toContain("alice@example.com");
    expect(runAgentMock.mock.calls[0]![0].allowedCollections).toEqual(["bank_product_docs", "banking_help"]);
  });

  it("stops on classifier failure without generation or retrieval", async () => {
    jevMock.mockResolvedValue({ status: "unavailable", reason: "timeout" });
    const t = fresh();
    const result = await t.withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(result.answer.routing.reason).toBe("timeout");
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("retries Jev once after a malformed reply, but not after a timeout", async () => {
    jevMock.mockResolvedValueOnce({ status: "unavailable", reason: "invalid_response" });
    const retried = await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(jevMock).toHaveBeenCalledTimes(2);
    expect(retried.answer.routing.reason).not.toBe("invalid_response");
    jevMock.mockReset().mockResolvedValue({ status: "unavailable", reason: "timeout" });
    await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(jevMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the customer's own figures in the final catalog check", async () => {
    const question = "I am 20 and want 10,000 EUR. Can I get a personal loan?";
    runAgentMock.mockResolvedValue({ ...answer, status: "answered", text: "At 20 you don't meet the minimum age yet, so 10,000 EUR isn't available today." });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, { ...args, question });
    expect(result.answer.text).toContain("10,000 EUR");
    expect(result.answer.verification.financialTermsSupported).toBe(true);
    expect(runAgentMock.mock.calls[0]![0].customerStatements).toEqual([question]);
  });

  it("shows financial figures from a checked answer as fetched (demo)", async () => {
    runAgentMock.mockResolvedValue({ ...answer, status: "answered", text: "The interest rate is 5.5%." });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(result.answer.text).toContain("5.5%");
    expect(result.answer.text).not.toContain("prices are not available");
    expect(result.answer.verification.financialTermsSupported).toBe(true);
  });

  it("still withholds an answer whose figures failed the source check", async () => {
    runAgentMock.mockResolvedValue({ ...answer, status: "failed_checks", text: "The interest rate is 9.9%." });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(result.answer.text).not.toContain("9.9");
  });

  it("hardship suppresses sales before Claude and exposes the controlled UI envelope", async () => {
    const c = classification(); Object.assign(c.answers, { hardship: { type: "noul", noul: 0.9 } });
    jevMock.mockResolvedValue({ status: "classified", classification: c });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(result.answer.ui.mode).toBe("hardship");
    expect(result.answer.ui.flags.suppressOffers).toBe(true);
    // No sales follow-ups and no booking button: the hardship text names Raiffeisen's support team.
    expect(result.answer.ui.actions).toEqual([]);
    expect(result.answer.text).toMatch(/support team/);
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("denies collections outside the trusted route even if Claude asks for them", async () => {
    runAgentMock.mockImplementation(async (_input, deps) => {
      const result = await deps.search({ collection: "competitor_docs", query: "secret", limit: 5 });
      expect(result.status).toBe("unavailable");
      return answer;
    });
    await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("starts a queued request once, isolates run/stop and never publishes a stopped reply", async () => {
    const t = fresh(); const alice = t.withIdentity(identity()); const bob = t.withIdentity(identity("bob"));
    const sent = await alice.mutation(anyApi.agent.send, args);
    await expect(bob.action(anyApi.agent.run, { messageId: sent.messageId })).rejects.toThrow("conversation_unavailable");
    await expect(bob.mutation(anyApi.agent.stop, { messageId: sent.messageId })).rejects.toThrow("conversation_unavailable");
    await alice.mutation(anyApi.agent.stop, { messageId: sent.messageId });
    await alice.action(anyApi.agent.run, { messageId: sent.messageId });
    expect(jevMock).not.toHaveBeenCalled();
    const rows = await alice.query(anyApi.agent.listMessages, { threadId: sent.threadId });
    expect(rows.at(-1)).toMatchObject({ status: "stopped", text: "" });
    expect(await alice.query(anyApi.agent.listThreads, {})).toHaveLength(1);
    expect(await bob.query(anyApi.agent.listThreads, {})).toHaveLength(0);
  });

  it("reserves evidence space for both bank collections in a comparison", async () => {
    const c = classification(); const inquiry = c.answers.inquiry;
    [inquiry.probabilities.product_comparison, inquiry.probabilities.product_explanation] = [inquiry.probabilities.product_explanation!, inquiry.probabilities.product_comparison!];
    inquiry.choice = "product_comparison";
    jevMock.mockResolvedValue({ status: "classified", classification: c });
    searchMock.mockImplementation(async (_ctx, _track, input) => ({ status: "ok", collection: input.collection,
      passages: Array.from({length: input.limit}, (_,i) => ({ passageId: `${input.collection}-${i}` })),
      coverage: { requested: input.limit, returned: input.limit, gaps: [] } }));
    runAgentMock.mockImplementation(async (_input, deps) => {
      const own = await deps.search({ collection: "bank_product_docs", query: "personal loan", limit: 5 });
      const other = await deps.search({ collection: "competitor_docs", query: "BCR loan", limit: 5 });
      expect(own.passages).toHaveLength(3);
      expect(other.passages).toHaveLength(2);
      return answer;
    });
    await fresh().withIdentity(identity()).action(anyApi.agent.ask, { ...args, question: "Compare Raiffeisen's personal loan with BCR's for 40,000 lei over 5 years." });
    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it("asks only for missing required inputs, then answers with every input in the brief", async () => {
    const c = classification(); const inquiry = c.answers.inquiry;
    [inquiry.probabilities.affordability, inquiry.probabilities.product_explanation] = [inquiry.probabilities.product_explanation!, inquiry.probabilities.affordability!];
    inquiry.choice = "affordability";
    jevMock.mockResolvedValue({ status: "classified", classification: c });
    const t = fresh(); const alice = t.withIdentity(identity());
    const first = await alice.action(anyApi.agent.ask, { ...args, question: "Can I afford a 2,000 lei monthly payment?" });
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(first.answer.routing).toMatchObject({ handler: "collect_inputs", inquiry: "affordability" });
    expect(first.answer.ui.blocks[0].fields.map((f: { key: string }) => f.key)).toEqual(["income", "obligations"]);
    expect(first.answer.ui.actions).toEqual([expect.objectContaining({ kind: "skip_inputs" })]);

    // The form reply is short, so Jev sees "other"; the pending question keeps the pattern.
    const other = classification(); other.answers.inquiry = { ...other.answers.inquiry, choice: "other",
      probabilities: Object.fromEntries(Object.keys(INQUIRIES).map(k => [k, k === "other" ? 0.87 : 0.13 / (LABELS - 1)])) };
    other.answers.inquiry.confidence = (0.87 - 1 / LABELS) / (1 - 1 / LABELS);
    jevMock.mockResolvedValue({ status: "classified", classification: other });
    const second = await alice.action(anyApi.agent.ask, { ...args, threadId: first.threadId, question: "Net monthly income: 7,500 lei · Monthly loan and card payments: 0",
      reply: { kind: "inputs", values: { income: 7500, obligations: 0, amount: 999 } } });
    expect(second.answer.routing).toMatchObject({ inquiry: "affordability", basis: "pending", inputs: { known: { monthlyPayment: "conversation", income: "form", obligations: "form" } } });
    expect(runAgentMock).toHaveBeenCalledTimes(1);
  });

  it("offers close patterns as choices when neither Jev nor the fallback can decide, and accepts only an offered choice", async () => {
    const c = classification(); const inquiry = c.answers.inquiry;
    inquiry.probabilities = Object.fromEntries(Object.keys(INQUIRIES).map(k => [k, k === "negotiation" ? 0.45 : k === "product_comparison" ? 0.42 : 0.13 / (LABELS - 2)]));
    inquiry.choice = "negotiation"; inquiry.confidence = (0.45 - 1 / LABELS) / (1 - 1 / LABELS);
    jevMock.mockResolvedValue({ status: "classified", classification: c });
    const t = fresh(); const alice = t.withIdentity(identity());
    const first = await alice.action(anyApi.agent.ask, { ...args, question: "BT is cheaper." });
    expect(fallbackMock).toHaveBeenCalledTimes(1);
    expect(first.answer.ui.actions.map((a: { inquiry: string }) => a.inquiry)).toEqual(["negotiation", "product_comparison"]);
    await expect(alice.action(anyApi.agent.ask, { ...args, threadId: first.threadId, question: "Approve", reply: { kind: "choose", inquiry: "security_complaint" } }))
      .resolves.toMatchObject({ answer: { routing: { handler: "clarify" } } });
    const chosen = await alice.action(anyApi.agent.ask, { ...args, threadId: first.threadId, question: "Get a better offer", reply: { kind: "choose", inquiry: "negotiation" } });
    expect(chosen.answer.routing).toMatchObject({ inquiry: "negotiation", basis: "choice", handler: "collect_inputs" });
  });

  it("routes on the fallback model's pick when Jev is split", async () => {
    const c = classification(); const inquiry = c.answers.inquiry;
    inquiry.probabilities = Object.fromEntries(Object.keys(INQUIRIES).map(k => [k, k === "negotiation" ? 0.45 : k === "product_comparison" ? 0.42 : 0.13 / (LABELS - 2)]));
    inquiry.choice = "negotiation"; inquiry.confidence = (0.45 - 1 / LABELS) / (1 - 1 / LABELS);
    jevMock.mockResolvedValue({ status: "classified", classification: c });
    fallbackMock.mockResolvedValue({ inquiry: "product_comparison", inputs: {} });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, { ...args, question: "Which current account is cheaper, yours or ING's?" });
    expect(result.answer.routing).toMatchObject({ inquiry: "product_comparison", basis: "fallback", fallbackUsed: true });
    expect(runAgentMock).toHaveBeenCalledTimes(1);
  });

  it("runs the affordability check on the customer's figures and the stored limits, and keeps its figures in the answer", async () => {
    jevMock.mockResolvedValue({ status: "classified", classification: classification("affordability") });
    const t = fresh();
    await t.run(async (ctx) => {
      for (const [key, value] of [["dti_max_share_ron", 0.4], ["dti_max_share_fx", 0.2], ["consumer_loan_max_months", 60]] as const) {
        await ctx.db.insert("regulatoryLimits", { key, value, sourceLabel: "Test limits", sourceUrl: "https://example.test", validFrom: "2026-01-01", status: "pending_review" });
      }
    });
    runAgentMock.mockImplementation(async (_input, deps) => {
      const ok = await deps.calculate({ calculation: "loan_affordability", netMonthlyIncome: 4500, loanAmount: 50000, termMonths: 60 });
      expect(JSON.parse(ok.content).results.maxNewMonthlyInstalment).toBe(1800);
      expect((await deps.calculate({ calculation: "loan_affordability", netMonthlyIncome: 9000, loanAmount: 50000, termMonths: 60 })).status).toBe("unavailable");
      return { ...answer, status: "answered", text: "Up to 1,800 lei a month can go to instalments." };
    });
    const result = await t.withIdentity(identity()).action(anyApi.agent.ask, { ...args, question: "My salary is 4500 lei and I have no other loans. Can I borrow 50000 lei over 60 months?" });
    expect(result.answer.verification.financialTermsSupported).toBe(true);
    expect(result.answer.text).toContain("1,800 lei");
  });

  it("records the message, queues Claude's memory proposal for consent and brings saved memories into later chats", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("RAIFFY_MEMORY_WRITES_ENABLED", "true");
    vi.stubEnv("RAIFFY_MEMORY_WRITES_DEPLOYMENT_URL", "http://127.0.0.1:3210");
    const stated = classification("purchase_goal", "solution");
    Object.assign(stated.answers, { memory_candidate: choice(MEMORY_CANDIDATES, "goal"), memory_durable: { type: "noul", noul: 0.9 } });
    jevMock.mockResolvedValue({ status: "classified", classification: stated });
    const alice = fresh().withIdentity(identity());
    const question = "I want to buy a used car next year for about 30,000 lei.";
    runAgentMock.mockImplementation(async (input, deps) => {
      expect(input.customerContext).toBeUndefined();
      expect(await deps.proposeMemory({ kind: "goal", text: "buy a used car next year", customerQuote: question })).toMatchObject({ status: "proposed" });
      expect((await deps.proposeMemory({ kind: "goal", text: "buy a boat", customerQuote: "I want to buy a boat." })).status).toBe("unavailable");
      return answer;
    });
    const first = await alice.action(anyApi.agent.ask, { ...args, question });
    const block = first.answer.ui.blocks.find((b: { type: string }) => b.type === "memory");
    expect(block.proposals).toEqual([{ id: expect.any(String), kind: "goal", text: "buy a used car next year", customerQuote: question }]);
    await alice.mutation(anyApi.memory.confirm, { track: "personal", proposalId: block.proposals[0].id });

    runAgentMock.mockImplementation(async (input) => { expect(input.customerContext).toContain("buy a used car next year"); return answer; });
    await alice.action(anyApi.agent.ask, { ...args, question: "Which loan would suit me for a 30,000 lei car?" });
    expect(runAgentMock).toHaveBeenCalledTimes(2);

    const inspect = classification(); inspect.answers.memory_operation = choice(MEMORY_OPERATIONS, "inspect");
    jevMock.mockResolvedValue({ status: "classified", classification: inspect });
    const listed = await alice.action(anyApi.agent.ask, { ...args, question: "What do you remember about me?" });
    expect(listed.answer.text).toContain("buy a used car next year");
    expect(runAgentMock).toHaveBeenCalledTimes(2);
  });

  it("keeps memory proposals off where writes aren't enabled for this deployment", async () => {
    const stated = classification("purchase_goal", "solution");
    Object.assign(stated.answers, { memory_candidate: choice(MEMORY_CANDIDATES, "goal"), memory_durable: { type: "noul", noul: 0.9 } });
    jevMock.mockResolvedValue({ status: "classified", classification: stated });
    runAgentMock.mockImplementation(async (_input, deps) => { expect(deps.proposeMemory).toBeUndefined(); return answer; });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, { ...args, question: "I want to buy a used car next year." });
    expect(result.answer.ui.blocks.some((b: { type: string }) => b.type === "memory")).toBe(false);
  });

  it("attaches the chosen sample customer's statement, and reads it for that question even with the switches off", async () => {
    jevMock.mockResolvedValue({ status: "classified", classification: classification("other") });
    const t = fresh(); const alice = t.withIdentity(identity());
    const attach = { ...args, question: "What stands out on this statement?", attachment: "sample_statement" as const };
    await expect(alice.mutation(anyApi.agent.send, attach)).rejects.toThrow("statement_unavailable");
    await expect(alice.mutation(anyApi.agent.send, { ...attach, track: "business" })).rejects.toThrow();
    await t.run((ctx) => ctx.db.insert("accountAccess", { ownerKey: identity().tokenIdentifier, persona: "new-client", account: false, savings: false, cards: false, transactions: false, updatedAt: 0 }));
    runAgentMock.mockImplementation(async (input) => {
      const tool = input.hostTools.find((h: { tool: { name: string } }) => h.tool.name === "get_expense_summary");
      expect(tool).toBeDefined();
      const read = await tool.run({ period: "last_complete_month" });
      expect(read.citables).toHaveLength(1);
      expect(read.citables[0].text).toContain("Income:");
      return { ...answer, status: "answered", text: "Most of the month went on rent." };
    });
    await alice.action(anyApi.agent.ask, attach);
    expect(runAgentMock).toHaveBeenCalledOnce();
    const stored = await t.run((ctx) => ctx.db.query("ragMessages").filter((q) => q.eq(q.field("role"), "user")).first());
    expect(stored?.attachment).toBe("sample_statement");
  });

  it("enforces a per-owner request limit before provider spend", async () => {
    const t = fresh(); const alice = t.withIdentity(identity());
    for (let i=0;i<10;i++) await alice.mutation(anyApi.agent.send, args);
    await expect(alice.mutation(anyApi.agent.send, args)).rejects.toThrow("rate_limit_exceeded");
    expect(jevMock).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated agent access", () => {
  it("rejects anonymous paid calls before creating a thread or reaching either provider", async () => {
    const t = fresh();
    await expect(t.action(anyApi.agent.ask, args)).rejects.toThrow("authentication_required");
    await expect(t.action(anyApi.rag.search, { question: "term deposit", track: "personal" })).rejects.toThrow("authentication_required");
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(embedMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("ragThreads").collect())).toEqual([]);
  });

  it("derives ownership from auth and lets the owner continue and read a thread", async () => {
    const t = fresh(); const alice = t.withIdentity(identity());
    const first = await alice.action(anyApi.agent.ask, args);
    const thread = await t.run((ctx) => ctx.db.get(first.threadId));
    expect(thread).toMatchObject({ ownerKey: identity().tokenIdentifier, organizationKey: null, track: "personal" });
    await alice.action(anyApi.agent.ask, { ...args, question: "Tell me more.", threadId: first.threadId });
    expect((await alice.query(anyApi.agent.listMessages, { threadId: first.threadId })).map((m: { role: string }) => m.role))
      .toEqual(["user", "assistant", "user", "assistant"]);
    expect(runAgentMock).toHaveBeenCalledTimes(2);
  });

  it("blocks anonymous and different-user reads and continuation without provider calls", async () => {
    const t = fresh(); const alice = t.withIdentity(identity()); const bob = t.withIdentity(identity("bob"));
    const { threadId } = await alice.action(anyApi.agent.ask, args);
    runAgentMock.mockClear();
    await expect(t.query(anyApi.agent.listMessages, { threadId })).rejects.toThrow("authentication_required");
    await expect(bob.query(anyApi.agent.listMessages, { threadId })).rejects.toThrow("conversation_unavailable");
    await expect(bob.action(anyApi.agent.ask, { ...args, threadId })).rejects.toThrow("conversation_unavailable");
    await expect(bob.query(anyApi.agent.recentTurns, { threadId, limit: 10 })).rejects.toThrow("conversation_unavailable");
    await expect(bob.mutation(anyApi.agent.saveMessage, { threadId, role: "user", text: "intrusion" })).rejects.toThrow("conversation_unavailable");
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(await alice.query(anyApi.agent.listMessages, { threadId })).toHaveLength(2);
  });

  it("requires an organization for business calls and isolates the same user across organizations", async () => {
    const t = fresh(); const personal = t.withIdentity(identity());
    await expect(personal.action(anyApi.agent.ask, { ...args, track: "business" })).rejects.toThrow("organization_required");
    await expect(personal.action(anyApi.rag.search, { question: "fees", track: "business" })).rejects.toThrow("organization_required");
    const orgA = t.withIdentity(identity("alice", "org-a")); const orgB = t.withIdentity(identity("alice", "org-b"));
    const { threadId } = await orgA.action(anyApi.agent.ask, { ...args, track: "business" });
    runAgentMock.mockClear();
    await expect(orgB.query(anyApi.agent.listMessages, { threadId })).rejects.toThrow("conversation_unavailable");
    await expect(orgB.action(anyApi.agent.ask, { ...args, track: "business", threadId })).rejects.toThrow("conversation_unavailable");
    await expect(orgA.action(anyApi.agent.ask, { ...args, threadId })).rejects.toThrow("other track");
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(await orgA.query(anyApi.agent.listMessages, { threadId })).toHaveLength(2);
  });

  it("never adopts legacy unowned threads or accepts a client-selected owner", async () => {
    const t = fresh(); const alice = t.withIdentity(identity());
    const threadId = await t.run((ctx) => ctx.db.insert("ragThreads", { track: "personal", title: "Legacy" }));
    await expect(alice.query(anyApi.agent.listMessages, { threadId })).rejects.toThrow("conversation_unavailable");
    await expect(alice.action(anyApi.agent.ask, { ...args, threadId })).rejects.toThrow("conversation_unavailable");
    await expect(alice.mutation(anyApi.agent.createThread, { track: "personal", title: "Fake owner", ownerKey: "other" })).rejects.toThrow();
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("bounds message/history reads while preserving chronological ordering", async () => {
    const t = fresh(); const alice = t.withIdentity(identity());
    const { threadId } = await alice.action(anyApi.agent.ask, args);
    expect(await alice.query(anyApi.agent.listMessages, { threadId, limit: 1 })).toMatchObject([{ role: "assistant" }]);
    await expect(alice.query(anyApi.agent.listMessages, { threadId, limit: 101 })).rejects.toThrow("message_limit_invalid");
    await expect(alice.query(anyApi.agent.recentTurns, { threadId, limit: 21 })).rejects.toThrow("history_limit_invalid");
  });

  it("lets an authenticated caller reach the mocked public-document embedding boundary", async () => {
    const t = fresh(); const alice = t.withIdentity(identity());
    await expect(alice.action(anyApi.rag.search, { question: "term deposit", track: "personal" })).rejects.toThrow("mock_embedding_boundary");
    expect(embedMock).toHaveBeenCalledOnce();
  });
});

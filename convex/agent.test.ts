import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import schema from "./schema";
import { AUDIENCES, COMPLEXITIES, INQUIRIES, MEMORY_CANDIDATES, MEMORY_OPERATIONS, SCOPES } from "../lib/agent/jev";

const { runAgentMock, embedMock, jevMock, searchMock } = vi.hoisted(() => ({ runAgentMock: vi.fn(), embedMock: vi.fn(), jevMock: vi.fn(), searchMock: vi.fn() }));
vi.mock("../lib/rag/agent", () => ({ runAgent: runAgentMock }));
vi.mock("./openai", () => ({ embedTexts: embedMock }));
vi.mock("./jevTransport", () => ({ requestJev: jevMock }));
vi.mock("./knowledge", () => ({ searchKnowledge: searchMock }));

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

  it("withholds exact financial figures until a reviewed catalog is connected", async () => {
    runAgentMock.mockResolvedValue({ ...answer, status: "answered", text: "The interest rate is 5.5%." });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(result.answer.text).not.toContain("5.5");
    expect(result.answer.text).toContain("prices are not available");
    expect(result.answer.verification.financialTermsSupported).toBe(false);
    expect(result.answer.ui.mode).toBe("degraded");
  });

  it("hardship suppresses sales before Claude and exposes the controlled UI envelope", async () => {
    const c = classification(); Object.assign(c.answers, { hardship: { type: "noul", noul: 0.9 } });
    jevMock.mockResolvedValue({ status: "classified", classification: c });
    const result = await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(result.answer.ui.mode).toBe("hardship");
    expect(result.answer.ui.flags.suppressOffers).toBe(true);
    // No sales follow-ups; only the human callback the hardship flow calls for.
    expect(result.answer.ui.actions).toEqual([{ kind: "handoff", label: "Talk to an adviser", reason: "hardship" }]);
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
    await fresh().withIdentity(identity()).action(anyApi.agent.ask, { ...args, question: "Compare a Raiffeisen personal loan with a BCR one." });
    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it("reserves evidence space for the product FAQs in a product question", async () => {
    searchMock.mockImplementation(async (_ctx, _track, input) => ({ status: "ok", collection: input.collection,
      passages: Array.from({length: input.limit}, (_,i) => ({ passageId: `${input.collection}-${i}` })),
      coverage: { requested: input.limit, returned: input.limit, gaps: [] } }));
    runAgentMock.mockImplementation(async (input, deps) => {
      expect(input.withholdFinancialFigures).toBe(true);
      const docs = await deps.search({ collection: "bank_product_docs", query: "depozit la termen", limit: 5 });
      const faq = await deps.search({ collection: "banking_help", query: "depozit la termen", limit: 5 });
      expect(docs.passages).toHaveLength(3);
      expect(faq.passages).toHaveLength(2);
      return answer;
    });
    await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps no competitor space when both compared options are Raiffeisen products", async () => {
    jevMock.mockResolvedValue({ status: "classified", classification: classification("product_comparison", "compare") });
    searchMock.mockImplementation(async (_ctx, _track, input) => ({ status: "ok", collection: input.collection,
      passages: Array.from({length: input.limit}, (_,i) => ({ passageId: `${input.query}-${i}` })),
      coverage: { requested: input.limit, returned: input.limit, gaps: [] } }));
    runAgentMock.mockImplementation(async (_input, deps) => {
      const overdraft = await deps.search({ collection: "bank_product_docs", query: "descoperit de cont", limit: 5 });
      const loan = await deps.search({ collection: "bank_product_docs", query: "credit nevoi personale", limit: 5 });
      expect([overdraft.passages.length, loan.passages.length]).toEqual([3, 2]);
      return answer;
    });
    await fresh().withIdentity(identity()).action(anyApi.agent.ask, { ...args, question: "Is an overdraft or a personal loan better?" });
  });

  it("leaves evidence space for three routes when the customer describes a goal", async () => {
    jevMock.mockResolvedValue({ status: "classified", classification: classification("purchase_goal", "solution") });
    searchMock.mockImplementation(async (_ctx, _track, input) => ({ status: "ok", collection: input.collection,
      passages: Array.from({length: input.limit}, (_,i) => ({ passageId: `${input.query}-${i}` })),
      coverage: { requested: input.limit, returned: input.limit, gaps: [] } }));
    runAgentMock.mockImplementation(async (_input, deps) => {
      const routes = [];
      for (const query of ["credit nevoi personale", "descoperit de cont", "card de credit rate"]) {
        routes.push((await deps.search({ collection: "bank_product_docs", query, limit: 5 })).passages.length);
      }
      expect(routes).toEqual([2, 2, 1]);
      return answer;
    });
    await fresh().withIdentity(identity()).action(anyApi.agent.ask, args);
    expect(searchMock).toHaveBeenCalledTimes(3);
  });

  it("runs the calculator on the customer's figures and the stored limits, and keeps its figures in the answer", async () => {
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
    const result = await t.withIdentity(identity()).action(anyApi.agent.ask, { ...args, question: "My salary is 4500 lei. Can I borrow 50000 lei over 60 months?" });
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
    const question = "I want to buy a used car next year.";
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
    await alice.action(anyApi.agent.ask, { ...args, question: "Which loan would suit me?" });
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

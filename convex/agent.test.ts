import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import schema from "./schema";

const { runAgentMock, embedMock } = vi.hoisted(() => ({ runAgentMock: vi.fn(), embedMock: vi.fn() }));
vi.mock("../lib/rag/agent", () => ({ runAgent: runAgentMock }));
vi.mock("./openai", () => ({ embedTexts: embedMock }));

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./agent.ts": () => import("./agent"),
  "./rag.ts": () => import("./rag"),
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
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  // The private-memory demo fallback must never permit paid agent access.
  vi.stubEnv("RAIFFY_DEMO_IDENTITY_ENABLED", "true");
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

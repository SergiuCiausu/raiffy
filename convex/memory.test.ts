import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { DEMO_MEMORY_OWNER } from "../lib/agent/memory-store";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./conversations.ts": () => import("./conversations"),
  "./memory.ts": () => import("./memory"),
  "./memoryDemo.ts": () => import("./memoryDemo"),
};
const fresh = () => convexTest(schema, modules);
type TestBackend = ReturnType<typeof fresh>;
const text = "I am saving for a car over the next two years.";
const track = "personal" as const;

beforeEach(() => {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://demo-dev.eu-west-1.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://demo-dev.eu-west-1.convex.site");
  vi.stubEnv("RAIFFY_DEMO_DEPLOYMENT_URL", "https://demo-dev.eu-west-1.convex.cloud");
  vi.stubEnv("RAIFFY_DEMO_IDENTITY_ENABLED", "true");
  vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "true");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function proposal(t: Pick<TestBackend, "mutation">, value = text, kind: "goal" | "stated_financial" = "goal") {
  const source = await t.mutation(internal.conversations.recordCustomerMessage, { track, text: value });
  const args = { track, operation: "remember" as const, kind, text: value, customerQuote: value, sourceMessageId: source.messageId };
  const result = await t.mutation(internal.memory.propose, args);
  return { ...source, proposalId: result.id as Id<"memoryProposals">, args };
}

describe("Convex memory lifecycle", () => {
  it("queues a proposal, waits for customer consent, and confirms idempotently", async () => {
    const t = fresh(); const p = await proposal(t);
    const before = await t.query(api.memory.listMine, { track });
    expect(before.memories).toEqual([]);
    expect(before.proposals).toHaveLength(1);
    expect(before.proposals[0]).not.toHaveProperty("ownerKey");
    expect((await t.mutation(internal.memory.propose, p.args)).id).toBe(p.proposalId);
    const saved = await t.mutation(api.memory.confirm, { track, proposalId: p.proposalId });
    expect(saved.status).toBe("saved");
    expect(await t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).toEqual(saved);
    const after = await t.query(api.memory.listMine, { track });
    expect(after.proposals).toEqual([]); expect(after.memories).toHaveLength(1);
    expect(after.memories[0]).toMatchObject({ text, kind: "goal" });
    const row = await t.run((ctx) => ctx.db.get(saved.id as Id<"userMemories">));
    expect(row).toMatchObject({ ownerKey: DEMO_MEMORY_OWNER, consentEventId: p.proposalId });
    await expect(t.mutation(internal.memory.propose, p.args)).rejects.toThrow("memory_already_saved");
  });

  it("rejects a proposal without saving and prevents replay of the source", async () => {
    const t = fresh(); const p = await proposal(t);
    vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "false");
    expect((await t.mutation(api.memory.reject, { track, proposalId: p.proposalId })).status).toBe("rejected");
    expect(await t.query(api.memory.listMine, { track })).toEqual({ memories: [], proposals: [] });
    vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "true");
    await expect(t.mutation(internal.memory.propose, p.args)).rejects.toThrow("memory_source_ineligible");
    await expect(t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).rejects.toThrow("memory_unavailable");
  });

  it("removes a saved memory, its consent and competing updates without resurrection", async () => {
    const t = fresh(); const p = await proposal(t);
    const saved = await t.mutation(api.memory.confirm, { track, proposalId: p.proposalId });
    vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "false");
    expect((await t.mutation(api.memory.forgetOne, { track, memoryId: saved.id as Id<"userMemories"> })).status).toBe("forgotten");
    expect(await t.query(api.memory.listMine, { track })).toEqual({ memories: [], proposals: [] });
    expect(await t.run((ctx) => ctx.db.query("memoryProposals").collect())).toEqual([]);
    vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "true");
    await expect(t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).rejects.toThrow("memory_unavailable");
    await expect(t.mutation(internal.memory.propose, p.args)).rejects.toThrow("memory_source_ineligible");
  });

  it("applies corrections atomically and invalidates other proposals based on the replaced version", async () => {
    const t = fresh(); const old = await proposal(t);
    const first = await t.mutation(api.memory.confirm, { track, proposalId: old.proposalId });
    const nextText = "I am saving for a home over the next five years.";
    const source = await t.mutation(internal.conversations.recordCustomerMessage, { track, text: nextText });
    const args = { track, operation: "update" as const, kind: "goal" as const, text: nextText, customerQuote: nextText, sourceMessageId: source.messageId, replacesMemoryId: first.id as Id<"userMemories"> };
    const next = await t.mutation(internal.memory.propose, args);
    const competing = await t.mutation(internal.memory.propose, { ...args, text: "saving for a home" });
    const saved = await t.mutation(api.memory.confirm, { track, proposalId: next.id as Id<"memoryProposals"> });
    expect(await t.run((ctx) => ctx.db.get(first.id as Id<"userMemories">))).toBeNull();
    const listed = await t.query(api.memory.listMine, { track });
    expect(listed.memories.map((m) => m.text)).toEqual([nextText]); expect(listed.proposals).toEqual([]);
    expect(await t.mutation(api.memory.confirm, { track, proposalId: next.id as Id<"memoryProposals"> })).toEqual(saved);
    await expect(t.mutation(api.memory.confirm, { track, proposalId: competing.id as Id<"memoryProposals"> })).rejects.toThrow("memory_unavailable");
  });

  it("forgets pending and confirmed memories together and remains safe when called twice", async () => {
    const t = fresh(); const p = await proposal(t); await proposal(t, "I prefer concise explanations.");
    await t.mutation(api.memory.confirm, { track, proposalId: p.proposalId });
    expect(await t.mutation(api.memory.forgetAll, { track })).toEqual({ memoriesDeleted: 1, proposalsDeleted: 2 });
    expect(await t.mutation(api.memory.forgetAll, { track })).toEqual({ memoriesDeleted: 0, proposalsDeleted: 0 });
    expect(await t.query(api.memory.listMine, { track })).toEqual({ memories: [], proposals: [] });
  });

  it("bounds proposal and saved-memory growth while allowing idempotent retries at capacity", async () => {
    const t = fresh(); const p = await proposal(t);
    await t.run(async (ctx) => {
      const first = (await ctx.db.get(p.proposalId))!;
      const { _id: _id, _creationTime: _creationTime, ...row } = first;
      for (let i = 1; i < 100; i++) await ctx.db.insert("memoryProposals", { ...row, text: `synthetic ${i}` });
    });
    expect((await t.mutation(internal.memory.propose, p.args)).id).toBe(p.proposalId);
    const source = await t.mutation(internal.conversations.recordCustomerMessage, { track, text: "I prefer concise explanations." });
    await expect(t.mutation(internal.memory.propose, { ...p.args, text: "I prefer concise explanations.", customerQuote: "I prefer concise explanations.", sourceMessageId: source.messageId })).rejects.toThrow("memory_limit_reached");
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) await ctx.db.insert("userMemories", {
        ownerKey: DEMO_MEMORY_OWNER, track, organizationKey: null, kind: "goal", text, sourceMessageId: p.messageId,
        consentEventId: p.proposalId, status: "active", statedAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 100_000,
      });
    });
    await expect(t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).rejects.toThrow("memory_limit_reached");
  });
});

describe("Convex memory access and provenance", () => {
  it("denies anonymous access by default, an unpinned cloud deployment and demo business access", async () => {
    const t = fresh(); vi.stubEnv("RAIFFY_DEMO_IDENTITY_ENABLED", "false");
    await expect(t.query(api.memory.listMine, { track })).rejects.toThrow("authentication_required");
    await expect(proposal(t)).rejects.toThrow("authentication_required");
    vi.stubEnv("RAIFFY_DEMO_IDENTITY_ENABLED", "true"); vi.stubEnv("CONVEX_CLOUD_URL", "https://production.convex.cloud");
    await expect(t.query(api.memory.listMine, { track })).rejects.toThrow("authentication_required");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://demo-dev.eu-west-1.convex.cloud");
    await expect(t.query(api.memory.listMine, { track: "business" })).rejects.toThrow("organization_required");
  });

  it("enforces the default write gate and keeps real-customer persistence off on dev", async () => {
    const t = fresh(); const p = await proposal(t);
    vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "false");
    await expect(t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).rejects.toThrow("memory_persistence_disabled");
    vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "true");
    await expect(proposal(t.withIdentity({ subject: "real-user", issuer: "https://clerk.test" }))).rejects.toThrow("memory_persistence_disabled");
  });

  it("prevents another user from reading, rejecting or deleting a memory", async () => {
    const t = fresh(); const p = await proposal(t);
    const other = t.withIdentity({ subject: "other-user", issuer: "https://clerk.test" });
    expect(await other.query(api.memory.listMine, { track })).toEqual({ memories: [], proposals: [] });
    await expect(other.mutation(api.memory.reject, { track, proposalId: p.proposalId })).rejects.toThrow("memory_unavailable");
    const saved = await t.mutation(api.memory.confirm, { track, proposalId: p.proposalId });
    await expect(other.mutation(api.memory.forgetOne, { track, memoryId: saved.id as Id<"userMemories"> })).rejects.toThrow("memory_unavailable");
    expect(await other.mutation(api.memory.forgetAll, { track })).toEqual({ memoriesDeleted: 0, proposalsDeleted: 0 });
    expect((await t.query(api.memory.listMine, { track })).memories).toHaveLength(1);
  });

  it("isolates personal and business records by the signed organization claim", async () => {
    const t = fresh(); const now = Date.now(); const ownerKey = "https://clerk.test|user-a";
    const p = await proposal(t);
    await t.run(async (ctx) => {
      const base = { ownerKey, kind: "goal" as const, text, sourceMessageId: p.messageId, consentEventId: p.proposalId,
        status: "active" as const, statedAt: now, updatedAt: now, expiresAt: now + 100_000 };
      await ctx.db.insert("userMemories", { ...base, track, organizationKey: null });
      await ctx.db.insert("userMemories", { ...base, track: "business", organizationKey: "org-a" });
      await ctx.db.insert("userMemories", { ...base, track: "business", organizationKey: "org-b" });
    });
    const user = t.withIdentity({ subject: "user-a", issuer: "https://clerk.test", tokenIdentifier: ownerKey, org_id: "org-a" });
    expect((await user.query(api.memory.listMine, { track })).memories).toHaveLength(1);
    expect((await user.query(api.memory.listMine, { track: "business" })).memories).toHaveLength(1);
    expect((await user.mutation(api.memory.forgetAll, { track: "business" })).memoriesDeleted).toBe(1);
    expect((await user.query(api.memory.listMine, { track })).memories).toHaveLength(1);
    const otherOrg = t.withIdentity({ subject: "user-a", issuer: "https://clerk.test", tokenIdentifier: ownerKey, org_id: "org-b" });
    expect((await otherOrg.query(api.memory.listMine, { track: "business" })).memories).toHaveLength(1);
  });

  it("checks source ownership and exact evidence, including rechecking at confirmation", async () => {
    const t = fresh(); const p = await proposal(t);
    await expect(t.mutation(internal.memory.propose, { ...p.args, text: "I love luxury cars" })).rejects.toThrow("memory_quote_mismatch");
    await t.run((ctx) => ctx.db.patch(p.messageId, { ownerKey: "other-user" }));
    await expect(t.mutation(internal.memory.propose, p.args)).rejects.toThrow("memory_unavailable");
    await expect(t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).rejects.toThrow("memory_unavailable");
    await t.run((ctx) => ctx.db.patch(p.messageId, { ownerKey: DEMO_MEMORY_OWNER, memoryEligible: false }));
    await expect(t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).rejects.toThrow("memory_source_ineligible");
  });

  it("stores a redaction marker for excluded details and never queues them", async () => {
    const t = fresh(); const raw = "My password is not-for-memory";
    const source = await t.mutation(internal.conversations.recordCustomerMessage, { track, text: raw });
    expect(source.memoryEligible).toBe(false);
    const row = await t.run((ctx) => ctx.db.get(source.messageId));
    expect(row?.maskedText).not.toContain(raw);
    await expect(t.mutation(internal.memory.propose, { track, operation: "remember", kind: "constraint", text: raw, customerQuote: raw, sourceMessageId: source.messageId })).rejects.toThrow("memory_source_ineligible");
    await expect(t.mutation(api.memory.confirm, { track, proposalId: source.messageId as unknown as Id<"memoryProposals"> })).rejects.toThrow();
  });
});

describe("memory expiry", () => {
  it("drains expired proposals in bounded scheduled batches", async () => {
    vi.useFakeTimers(); const t = fresh(); const p = await proposal(t);
    await t.run(async (ctx) => {
      const { _id: _id, _creationTime: _creationTime, ...row } = (await ctx.db.get(p.proposalId))!;
      await ctx.db.patch(p.proposalId, { expiresAt: Date.now() - 1 });
      for (let i = 0; i < 100; i++) await ctx.db.insert("memoryProposals", { ...row, expiresAt: Date.now() - 1 });
    });
    expect(await t.mutation(internal.memory.removeExpired, {})).toEqual({ removed: 100, more: true });
    expect((await t.run((ctx) => ctx.db.query("memoryProposals").collect()))).toHaveLength(1);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("memoryProposals").collect())).toEqual([]);
  });

  it("retains an active conversation from its latest message without extending older message retention", async () => {
    vi.useFakeTimers(); const t = fresh(); const startedAt = Date.now();
    const first = await t.mutation(internal.conversations.recordCustomerMessage, { track, text });
    vi.setSystemTime(startedAt + 29 * 86_400_000);
    const latest = await t.mutation(internal.conversations.recordCustomerMessage, { track, text, conversationId: first.conversationId });
    vi.setSystemTime(startedAt + 30 * 86_400_000);
    await t.mutation(internal.memory.removeExpired, {});
    expect(await t.run((ctx) => ctx.db.get(first.messageId))).toBeNull();
    const next = await t.mutation(internal.memory.propose, { track, operation: "remember", kind: "goal", text, customerQuote: text, sourceMessageId: latest.messageId });
    expect((await t.mutation(api.memory.confirm, { track, proposalId: next.id as Id<"memoryProposals"> })).status).toBe("saved");
  });

  it("hides expired proposals before the cron and rejects late confirmation", async () => {
    vi.useFakeTimers(); const t = fresh(); const p = await proposal(t);
    vi.setSystemTime(Date.now() + 7 * 86_400_000);
    expect(await t.query(api.memory.listMine, { track })).toEqual({ memories: [], proposals: [] });
    await expect(t.mutation(api.memory.confirm, { track, proposalId: p.proposalId })).rejects.toThrow("memory_unavailable");
    expect((await t.mutation(internal.memory.removeExpired, {})).removed).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(p.proposalId))).toBeNull();
  });

  it("expires financial claims 90 days after the statement and deletes consent and provenance", async () => {
    vi.useFakeTimers(); const t = fresh(); const statedAt = Date.now();
    const p = await proposal(t, "My net income is 7,500 lei per month.", "stated_financial");
    vi.setSystemTime(statedAt + 86_400_000);
    const saved = await t.mutation(api.memory.confirm, { track, proposalId: p.proposalId });
    const listed = await t.query(api.memory.listMine, { track });
    expect(listed.memories[0]?.expiresAt).toBe(statedAt + 90 * 86_400_000);
    vi.setSystemTime(statedAt + 90 * 86_400_000);
    expect((await t.query(api.memory.listMine, { track })).memories).toEqual([]);
    await t.mutation(internal.memory.removeExpired, {});
    const remaining = await t.run(async (ctx) => ({
      memory: await ctx.db.get(saved.id as Id<"userMemories">), proposal: await ctx.db.get(p.proposalId),
      source: await ctx.db.get(p.messageId), conversation: await ctx.db.get(p.conversationId),
    }));
    expect(remaining).toEqual({ memory: null, proposal: null, source: null, conversation: null });
  });
});

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./analytics.ts": () => import("./analytics"),
  "./sentiment.ts": () => import("./sentiment"),
};
const fresh = () => convexTest(schema, modules);
const identity = (subject: string, role?: JSONValue) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...(role === undefined ? {} : { role }) });
const today = new Date().toISOString().slice(0, 10);

async function answered(t: ReturnType<typeof fresh>, owner: string, status: "done" | "streaming" = "done") {
  return t.run(async (ctx) => {
    const threadId = await ctx.db.insert("ragThreads", { track: "personal", title: "t", ownerKey: owner, organizationKey: null });
    return ctx.db.insert("ragMessages", { threadId, role: "assistant", text: "", status });
  });
}

describe("analytics", () => {
  it("records a pseudonymous trace for a delivered answer only", async () => {
    const t = fresh();
    const done = await answered(t, "owner-1");
    const streaming = await answered(t, "owner-2", "streaming");
    const args = { inquiry: "debt_refinancing", handler: "answer", status: "answered" as const, attempts: 1, tools: [{ name: "get_holdings", kinds: ["loans"] }] };
    await t.mutation(anyApi.analytics.record, { messageId: done, ...args });
    await t.mutation(anyApi.analytics.record, { messageId: streaming, ...args });
    const rows = await t.run((ctx) => ctx.db.query("answerTraces").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ intent: "refinancing", dataUsed: ["loans"], track: "personal", entry: "web", fallback: false });
    expect(JSON.stringify(rows[0])).not.toContain("owner-1");
  });

  it("is admin-only and hides groups under the minimum", async () => {
    const t = fresh();
    const filter = { from: today, to: today };
    await expect(t.withIdentity(identity("o", "operator")).query(anyApi.analytics.summary, filter)).rejects.toThrow("forbidden");
    for (let i = 0; i < 3; i++) {
      const id = await answered(t, `owner-${i}`);
      await t.mutation(anyApi.analytics.record, { messageId: id, inquiry: null, handler: "answer", status: "answered", attempts: 1, tools: [] });
    }
    const s = await t.withIdentity(identity("a", "admin")).query(anyApi.analytics.summary, { ...filter, minCount: 1 });
    expect(s.kpis.answers).toBeNull();
    expect(s.minCount).toBe(10);
  });
});

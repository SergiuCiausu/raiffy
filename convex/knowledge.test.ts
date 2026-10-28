import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import type { ActionCtx } from "./_generated/server";
import { searchKnowledge } from "./knowledge";
import schema from "./schema";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock("./openai", () => ({ embedTexts: embedMock }));

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./rag.ts": () => import("./rag"),
  "./retrievalEval.ts": () => import("./retrievalEval"),
};
const fresh = () => convexTest(schema, modules);
const identity = (org_id?: string) => ({
  subject: "eval", issuer: "https://clerk.test", tokenIdentifier: "https://clerk.test|eval", ...(org_id ? { org_id } : {}),
});
// The handler only needs auth, runQuery and vectorSearch; embedding is mocked to fail before vectorSearch.
const handler = (t: Pick<ReturnType<typeof fresh>, "run">, track: "personal" | "business", collection: string) =>
  t.run((ctx) => searchKnowledge(ctx as unknown as ActionCtx, track, { collection, query: "my saved goals", limit: 5 }));
const evalCase = (collection: string, track: "personal" | "business" = "personal") => ({
  id: `c-${collection}`, kind: "isolation", question: "my saved goals", track, collection,
});

// A block body: a returned function would run as the test's teardown.
beforeEach(() => {
  embedMock.mockReset().mockImplementation(async () => {
    throw new Error("mock_embedding_boundary");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("search_knowledge handler", () => {
  it("rejects an anonymous caller before any provider call, even for an unavailable collection", async () => {
    await expect(handler(fresh(), "personal", "user_memory")).rejects.toThrow("authentication_required");
    await expect(handler(fresh(), "personal", "bank_product_docs")).rejects.toThrow("authentication_required");
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns user_memory and unknown collections as unavailable without searching", async () => {
    const t = fresh().withIdentity(identity());
    expect(await handler(t, "personal", "user_memory")).toMatchObject({ status: "unavailable", reason: "collection_not_connected", passages: [] });
    expect(await handler(t, "personal", "all_bank_data")).toMatchObject({ status: "unavailable", reason: "unknown_collection", passages: [] });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("requires an organization for the business track", async () => {
    await expect(handler(fresh().withIdentity(identity()), "business", "bank_product_docs")).rejects.toThrow("organization_required");
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("searches public collections only after authentication", async () => {
    await expect(handler(fresh().withIdentity(identity("org_1")), "business", "bank_product_docs")).rejects.toThrow();
    expect(embedMock).toHaveBeenCalledTimes(1);
  });
});

describe("retrieval eval action", () => {
  it("scores unavailable collections without searching", async () => {
    const scores = await fresh().action(anyApi.retrievalEval.run, { cases: [evalCase("user_memory"), evalCase("all_bank_data")] });
    expect(scores.map((s: { status: string; top: unknown[]; pass: boolean }) => [s.status, s.top.length, s.pass]))
      .toEqual([["unavailable", 0, true], ["unavailable", 0, true]]);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("runs public collections through the real search", async () => {
    await expect(fresh().action(anyApi.retrievalEval.run, { cases: [evalCase("bank_product_docs", "business")] }))
      .rejects.toThrow("mock_embedding_boundary");
    expect(embedMock).toHaveBeenCalledTimes(1);
  });
});

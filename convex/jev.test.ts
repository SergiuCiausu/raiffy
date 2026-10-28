import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { requestJev } from "./jevTransport";
import { AGENT_POLICY } from "../lib/agent/config";
import { AUDIENCES, COMPLEXITIES, INQUIRIES, MEMORY_CANDIDATES, MEMORY_OPERATIONS, SCOPES } from "../lib/agent/jev";
import { JEV_MAX_RESPONSE_BYTES, JEV_TIMEOUT_MS } from "../lib/agent/jev-transport";
import { planAgentRoute } from "../lib/agent/route";

function choice(criteria: Record<string, string>, selected: string) {
  const keys = Object.keys(criteria); const top = 0.95 * (1 - 1 / keys.length) + 1 / keys.length;
  return { type: "choice", choice: selected, confidence: 0.95, probabilities: Object.fromEntries(keys.map((k) => [k, k === selected ? top : (1 - top) / (keys.length - 1)])) };
}
function response() {
  const noul = (noul = 0.01) => ({ type: "noul", noul });
  return { model: AGENT_POLICY.classifierModel, answers: {
    inquiry: choice(INQUIRIES, "saving_goal"), scope: choice(SCOPES, "solution"), complexity: choice(COMPLEXITIES, "simple"),
    audience: choice(AUDIENCES, "personal"), memory_operation: choice(MEMORY_OPERATIONS, "none"), memory_candidate: choice(MEMORY_CANDIDATES, "goal"),
    memory_durable: noul(0.9), special_category: noul(), multi_goal: noul(), crisis: noul(), fraud: noul(), hardship: noul(), aml_evasion: noul(), prompt_injection: noul(),
  }, usage: { input_tokens: 120, output_tokens: 20 } };
}
const input = { message: "I am saving for a car.", recentContext: "" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Jev server transport", () => {
  it("makes one pinned request to the fixed endpoint with only bounded screened state", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response()));
    const result = await requestJev(input, { enabled: true, apiKey: "synthetic-test-key", fetcher });
    expect(result.status).toBe("classified"); expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer synthetic-test-key" } });
    expect(JSON.parse(options!.body as string)).toMatchObject({ model: "jev-1.14.0", state: input });
    expect(JSON.stringify(result)).not.toContain("synthetic-test-key");
  });
  it("never calls the provider when disabled, missing a key or given invalid input", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await requestJev(input, { enabled: false, apiKey: "test", fetcher })).toEqual({ status: "unavailable", reason: "disabled" });
    expect(await requestJev(input, { enabled: true, fetcher })).toEqual({ status: "unavailable", reason: "missing_api_key" });
    expect(await requestJev({ message: "x".repeat(4001) }, { enabled: true, apiKey: "test", fetcher })).toEqual({ status: "unavailable", reason: "invalid_response" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])("returns a safe unavailable result for HTTP %s without retrying", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("provider body must not leak", { status }));
    const result = await requestJev(input, { enabled: true, apiKey: "test", fetcher });
    expect(result).toEqual({ status: "unavailable", reason: "provider_error" }); expect(fetcher).toHaveBeenCalledTimes(1);
    const route = planAgentRoute({}, { track: "personal", availableCollections: [], availableTools: [] });
    expect(route).toMatchObject({ handler: "unavailable", model: null, suppressOffers: true, tools: [], collections: [] });
  });
  it("rejects malformed, missing, oversized and version-changed responses", async () => {
    const changed = response(); changed.model = "jev-latest";
    for (const [raw, reason] of [
      [new Response("{"), "invalid_response"], [Response.json({}), "invalid_response"],
      [new Response("x".repeat(JEV_MAX_RESPONSE_BYTES + 1)), "invalid_response"], [Response.json(changed), "unexpected_classifier_version"],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(raw);
      expect(await requestJev(input, { enabled: true, apiKey: "test", fetcher })).toEqual({ status: "unavailable", reason });
    }
  });
  it("times out even when fetch ignores abort, including a stalled response body", async () => {
    vi.useFakeTimers();
    for (const fetcher of [
      vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {})),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start() {} }))),
    ]) {
      const result = requestJev(input, { enabled: true, apiKey: "test", fetcher });
      await vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS);
      expect(await result).toEqual({ status: "unavailable", reason: "timeout" });
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    }
  });
  it("does not leak network exceptions or start a fallback provider", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret key and customer text"));
    expect(await requestJev(input, { enabled: true, apiKey: "test", fetcher })).toEqual({ status: "unavailable", reason: "provider_error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("stored-source Jev adapter", () => {
  const modules = {
    "./_generated/server.js": () => import("./_generated/server"), "./jev.ts": () => import("./jev"),
    "./conversations.ts": () => import("./conversations"),
  };
  function setup() {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://demo-dev.eu-west-1.convex.cloud"); vi.stubEnv("CONVEX_SITE_URL", "https://demo-dev.eu-west-1.convex.site");
    vi.stubEnv("RAIFFY_DEMO_DEPLOYMENT_URL", "https://demo-dev.eu-west-1.convex.cloud");
    vi.stubEnv("RAIFFY_DEMO_IDENTITY_ENABLED", "true"); vi.stubEnv("RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED", "true");
    return convexTest(schema, modules);
  }
  it("stays disabled by default and blocks unscreened and foreign-source input before fetch", async () => {
    const t = setup(); const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher); vi.stubEnv("RAIFFY_JEV_ENABLED", "false");
    const source = await t.mutation(internal.conversations.recordCustomerMessage, { track: "personal", text: input.message });
    const args = { track: "personal" as const, sourceMessageId: source.messageId };
    expect(await t.action(internal.jev.classify, args)).toEqual({ status: "unavailable", reason: "disabled" });
    vi.stubEnv("RAIFFY_JEV_ENABLED", "true");
    await t.run((ctx) => ctx.db.patch(source.messageId, { memoryEligible: false }));
    expect(await t.action(internal.jev.classify, args)).toEqual({ status: "unavailable", reason: "privacy_screening_required" });
    await t.run((ctx) => ctx.db.patch(source.messageId, { ownerKey: "someone-else", memoryEligible: true }));
    expect(await t.action(internal.jev.classify, args)).toEqual({ status: "unavailable", reason: "source_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("derives recent context from the same scoped conversation and never accepts raw client state", async () => {
    const t = setup();
    const first = await t.mutation(internal.conversations.recordCustomerMessage, { track: "personal", text: "I prefer concise explanations." });
    const source = await t.mutation(internal.conversations.recordCustomerMessage, { track: "personal", text: input.message, conversationId: first.conversationId });
    const current = await t.query(internal.jev.classifierInput, { track: "personal", sourceMessageId: source.messageId });
    expect(current.message).toBe(input.message); expect(current.recentContext).toContain("concise");
    vi.stubEnv("RAIFFY_JEV_ENABLED", "true"); vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response())); vi.stubGlobal("fetch", fetcher);
    expect((await t.action(internal.jev.classify, { track: "personal", sourceMessageId: source.messageId })).status).toBe("classified");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

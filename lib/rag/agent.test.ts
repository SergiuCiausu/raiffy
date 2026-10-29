import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { type AgentDeps, type ModelRequest, runAgent } from "./agent";
import { MAX_SEARCHES, SEARCH_TOOL_NAME } from "./prompt";
import { ragAnswerSchema } from "./answer";
import { buildKnowledgeResult, isPublicCollection, unavailableResult } from "./knowledge";
import type { SearchHit } from "./schemas";

const NOW = Date.parse("2026-11-01T12:00:00Z");

const hit = (id: string, text: string): SearchHit => ({
  chunkId: id,
  text,
  embedded: true,
  bank: "raiffeisen",
  personal_bank_product_docs: true,
  personal_competitor_docs: false,
  personal_banking_help: false,
  business_bank_product_docs: false,
  business_competitor_docs: false,
  business_banking_help: false,
  sourceType: "product_page",
  sectionType: "interest_rates",
  url: `https://www.raiffeisen.ro/${id}.html`,
  scrapedAt: "2026-10-28T07:45:27+00:00",
  product: "Depozite la termen",
  score: 0.03,
});

const message = (stop_reason: BetaMessage["stop_reason"], content: unknown[]): BetaMessage =>
  ({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason, content } as unknown as BetaMessage);

const toolUse = (id: string, input: unknown, name = SEARCH_TOOL_NAME) => ({ type: "tool_use", id, name, input });
const cited = (text: string, index: number) => ({
  type: "text",
  text,
  citations: [{
    type: "search_result_location", cited_text: "x", source: "s", title: "t",
    search_result_index: index, start_block_index: 0, end_block_index: 1,
  }],
});

/** A scripted model: returns the given responses in order and records every request. */
function fakeDeps(responses: BetaMessage[], results: SearchHit[][] = []) {
  const requests: ModelRequest[] = [];
  const queries: string[] = [];
  const deps: AgentDeps = {
    createMessage: async (request) => {
      requests.push(structuredClone(request));
      const next = responses.shift();
      if (!next) throw new Error("no more scripted responses");
      return next;
    },
    search: async ({ collection, query, limit }) => {
      queries.push(query);
      if (!isPublicCollection(collection)) return unavailableResult(collection, "collection_not_connected", limit);
      return buildKnowledgeResult({ collection, query, limit, hits: results.shift() ?? [], now: NOW });
    },
  };
  return { deps, requests, queries };
}

const input = { question: "What rate does the 3-month deposit pay?", track: "personal" as const, model: "claude-sonnet-5-5" };

describe("runAgent", () => {
  it("searches, then answers with citations mapped to the fragments it saw", async () => {
    const { deps, requests, queries } = fakeDeps(
      [
        message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "dobanda depozit 3 luni", limit: 5 })]),
        message("end_turn", [cited("The 3-month deposit pays 4.70% a year.", 0)]),
      ],
      [[hit("dep", "3 luni: dobândă 4.70% pe an")]],
    );
    const answer = await runAgent(input, deps);
    expect(queries).toEqual(["dobanda depozit 3 luni"]);
    expect(answer.status).toBe("answered");
    expect(answer.text).toBe("The 3-month deposit pays 4.70% a year.");
    expect(answer.sources.map((s) => s.chunkIds)).toEqual([["dep"]]);
    expect(answer.searches).toEqual([{ query: "dobanda depozit 3 luni", collection: "bank_product_docs", status: "ok", results: 1 }]);
    // The second request carries the assistant tool call and a tool result made of search_result blocks.
    const last = requests[1]!.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain('"type":"search_result"');
    // First turn of a conversation: the disclosure instruction is in the user message.
    expect(String(requests[0]!.messages[0]!.content)).toMatch(/AI assistant/);
  });

  it("carries checked cards from the presentation tool and adds their sources, only on an answered turn", async () => {
    const url = "https://www.raiffeisen.ro/dep.html";
    const cards = {
      tool: { name: "show_cards", description: "cards", input_schema: { type: "object" as const } },
      check: (raw: unknown, hits: readonly { url: string; text: string }[]) =>
        hits.some(h => h.url === url && h.text.includes("4.70")) ? { ok: true as const, cards: [raw], urls: [url], note: "Shown." } : { ok: false as const, error: "unsupported" },
    };
    const script = () => [
      message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "depozit 3 luni", limit: 5 })]),
      message("tool_use", [toolUse("c1", { cards: [{ type: "keyFacts" }] }, "show_cards")]),
      message("end_turn", [cited("Here is the 3-month deposit at a glance.", 0)]),
    ];
    const { deps, requests } = fakeDeps(script(), [[hit("dep", "3 luni: dobândă 4.70% pe an")]]);
    const answer = await runAgent({ ...input, cards }, deps);
    expect(answer.cards).toEqual([{ cards: [{ type: "keyFacts" }] }]);
    expect(answer.sources.map(s => s.url)).toEqual([url]);
    expect(requests[0]!.tools.map(t => t.name)).toEqual([SEARCH_TOOL_NAME, "show_cards"]);
    expect(JSON.stringify(requests[2]!.messages.at(-1)!.content)).toContain("Shown.");
    expect(ragAnswerSchema.safeParse(answer).success).toBe(true);

    // Cards never outlive a failed answer
    const bad = fakeDeps([...script().slice(0, 2), message("end_turn", [cited("It pays 9.99%.", 0)]), message("end_turn", [cited("It pays 9.99%.", 0)])],
      [[hit("dep", "3 luni: dobândă 4.70% pe an")]]);
    const failed = await runAgent({ ...input, cards }, bad.deps);
    expect(failed.status).toBe("failed_checks");
    expect(failed.cards).toBeUndefined();
  });

  it("asks the fallback for cards when the model showed none, with the cited segments and the passage text", async () => {
    const url = "https://www.raiffeisen.ro/dep.html";
    const seen: { segments: string[]; hitText: string[] }[] = [];
    const cards = {
      tool: { name: "show_cards", description: "cards", input_schema: { type: "object" as const } },
      check: () => ({ ok: false as const, error: "unused" }),
      fallback: (segments: readonly { text: string }[], hits: readonly { text: string }[]) => {
        seen.push({ segments: segments.map(s => s.text), hitText: hits.map(h => h.text) });
        return { cards: [{ type: "keyFacts" }], urls: [url] };
      },
    };
    const script = () => [
      message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "depozit 3 luni", limit: 5 })]),
      message("end_turn", [cited("The 3-month deposit pays 4.70% a year.", 0)]),
    ];
    const answer = await runAgent({ ...input, cards }, fakeDeps(script(), [[hit("dep", "3 luni: dobândă 4.70% pe an")]]).deps);
    expect(answer.cards).toEqual([{ type: "keyFacts" }]);
    expect(seen).toEqual([{ segments: ["The 3-month deposit pays 4.70% a year."], hitText: ["3 luni: dobândă 4.70% pe an"] }]);

    // Never on a failed answer
    seen.length = 0;
    const failed = await runAgent({ ...input, cards }, fakeDeps([script()[0]!, message("end_turn", [cited("It pays 9.99%.", 0)]), message("end_turn", [cited("It pays 9.99%.", 0)])],
      [[hit("dep", "3 luni: dobândă 4.70% pe an")]]).deps);
    expect(failed.cards).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("runs host tools whose results are citable, so a cited calculation passes the number check and an invented one doesn't", async () => {
    const calc = { chunkId: "calc:1", label: "Raiffy calculation", url: "https://www.raiffeisen.ro/loan.html",
      text: ["Loan monthly payment: 961.21 lei.", "Loan total payable: 57,962.60 lei."].join("\n"), collectedAt: "2026-10-28T07:45:27+00:00", sectionType: "representative_example" as const, score: 1 };
    const hostTools = [{ tool: { name: "calculate_scenario", description: "calc", input_schema: { type: "object" as const } },
      run: async () => ({ citables: [calc], note: "Not calculated: overdraft rate: unreviewed." }) }];
    const script = (answer: string) => [
      message("tool_use", [toolUse("c1", { calculation: "loan_cost" }, "calculate_scenario")]),
      message("end_turn", [cited(answer, 0)]),
    ];
    const good = fakeDeps(script("You'd pay 961.21 lei a month."));
    const answer = await runAgent({ ...input, hostTools }, good.deps);
    expect(answer.status).toBe("answered");
    expect(answer.sources.map(s => s.chunkIds)).toEqual([["calc:1"]]);
    expect(good.requests[0]!.tools.map(t => t.name)).toEqual([SEARCH_TOOL_NAME, "calculate_scenario"]);
    // The API rejects a tool result that mixes search_result blocks with text: the rows go alone, the note follows
    const sent = good.requests[1]!.messages;
    const result = (sent.at(-2)!.content as { content: { type: string }[] }[])[0]!.content;
    expect(result.map((b) => b.type)).toEqual(["search_result"]);
    expect(sent.at(-1)).toMatchObject({ role: "system" });
    expect(String(sent.at(-1)!.content)).toContain("calculate_scenario: Not calculated");

    const bad = fakeDeps([...script("You'd pay 950 lei a month."), message("end_turn", [cited("You'd pay 950 lei a month.", 0)])]);
    expect((await runAgent({ ...input, hostTools }, bad.deps)).status).toBe("failed_checks");

    const failing = [{ ...hostTools[0]!, run: async () => ({ error: "Invalid input: loan references are required" }) }];
    const err = fakeDeps([message("tool_use", [toolUse("c1", {}, "calculate_scenario")]), message("end_turn", [{ type: "text", text: "I couldn't calculate it." }])]);
    await runAgent({ ...input, hostTools: failing }, err.deps);
    expect(JSON.stringify(err.requests[1]!.messages.at(-1)!.content)).toContain('"is_error":true');
  });

  it("runs preloaded catalog calls before the first model turn, as the model's own earlier call, and lets the answer cite them", async () => {
    const row = { chunkId: "term:ing-personal-rate", label: "ING Personal: interest rate", url: "https://ing.ro/persoane-fizice/credite/ing-personal",
      text: "ING Personal (ing). Fixed interest rate: 7.25% a year.", collectedAt: "2026-10-28T07:45:27+00:00", sectionType: "interest_rates" as const, score: 1 };
    const inputs: unknown[] = [];
    const hostTools = [{ tool: { name: "query_catalog", description: "catalog", input_schema: { type: "object" as const } },
      run: async (input: unknown) => { inputs.push(input); return { citables: [row] }; } }];
    const run = fakeDeps([message("end_turn", [cited("ING Personal has a fixed rate of 7.25% a year.", 0)])]);
    const answer = await runAgent({ ...input, hostTools, preload: [{ tool: "query_catalog", input: { find: "terms", banks: ["ing"] } }] }, run.deps);
    expect(answer.status).toBe("answered");
    expect(answer.sources.map(s => s.chunkIds)).toEqual([["term:ing-personal-rate"]]);
    expect(inputs).toEqual([{ find: "terms", banks: ["ing"] }]);
    const [, call, result] = run.requests[0]!.messages;
    expect(JSON.stringify(call!.content)).toContain('"name":"query_catalog"');
    expect(JSON.stringify(result!.content)).toContain('"type":"search_result"');

    // Nothing preloaded when the tool isn't offered or finds nothing
    const empty = fakeDeps([message("end_turn", [{ type: "text", text: "Which product do you mean?" }])]);
    await runAgent({ ...input, hostTools: [{ ...hostTools[0]!, run: async () => ({ citables: [] }) }], preload: [{ tool: "query_catalog", input: {} }] }, empty.deps);
    await runAgent({ ...input, preload: [{ tool: "query_catalog", input: {} }] }, fakeDeps([message("end_turn", [{ type: "text", text: "Which product do you mean?" }])]).deps);
    expect(empty.requests[0]!.messages).toHaveLength(1);
  });

  it("retries once when the answer states a number the fragments don't contain", async () => {
    const { deps, requests } = fakeDeps(
      [
        message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "depozit", limit: 5 })]),
        message("end_turn", [cited("It pays 5.10% a year.", 0)]),
        message("end_turn", [cited("It pays 4.70% a year.", 0)]),
      ],
      [[hit("dep", "dobândă 4.70% pe an")]],
    );
    const answer = await runAgent(input, deps);
    expect(answer.status).toBe("answered");
    expect(answer.checks.attempts).toBe(2);
    expect(String(requests[2]!.messages.at(-1)!.content)).toContain("5.10");
  });

  it("reports failed checks when the retry is still ungrounded", async () => {
    const { deps } = fakeDeps(
      [
        message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "depozit", limit: 5 })]),
        message("end_turn", [cited("It pays 5.10%.", 0)]),
        message("end_turn", [cited("It pays 5.20%.", 0)]),
      ],
      [[hit("dep", "dobândă 4.70% pe an")]],
    );
    const answer = await runAgent(input, deps);
    expect(answer.status).toBe("failed_checks");
    expect(answer.checks.ungroundedNumbers).toEqual(["5.20"]);
  });

  it("turns bad tool calls into error results instead of crashing", async () => {
    const { deps, requests, queries } = fakeDeps([
      message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "", limit: 5 }), toolUse("t2", {}, "transfer_money")]),
      message("end_turn", [{ type: "text", text: "I can't help with that here." }]),
    ]);
    const answer = await runAgent(input, deps);
    expect(queries).toEqual([]);
    const results = requests[1]!.messages.at(-1)!.content as { is_error?: boolean }[];
    expect(results.map((r) => r.is_error)).toEqual([true, true]);
    expect(answer.status).toBe("no_results");
  });

  it("stops searching after the limit", async () => {
    const calls = Array.from({ length: MAX_SEARCHES + 1 }, (_, i) =>
      message("tool_use", [toolUse(`t${i}`, { collection: "bank_product_docs", query: `q${i}`, limit: 5 })]));
    const { deps, queries } = fakeDeps([...calls, message("end_turn", [{ type: "text", text: "Done." }])]);
    await runAgent(input, deps);
    expect(queries).toHaveLength(MAX_SEARCHES);
  });

  it("asks for one more search when a single search ends in an uncited answer", async () => {
    const { deps, requests, queries } = fakeDeps(
      [
        message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "descoperit de cont IMM", limit: 5 })]),
        message("end_turn", [{ type: "text", text: "I couldn't find that." }]),
        message("tool_use", [toolUse("t2", { collection: "bank_product_docs", query: "linie de credit overdraft IMM", limit: 5 })]),
        message("end_turn", [cited("Up to 35% of last year's turnover.", 1)]),
      ],
      [[hit("pkg", "Pachete de cont IMM")], [hit("od", "maximum 35% din cifra de afaceri")]],
    );
    const answer = await runAgent(input, deps);
    expect(queries).toEqual(["descoperit de cont IMM", "linie de credit overdraft IMM"]);
    expect(String(requests[2]!.messages.at(-1)!.content)).toMatch(/search again/);
    expect(answer.status).toBe("answered");
    expect(answer.sources.map((s) => s.chunkIds)).toEqual([["od"]]);
  });

  it("returns a refusal without an answer", async () => {
    const { deps } = fakeDeps([message("refusal", [])]);
    expect((await runAgent(input, deps)).status).toBe("refused");
  });

  it("never marks a truncated cited answer as answered", async () => {
    const { deps } = fakeDeps([
      message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "depozit", limit: 5 })]),
      message("max_tokens", [cited("It pays 4.70%", 0)]),
    ], [[hit("dep", "dobândă 4.70%")]]);
    const answer = await runAgent(input, deps);
    expect(answer).toMatchObject({ status: "failed_checks", text: "", segments: [], sources: [] });
    expect(() => ragAnswerSchema.parse(answer)).not.toThrow();
  });

  it("returns a schema-valid failure when only paused turns exhaust the model-call budget", async () => {
    const { deps } = fakeDeps(Array.from({ length: MAX_SEARCHES + 5 }, () => message("pause_turn", [])));
    const answer = await runAgent(input, deps);
    expect(answer.status).toBe("failed_checks");
    expect(answer.checks.attempts).toBeGreaterThan(0);
    expect(() => ragAnswerSchema.parse(answer)).not.toThrow();
  });

  it("retries a financial value present only in the question or an uncited hit", async () => {
    const { deps } = fakeDeps([
      message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "depozite", limit: 5 })]),
      message("end_turn", [cited("It pays 5.10%.", 0)]),
      message("end_turn", [cited("It pays 4.70%.", 0)]),
    ], [[hit("dep", "dobândă 4.70%"), hit("other", "dobândă 5.10%")]]);
    const answer = await runAgent({ ...input, question: "Could I get 5.10%?" }, deps);
    expect(answer.status).toBe("answered"); expect(answer.checks.attempts).toBe(2);
  });

  it("fails invalid citation indexes even when the text contains no numbers", async () => {
    const { deps, requests } = fakeDeps([
      message("tool_use", [toolUse("t1", { collection: "bank_product_docs", query: "depozit", limit: 5 })]),
      message("end_turn", [cited("An unsupported banking fact.", 99)]),
      message("end_turn", [cited("Still an unsupported fact.", -1)]),
    ], [[hit("dep", "dobândă 4.70%")]]);
    const answer = await runAgent(input, deps);
    expect(answer.status).toBe("failed_checks");
    expect(answer.checks.invalidCitationIndexes).toBe(1);
    expect(answer.sources).toEqual([]);
    expect(String(requests[2]!.messages.at(-1)!.content)).toContain("unavailable search results");
    expect(() => ragAnswerSchema.parse(answer)).not.toThrow();
  });

  it("uses Denis's search_knowledge contract as the only tool", async () => {
    const { deps, requests } = fakeDeps([message("end_turn", [{ type: "text", text: "Hello." }])]);
    await runAgent(input, deps);
    const tool = requests[0]!.tools[0]!;
    expect(requests[0]!.tools).toHaveLength(1);
    expect(tool.name).toBe("search_knowledge");
    expect(Object.keys((tool.input_schema as { properties: object }).properties).sort()).toEqual(["collection", "limit", "query"]);
    expect(tool.input_schema).not.toHaveProperty("$schema");
  });

  it("returns user_memory as unavailable and never substitutes another collection", async () => {
    const { deps, requests } = fakeDeps([
      message("tool_use", [toolUse("t1", { collection: "user_memory", query: "my goals", limit: 3 })]),
      message("end_turn", [{ type: "text", text: "I can't see saved goals here." }]),
    ], [[hit("dep", "dobândă 4.70%")]]);
    const answer = await runAgent(input, deps);
    const toolResult = (requests[1]!.messages.at(-1)!.content as { content: unknown }[])[0]!;
    expect(String(toolResult.content)).toMatch(/user_memory collection is unavailable/);
    expect(answer.searches).toEqual([{ query: "my goals", collection: "user_memory", status: "unavailable", results: 0 }]);
    expect(answer.retrieval).toEqual([]);
  });

  it("adds coverage gaps as a separate system note after the tool results", async () => {
    const ing = hit("ing", "ING Personal: dobândă fixă între 5,99% - 15,99%");
    const { deps, requests } = fakeDeps([
      message("tool_use", [toolUse("t1", { collection: "competitor_docs", query: "ING personal loan APR", limit: 5 })]),
      message("end_turn", [cited("ING's fixed rate is between 5,99% - 15,99%.", 0)]),
    ], [[{ ...ing, bank: "ing", url: "https://ing.ro/persoane-fizice/credite/ing-personal" }]]);
    await runAgent(input, deps);
    const sent = requests[1]!.messages;
    expect(sent.at(-2)!.role).toBe("user");
    expect(sent.at(-1)).toMatchObject({ role: "system" });
    expect(String(sent.at(-1)!.content)).toMatch(/ING's fee and rate PDFs were not collected/);
  });

  it("sends earlier turns as plain text and skips the disclosure after the first turn", async () => {
    const { deps, requests } = fakeDeps([message("end_turn", [{ type: "text", text: "Hello again." }])]);
    await runAgent({ ...input, history: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hi, I'm Raiffy." }] }, deps);
    const sent = requests[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(String(sent[2]!.content)).not.toMatch(/AI assistant/);
  });
});

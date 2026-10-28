import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { type AgentDeps, type ModelRequest, runAgent } from "./agent";
import { MAX_SEARCHES, SEARCH_TOOL_NAME } from "./prompt";
import type { SearchHit } from "./schemas";

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
    search: async ({ query }) => {
      queries.push(query);
      return results.shift() ?? [];
    },
  };
  return { deps, requests, queries };
}

const input = { question: "What rate does the 3-month deposit pay?", track: "personal" as const, model: "claude-sonnet-5-5" };

describe("runAgent", () => {
  it("searches, then answers with citations mapped to the fragments it saw", async () => {
    const { deps, requests, queries } = fakeDeps(
      [
        message("tool_use", [toolUse("t1", { query: "dobanda depozit 3 luni", focus: "interest_rates" })]),
        message("end_turn", [cited("The 3-month deposit pays 4.70% a year.", 0)]),
      ],
      [[hit("dep", "3 luni: dobândă 4.70% pe an")]],
    );
    const answer = await runAgent(input, deps);
    expect(queries).toEqual(["dobanda depozit 3 luni"]);
    expect(answer.status).toBe("answered");
    expect(answer.text).toBe("The 3-month deposit pays 4.70% a year.");
    expect(answer.sources.map((s) => s.chunkIds)).toEqual([["dep"]]);
    expect(answer.searches).toEqual([{ query: "dobanda depozit 3 luni", focus: "interest_rates", results: 1 }]);
    // The second request carries the assistant tool call and a tool result made of search_result blocks.
    const last = requests[1]!.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain('"type":"search_result"');
    // First turn of a conversation: the disclosure instruction is in the user message.
    expect(String(requests[0]!.messages[0]!.content)).toMatch(/AI assistant/);
  });

  it("retries once when the answer states a number the fragments don't contain", async () => {
    const { deps, requests } = fakeDeps(
      [
        message("tool_use", [toolUse("t1", { query: "depozit", focus: "any" })]),
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
        message("tool_use", [toolUse("t1", { query: "depozit", focus: "any" })]),
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
      message("tool_use", [toolUse("t1", { query: "" , focus: "any" }), toolUse("t2", {}, "transfer_money")]),
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
      message("tool_use", [toolUse(`t${i}`, { query: `q${i}`, focus: "any" })]));
    const { deps, queries } = fakeDeps([...calls, message("end_turn", [{ type: "text", text: "Done." }])]);
    await runAgent(input, deps);
    expect(queries).toHaveLength(MAX_SEARCHES);
  });

  it("asks for one more search when a single search ends in an uncited answer", async () => {
    const { deps, requests, queries } = fakeDeps(
      [
        message("tool_use", [toolUse("t1", { query: "descoperit de cont IMM", focus: "any" })]),
        message("end_turn", [{ type: "text", text: "I couldn't find that." }]),
        message("tool_use", [toolUse("t2", { query: "linie de credit overdraft IMM", focus: "any" })]),
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

  it("sends earlier turns as plain text and skips the disclosure after the first turn", async () => {
    const { deps, requests } = fakeDeps([message("end_turn", [{ type: "text", text: "Hello again." }])]);
    await runAgent({ ...input, history: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hi, I'm Raiffy." }] }, deps);
    const sent = requests[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(String(sent[2]!.content)).not.toMatch(/AI assistant/);
  });
});

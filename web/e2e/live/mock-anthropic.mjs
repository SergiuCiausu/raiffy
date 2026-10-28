#!/usr/bin/env node
/**
 * A stand-in for the Anthropic Messages API that speaks its streaming protocol (server-sent events), for testing
 * the live chat end to end without an API key or spend. Point the Convex deployment at it:
 *
 *   npx convex env set ANTHROPIC_API_KEY mock
 *   npx convex env set ANTHROPIC_BASE_URL http://127.0.0.1:4010
 *
 * What it answers depends on the question:
 *   contains "search" → a search_knowledge tool call (then fails at the embedding step without an OpenAI key)
 *   contains "long"   → a long, slow answer (to test stopping)
 *   anything else     → a short answer, streamed word by word
 * GET /__requests lists the requests it received; DELETE /__requests clears the list.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);
const requests = [];

const SHORT = "This is Raiffy answering from the mock. Each word arrives on its own, the way Claude streams a real reply, so the chat can show it before the answer is complete. Is there a product you'd like to look at?";
const LONG = Array.from({ length: 12 }, (_, i) => `This is sentence ${["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][i]} of a long answer that keeps going.`).join(" ");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastUserText(body) {
  const last = [...body.messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return last.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? "[tool_result]" : "")).join(" ");
}

async function stream(res, body) {
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  const question = lastUserText(body);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });

  send("message_start", {
    message: {
      id: `msg_mock_${requests.length}`, type: "message", role: "assistant", model: body.model, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 },
    },
  });

  if (/search/i.test(question) && !question.includes("[tool_result]")) {
    send("content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_mock_1", name: "search_knowledge", input: {} } });
    for (const part of ['{"query": "dobanda ', 'depozit 3 luni", ', '"focus": "interest_rates"}']) {
      await sleep(60);
      send("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: part } });
    }
    send("content_block_stop", { index: 0 });
    send("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } });
    send("message_stop", {});
    return res.end();
  }

  const long = /long/i.test(question);
  const words = (long ? LONG : SHORT).split(/(?<= )/);
  send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (const word of words) {
    if (res.destroyed) return; // the client aborted (Stop)
    await sleep(long ? 250 : 70);
    send("content_block_delta", { index: 0, delta: { type: "text_delta", text: word } });
  }
  send("content_block_stop", { index: 0 });
  send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: words.length } });
  send("message_stop", {});
  res.end();
}

createServer(async (req, res) => {
  if (req.url === "/__requests") {
    if (req.method === "DELETE") requests.length = 0;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(requests));
  }
  if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const entry = {
      at: Date.now(), path: req.url, stream: body.stream === true, model: body.model,
      betas: req.headers["anthropic-beta"] ?? null, question: lastUserText(body).slice(0, 120), aborted: false,
    };
    requests.push(entry);
    res.on("close", () => { if (!res.writableEnded) entry.aborted = true; });
    if (!entry.stream) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "mock only serves streaming requests" } }));
    }
    return stream(res, body);
  }
  res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => console.log(`mock Anthropic API on http://127.0.0.1:${PORT}`));

import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import schema from "../schema";
import { analyticsMinGroup } from "../analyticsConfig";
import { personaById } from "./demoPersonas";
import { buildChat, citedTexts, type Passage, type SeedMessage } from "./chatBuild";
import { CHAT_SCRIPTS } from "./chatScripts";
import { CITED_CHUNK_IDS } from "./chats";
import { CHAT_CARDS, TEXT_ONLY } from "./chatCards";
import { meetsCardContract } from "../../lib/agent/cardContract";
import { answerEnvelopeSchema } from "../../lib/agent/composer";
import { holdingsCitables, holdingsView } from "../../lib/bank/holdings";
import { ragAnswerSchema } from "../../lib/rag/answer";
import { findUngroundedNumbers } from "../../lib/rag/numbers";
import { toSearchText } from "../../lib/rag/normalize";
import { rawChunkSchema, scopeFlagsSchema } from "../../lib/rag/schemas";
import { resultTitle } from "../../lib/rag/titles";

const modules = {
  "./_generated/server.js": () => import("../_generated/server"),
  "./seed/chats.ts": () => import("./chats"),
};
const TODAY = "2026-10-29";
const ALL = { account: true, transactions: true, savings: true, offers: true, loans: true, cards: true };

// The real scraped passages the scripts cite (banks-data-package is what the ragChunks table is imported from).
const wanted = new Set(CITED_CHUNK_IDS);
const chunkRows = readFileSync("banks-data-package/data/chunks.jsonl", "utf-8").split("\n").filter((l) => l.trim())
  .map((l) => rawChunkSchema.parse(JSON.parse(l))).filter((c) => wanted.has(c.id))
  .map(({ id, text, metadata: m }) => ({
    chunkId: id, bank: m.bank, text, searchText: toSearchText(text), embedded: false,
    ...Object.fromEntries(Object.keys(scopeFlagsSchema.shape).map((f) => [f, false])),
    sourceType: m.source_type, sectionType: m.section_type, url: m.url, scrapedAt: m.scraped_at, product: m.product, productId: m.product_id,
    ...(m.title ? { title: m.title } : {}), ...(m.doc_type ? { docType: m.doc_type } : {}),
  }));
const passages = new Map<string, Passage>(chunkRows.map((r) => [r.chunkId,
  { chunkId: r.chunkId, label: resultTitle(r as never), url: r.url, text: r.text, scrapedAt: r.scrapedAt, sectionType: r.sectionType }]));
const holdingsOf = (persona?: string) => persona ? holdingsCitables(holdingsView({ customer: persona, holdings: personaById(persona)!.holdings, switches: ALL, today: TODAY }), {}) : [];
const chats = CHAT_SCRIPTS.map((s) => buildChat(s, passages, holdingsOf(s.persona), TODAY));
const assistant = (m: SeedMessage): m is Extract<SeedMessage, { role: "assistant"; status: "done" }> => m.role === "assistant" && m.status === "done";

describe("seeded test chats", () => {
  it("cite only passages that exist in the scraped data", () => {
    expect(CITED_CHUNK_IDS.filter((id) => !passages.has(id))).toEqual([]);
  });

  it("are twenty chats of 12 to 20 messages, with every mood, answer pattern and several-goal turns", () => {
    expect(chats).toHaveLength(20);
    expect(new Set(chats.map((c) => c.ownerKey)).size).toBe(20);
    for (const c of chats) expect(c.messages.length, c.id).toBeGreaterThanOrEqual(12), expect(c.messages.length, c.id).toBeLessThanOrEqual(20);
    const users = chats.flatMap((c) => c.messages.filter((m) => m.role === "user"));
    expect(new Set(users.map((m) => m.role === "user" && m.sentiment))).toEqual(new Set(["positive", "neutral", "confused", "frustrated", "angry"]));
    const answers = chats.flatMap((c) => c.messages.filter(assistant));
    const routing = answers.map((m) => (m.answer as { routing: { handler: string; reason: string } }).routing);
    const ui = answers.map((m) => answerEnvelopeSchema.parse((m.answer as { ui: unknown }).ui));
    expect(new Set(routing.map((r) => r.handler))).toEqual(new Set(["answer", "orchestrator", "clarify", "human_contact", "fraud", "professional_referral", "unavailable"]));
    expect(routing.filter((r) => r.reason === "multiple_goals").length).toBeGreaterThanOrEqual(5);
    expect(ui.some((u) => u.actions.some((a) => a.kind === "choose"))).toBe(true);
    expect(chats.flatMap((c) => c.messages).filter((m) => m.role === "user" && m.reply?.kind === "choose")).toHaveLength(3);
    expect(chats.flatMap((c) => c.messages).filter((m) => m.role === "assistant" && m.status !== "done").map((m) => m.status)).toEqual(["stopped", "failed"]);
    expect(answers.filter((m) => m.vote).length).toBeGreaterThanOrEqual(30);
    expect(chats.filter((c) => c.track === "business")).toHaveLength(4);
  });

  it("quote figures only from the customer or the passages and holdings they cite, and never send the customer to a page instead", () => {
    for (const script of CHAT_SCRIPTS) {
      const holdings = holdingsOf(script.persona), said = script.turns.map((x) => x.user);
      for (const { reply } of script.turns) {
        if (reply.k !== "answer") continue;
        expect(findUngroundedNumbers(reply.text, [...citedTexts(reply.cite ?? [], passages, holdings), ...said]), `${script.id}: ${reply.text}`).toEqual([]);
        expect(reply.text, script.id).not.toMatch(/\b(page|pages) (lists?|gives?|shows?|sets?)\b|check (it|them|both pages|the page)|on each (product )?page/i);
      }
    }
    for (const c of chats) for (const m of c.messages.filter(assistant)) ragAnswerSchema.parse(m.answer);
  });

  it("show the card each answer pattern expects, checked against the answer's sources, unless the answer is text only", () => {
    for (const script of CHAT_SCRIPTS) {
      const built = chats.find((c) => c.id === script.id)!.messages.filter(assistant);
      let answer = 0;
      script.turns.forEach((turn, i) => {
        const r = turn.reply, key = `${script.id}#${i}`;
        if (r.k === "stopped" || r.k === "failed") return;
        const m = built[answer++]!;
        if (r.k !== "answer") return;
        // Either cards or a reason for none, never both and never neither
        expect(!!CHAT_CARDS[key] !== !!TEXT_ONLY[key], key).toBe(true);
        if (!CHAT_CARDS[key]) return;
        const ui = answerEnvelopeSchema.parse((m.answer as { ui: unknown }).ui);
        // seedCards (chatBuild.ts) already threw on any figure the cited sources don't support
        expect(meetsCardContract(r.inquiry, ui.blocks, r.scope ?? null), `${key}: ${ui.blocks.map((b) => b.type).join(",")}`).toBe(true);
      });
    }
    expect(Object.keys(CHAT_CARDS).length).toBeGreaterThanOrEqual(60);
  });

  it("offer a specialist at most once per chat, and never as an answer's only reply", () => {
    for (const c of chats) {
      const uis = c.messages.filter(assistant).map((m) => answerEnvelopeSchema.parse((m.answer as { ui: unknown }).ui));
      const offers = uis.filter((ui) => ui.actions.some((a) => a.kind === "handoff") || ui.blocks.some((b) => b.type === "handoff"));
      expect(offers.length, c.id).toBeLessThanOrEqual(1);
      expect(uis.filter((ui) => ui.actions.length === 1 && ui.actions[0]!.kind === "handoff").length, c.id).toBeLessThanOrEqual(1);
    }
  });

  it("insert as live chats would leave them, replace an earlier seed, and are removed with nothing left", { timeout: 30_000 }, async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const r of chunkRows) await ctx.db.insert("ragChunks", r as never);
    });
    const first = await t.mutation(anyApi["seed/chats"].insertChats, {});
    expect(first).toEqual({ chats: 20, messages: chats.reduce((n, c) => n + c.messages.length, 0) });
    const before = await t.run(async (ctx) => (await ctx.db.query("ragThreads").collect()).map((r) => r._id).sort());
    await t.mutation(anyApi["seed/chats"].insertChats, {});
    // A re-seed refills the same threads, so a chat open in a browser keeps working.
    expect(await t.run(async (ctx) => (await ctx.db.query("ragThreads").collect()).map((r) => r._id).sort())).toEqual(before);
    const counts = await t.run(async (ctx) => ({
      threads: (await ctx.db.query("ragThreads").collect()).length,
      events: await ctx.db.query("sentimentEvents").collect(),
      votes: (await ctx.db.query("answerFeedback").collect()).length,
      traces: (await ctx.db.query("answerTraces").collect()).length,
    }));
    expect(counts.threads).toBe(20);
    expect(counts.events).toHaveLength(chats.reduce((n, c) => n + c.messages.filter((m) => m.role === "user").length, 0));
    expect(new Set(counts.events.map((e) => e.after))).toEqual(new Set(["first", "answered", "unavailable", "menu", "repeat", "stopped", "failed"]));
    expect(new Set(counts.events.map((e) => e.customerKey)).size).toBe(20);
    expect(counts.votes).toBe(chats.flatMap((c) => c.messages.filter(assistant)).filter((m) => m.vote).length);
    expect(counts.traces).toBe(chats.flatMap((c) => c.messages.filter(assistant)).length);

    expect(await t.mutation(anyApi["seed/chats"].removeChats, {})).toEqual({ removed: 20 });

    // Under a real owner: personal chats join their sidebar, a chat of their own is left alone.
    const me = "https://clerk.test|user_me";
    const own = await t.run((ctx) => ctx.db.insert("ragThreads", { track: "personal", title: "Mine", ownerKey: me, organizationKey: null }));
    await t.mutation(anyApi["seed/chats"].insertChats, { ownerKey: me });
    const mine = await t.run((ctx) => ctx.db.query("ragThreads").withIndex("by_owner_scope", (q) => q.eq("ownerKey", me).eq("track", "personal")).collect());
    expect(mine).toHaveLength(17);
    expect(await t.mutation(anyApi["seed/chats"].removeChats, { ownerKey: me })).toEqual({ removed: 20 });
    expect((await t.run((ctx) => ctx.db.query("ragThreads").collect())).map((r) => r._id)).toEqual([own]);
    await t.run((ctx) => ctx.db.delete(own));
    expect(await t.run(async (ctx) => [
      ...await ctx.db.query("ragThreads").collect(), ...await ctx.db.query("ragMessages").collect(), ...await ctx.db.query("sentimentEvents").collect(),
      ...await ctx.db.query("answerFeedback").collect(), ...await ctx.db.query("answerTraces").collect(),
    ])).toEqual([]);
  });
});

describe("analytics minimum group", () => {
  it("defaults to the spec's 10 and takes a whole number of at least 1 from the deployment", () => {
    expect(analyticsMinGroup(undefined)).toBe(10);
    expect(analyticsMinGroup("1")).toBe(1);
    for (const bad of ["", " ", "0", "-3", "2.5", "ten"]) expect(analyticsMinGroup(bad)).toBe(10);
  });
});

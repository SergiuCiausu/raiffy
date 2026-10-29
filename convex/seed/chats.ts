import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { afterOf, keysOf, pseudonym } from "../sentiment";
import { personaById } from "./demoPersonas";
import { buildChat, chunkIdOf, SEED_OWNER_PREFIX, type Passage, type SeedChat } from "./chatBuild";
import { CHAT_SCRIPTS, type ProductKey } from "./chatScripts";
import { resultTitle } from "../../lib/rag/titles";
import { MESSAGE_RETENTION_DAYS, retentionExpiry } from "../../lib/agent/memory-store";
import { traceFields } from "../../lib/analytics/trace";
import { holdingsCitables, holdingsView } from "../../lib/bank/holdings";

/*
 * Twenty test chats for the dev deployment (chatScripts.ts), inserted as finished rows: threads, messages, the
 * sentiment label of every customer message, votes and analytics traces, as a live chat would leave them. Nothing
 * goes through Jev or Claude. By default each chat has its own owner key starting with "seed|", so they count as twenty
 * customers on the Sentiment page but appear in nobody's sidebar. Pass a signed-in user's owner key (Clerk
 * tokenIdentifier) to put them in that user's sidebar instead; they then count as one customer. Business chats only
 * show for a user in an organization (organizationKey). Seeded answers carry `seeded: true`, which is how
 * removeChats finds them under a real owner.
 *
 *   pnpm exec convex run seed/chats:insertChats '{"ownerKey":"https://…clerk.accounts.dev|user_…"}'   (refills earlier seeded chats in place)
 *   pnpm exec convex run seed/chats:removeChats
 */

const ALL_SWITCHES = { account: true, transactions: true, savings: true, offers: true, loans: true, cards: true };

/** Every public page passage the scripts cite, read from ragChunks as a live search would return it. */
export const CITED_CHUNK_IDS = [...new Set(CHAT_SCRIPTS.flatMap((c) => c.turns.flatMap((t) => t.reply.k === "answer" ? t.reply.cite ?? [] : []))
  .filter((c) => !c.startsWith("@")).map((c) => chunkIdOf(c as `${ProductKey}#${string}`)))];

async function passages(ctx: MutationCtx): Promise<Map<string, Passage>> {
  const rows = await Promise.all(CITED_CHUNK_IDS.map((chunkId) => ctx.db.query("ragChunks").withIndex("by_chunkId", (q) => q.eq("chunkId", chunkId)).first()));
  return new Map(rows.filter((r) => r !== null).map((r) => [r.chunkId, { chunkId: r.chunkId, label: resultTitle(r as Parameters<typeof resultTitle>[0]), url: r.url, text: r.text, scrapedAt: r.scrapedAt,
    sectionType: r.sectionType, ...(r.docType ? { docType: r.docType } : {}) }]));
}

type Owner = { ownerKey?: string; organizationKey?: string };

/** Inserts a chat, refilling `reuse` (an earlier seed of it, already emptied) so a chat open in someone's browser keeps working. */
async function insertChat(ctx: MutationCtx, chat: SeedChat, owner: Owner, reuse?: Doc<"ragThreads">): Promise<number> {
  const fields = { track: chat.track, title: chat.title, ownerKey: owner.ownerKey ?? chat.ownerKey,
    organizationKey: chat.track === "business" ? owner.organizationKey ?? null : null };
  if (reuse) await ctx.db.replace(reuse._id, fields);
  const threadId = reuse?._id ?? await ctx.db.insert("ragThreads", fields);
  const thread = (await ctx.db.get(threadId))!;
  const keys = await keysOf(thread);
  const base = (now: number) => ({ ...keys, at: new Date(now).toISOString(), track: chat.track, entry: chat.entry, expiresAt: retentionExpiry(now, MESSAGE_RETENTION_DAYS) });
  let request: Doc<"ragMessages"> | null = null;
  for (const m of chat.messages) {
    const now = Date.now();
    if (m.role === "user") {
      const id = await ctx.db.insert("ragMessages", { threadId, role: "user", text: m.text, ...(m.reply ? { reply: m.reply } : {}) });
      request = (await ctx.db.get(id))!;
      // Labels the run records right after routing (convex/sentiment.ts record), with what came before.
      await ctx.db.insert("sentimentEvents", { ...base(now), inquiry: m.inquiry, sentiment: m.sentiment, about: m.about, confidence: 0.9, after: await afterOf(ctx, request) });
      continue;
    }
    const fields = m.status === "done" ? { text: m.text, status: m.status, answer: m.answer }
      : m.status === "failed" ? { text: "", status: m.status, error: m.error } : { text: "", status: m.status };
    const messageId: Id<"ragMessages"> = await ctx.db.insert("ragMessages", { threadId, role: "assistant", ...fields, requestMessageId: request!._id, startedAt: now });
    if (m.status !== "done") continue;
    await ctx.db.insert("answerTraces", { ...base(now), ...traceFields({ ...m.trace, attempts: 1 }) });
    if (m.vote) await ctx.db.insert("answerFeedback", { ...base(now), answerKey: await pseudonym("conversation", messageId), vote: m.vote.vote,
      ...(m.vote.vote === "down" && m.vote.reason ? { reason: m.vote.reason as "wrong" | "unclear" | "missing" | "other" } : {}) });
  }
  return chat.messages.length;
}

const ownerArgs = { ownerKey: v.optional(v.string()), organizationKey: v.optional(v.string()) };

export const insertChats = internalMutation({
  args: ownerArgs,
  returns: v.object({ chats: v.number(), messages: v.number() }),
  handler: async (ctx, owner) => {
    // Earlier seeded chats are emptied and refilled in place, keeping their IDs; any left over are deleted.
    const earlier = await seededThreads(ctx, owner.ownerKey);
    for (const thread of earlier) await clearThread(ctx, thread);
    const cited = await passages(ctx), today = new Date().toISOString().slice(0, 10);
    // Holdings name their product pages, as agent.ts does with the catalog's URLs.
    const productUrls = Object.fromEntries((await ctx.db.query("products").collect()).map((p) => [p.productId, p.url]));
    let messages = 0;
    for (const script of CHAT_SCRIPTS) {
      const persona = script.persona ? personaById(script.persona) : null;
      const holdings = persona ? holdingsCitables(holdingsView({ customer: persona.id, holdings: persona.holdings, switches: ALL_SWITCHES, today }),
        productUrls) : [];
      const chat = buildChat(script, cited, holdings, today), ownerKey = owner.ownerKey ?? chat.ownerKey;
      const i = earlier.findIndex((th) => th.ownerKey === ownerKey && th.title === chat.title);
      messages += await insertChat(ctx, chat, owner, i >= 0 ? earlier.splice(i, 1)[0] : undefined);
    }
    for (const thread of earlier) await ctx.db.delete(thread._id);
    return { chats: CHAT_SCRIPTS.length, messages };
  },
});

/** Seeded chats: every thread under a "seed|" owner, and `ownerKey`'s threads holding seeded answers. */
async function seededThreads(ctx: MutationCtx, ownerKey?: string): Promise<Doc<"ragThreads">[]> {
  const threads = await ctx.db.query("ragThreads").withIndex("by_owner_scope", (q) => q.gte("ownerKey", SEED_OWNER_PREFIX).lt("ownerKey", `${SEED_OWNER_PREFIX}￿`)).collect();
  if (ownerKey) for (const thread of await ctx.db.query("ragThreads").withIndex("by_owner_scope", (q) => q.eq("ownerKey", ownerKey)).collect()) {
    const messages = await ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
    if (messages.some((m) => (m.answer as { seeded?: unknown } | undefined)?.seeded === true)) threads.push(thread);
  }
  return threads;
}

/** Deletes a chat's messages, sentiment labels, votes and traces, keeping the thread. */
async function clearThread(ctx: MutationCtx, thread: Doc<"ragThreads">) {
  const { conversationKey } = await keysOf(thread);
  for (const m of await ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect()) await ctx.db.delete(m._id);
  for (const table of ["sentimentEvents", "answerFeedback", "answerTraces"] as const) {
    const rows = await ctx.db.query(table).filter((q) => q.eq(q.field("conversationKey"), conversationKey)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
}

/** Deletes every seeded chat with its messages, labels, votes and traces. */
async function removeSeeded(ctx: MutationCtx, ownerKey?: string): Promise<number> {
  const threads = await seededThreads(ctx, ownerKey);
  for (const thread of threads) { await clearThread(ctx, thread); await ctx.db.delete(thread._id); }
  return threads.length;
}

export const removeChats = internalMutation({
  args: { ownerKey: v.optional(v.string()) }, returns: v.object({ removed: v.number() }),
  handler: async (ctx, { ownerKey }) => ({ removed: await removeSeeded(ctx, ownerKey) }),
});

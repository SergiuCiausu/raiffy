import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { trackArg, searchChunks } from "./rag";
import { runAgent, type HistoryTurn } from "../lib/rag/agent";
import { ragAnswerSchema, type RagAnswer } from "../lib/rag/answer";
import type { Track } from "../lib/rag/schemas";

const DEFAULT_MODEL = "claude-sonnet-5-5";
type Effort = "low" | "medium" | "high";
const HISTORY_TURNS = 10;
const RESULTS_PER_SEARCH = 5;
/** How often the streamed text is written to the database (and so pushed to the chat UI). */
const DRAFT_FLUSH_MS = 100;

export const createThread = internalMutation({
  args: { track: trackArg, title: v.string() },
  handler: async (ctx, args) => ctx.db.insert("ragThreads", args),
});

export const getThread = internalQuery({
  args: { threadId: v.id("ragThreads") },
  handler: async (ctx, { threadId }) => ctx.db.get(threadId),
});

export const recentTurns = internalQuery({
  args: {
    threadId: v.id("ragThreads"),
    limit: v.number(),
    /** Only turns written before this message (the question being answered), so it isn't sent twice. */
    before: v.optional(v.id("ragMessages")),
  },
  handler: async (ctx, { threadId, limit, before }): Promise<HistoryTurn[]> => {
    const cutoff = before ? (await ctx.db.get(before))?._creationTime : undefined;
    const messages = await ctx.db
      .query("ragMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .filter((q) => (cutoff === undefined ? true : q.lt(q.field("_creationTime"), cutoff)))
      .take(limit);
    return messages
      .reverse()
      // Unfinished replies (streaming, stopped, failed) would feed the model half sentences
      .filter((m) => m.text.trim() && (m.status === undefined || m.status === "done"))
      .map((m) => ({ role: m.role, text: m.text }));
  },
});

export const saveMessage = internalMutation({
  args: {
    threadId: v.id("ragThreads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    answer: v.optional(v.any()),
  },
  handler: async (ctx, args) => ctx.db.insert("ragMessages", args),
});

/** Messages of a conversation, oldest first, for the chat UI. Streaming replies update in place. */
export const listMessages = query({
  args: { threadId: v.id("ragThreads") },
  handler: async (ctx, { threadId }) =>
    ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect(),
});

/** Recent conversations, newest first, for the chat sidebar. */
export const listThreads = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const threads = await ctx.db.query("ragThreads").order("desc").take(Math.min(limit ?? 50, 100));
    return threads.map((t) => ({ _id: t._id, _creationTime: t._creationTime, title: t.title, track: t.track }));
  },
});

/* ───────────── Starting a turn ───────────── */

type Turn = { threadId: Id<"ragThreads">; questionId: Id<"ragMessages">; messageId: Id<"ragMessages">; question: string; track: Track };

/** Validates the question, opens or checks the thread, and writes the question plus an empty streaming reply. */
async function beginTurn(
  ctx: MutationCtx,
  { question, track, threadId }: { question: string; track: Track; threadId?: Id<"ragThreads"> },
): Promise<Turn> {
  const text = question.trim();
  if (!text || text.length > 2000) throw new Error("The question must be 1-2000 characters long");

  let id = threadId;
  if (id) {
    const thread = await ctx.db.get(id);
    if (!thread) throw new Error("Conversation not found");
    if (thread.track !== track) throw new Error("This conversation belongs to the other track; start a new one");
    const existing = id;
    const last = await ctx.db
      .query("ragMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", existing))
      .order("desc")
      .first();
    if (last?.status === "streaming") throw new Error("Raiffy is still answering in this conversation");
  } else {
    id = await ctx.db.insert("ragThreads", { track, title: text.slice(0, 60) });
  }

  const questionId = await ctx.db.insert("ragMessages", { threadId: id, role: "user", text });
  const messageId = await ctx.db.insert("ragMessages", { threadId: id, role: "assistant", text: "", status: "streaming", steps: [] });
  return { threadId: id, questionId, messageId, question: text, track };
}

export const begin = internalMutation({
  args: { question: v.string(), track: trackArg, threadId: v.optional(v.id("ragThreads")) },
  handler: async (ctx, args) => beginTurn(ctx, args),
});

/**
 * Ask Raiffy from the chat UI. Returns at once with the ids; the reply streams into the message row, which the
 * UI watches through `listMessages`.
 */
export const send = mutation({
  args: { question: v.string(), track: trackArg, threadId: v.optional(v.id("ragThreads")) },
  handler: async (ctx, args): Promise<{ threadId: Id<"ragThreads">; messageId: Id<"ragMessages"> }> => {
    const turn = await beginTurn(ctx, args);
    await ctx.scheduler.runAfter(0, internal.agent.respond, turn);
    return { threadId: turn.threadId, messageId: turn.messageId };
  },
});

/** Stop a reply that is still streaming. The partial text stays, marked as stopped. */
export const stop = mutation({
  args: { messageId: v.id("ragMessages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (message?.role === "assistant" && message.status === "streaming") await ctx.db.patch(messageId, { status: "stopped" });
  },
});

/* ───────────── Streaming writes ───────────── */

/** Write the text streamed so far. Reports whether the customer stopped the reply, so the stream can be aborted. */
export const writeDraft = internalMutation({
  args: { messageId: v.id("ragMessages"), text: v.string() },
  handler: async (ctx, { messageId, text }) => {
    const message = await ctx.db.get(messageId);
    if (message?.status !== "streaming") return { stopped: true };
    await ctx.db.patch(messageId, { text });
    return { stopped: false };
  },
});

export const addStep = internalMutation({
  args: { messageId: v.id("ragMessages"), query: v.string(), focus: v.string() },
  handler: async (ctx, { messageId, query, focus }) => {
    const message = await ctx.db.get(messageId);
    if (message?.status !== "streaming") return { stopped: true };
    await ctx.db.patch(messageId, { steps: [...(message.steps ?? []), { query, focus }] });
    return { stopped: false };
  },
});

export const finishStep = internalMutation({
  args: { messageId: v.id("ragMessages"), results: v.number() },
  handler: async (ctx, { messageId, results }) => {
    const message = await ctx.db.get(messageId);
    const steps = message?.steps ?? [];
    const last = steps.at(-1);
    if (!message || !last) return;
    await ctx.db.patch(messageId, { steps: [...steps.slice(0, -1), { ...last, results }] });
  },
});

export const finish = internalMutation({
  args: {
    messageId: v.id("ragMessages"),
    status: v.union(v.literal("done"), v.literal("stopped"), v.literal("failed")),
    text: v.optional(v.string()),
    answer: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { messageId, status, text, answer, error }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return;
    // A stop that raced the last tokens wins: keep what the customer saw
    const final = message.status === "stopped" ? "stopped" : status;
    await ctx.db.patch(messageId, {
      status: final,
      ...(final === "done" && text !== undefined ? { text } : {}),
      ...(final === "done" && answer !== undefined ? { answer } : {}),
      ...(error ? { error } : {}),
    });
  },
});

/* ───────────── Running a turn ───────────── */

class Stopped extends Error {}

/**
 * Collects streamed text and writes it at most every DRAFT_FLUSH_MS, one write at a time. A write that finds the
 * reply stopped flips `stopped`, and the caller aborts the Anthropic stream.
 */
function draftWriter(ctx: ActionCtx, messageId: Id<"ragMessages">, onStop: () => void) {
  let text = "";
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  const state = { stopped: false };

  function flush() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (!dirty) return chain;
    dirty = false;
    const snapshot = text;
    chain = chain.then(async () => {
      const { stopped } = await ctx.runMutation(internal.agent.writeDraft, { messageId, text: snapshot });
      if (stopped && !state.stopped) { state.stopped = true; onStop(); }
    });
    return chain;
  }

  return {
    state,
    /** A new model call starts: its text replaces the previous call's (a retry rewrites the answer). */
    reset() { text = ""; dirty = true; },
    append(delta: string) {
      text += delta;
      dirty = true;
      timer ??= setTimeout(flush, DRAFT_FLUSH_MS);
    },
    flush,
  };
}

async function runTurn(ctx: ActionCtx, turn: Turn): Promise<RagAnswer> {
  const { threadId, questionId, messageId, question, track } = turn;
  let current: { abort: () => void } | undefined;
  const draft = draftWriter(ctx, messageId, () => current?.abort());

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on this Convex deployment");
    const client = new Anthropic({ apiKey });
    const model = process.env.RAG_MODEL ?? DEFAULT_MODEL;
    // Medium is the starting point for multistep tool use on Sonnet 5.5; at low it tends to stop after one search.
    const effort = (process.env.RAG_EFFORT ?? "medium") as Effort;
    const history = await ctx.runQuery(internal.agent.recentTurns, { threadId, limit: HISTORY_TURNS, before: questionId });

    const answer = await runAgent(
      { question, track, history, model },
      {
        // Same request as before, streamed: text deltas reach the chat as Claude writes them, and the loop still
        // gets the complete message from finalMessage().
        createMessage: async ({ system, tools, messages }) => {
          if (draft.state.stopped) throw new Stopped();
          draft.reset();
          // Stop cancels the HTTP request (abort signal), so no more tokens are generated or billed. Convex's runtime
          // logs "The stream is not in a state that permits close" when a response body is cancelled; it's harmless.
          const controller = new AbortController();
          current = controller;
          const stream = client.beta.messages.stream(
            {
              model,
              max_tokens: 16000,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              output_config: { effort },
              system,
              tools,
              messages,
            },
            { signal: controller.signal },
          );
          stream.on("text", (delta) => draft.append(delta));
          try {
            return await stream.finalMessage();
          } finally {
            await draft.flush();
          }
        },
        search: async ({ query, focus }) => {
          const { stopped } = await ctx.runMutation(internal.agent.addStep, { messageId, query, focus });
          if (stopped || draft.state.stopped) throw new Stopped();
          const hits = await searchChunks(ctx, { question: query, track, k: RESULTS_PER_SEARCH, focus });
          await ctx.runMutation(internal.agent.finishStep, { messageId, results: hits.length });
          return hits;
        },
      },
    );

    const validated = ragAnswerSchema.parse(answer);
    await ctx.runMutation(internal.agent.finish, { messageId, status: "done", text: validated.text, answer: validated });
    return validated;
  } catch (error) {
    await draft.flush().catch(() => {});
    const stopped = draft.state.stopped || error instanceof Stopped || error instanceof Anthropic.APIUserAbortError;
    if (stopped) {
      await ctx.runMutation(internal.agent.finish, { messageId, status: "stopped" });
    } else {
      console.error("agent turn failed", error);
      await ctx.runMutation(internal.agent.finish, {
        messageId,
        status: "failed",
        // Shown next to a "Try again" button, so it doesn't say it again
        error: error instanceof Anthropic.RateLimitError ? "Raiffy is busy right now. Wait a minute, then" : "Raiffy couldn’t finish this answer.",
      });
    }
    throw error;
  }
}

/** Scheduled by `send`: runs the agent and streams the reply into the message row. */
export const respond = internalAction({
  args: {
    threadId: v.id("ragThreads"),
    questionId: v.id("ragMessages"),
    messageId: v.id("ragMessages"),
    question: v.string(),
    track: trackArg,
  },
  handler: async (ctx, turn) => {
    // The row already records the failure or the stop for the UI; a scheduled job has no caller to rethrow to
    await runTurn(ctx, turn).catch(() => {});
  },
});

/**
 * Ask Raiffy and wait for the whole answer (scripts and evals). Claude (Anthropic) runs the agent loop and decides
 * what to search; OpenAI embeddings power the vector leg of the search. Pass `threadId` to continue a conversation;
 * a thread keeps the track it started with. The reply streams into the database like the chat's.
 */
export const ask = action({
  args: { question: v.string(), track: trackArg, threadId: v.optional(v.id("ragThreads")) },
  handler: async (ctx, args): Promise<{ threadId: Id<"ragThreads">; answer: RagAnswer }> => {
    const turn: Turn = await ctx.runMutation(internal.agent.begin, args);
    const answer = await runTurn(ctx, turn);
    return { threadId: turn.threadId, answer };
  },
});

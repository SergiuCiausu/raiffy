import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { trackArg, searchChunks } from "./rag";
import { runAgent, type HistoryTurn } from "../lib/rag/agent";
import { ragAnswerSchema, type RagAnswer } from "../lib/rag/answer";

const DEFAULT_MODEL = "claude-sonnet-5-5";
type Effort = "low" | "medium" | "high";
const HISTORY_TURNS = 10;
const RESULTS_PER_SEARCH = 5;

export const createThread = internalMutation({
  args: { track: trackArg, title: v.string() },
  handler: async (ctx, args) => ctx.db.insert("ragThreads", args),
});

export const getThread = internalQuery({
  args: { threadId: v.id("ragThreads") },
  handler: async (ctx, { threadId }) => ctx.db.get(threadId),
});

export const recentTurns = internalQuery({
  args: { threadId: v.id("ragThreads"), limit: v.number() },
  handler: async (ctx, { threadId, limit }): Promise<HistoryTurn[]> => {
    const messages = await ctx.db
      .query("ragMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(limit);
    return messages.reverse().filter((m) => m.text.trim()).map((m) => ({ role: m.role, text: m.text }));
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

/** Messages of a conversation, oldest first, for the chat UI. */
export const listMessages = query({
  args: { threadId: v.id("ragThreads") },
  handler: async (ctx, { threadId }) =>
    ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect(),
});

/**
 * Ask Raiffy. Claude (Anthropic) runs the agent loop and decides what to search; OpenAI embeddings power the
 * vector leg of the search. Pass `threadId` to continue a conversation; a thread keeps the track it started with.
 */
export const ask = action({
  args: { question: v.string(), track: trackArg, threadId: v.optional(v.id("ragThreads")) },
  handler: async (ctx, { question, track, threadId }): Promise<{ threadId: Id<"ragThreads">; answer: RagAnswer }> => {
    const text = question.trim();
    if (!text || text.length > 2000) throw new Error("The question must be 1-2000 characters long");

    let id = threadId;
    if (id) {
      const thread = await ctx.runQuery(internal.agent.getThread, { threadId: id });
      if (!thread) throw new Error("Conversation not found");
      if (thread.track !== track) throw new Error("This conversation belongs to the other track; start a new one");
    } else {
      id = await ctx.runMutation(internal.agent.createThread, { track, title: text.slice(0, 60) });
    }

    const history = await ctx.runQuery(internal.agent.recentTurns, { threadId: id, limit: HISTORY_TURNS });
    await ctx.runMutation(internal.agent.saveMessage, { threadId: id, role: "user", text });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on this Convex deployment");
    const client = new Anthropic({ apiKey });
    const model = process.env.RAG_MODEL ?? DEFAULT_MODEL;
    // Medium is the starting point for multistep tool use on Sonnet 5.5; at low it tends to stop after one search.
    const effort = (process.env.RAG_EFFORT ?? "medium") as Effort;

    const answer = await runAgent(
      { question: text, track, history, model },
      {
        createMessage: ({ system, tools, messages }) =>
          client.beta.messages.create({
            model,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort },
            system,
            tools,
            messages,
          }),
        search: ({ query, focus }) => searchChunks(ctx, { question: query, track, k: RESULTS_PER_SEARCH, focus }),
      },
    );

    const validated = ragAnswerSchema.parse(answer);
    await ctx.runMutation(internal.agent.saveMessage, {
      threadId: id,
      role: "assistant",
      text: validated.text,
      answer: validated,
    });
    return { threadId: id, answer: validated };
  },
});

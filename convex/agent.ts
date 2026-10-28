import Anthropic from "@anthropic-ai/sdk";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx } from "./_generated/server";
import { searchKnowledge } from "./knowledge";
import { trackArg } from "./rag";
import { runAgent, type HistoryTurn } from "../lib/rag/agent";
import { ragAnswerSchema, type RagAnswer } from "../lib/rag/answer";
import { requireAgentScope, requireAgentThread } from "./agentAuth";
import { screenChat } from "../lib/agent/privacy";
import { requestJev } from "./jevTransport";
import { planAgentRoute, type RoutePlan } from "../lib/agent/route";
import { composeAnswer, containsFinancialFigure, memoryResponse, routeResponse, type MemoryBlock } from "../lib/agent/composer";
import { unavailableResult } from "../lib/rag/knowledge";
import { answerScopeNote } from "../lib/rag/prompt";
import { runCalculator } from "../lib/agent/calculator";
import type { CalculateScenarioInput, ProposeMemoryInput } from "../lib/agent/prompt";
import { memoryEnvironment } from "./memoryAuth";
import { customerMemoryWritesEnabled } from "../lib/agent/memory-store";
import { memoryContextNote, type ContextMemory } from "../lib/agent/memory";
import type { MemoryProposalResult } from "../lib/rag/agent";
import { namedBanks } from "../lib/rag/query";

const HISTORY_TURNS = 10;

export const createThread = internalMutation({
  args: { track: trackArg, title: v.string() },
  handler: async (ctx, args) => {
    const scope = await requireAgentScope(ctx, args.track);
    return ctx.db.insert("ragThreads", { ...args, title: screenChat(args.title).text, ...scope });
  },
});

export const getThread = internalQuery({
  args: { threadId: v.id("ragThreads") },
  handler: async (ctx, { threadId }) => requireAgentThread(ctx, threadId),
});

export const recentTurns = internalQuery({
  args: { threadId: v.id("ragThreads"), limit: v.number() },
  handler: async (ctx, { threadId, limit }): Promise<HistoryTurn[]> => {
    await requireAgentThread(ctx, threadId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("history_limit_invalid");
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
  handler: async (ctx, args) => {
    await requireAgentThread(ctx, args.threadId);
    return ctx.db.insert("ragMessages", args);
  },
});

/** Messages of a conversation, oldest first, for the chat UI. */
export const listMessages = query({
  args: { threadId: v.id("ragThreads"), limit: v.optional(v.number()) },
  handler: async (ctx, { threadId, limit = 100 }) => {
    await requireAgentThread(ctx, threadId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("message_limit_invalid");
    const rows = await ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).order("desc").take(limit);
    return rows.reverse().map(row => row.status === "streaming" || row.status === "stopped"
      ? { ...row, text: "", answer: undefined } : row);
  },
});

const sendArgs = { question: v.string(), track: trackArg, threadId: v.optional(v.id("ragThreads")) };
type SendArgs = { question: string; track: "personal" | "business"; threadId?: Id<"ragThreads"> };

async function enqueueHandler(ctx: MutationCtx, { question, track, threadId }: SendArgs) {
  const scope = await requireAgentScope(ctx, track);
  if (!question.trim() || question.length > 2000) throw new ConvexError("question_length_invalid");
  const text = screenChat(question).text;
  if (threadId) {
    const thread = await requireAgentThread(ctx, threadId);
    if (thread.track !== track) throw new ConvexError("This conversation belongs to the other track");
    const latest = await ctx.db.query("ragMessages").withIndex("by_thread", q => q.eq("threadId", threadId)).order("desc").take(1);
    if (latest[0]?.status === "streaming") throw new ConvexError("reply_in_progress");
  }
  const now = Date.now();
  const rate = await ctx.db.query("agentRateLimits").withIndex("by_owner", q => q.eq("ownerKey", scope.ownerKey)).unique();
  if (rate && now - rate.windowStart < 60_000 && rate.requests >= 10) throw new ConvexError("rate_limit_exceeded");
  const next = { windowStart: rate && now - rate.windowStart < 60_000 ? rate.windowStart : now,
    requests: rate && now - rate.windowStart < 60_000 ? rate.requests + 1 : 1 };
  if (rate) await ctx.db.patch(rate._id, next);
  else await ctx.db.insert("agentRateLimits", { ownerKey: scope.ownerKey, ...next });
  const id = threadId ?? await ctx.db.insert("ragThreads", { ...scope, title: text.slice(0, 60) });
  const requestMessageId = await ctx.db.insert("ragMessages", { threadId: id, role: "user", text });
  const messageId = await ctx.db.insert("ragMessages", { threadId: id, role: "assistant", text: "", status: "streaming", requestMessageId, steps: [] });
  return { threadId: id, messageId };
}

export const send = mutation({ args: sendArgs, handler: enqueueHandler });
export const enqueue = internalMutation({ args: sendArgs, handler: enqueueHandler });

export const listThreads = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }) => {
    const scope = await requireAgentScope(ctx, "personal");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ConvexError("thread_limit_invalid");
    const personal = await ctx.db.query("ragThreads").withIndex("by_owner_scope", q => q.eq("ownerKey", scope.ownerKey).eq("track", "personal").eq("organizationKey", null)).order("desc").take(limit);
    const identity = await ctx.auth.getUserIdentity();
    const org = typeof identity?.org_id === "string" ? identity.org_id : null;
    const business = org ? await ctx.db.query("ragThreads").withIndex("by_owner_scope", q => q.eq("ownerKey", scope.ownerKey).eq("track", "business").eq("organizationKey", org)).order("desc").take(limit) : [];
    return [...personal, ...business].sort((a,b) => b._creationTime - a._creationTime).slice(0, limit);
  },
});

const messageArgs = { messageId: v.id("ragMessages") };
export const request = internalQuery({
  args: messageArgs,
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message) { await requireAgentScope(ctx, "personal"); throw new ConvexError("conversation_unavailable"); }
    const thread = await requireAgentThread(ctx, message.threadId);
    if (message.role !== "assistant" || !message.requestMessageId) throw new ConvexError("request_unavailable");
    const source = await ctx.db.get(message.requestMessageId);
    if (!source || source.threadId !== thread._id || source.role !== "user") throw new ConvexError("request_unavailable");
    const rows = await ctx.db.query("ragMessages").withIndex("by_thread", q => q.eq("threadId", thread._id)).order("desc").take(HISTORY_TURNS + 2);
    const history = rows.filter(m => m._creationTime < source._creationTime && m.text.trim() && (!m.status || m.status === "done"))
      .reverse().map(m => ({ role: m.role, text: screenChat(m.text.slice(0, 4000)).text }));
    return { message, source, thread, history };
  },
});

export const begin = internalMutation({
  args: messageArgs,
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId);
    if (!m) throw new ConvexError("request_unavailable");
    await requireAgentThread(ctx, m.threadId);
    if (m.status !== "streaming" || m.startedAt !== undefined) return false;
    await ctx.db.patch(messageId, { startedAt: Date.now() });
    return true;
  },
});

export const progress = internalMutation({
  args: { ...messageArgs, step: v.object({ query: v.string(), focus: v.string(), results: v.optional(v.number()) }) },
  handler: async (ctx, { messageId, step }) => {
    const m = await ctx.db.get(messageId);
    if (!m) throw new ConvexError("request_unavailable");
    await requireAgentThread(ctx, m.threadId);
    if (m.status !== "streaming") throw new ConvexError("reply_stopped");
    await ctx.db.patch(messageId, { steps: [...(m.steps ?? []).slice(-5), step] });
  },
});

export const complete = internalMutation({
  args: { ...messageArgs, answer: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, { messageId, answer, error }) => {
    const m = await ctx.db.get(messageId);
    if (!m) throw new ConvexError("request_unavailable");
    await requireAgentThread(ctx, m.threadId);
    if (m.status !== "streaming") return;
    if (error) await ctx.db.patch(messageId, { status: "failed", text: "", error });
    else {
      const parsed = ragAnswerSchema.parse(answer);
      await ctx.db.patch(messageId, { status: "done", text: parsed.text, answer });
    }
  },
});

export const stop = mutation({
  args: messageArgs,
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId);
    if (!m) throw new ConvexError("request_unavailable");
    await requireAgentThread(ctx, m.threadId);
    if (m.role !== "assistant") throw new ConvexError("request_unavailable");
    if (m.status === "streaming") await ctx.db.patch(messageId, { status: "stopped", text: "" });
    return null;
  },
});

/** Runs under the browser's verified identity. Scheduled functions must not impersonate that identity. */
export const run = action({
  args: messageArgs,
  handler: async (ctx, { messageId }): Promise<null> => {
    const input = await ctx.runQuery(internal.agent.request, { messageId });
    if (!await ctx.runMutation(internal.agent.begin, { messageId })) return null;
    try {
      const question = screenChat(input.source.text).text;
      const classified = await requestJev({ message: question, recentContext: input.history.map(m => m.text).join("\n").slice(-2000) },
        { enabled: process.env.RAIFFY_JEV_ENABLED === "true", apiKey: process.env.TYPESAFE_API_KEY });
      // Memory: what this customer confirmed earlier, and (where writes are on) this message as the only source
      // a new proposal may quote. Screening decides whether the message may be a source at all.
      const track = input.thread.track;
      const writes = customerMemoryWritesEnabled(memoryEnvironment());
      const memories: ContextMemory[] = await ctx.runQuery(internal.memory.forAgent, { track }).catch(() => []);
      const source = writes ? await ctx.runMutation(internal.conversations.recordCustomerMessage, { track, text: question }).catch(() => null) : null;
      const plan = planAgentRoute(classified.status === "classified" ? classified.classification : {}, {
        track, availableTools: ["search_knowledge", "calculate_scenario", ...(source?.memoryEligible ? ["propose_memory_change" as const] : [])],
        availableCollections: ["bank_product_docs", "competitor_docs", "banking_help"],
        requestedBanks: namedBanks(question),
      });
      let answer: RagAnswer;
      // Calculator results this turn: figures they contain aren't catalog prices, so they may stay in the answer.
      const calculations: string[] = [];
      const proposals: MemoryBlock["proposals"] = [];
      const operation = plan.reason === "explicit_memory_request" ? plan.memoryOperation : null;
      if (operation === "inspect" || operation === "forget") answer = memoryResponse(operation, memories, writes);
      else if (operation && writes && !source?.memoryEligible) answer = memoryResponse("ineligible", memories, writes);
      else if (!plan.model || !["answer", "orchestrator"].includes(plan.handler)) answer = routeResponse(plan);
      else answer = await generate(ctx, question, input.history, plan, messageId, calculations,
        { memories, proposals, ...(source?.memoryEligible ? { sourceMessageId: source.messageId } : {}) });
      const requiresCatalog = answer.status === "answered" && containsFinancialFigure(answer.text, calculations);
      const verification = { status: answer.status, checks: answer.checks, searches: answer.searches, model: answer.model,
        financialTermsSupported: !requiresCatalog };
      // Failed drafts are neither shown nor retained. Only the checked final response reaches the UI.
      if (answer.status === "failed_checks" || answer.status === "refused") answer = routeResponse({ ...plan, handler: "unavailable" });
      if (requiresCatalog) answer = routeResponse({ ...plan, handler: "unavailable", reason: "catalog_required" });
      if (answer.sources.length > 0) {
        const notice = "This is dated public information, not a binding offer; check the source dates below.";
        answer = { ...answer, text: `${answer.text}\n\n${notice}`, segments: [...answer.segments, { text: ` ${notice}`, sourceIds: [] }] };
      }
      const envelope = composeAnswer(messageId, plan, answer, proposals);
      await ctx.runMutation(internal.agent.complete, { messageId, answer: { ...answer,
        routing: { handler: plan.handler, inquiry: plan.inquiry, confidence: plan.confidence, classifierModel: plan.classifierModel,
          collections: plan.collections, tools: plan.tools, unavailable: plan.unavailable, reason: classified.status === "unavailable" ? classified.reason : plan.reason },
        classifierConfidences: classified.status === "classified" ? Object.fromEntries(Object.entries(classified.classification.answers)
          .filter(([, a]) => a.type === "choice").map(([key, a]) => [key, a.type === "choice" ? a.confidence : null])) : {},
        // Yes/no probabilities (risks, durability, special category): they gate tools, so they stay visible.
        classifierSignals: classified.status === "classified" ? Object.fromEntries(Object.entries(classified.classification.answers)
          .flatMap(([key, a]) => a.type === "noul" ? [[key, a.noul]] : [])) : {},
        verification, ui: envelope } });
    } catch {
      await ctx.runMutation(internal.agent.complete, { messageId, error: "Raiffy couldn't verify an answer. Please try again." });
    }
    return null;
  },
});

type MemoryTurn = { memories: ContextMemory[]; proposals: MemoryBlock["proposals"]; sourceMessageId?: Id<"messages"> };

async function generate(ctx: ActionCtx, question: string, history: HistoryTurn[], plan: RoutePlan, messageId: Id<"ragMessages">,
  calculations: string[], memory: MemoryTurn): Promise<RagAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !plan.model) return routeResponse({ ...plan, handler: "unavailable" });
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 45_000 });
  const seen = new Set<string>();
  // Evidence space is kept for the second collection Claude should search: a bank the customer named,
  // or the product pages' FAQs for a single product. Unused reservations would starve the other searches.
  const second = namedBanks(question).some(bank => bank !== "raiffeisen") ? "competitor_docs"
    : plan.scope !== "solution" && plan.scope !== "compare" ? "banking_help" : null;
  const pairedCollections = second && plan.collections.includes("bank_product_docs") && plan.collections.includes(second)
    ? ["bank_product_docs", second] : [];
  const searchedCollections = new Set<string>();
  // Several routes need several searches, so no single search may take the whole evidence budget.
  const perSearch = plan.scope === "solution" ? 2 : plan.scope === "compare" ? 3 : plan.limits.publicChunks;
  const calculator = plan.tools.includes("calculate_scenario");
  const proposing = plan.tools.includes("propose_memory_change") && memory.sourceMessageId !== undefined;
  const tooling = [
    calculator
      ? "One calculator is connected: calculate_scenario (loan_affordability), an indicative debt-service check that needs no product rate. When the customer asks whether they can afford or qualify for a loan and has given their income, amount and term, call it with their own figures; if one is missing, ask for it. You may state its figures without a citation. Say the result is indicative and not a credit decision, and name what it doesn't check. Combine it with sourced eligibility conditions."
      : "No calculator is connected.",
    proposing
      ? "When the customer states something lasting about themselves (a goal, a preference, a constraint, or a figure about their own finances such as their net income or the instalments they already pay), propose each with propose_memory_change, alongside your answer. The app asks them to confirm, so never say it is saved."
      : "",
    "No reviewed product-terms catalog, account data or approved offers are connected.",
  ].filter(Boolean).join(" ");
  // Memories confirmed earlier count as the customer's own statements, so the calculator may use their figures.
  const customerTexts = [question, ...history.filter(turn => turn.role === "user").map(turn => turn.text), ...memory.memories.map(m => m.text)];
  const unavailable = memory.memories.length ? plan.unavailable.filter(id => id !== "user_memory") : plan.unavailable;
  return runAgent({ question, track: plan.track, history, model: plan.model.id, allowedCollections: plan.collections, withholdFinancialFigures: true,
    customerContext: memoryContextNote(memory.memories) }, {
    createMessage: async ({ system, tools, messages }) => {
      const state = await ctx.runQuery(internal.agent.request, { messageId });
      if (state.message.status !== "streaming") throw new ConvexError("reply_stopped");
      return client.beta.messages.create({ model: plan.model!.id, max_tokens: 8000,
        output_config: { effort: plan.model!.effort }, system: [...system, { type: "text", text:
          `Trusted route: ${JSON.stringify({ inquiry: plan.inquiry, scope: plan.scope, collections: plan.collections, unavailable })}. Only these collections are authorized. For a bank comparison, search both bank_product_docs and competitor_docs before answering, and compare exactly the named options. To explain a Raiffeisen product, search bank_product_docs and then banking_help when both are authorized. ${tooling} Exact product rates, fees, monetary amounts and credit limits are unavailable: do not quote them from RAG, even with citations. Explain sourced non-price conditions and documents instead. Never invent missing tool results or approve a discount. For negotiation, offer adviser review without claiming an appointment was booked. ${answerScopeNote(plan.scope)} Answer in English even when the customer writes in Romanian.` }], tools, messages });
    },
    search: async raw => {
      if (!plan.collections.includes(raw.collection)) return unavailableResult(raw.collection, "collection_not_connected", raw.limit);
      const remaining = plan.limits.publicChunks - seen.size;
      const reserved = pairedCollections.filter(c => c !== raw.collection && !searchedCollections.has(c)).length * 2;
      const available = remaining - reserved;
      if (available <= 0) return unavailableResult(raw.collection, "collection_not_connected", raw.limit);
      const safe = { ...raw, query: screenChat(raw.query).text, limit: Math.min(raw.limit, available, perSearch) };
      const result = await searchKnowledge(ctx, plan.track, safe);
      searchedCollections.add(raw.collection);
      const passages = result.passages.filter(p => !seen.has(p.passageId)).slice(0, safe.limit);
      passages.forEach(p => seen.add(p.passageId));
      await ctx.runMutation(internal.agent.progress, { messageId, step: { query: safe.query, focus: safe.collection, results: passages.length } });
      return { ...result, passages, coverage: { ...result.coverage, returned: passages.length } };
    },
    ...(calculator ? { calculate: async (data: CalculateScenarioInput) => {
      const result = runCalculator(data, customerTexts, await ctx.runQuery(internal.regulatoryLimits.affordabilityLimits, {}));
      if (result.status === "ok") calculations.push(result.content);
      return result;
    } } : {}),
    // The host attaches this message as the source; the store checks the quote, screens it and waits for consent.
    ...(proposing ? { proposeMemory: async (data: ProposeMemoryInput): Promise<MemoryProposalResult> => {
      try {
        const result = await ctx.runMutation(internal.memory.propose, { track: plan.track, operation: "remember", ...data, sourceMessageId: memory.sourceMessageId! });
        if (!memory.proposals.some(p => p.id === result.id)) memory.proposals.push({ id: result.id, ...data });
        return { status: "proposed", id: result.id };
      } catch (error) {
        return { status: "unavailable", reason: error instanceof ConvexError ? String(error.data) : "the proposal could not be checked" };
      }
    } } : {}),
  });
}

/** CLI/API harness uses the identical UI pipeline, including Jev and server-side ownership checks. */
export const ask = action({
  args: sendArgs,
  handler: async (ctx, args): Promise<{ threadId: Id<"ragThreads">; answer: RagAnswer }> => {
    await requireAgentScope(ctx, args.track);
    const sent = await ctx.runMutation(internal.agent.enqueue, args);
    await ctx.runAction(api.agent.run, { messageId: sent.messageId });
    const result = await ctx.runQuery(internal.agent.request, { messageId: sent.messageId });
    if (!result.message.answer) throw new ConvexError(result.message.error ?? "reply_unavailable");
    return { threadId: sent.threadId, answer: result.message.answer };
  },
});

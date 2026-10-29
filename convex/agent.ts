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
import { requestJev, requestJevSlots } from "./jevTransport";
import { askFallbackModel } from "./fallbackModel";
import { NO_TRACE, rounded, trace, type Trace } from "./trace";
import { replyValidator } from "./schema";
import { planAgentRoute, type RouteOptions, type RoutePlan } from "../lib/agent/route";
import { composeAnswer, memoryResponse, offersSpecialist, routeResponse, type MemoryBlock } from "../lib/agent/composer";
import { AGENT_POLICY } from "../lib/agent/config";
import { answerGuide } from "../lib/agent/guides";
import { checkCards, showCardsTool, SHOW_CARDS_TOOL_NAME, type AnswerCard } from "../lib/agent/blocks";
import { guessCards } from "../lib/agent/cardFallback";
import { expectedCards, meetsCardContract } from "../lib/agent/cardContract";
import { affordabilityBlock, type AffordabilityBlock } from "../lib/agent/affordabilityBlock";
import { CALCULATE_TOOL, PRODUCT_TERMS_TOOL, productTermsTool, scenarioTool, type StatedInputs } from "./calculator";
import { QUERY_CATALOG_TOOL, queryCatalogTool } from "./catalogQuery";
import { prefetchQuery } from "../lib/catalog/query";
import { EXPENSE_TOOL, expenseSummaryFor, expenseTool, HOLDINGS_TOOL, holdingsFor, holdingsTool } from "./accounts";
import { NEGOTIATE_TOOL, negotiateTool, OFFERS_TOOL, offersTool, type OfferBlock } from "./pricing";
import { COMPETITOR_OFFERS, PRICING_RULES } from "./seed/pricing";
import { accountInputs } from "../lib/expenses/summary";
import { holdingInputs, holdingsInputSchema } from "../lib/bank/holdings";
import { spendingBlock } from "../lib/expenses/schemas";
import { accountSourceUrl } from "../lib/rag/tools";
import { adviceStatedOf, COMPARE_ROUTES_TOOL, compareRoutesTool } from "./advice";
import { withHostRoutesCard } from "../lib/advice/copy";
import { COMPARE_PRODUCTS_TOOL, compareProductsTool } from "./compare";
import { comparisonBlock } from "../lib/compare/block";
import type { CompareTable } from "../lib/compare/schemas";
import { bankingIntent, inquirySchema, topInquiries } from "../lib/agent/confidence";
import { buildInputsBrief, customerAllowedFigures, extractInputs, gateInputs, inputFields, openChoiceSlots, resolveInputs, validateFormValues,
  NEED_BY_REPLIES, type InputsBrief, type ResolvedInputs, type Values } from "../lib/agent/inputs";
import { buildRecentContext, conversationValues, nextState, readState, type ConversationState } from "../lib/agent/state";
import { unavailableResult } from "../lib/rag/knowledge";
import { answerScopeNote } from "../lib/rag/prompt";
import { runCalculator } from "../lib/agent/calculator";
import type { CalculateScenarioInput, ProposeMemoryInput } from "../lib/agent/prompt";
import { memoryEnvironment } from "./memoryAuth";
import { customerMemoryWritesEnabled } from "../lib/agent/memory-store";
import { memoryContextNote, notConnectedClause, type ContextMemory } from "../lib/agent/memory";
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

const sendArgs = { question: v.string(), track: trackArg, threadId: v.optional(v.id("ragThreads")), reply: v.optional(replyValidator),
  attachment: v.optional(v.literal("sample_statement")) };
type Reply = { kind: "choose"; inquiry: string } | { kind: "inputs"; values: Record<string, string | number | string[]> } | { kind: "skip_inputs" };
type SendArgs = { question: string; track: "personal" | "business"; threadId?: Id<"ragThreads">; reply?: Reply; attachment?: "sample_statement" };

async function enqueueHandler(ctx: MutationCtx, { question, track, threadId, reply, attachment }: SendArgs) {
  const scope = await requireAgentScope(ctx, track);
  // The paperclip attaches the chosen sample customer's statement, so there must be one (personal track only)
  if (attachment && (track !== "personal"
    || !(await ctx.db.query("accountAccess").withIndex("by_owner", q => q.eq("ownerKey", scope.ownerKey)).unique())?.persona)) throw new ConvexError("statement_unavailable");
  if (!question.trim() || question.length > 2000) throw new ConvexError("question_length_invalid");
  // A structured reply only refers to something Raiffy offered in this thread; `run` checks it against the stored state.
  if (reply && (!threadId || (reply.kind === "inputs" && (Object.keys(reply.values).length > 3
    || Object.values(reply.values).some(x => (Array.isArray(x) ? x.join("") : String(x)).length > 80))))) throw new ConvexError("reply_invalid");
  const screened = screenChat(question);
  const text = screened.text;
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
  const requestMessageId = await ctx.db.insert("ragMessages", { threadId: id, role: "user", text, ...(reply ? { reply } : {}), ...(attachment ? { attachment } : {}) });
  const messageId = await ctx.db.insert("ragMessages", { threadId: id, role: "assistant", text: "", status: "streaming", requestMessageId, steps: [] });
  trace(messageId).step("message.received", { messageId, threadId: id, thread: threadId ? "existing" : "new", track,
    reply: reply?.kind ?? "none", attachment: attachment ?? "none", length: question.length, redacted: screened.redacted });
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

export const saveState = internalMutation({
  args: { threadId: v.id("ragThreads"), state: v.any() },
  handler: async (ctx, { threadId, state }) => {
    await requireAgentThread(ctx, threadId);
    await ctx.db.patch(threadId, { agentState: readState(state) });
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
    const t = trace(messageId);
    const started = Date.now();
    let step = "request";
    const input = await ctx.runQuery(internal.agent.request, { messageId });
    if (!await ctx.runMutation(internal.agent.begin, { messageId })) { t.step("run.skipped", { why: "already running or finished" }); return null; }
    t.step("run.start", { messageId, threadId: input.thread._id, track: input.thread.track, historyTurns: input.history.length });
    try {
      step = "screen";
      const screened = screenChat(input.source.text);
      const question = screened.text;
      t.step("privacy.screen", { length: question.length, redacted: screened.redacted, question: t.text(question) });
      step = "state";
      const state = readState(input.thread.agentState);
      const reply = input.source.reply as Reply | undefined;
      const jevOptions = { enabled: process.env.RAIFFY_JEV_ENABLED === "true", apiKey: process.env.TYPESAFE_API_KEY };
      const recentContext = buildRecentContext(state, input.history);
      t.step("state.loaded", { inquiry: state.inquiry ?? null, pending: state.pending ? { inquiry: state.pending.inquiry, keys: state.pending.keys, round: state.pending.round } : null,
        offered: state.offered, knownInputs: Object.keys(state.inputs ?? {}), reply: reply?.kind ?? "none", contextChars: recentContext.length });
      step = "jev";
      const classify = () => requestJev({ message: question, recentContext }, jevOptions);
      const classifiedFirst = await t.time("jev.classify", classify, (c) => c.status === "classified" ? {
        status: c.status, model: c.classification.model ?? undefined,
        inquiry: rounded(Object.fromEntries(Object.entries(c.classification.answers.inquiry.probabilities).sort(([, a], [, b]) => b - a).slice(0, 3))),
        risks: rounded(Object.fromEntries(Object.entries(c.classification.answers).filter(([, a]) => a?.type === "noul").map(([k, a]) => [k, a?.type === "noul" ? a.noul : null]))),
        memory: { operation: c.classification.answers.memory_operation.choice, confidence: Math.round(c.classification.answers.memory_operation.confidence * 100) / 100 },
      } : { status: c.status, reason: c.reason, enabled: jevOptions.enabled, hasKey: !!jevOptions.apiKey });
      // One retry for a malformed or failed reply: without a classification the customer gets no answer at all.
      // Timeouts aren't retried, so the worst case stays within two transport deadlines.
      const retryJev = classifiedFirst.status === "unavailable" && (classifiedFirst.reason === "invalid_response" || classifiedFirst.reason === "provider_error");
      const classified = retryJev ? await t.time("jev.retry", classify, (c) => ({ status: c.status })) : classifiedFirst;
      // Memory: what this customer confirmed earlier, and (where writes are on) this message as the only source
      // a new proposal may quote. Screening decides whether the message may be a source at all.
      step = "memory";
      const track = input.thread.track;
      const writes = customerMemoryWritesEnabled(memoryEnvironment());
      const memories: ContextMemory[] = await ctx.runQuery(internal.memory.forAgent, { track }).catch(() => []);
      // The customer's own statements: their figures may be repeated in the answer, and the affordability check may use them.
      const customerTexts = [question, ...input.history.filter(turn => turn.role === "user").map(turn => turn.text), ...memories.map(m => m.text)];
      const source = writes ? await ctx.runMutation(internal.conversations.recordCustomerMessage, { track, text: question }).catch(() => null) : null;
      t.step("memory.loaded", { memories: memories.length, writes, eligible: source?.memoryEligible ?? null });
      step = "route";
      // Income and existing payments from the sample account, only with the account switch on (below what the customer says)
      // Statements give income and every debt payment; with only the loans switch on, Raiffeisen loan payments still count.
      const account = track === "personal" ? { ...holdingInputs(await holdingsFor(ctx, "personal", ["loans"])),
        ...accountInputs(await expenseSummaryFor(ctx, "personal", "last_three_complete_months")) } : {};
      if (Object.keys(account).length) t.step("account.inputs", { keys: Object.keys(account) });
      const attached = input.source.attachment === "sample_statement";
      const turn = await routeTurn({ question, recentContext, state, reply, classified, track, jevOptions, account, memoryEligible: !!source?.memoryEligible, attached, t });
      const { plan, resolved, ask } = turn;
      // Labels only, for the Console's Sentiment page; never blocks or changes the answer.
      const feeling = classified.status === "classified" ? classified.classification.answers : null;
      if (feeling?.sentiment && feeling.sentiment_about) {
        await ctx.runMutation(internal.sentiment.record, { messageId, inquiry: plan.inquiry ?? "unknown", sentiment: feeling.sentiment.choice,
          about: feeling.sentiment_about.choice, confidence: feeling.sentiment.confidence })
          .then(() => t.step("sentiment.recorded", { sentiment: feeling.sentiment!.choice, about: feeling.sentiment_about!.choice }),
            (error: unknown) => t.step("sentiment.failed", { error: error instanceof Error ? error.message : String(error) }));
      }
      let answer: RagAnswer;
      const used: ToolUse[] = [];
      const proposals: MemoryBlock["proposals"] = [];
      const operation = plan.reason === "explicit_memory_request" ? plan.memoryOperation : null;
      if (operation === "inspect" || operation === "forget") {
        answer = memoryResponse(operation, memories, writes);
        t.step("answer.memory", { operation, memories: memories.length });
      } else if (operation && writes && !source?.memoryEligible) {
        answer = memoryResponse("ineligible", memories, writes);
        t.step("answer.memory", { operation: "ineligible" });
      } else if (!plan.model || !["answer", "orchestrator"].includes(plan.handler)) {
        answer = routeResponse(plan, { inputs: ask ?? undefined });
        t.step("answer.scripted", { handler: plan.handler, reason: plan.reason ?? null, why: plan.model ? "handler has no model" : "no model for this route" });
      } else {
        step = "generate";
        answer = await generate(ctx, question, input.history, plan, messageId, turn.brief, resolved ? customerAllowedFigures(question, resolved) : [], t, used,
          { memories, proposals, customerTexts, ...(source?.memoryEligible ? { sourceMessageId: source.messageId } : {}) }, attached);
      }
      step = "check";
      // Demo: prices are shown as fetched. Every figure must still appear in a cited passage from this turn's search
      // (the number check in lib/rag/agent.ts); an answer that fails it comes back failed_checks and is withheld below.
      t.step("answer.checked", { status: answer.status, model: answer.model ?? null, searches: answer.searches?.length ?? 0, sources: answer.sources.length,
        checks: answer.checks, replacedWith: answer.status === "failed_checks" || answer.status === "refused" ? "unavailable" : null });
      const verification = { status: answer.status, checks: answer.checks, searches: answer.searches, model: answer.model,
        financialTermsSupported: answer.status === "answered" };
      const attempts = answer.checks.attempts;
      // Failed drafts are neither shown nor retained. Only the checked final response reaches the UI.
      if (answer.status === "failed_checks" || answer.status === "refused") answer = routeResponse({ ...plan, handler: "unavailable" });
      if (answer.sources.length > 0) {
        const notice = "This is dated public information, not a binding offer; check the source dates below.";
        answer = { ...answer, text: `${answer.text}\n\n${notice}`, segments: [...answer.segments, { text: ` ${notice}`, sourceIds: [] }] };
      }
      // Missing optional inputs become suggested replies, never questions.
      const followups = "needsTiming" in answer && answer.needsTiming ? NEED_BY_REPLIES : turn.brief ? [...turn.brief.optional.filter(o => o.value === null).slice(0, 2).map(o => `Add my ${o.label.toLowerCase()}`),
        "Which official documents should I read?"] : undefined;
      step = "save";
      const envelope = composeAnswer(messageId, plan, answer, { inputs: ask ?? undefined, followups, proposals, specialistOffered: state.specialistOffered });
      // An answered pattern without its card (lib/agent/cardContract.ts): counted, so gaps show in the trace.
      if (answer.status === "answered" && !ask && !meetsCardContract(plan.inquiry, envelope.blocks, plan.scope)) {
        t.step("cards.missing", { inquiry: plan.inquiry, expected: expectedCards(plan.inquiry, plan.scope), shown: envelope.blocks.map(b => b.type) });
      }
      await ctx.runMutation(internal.agent.saveState, { threadId: input.thread._id, state: nextState(state, {
        inquiry: plan.inquiry, scope: plan.scope, resolved: resolved ?? undefined,
        asked: ask && plan.inquiry ? { inquiry: plan.inquiry, keys: ask.fields.map(f => f.key), round: ask.round } : null,
        offered: plan.handler === "clarify" ? plan.candidates : [],
        specialist: offersSpecialist(envelope, plan.handler),
      }) });
      await ctx.runMutation(internal.agent.complete, { messageId, answer: { ...answer,
        routing: { handler: plan.handler, inquiry: plan.inquiry, confidence: plan.confidence, classifierModel: plan.classifierModel,
          collections: plan.collections, tools: plan.tools, unavailable: plan.unavailable, reason: classified.status === "unavailable" ? classified.reason : plan.reason,
          basis: plan.routingBasis, candidates: plan.candidates, fallbackUsed: turn.fallbackUsed,
          // Which inputs were known and from where, without their values.
          inputs: resolved ? { known: Object.fromEntries(Object.entries(resolved.known).map(([k, x]) => [k, x!.source])), missingRequired: resolved.missingRequired } : null },
        classifierConfidences: classified.status === "classified" ? Object.fromEntries(Object.entries(classified.classification.answers)
          .filter(([, a]) => a?.type === "choice").map(([key, a]) => [key, a?.type === "choice" ? a.confidence : null])) : {},
        // The full inquiry distribution, for calibrating per-label thresholds.
        inquiryProbabilities: classified.status === "classified" ? classified.classification.answers.inquiry.probabilities : {},
        // Yes/no probabilities (risks, durability, special category): they gate tools, so they stay visible.
        classifierSignals: classified.status === "classified" ? Object.fromEntries(Object.entries(classified.classification.answers)
          .flatMap(([key, a]) => a?.type === "noul" ? [[key, a.noul]] : [])) : {},
        verification, ui: envelope } });
      // Counts only, for the Console's Analytics page; never blocks the answer.
      await ctx.runMutation(internal.analytics.record, { messageId, inquiry: plan.inquiry ?? null, handler: plan.handler, status: verification.status, attempts, tools: used })
        .then(() => t.step("analytics.recorded", { tools: used.map((u) => u.name) }),
          (error: unknown) => t.step("analytics.failed", { error: error instanceof Error ? error.message : String(error) }));
      t.step("run.done", { ms: Date.now() - started, handler: plan.handler, inquiry: plan.inquiry ?? null, status: answer.status,
        blocks: envelope.blocks.map(b => b.type), actions: envelope.actions.map(a => a.kind),
        nextPending: ask ? ask.fields.map(f => f.key) : null });
    } catch (error) {
      t.fail(`run (at ${step})`, error, { ms: Date.now() - started });
      await ctx.runMutation(internal.agent.complete, { messageId, error: "Raiffy couldn't verify an answer. Please try again." });
    }
    return null;
  },
});

/** Memory for one turn: confirmed memories, proposals queued so far, the customer's own texts and the message a proposal may quote. */
type MemoryTurn = { memories: ContextMemory[]; proposals: MemoryBlock["proposals"]; customerTexts: readonly string[]; sourceMessageId?: Id<"messages"> };
type JevOptions = { enabled: boolean; apiKey?: string };
type Turn = { plan: RoutePlan; resolved: ResolvedInputs | null; ask: { fields: ReturnType<typeof inputFields>; round: number } | null; brief: InputsBrief | null; fallbackUsed: boolean };

/**
 * Picks the answer pattern and gathers its inputs. Order: Jev's risk checks and routing, then the conversation's pending
 * question or a tapped choice, then the small fallback model only if Jev could not decide, then the inputs gate.
 */
async function routeTurn(args: { question: string; recentContext: string; state: ConversationState; reply?: Reply;
  classified: Awaited<ReturnType<typeof requestJev>>; track: "personal" | "business"; jevOptions: JevOptions; account?: Values; memoryEligible?: boolean;
  attached?: boolean; t?: Trace }): Promise<Turn> {
  const { question, recentContext, state, reply, classified } = args;
  const t = args.t ?? NO_TRACE;
  const context = { track: args.track, availableTools: ["search_knowledge" as const, "query_catalog" as const, "get_product_terms" as const, "calculate_scenario" as const, "get_expense_summary" as const, "get_holdings" as const, "get_approved_offers" as const, "negotiate_offer" as const, "check_affordability" as const,
    ...(args.memoryEligible ? ["propose_memory_change" as const] : [])],
    availableCollections: ["bank_product_docs" as const, "competitor_docs" as const, "banking_help" as const], requestedBanks: namedBanks(question),
    intentHints: bankingIntent(question) };
  const raw = classified.status === "classified" ? classified.classification : {};
  const answers = classified.status === "classified" ? classified.classification.answers : null;
  const pendingInquiry = state.pending ? inquirySchema.safeParse(state.pending.inquiry) : null;
  const pending = state.pending && pendingInquiry?.success ? { ...state.pending, inquiry: pendingInquiry.data } : null;

  let options: RouteOptions = {};
  const chosen = reply?.kind === "choose" ? inquirySchema.safeParse(reply.inquiry) : null;
  if (chosen?.success && state.offered.includes(chosen.data)) options = { inquiry: chosen.data, basis: "choice" };
  else if (reply?.kind === "choose") t.step("route.choice_rejected", { chosen: reply.inquiry, offered: state.offered });
  else if (pending) {
    const filled = Object.keys(extractInputs(pending.inquiry, question, pending.keys)).some(k => (pending.keys as string[]).includes(k));
    const answersPending = (answers?.answers_pending?.noul ?? 0) >= AGENT_POLICY.thresholds.answersPending;
    if (reply?.kind === "inputs" || reply?.kind === "skip_inputs" || answersPending || filled) options = { inquiry: pending.inquiry, basis: "pending" };
  }
  let plan = planAgentRoute(raw, context, AGENT_POLICY, options);
  const logPlan = (name: string) => t.step(name, { handler: plan.handler, inquiry: plan.inquiry ?? null, scope: plan.scope ?? null, basis: plan.routingBasis ?? null,
    confidence: plan.confidence ?? null, reason: plan.reason ?? null, candidates: plan.candidates, collections: plan.collections,
    model: plan.model?.id ?? null, forced: options.basis ?? null });
  logPlan("route.decided");
  let fallbackUsed = false;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (plan.handler === "clarify" && (plan.reason === "ambiguous_inquiry" || plan.reason === "low_route_confidence") && answers) {
    const candidates = plan.candidates.length >= 2 ? plan.candidates : topInquiries(answers.inquiry.probabilities);
    const picked = await t.time("fallback.pattern", () => askFallbackModel({ message: question, recentContext, candidates, slots: [] }, apiKey),
      (r) => ({ model: AGENT_POLICY.fallbackModel, candidates, picked: r === null ? "error_or_no_key" : r.inquiry ?? "unsure" }));
    fallbackUsed = true;
    if (picked?.inquiry) plan = planAgentRoute(raw, context, AGENT_POLICY, { inquiry: picked.inquiry, basis: "fallback" });
    else plan = { ...plan, candidates };
    logPlan("route.after_fallback");
  }
  // An attached sample statement makes this a question about it: with no clearer pattern, it reads as spending
  // insights, and whatever the pattern, the answer may read the statement.
  if (args.attached) {
    if (plan.handler === "clarify" || plan.inquiry === "other") plan = planAgentRoute(raw, context, AGENT_POLICY, { inquiry: "expense_insights", basis: "choice" });
    if (["answer", "orchestrator"].includes(plan.handler) && !plan.tools.includes("get_expense_summary")) plan = { ...plan, tools: [...plan.tools, "get_expense_summary"] };
    logPlan("route.statement");
  }
  if (!plan.inquiry || !["answer", "orchestrator"].includes(plan.handler)) return { plan, resolved: null, ask: null, brief: null, fallbackUsed };

  const inquiry = plan.inquiry;
  const samePending = pending?.inquiry === inquiry ? pending : null;
  const form: Values = reply?.kind === "inputs" && samePending ? validateFormValues(samePending.keys, reply.values) : {};
  const message = extractInputs(inquiry, question, samePending?.keys ?? []);
  const sources = { form, message, conversation: conversationValues(state), account: args.account ?? {} };
  let resolved = resolveInputs(inquiry, sources);
  const open = openChoiceSlots(resolved);
  const inputsDetail = () => ({ known: Object.fromEntries(Object.entries(resolved.known).map(([k, x]) => [k, x!.source])), missingRequired: resolved.missingRequired });
  t.step("inputs.extracted", { inquiry, fromForm: Object.keys(form), fromMessage: Object.keys(message), ...inputsDetail(), openChoices: open.map(o => o.key) });
  if (open.length) {
    // Choices the keywords missed: ask Jev, then the fallback model only for what Jev could not decide.
    const jev = await t.time("jev.slots", async () => await requestJevSlots({ message: question, recentContext }, open, args.jevOptions) ?? {},
      (r) => ({ asked: open.map(o => o.key), answered: Object.fromEntries(Object.entries(r).map(([k, a]) => [k, { choice: a.choice, confidence: Math.round(a.confidence * 1000) / 1000 }])) }));
    const settled = Object.fromEntries(Object.entries(jev).filter(([, a]) => a.confidence >= AGENT_POLICY.thresholds.slotConfidence).map(([k, a]) => [k, a.choice]));
    const rest = open.filter(s => !(s.key in settled));
    const picked = rest.length ? await t.time("fallback.slots", () => askFallbackModel({ message: question, recentContext, candidates: [], slots: rest }, apiKey),
      (r) => ({ model: AGENT_POLICY.fallbackModel, asked: rest.map(s => s.key), settled: r === null ? "error_or_no_key" : Object.keys(r.inputs ?? {}) })) : null;
    if (rest.length) fallbackUsed = true;
    resolved = resolveInputs(inquiry, { ...sources, message: { ...message, ...settled, ...(picked?.inputs ?? {}) } });
  }
  const gate = gateInputs(resolved, samePending, AGENT_POLICY, { skip: reply?.kind === "skip_inputs" });
  t.step("inputs.gate", { ...inputsDetail(), ...(gate.action === "ask" ? { action: "ask", keys: gate.keys, round: gate.round }
    : { action: "proceed", examplesRequested: gate.examplesRequested, stillMissing: gate.stillMissing }) });
  if (gate.action === "ask") {
    return { plan: { ...plan, handler: "collect_inputs", reason: "missing_required_inputs", model: null }, resolved,
      ask: { fields: inputFields(inquiry, gate.keys), round: gate.round }, brief: null, fallbackUsed };
  }
  return { plan, resolved, ask: null, brief: buildInputsBrief(resolved, gate.examplesRequested), fallbackUsed };
}

/**
 * The customer's own figures for a simulation: the starting amount and term, and the income and other monthly payments
 * for its share-of-income row. Defaulted inputs don't count. They travel only in the card, never in a trace.
 */
function scenarioOf(brief: InputsBrief | null): { amount?: number; months?: number; income?: number; obligations?: number } {
  const own = (key: string) => {
    const row = [...(brief?.required ?? []), ...(brief?.optional ?? [])].find(r => r.key === key);
    return row && row.source !== "default" && typeof row.value === "number" ? row.value : undefined;
  };
  return { amount: own("amount"), months: own("months"), income: own("income"), obligations: own("obligations") };
}

/** The customer's amount and term for the calculator, with whether each was stated or defaulted. */
function statedOf(brief: InputsBrief | null): StatedInputs {
  const row = (key: string) => [...(brief?.required ?? []), ...(brief?.optional ?? [])].find(r => r.key === key);
  const pick = (key: string) => {
    const r = row(key);
    return r && typeof r.value === "number" ? { value: r.value, source: r.source === "default" ? "default" as const : "customer" as const } : undefined;
  };
  const amount = pick("amount");
  const months = pick("months");
  return { ...(amount ? { amount } : {}), ...(months ? { months } : {}) };
}

/** An account-data tool the model called, for the answer's analytics trace (lib/analytics/trace.ts). */
type ToolUse = { name: string; kinds?: string[] };

async function generate(ctx: ActionCtx, question: string, history: HistoryTurn[], plan: RoutePlan, messageId: Id<"ragMessages">, brief: InputsBrief | null,
  figures: string[] = [], t: Trace = NO_TRACE, used: ToolUse[] = [], memory: MemoryTurn = { memories: [], proposals: [], customerTexts: [] },
  statement = false): Promise<RagAnswer & { needsTiming?: true }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !plan.model) { t.step("model.unavailable", { hasKey: !!apiKey, model: plan.model?.id ?? null }); return routeResponse({ ...plan, handler: "unavailable" }); }
  t.step("model.start", { model: plan.model.id, effort: plan.model.effort, collections: plan.collections, chunkBudget: plan.limits.publicChunks, brief: brief !== null });
  const guide = answerGuide(plan);
  const euro = brief?.optional.some(o => o.key === "currency" && o.value === "EUR") || brief?.required.some(o => o.key === "currency" && o.value === "EUR");
  t.step("model.figures", { customerFigures: figures.length, euro: !!euro, scope: plan.scope });
  let calls = 0;
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 45_000 });
  const seen = new Set<string>();
  // Evidence space is kept for the second collection Claude should search: a bank the customer named,
  // or the product pages' FAQs for a single product. Unused reservations would starve the other searches.
  const second = namedBanks(question).some(bank => bank !== "raiffeisen") ? "competitor_docs"
    : plan.scope !== "solution" && plan.scope !== "compare" ? "banking_help" : null;
  const pairedCollections = second && plan.collections.includes("bank_product_docs") && plan.collections.includes(second)
    ? ["bank_product_docs", second] : [];
  const searchedCollections = new Set<string>();
  // A routes card built by compare_routes replaces any routes card Claude makes, so the recommendation is never
  // model-written (lib/advice/copy.ts withHostRoutesCard).
  let routesFromTool: { card: AnswerCard; text: string } | null = null;
  // Set when the recommendation waits on when the customer needs the money: the answer then offers the timing replies.
  let needsTiming = false;
  const withRoutesCard = (shown: readonly AnswerCard[], urls: readonly string[], hits: readonly { url: string; text: string; collectedAt: string }[]) => {
    const merged = withHostRoutesCard(routesFromTool, shown, urls, hits, figures);
    if (!merged) return null;
    if ("dropped" in merged) { t.step("cards.routes_dropped", { reason: merged.dropped }); return null; }
    t.step("cards.routes_from_tool", { replaced: merged.replaced });
    return { cards: merged.cards, urls: merged.urls };
  };
  // Answer cards: Claude fills them as JSON; every number must be copied from a result it cites (lib/agent/blocks.ts).
  const cards = {
    tool: showCardsTool(),
    check: (input: unknown, hits: readonly { url: string; text: string; collectedAt: string }[]) => {
      const checked = checkCards(input, hits, figures);
      if ("error" in checked) {
        t.step("cards.rejected", { error: checked.error });
        const host = withRoutesCard([], [], hits);
        return host ? { ok: true as const, ...host, note: "Shown: the routes card from compare_routes." } : { ok: false as const, error: checked.error };
      }
      t.step("cards.checked", { shown: checked.cards.map(c => c.type), dropped: checked.dropped, sources: checked.urls.length });
      const host = withRoutesCard(checked.cards, checked.urls, hits);
      if (host) return { ok: true as const, ...host, note: "Shown, with the routes card from compare_routes in place of any routes card." };
      if (!checked.cards.length) return { ok: false as const, error: `nothing on the cards was supported by a cited result (${checked.dropped.slice(0, 3).join("; ")})` };
      return { ok: true as const, cards: checked.cards, urls: checked.urls,
        note: checked.dropped.length ? `Shown, without these unsupported parts: ${checked.dropped.join("; ")}. Don't repeat them in the text.` : "Shown to the customer." };
    },
    // Claude showed no card: guess one from the checked answer, grounded by the same check (lib/agent/cardFallback.ts).
    fallback: (segments: readonly { text: string; hitIndexes: number[] }[], hits: readonly { url: string; text: string; label: string; collectedAt: string }[]) => {
      const host = withRoutesCard([], [], hits);
      if (host) return host;
      const guess = guessCards({ segments, hits, inquiry: plan.inquiry, question, scenario: scenarioOf(brief) });
      if (!guess) return null;
      const checked = checkCards(guess, hits, figures);
      if ("error" in checked || !checked.cards.length) { t.step("cards.fallback_dropped", { reason: "error" in checked ? checked.error : checked.dropped }); return null; }
      t.step("cards.fallback", { shown: checked.cards.map(c => c.type), dropped: checked.dropped });
      return { cards: checked.cards, urls: checked.urls };
    },
    // The pattern's card (lib/agent/cardContract.ts), counting the cards code builds after the answer from tool results.
    complete: (shown: readonly unknown[]) => meetsCardContract(plan.inquiry, [...shown, ...hostCardKinds().map(type => ({ type }))], plan.scope),
  };
  // Catalog terms and the calculator, when the route allows them: citable results, figures only from reviewed records.
  let calculations = 0;
  let spending: ReturnType<typeof spendingBlock> = null;
  // The comparison card's fixed rows from the catalog (compare_products); the model's comparison facts fill its gaps
  let compareFromTool: CompareTable | null = null;
  const comparing = plan.tools.includes("get_product_terms") && (plan.scope === "compare" || plan.inquiry === "product_comparison");
  let offer: OfferBlock | null = null;
  // The last successful affordability check this turn: the chat shows it as a card built by code.
  let affordabilityCard: AffordabilityBlock | null = null;
  const hostCardKinds = () => [...(spending ? ["spending"] : []), ...(offer ? ["offer"] : []), ...(compareFromTool ? ["compare_table"] : []),
    ...(affordabilityCard ? ["affordability"] : [])];
  // The catalog reads only the banks this turn's collections allow, in its track (lib/catalog/query.ts)
  const catalogScope = { track: plan.track, collections: plan.collections.filter((c): c is "bank_product_docs" | "competitor_docs" | "banking_help" => c !== "user_memory") };
  const hostTools = [
    ...(plan.tools.includes("query_catalog") ? [{ tool: QUERY_CATALOG_TOOL, run: async (input: unknown) => {
      const out = await queryCatalogTool(ctx, catalogScope, input);
      t.step("catalog.query", "error" in out ? { error: out.error } : { rows: out.citables.length, note: !!out.note,
        unreviewed: out.citables.filter((c) => c.text.includes("not reviewed yet")).length });
      return out;
    } }] : []),
    ...(plan.tools.includes("get_product_terms") ? [{ tool: PRODUCT_TERMS_TOOL, run: async (input: unknown) => {
      const out = await productTermsTool(ctx, plan.track, input);
      t.step("terms.done", "error" in out ? { error: out.error } : { usable: out.citables.length, someUnavailable: !!out.note });
      return out;
    } }] : []),
    ...(plan.tools.includes("calculate_scenario") ? [{ tool: CALCULATE_TOOL, run: async (input: unknown) => {
      const { outcome, result } = await scenarioTool(ctx, plan.track, input, statedOf(brief), figures, ++calculations);
      t.step("calc.done", result ? { calculation: result.calculation, status: result.status, basis: result.basis, gaps: result.gaps.map(g => g.reason), sources: result.sources.length }
        : { error: "error" in outcome ? outcome.error : null });
      return outcome;
    } }] : []),
    // Solution answers: routes and Raiffy's recommendation by the fixed rule (lib/advice/recommend.ts)
    ...(plan.tools.includes("calculate_scenario") && plan.scope === "solution" ? [{ tool: COMPARE_ROUTES_TOOL, run: async (input: unknown) => {
      const { outcome, result, card } = await compareRoutesTool(ctx, plan.track, input, adviceStatedOf(brief), figures, ++calculations);
      if (card && "citables" in outcome && outcome.citables[0]) routesFromTool = { card, text: outcome.citables[0].text };
      needsTiming = result?.recommendation.status === "needs_input" && result.recommendation.needs.includes("need_by");
      t.step("routes.done", result ? { status: result.recommendation.status, pick: result.recommendation.pick ?? null, needs: result.recommendation.needs,
        routes: result.routes.routes.map(r => `${r.key}:${r.status}`), card: !!card } : { error: "error" in outcome ? outcome.error : null });
      return outcome;
    } }] : []),
    // Named products side by side in the card's fixed rows (lib/compare), built here from the catalog
    ...(comparing ? [{ tool: COMPARE_PRODUCTS_TOOL, run: async (input: unknown) => {
      const { outcome, table } = await compareProductsTool(ctx, catalogScope, input, figures);
      if (table) compareFromTool = table;
      t.step("compare.done", table ? { focus: table.focus, products: table.products.length, rows: table.groups.flatMap(g => g.rows.map(r => r.key)),
        best: table.best, paymentUnavailable: table.paymentUnavailable } : { error: "error" in outcome ? outcome.error : null });
      return outcome;
    } }] : []),
    // Account data: a sample persona the customer chose, read only through the switches they turned on (convex/accounts.ts)
    ...(plan.tools.includes("get_expense_summary") ? [{ tool: EXPENSE_TOOL, run: async (input: unknown) => {
      used.push({ name: "get_expense_summary" });
      const { outcome, summary } = await expenseTool(ctx, plan.track, input, statement);
      if (summary?.status === "ok") spending = spendingBlock(summary, accountSourceUrl(summary));
      t.step("account.done", summary ? { status: summary.status, reason: summary.reason ?? null, notUsed: summary.notUsed, insights: summary.insights.map(i => i.kind) }
        : { error: "error" in outcome ? outcome.error : null });
      return outcome;
    } }] : []),
    // The customer's Raiffeisen products as Smart Mobile shows them, one switch per kind (convex/accounts.ts)
    ...(plan.tools.includes("get_holdings") ? [{ tool: HOLDINGS_TOOL, run: async (input: unknown) => {
      used.push({ name: "get_holdings", kinds: holdingsInputSchema.safeParse(input).data?.kinds });
      const outcome = await holdingsTool(ctx, plan.track, input);
      t.step("holdings.done", "error" in outcome ? { error: outcome.error } : { citables: outcome.citables.map(c => c.chunkId), note: outcome.note ?? null });
      return outcome;
    } }] : []),
    // Relationship pricing and negotiation: sample pricing on synthetic customers, every price from lib/pricing (convex/pricing.ts)
    ...(plan.tools.includes("get_approved_offers") ? [{ tool: OFFERS_TOOL, run: async (input: unknown) => {
      used.push({ name: "get_approved_offers" });
      const { outcome, block } = await offersTool(ctx, plan.track, input, statedOf(brief), figures);
      if (block && !offer) offer = block;
      t.step("offers.done", block ? { product: block.quote.productId, current: block.quote.current.id, couldBeBetter: block.quote.couldBeBetter } : { error: "error" in outcome ? outcome.error : null });
      return outcome;
    } }] : []),
    ...(plan.tools.includes("negotiate_offer") ? [{ tool: NEGOTIATE_TOOL, run: async (input: unknown) => {
      used.push({ name: "negotiate_offer" });
      const { outcome, block } = await negotiateTool(ctx, plan.track, input, statedOf(brief), figures, messageId);
      if (block) offer = block;
      t.step("negotiate.done", block ? { resolution: block.resolution, product: block.quote.productId } : { error: "error" in outcome ? outcome.error : null });
      return outcome;
    } }] : []),
  ];
  const catalog = hostTools.length ? await ctx.runQuery(internal.calculator.catalogProducts, { track: plan.track }) : [];
  // Catalog first: on a catalog-shaped question the host reads the database before the model searches documents.
  const briefValue = (key: string) => [...(brief?.required ?? []), ...(brief?.optional ?? [])].find((r) => r.key === key)?.value;
  const productKind = briefValue("productKind");
  const prefetch = plan.tools.includes("query_catalog")
    ? prefetchQuery({ inquiry: plan.inquiry, productKind: typeof productKind === "string" ? productKind : null, banks: namedBanks(question) }) : null;
  if (prefetch) t.step("catalog.prefetch", { find: prefetch.find, productKind: prefetch.productKind ?? null, banks: prefetch.banks ?? [] });
  // Several routes need several searches, so no single search may take the whole evidence budget.
  const perSearch = plan.scope === "solution" ? 2 : plan.scope === "compare" ? 3 : plan.limits.publicChunks;
  // The indicative debt-service check (lib/agent/calculator.ts) and memory proposals the customer confirms in the app.
  const affordability = plan.tools.includes("check_affordability");
  const proposing = plan.tools.includes("propose_memory_change") && memory.sourceMessageId !== undefined;
  const memoryNotes = [
    affordability ? "Affordability: when the customer asks whether they can afford or qualify for a loan and has given their net monthly income, the amount and the term, call check_affordability (loan_affordability) with only the figures they wrote; it needs no product rate and is never a credit decision. If a figure is missing, ask for it." : "",
    statement ? "The customer attached their statement to this message. In this preview it is the sample customer's statement, not a real document: read it with get_expense_summary, answer from it, and say it is sample data." : "",
    proposing ? "When the customer states something lasting about themselves (a goal, a preference, a constraint, or a figure about their own finances such as their net income or the instalments they already pay), propose each with propose_memory_change, alongside your answer. The customer confirms each one in the app, so never say it is saved." : "",
  ].filter(Boolean).join(" ");
  const unavailable = memory.memories.length ? plan.unavailable.filter(id => id !== "user_memory") : plan.unavailable;
  // The pattern's card when Claude makes it (lib/agent/cardContract.ts); code builds the table, price, spending and affordability cards.
  const modelCards = expectedCards(plan.inquiry, plan.scope).filter((k): k is keyof typeof CARD_NAMES => k in CARD_NAMES)
    .filter(k => !(k === "comparison" && comparing));
  const answer = await runAgent({ question, track: plan.track, history, model: plan.model.id, allowedCollections: plan.collections, customerFigures: figures, cards, hostTools,
    customerContext: memoryContextNote(memory.memories), customerStatements: memory.customerTexts,
    preload: prefetch ? [{ tool: QUERY_CATALOG_TOOL.name, input: prefetch }] : [] }, {
    createMessage: async ({ system, tools, messages }) => {
      const state = await ctx.runQuery(internal.agent.request, { messageId });
      if (state.message.status !== "streaming") { t.step("model.stopped_by_customer", { calls }); throw new ConvexError("reply_stopped"); }
      calls += 1;
      return t.time(`model.call#${calls}`, () => client.beta.messages.create({ model: plan.model!.id, max_tokens: 8000,
        output_config: { effort: plan.model!.effort }, system: [...system, { type: "text", text:
          `Trusted route: ${JSON.stringify({ inquiry: plan.inquiry, scope: plan.scope, collections: plan.collections, unavailable })}. Only these collections are authorized. For a bank comparison, search both bank_product_docs and competitor_docs before answering, and compare exactly the named options. ${notConnectedClause(memory.memories.length)}${plan.tools.includes("negotiate_offer") ? "; Raiffeisen prices and counter-offers come only from get_approved_offers and negotiate_offer (sample pricing)" : ", and no approved offers are connected"}${plan.tools.includes("get_expense_summary") ? "; account data comes only from get_expense_summary, and in this preview it is sample data, which you must say" : ", and no account data is connected"}. Quote rates, fees, monetary amounts and credit limits exactly as they appear in this turn's search results, each with its citation, and say they are dated public figures, not a personal offer. If a figure isn't in the results, say it wasn't found; never estimate it. Never invent missing tool results or approve a discount. For negotiation, mention a specialist review only when the pricing result asks for one, without claiming a call was booked.` },
          ...(guide ? [{ type: "text" as const, text: guide }] : []),
          ...(memoryNotes ? [{ type: "text" as const, text: memoryNotes }] : []),
          ...(hostTools.length ? [{ type: "text" as const, text: `Catalog and calculator: ${catalog.length ? `the catalog has these products (ID: name, bank): ${catalog.slice(0, 60).map(p => `${p.productId}: ${p.product}, ${p.bank}`).join("; ")}.` : "the catalog has no products for this track yet."}${plan.tools.includes("query_catalog") ? " The structured catalog comes before the documents: call query_catalog first when the question is about which products exist or about their rates, fees, limits or terms, and search documents for explanations and for whatever it lists as a gap. A catalog row overrides a passage that disagrees with it. A row marked not reviewed is a dated public figure: say so." : ""} For an exact rate, fee or limit, call get_product_terms with the product IDs. For a loan's or an overdraft's monthly payment, total cost or DAE, call calculate_scenario with the term IDs it returned; never work a figure out yourself. Quote catalog and calculation figures exactly as written and cite them. A calculation on an example amount must be labelled as an example. A stress test is not the rate.${plan.scope === "solution" && plan.tools.includes("calculate_scenario") ? " For a goal the customer wants to reach (a renovation, a purchase), call compare_routes once with the loan's term IDs (and the overdraft's, when the catalog has one) and the customer's timing: it shows the routes card with Raiffy's recommendation itself. Don't make a routes card, don't recommend a different route, and if it asks for an input, ask the customer for it in one short question." : ""}${comparing ? " When the customer compares named products, call compare_products once with their catalog product IDs (exactly the products they named) and focus \"documents\" only for a documents question: the chat shows its comparison card with fixed rows, so don't make a comparison card for products it covered." : ""} When a term is unavailable, say the exact figure isn't confirmed and use the dated public sources as before.` }] : []),
          ...(plan.tools.includes("negotiate_offer") ? [{ type: "text" as const, text: `Pricing and negotiation (sample pricing in this preview, say so once): products ${PRICING_RULES.map(r => `${r.productId} (${r.product})`).join(", ")}; competitor offers in the store ${COMPETITOR_OFFERS.map(c => `${c.id} (${c.bank}, ${c.product})`).join(", ")}. Be upfront that you are Raiffeisen's assistant and will be straight about how the offers compare. Call get_approved_offers for the customer's price and negotiate_offer when they compare with another bank or ask for a better price; pass a store offerId only when it is that bank's offer, otherwise claimedBank. Present exactly the outcome: total cost first; a counter-offer only as returned, with its validity; for a specialist review, say the customer can ask for it on the card and never promise, hint at or estimate a price. Prices are indicative until the bank issues an offer. In a comparison, compare exactly the options the customer named: a counter-offer is the same Raiffeisen product at a better price, never an extra option. The chat shows the price card from the same result, so explain rather than list every line.` }] : []),
          ...(plan.tools.includes("get_holdings") ? [{ type: "text" as const, text: "The customer's products: when the answer depends on what they already hold at Raiffeisen (a loan's balance, rate or fixed-rate end, a deposit's maturity, a card's fee or limit, a pre-approved offer, or whether they can sign digitally), call get_holdings with the kinds you need. It is a sample customer in this preview: say so once. Cite each product's figures from its own result; if a kind is switched off, say it wasn't read and never assume they have none." }] : []),
          ...(plan.tools.includes("get_expense_summary") ? [{ type: "text" as const, text: "Account data: when the answer depends on the customer's own income, spending, payments or balances, call get_expense_summary (last_complete_month unless they ask about a longer stretch). It is a sample account in this preview: say so once, plainly. Cite its figures like any result and never name merchants or guess what it doesn't return. If it says nothing is connected or switched off, say so and answer from what the customer tells you; never ask them to switch something on just to answer. The chat shows a spending card from the same summary, so in the text explain what the figures mean rather than listing every category." }] : []),
          { type: "text" as const, text: `Answer cards: after searching and before your final text, call ${SHOW_CARDS_TOOL_NAME} once when a card helps the customer. Use "simulation" when the customer is weighing a loan and a cited result gives its interest rate (the rate and source only; the chat calculates). When the source gives a range, pass both ends (ratePercent and rateMaxPercent), never one end alone; if the rates belong to another product than the one asked about, say so in rateFor. Pass the customer's own amount, term, income and other monthly payments when they gave them, and a maximum debt ratio only when a cited result states it. Never say whether the customer is eligible. Use "comparison" when the customer names the options to compare (exactly those options), "routes" for a goal (at least three routes when the sources support them, one recommended; every route must fit the customer's stated purpose, so refinancing or consolidation appears only when the customer mentions existing loans), "keyFacts" for one product or term, "checklist" for documents or steps, and "handoff" only when a decision needs a person (eligibility, a complaint); the chat already offers a specialist where one is needed, so don't point to a button or suggest booking an adviser in the text. Put numbers only in facts, one figure per fact, each copied exactly from one search result with that result's URL as its source. A fact value is the figure with its unit in English, short ("9.52%", "2,906.42 lei a month", "up to 200,000 euro"), never a pasted Romanian phrase; put what it describes in the label ("Monthly payment, 50,000 lei over 18 months"). A payment and its APR are two facts; titles, summaries, fit and reasons stay free of numbers unless they repeat the customer's own figures. Never calculate, estimate or convert. Keep the final text to two or three sentences that frame the cards; don't repeat every fact. Skip the cards when the sources don't support them.${modelCards.length ? ` This question's pattern shows ${modelCards.map(k => CARD_NAMES[k]).join(" or ")}: call ${SHOW_CARDS_TOOL_NAME} with one whenever the cited results support it, including facts without numbers (who it's for, access, term, conditions) for a product explanation.` : ""}` },
          ...(plan.scope === "solution" ? [{ type: "text" as const, text: "Solution answer: search for and present at least three routes from the sources, including one without new borrowing when the sources support it, and say plainly if coverage is missing. The comparison calculator isn't connected, so recommend one route by fit (the customer's stated purpose, amount and term against the conditions in the sources), say why, and say when another route fits better. Never present the recommendation as an approval or a personal offer; the customer makes the final choice." }] : []),
          ...(euro ? [{ type: "text" as const, text: "The customer gave the amount in euro. No dated exchange rate is available, so never convert it. If the sources only show lei products, say so plainly, then use the same number in lei as a clearly labelled example (for example, 'a loan of 50,000 lei') to explain the routes, and say a Raiffeisen adviser can confirm whether a euro option exists." }] : []),
          ...(brief ? [{ type: "text" as const, text: `Customer inputs for this pattern (stated by the customer or defaulted; never bank terms): ${JSON.stringify(brief)}. Use them as the customer's scenario. You may repeat a figure the customer gave exactly as given, but never derive new figures from it. Name each defaulted input as an assumption. If examplesRequested is true, the customer skipped some required inputs: describe typical cases clearly labelled as examples and make no recommendation. For a missing optional input that would change the answer, say briefly what it would change.` }] : [])], tools, messages }),
      (r) => ({ stop: r.stop_reason, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens,
        toolCalls: r.content.filter(c => c.type === "tool_use").length }));
    },
    search: async raw => {
      if (!plan.collections.includes(raw.collection)) {
        t.step("search.denied", { collection: raw.collection, why: "collection not in the route", allowed: plan.collections });
        return unavailableResult(raw.collection, "collection_not_connected", raw.limit);
      }
      const remaining = plan.limits.publicChunks - seen.size;
      const reserved = pairedCollections.filter(c => c !== raw.collection && !searchedCollections.has(c)).length * 2;
      const available = remaining - reserved;
      if (available <= 0) {
        t.step("search.denied", { collection: raw.collection, why: "chunk budget used", remaining, reserved });
        return unavailableResult(raw.collection, "collection_not_connected", raw.limit);
      }
      const safe = { ...raw, query: screenChat(raw.query).text, limit: Math.min(raw.limit, available, perSearch) };
      t.step("search.call", { collection: safe.collection, limit: safe.limit, asked: raw.limit, budgetLeft: remaining, focus: (safe as { focus?: string }).focus, query: t.text(safe.query) });
      const result = await searchKnowledge(ctx, plan.track, safe, Date.now(), t);
      searchedCollections.add(raw.collection);
      const passages = result.passages.filter(p => !seen.has(p.passageId)).slice(0, safe.limit);
      passages.forEach(p => seen.add(p.passageId));
      t.step("search.done", { collection: safe.collection, status: result.status, returned: result.passages.length, new: passages.length,
        duplicates: result.passages.length - passages.length });
      await ctx.runMutation(internal.agent.progress, { messageId, step: { query: safe.query, focus: safe.collection, results: passages.length } });
      return { ...result, passages, coverage: { ...result.coverage, returned: passages.length } };
    },
    ...(affordability ? { calculate: async (data: CalculateScenarioInput) => {
      used.push({ name: "check_affordability" });
      const result = runCalculator(data, memory.customerTexts, await ctx.runQuery(internal.regulatoryLimits.affordabilityLimits, {}));
      t.step("affordability.done", { status: result.status });
      if (result.status === "ok") affordabilityCard = affordabilityBlock(result.content) ?? affordabilityCard;
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
  // Code-built cards (spending, price), only when the answer cites the result they come from.
  if (answer.status !== "answered") return answer;
  const cited = (url: string) => answer.sources.some(s => s.url === url);
  const card = spending as ReturnType<typeof spendingBlock>;
  const price = offer as OfferBlock | null;
  // Every comparison shows in the fixed rows: the catalog table with the model's facts in its gaps, or the facts alone
  const compared = comparisonBlock({ host: compareFromTool as CompareTable | null, cards: answer.cards ?? [], cited });
  const others = compared.block ? (answer.cards ?? []).filter(c => (c as { type?: unknown }).type !== "comparison") : answer.cards ?? [];
  const checkedAffordability = affordabilityCard as AffordabilityBlock | null;
  const built = [...(card && cited(card.sourceUrl) ? [card] : []), ...(price && cited(price.sourceUrl) ? [price] : []), ...(compared.block ? [compared.block] : []),
    ...(checkedAffordability ? [checkedAffordability] : [])];
  if (!built.length) return answer;
  t.step("cards.built", { types: built.map(b => b.type), comparisonsReplaced: compared.replaced });
  return { ...answer, cards: [...built, ...others], ...(needsTiming ? { needsTiming: true as const } : {}) };
}

const CARD_NAMES = { comparison: "a \"comparison\" card", routes: "a \"routes\" card", simulation: "a \"simulation\" card",
  keyFacts: "a \"keyFacts\" card", checklist: "a \"checklist\" card" } as const;

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

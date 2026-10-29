import type {
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { type SearchKnowledgeInput, searchKnowledgeInputSchema } from "../agent/prompt";
import { addCardSources, assembleCitations, type Citable, citableFromPassage, checkNumbers, type CitedSegment, citedSegments, type RagAnswer } from "./answer";
import type { SearchKnowledgeResult } from "./knowledge";
import { citableToSearchResult } from "./tools";
import {
  buildSystem,
  buildUserTurn,
  coverageNote,
  MAX_SEARCHES,
  RAG_PROMPT_VERSION,
  retryNoteForNumbers,
  searchAgainNote,
  SEARCH_TOOL,
  SEARCH_TOOL_NAME,
  toolErrorResult,
  toToolResult,
} from "./prompt";
import type { Track } from "./schemas";

/** Model calls per turn: searches, a search-again nudge, a final answer and one retry, plus a paused turn. */
const MAX_MODEL_CALLS = MAX_SEARCHES + 5;
const MAX_ANSWER_ATTEMPTS = 2;

export type ModelRequest = { system: BetaTextBlockParam[]; tools: BetaTool[]; messages: BetaMessageParam[] };

/** Side effects come in from the caller (Convex), so the loop itself stays pure and testable. */
export type AgentDeps = {
  createMessage: (request: ModelRequest) => Promise<BetaMessage>;
  /** The search_knowledge handler, already scoped to the session's track by the caller. */
  search: (input: SearchKnowledgeInput) => Promise<SearchKnowledgeResult>;
};

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type AgentInput = {
  question: string;
  track: Track;
  /** Earlier turns of the conversation as plain text (no citations), oldest first. */
  history?: readonly HistoryTurn[];
  model: string;
  allowedCollections?: readonly string[];
  /** Numbers the customer stated as inputs, which the answer may repeat (see checkNumbers). */
  customerFigures?: readonly string[];
  /** An optional presentation tool (answer cards). Its input is checked against the search results the model has seen. */
  cards?: CardsTool;
  /** Data tools run by the host (catalog terms, calculators). Their results are citable like search results. */
  hostTools?: readonly HostTool[];
  /**
   * Host tool calls made before the model's first turn (the catalog lookup for a catalog-shaped question). Each one is
   * shown to the model as its own earlier call with the results, so it reads the database before it searches.
   */
  preload?: readonly { tool: string; input: unknown }[];
};

/**
 * A host tool: the caller validates the input, authorizes it and runs it. What it returns as citables is shown to
 * the model as search_result blocks and joins the hits, so the answer cites it and the number check accepts its
 * figures; a note is plain text (gaps, what wasn't available) and is not citable.
 */
export type HostTool = {
  tool: BetaTool;
  run: (input: unknown, hits: readonly Citable[]) => Promise<{ citables: Citable[]; note?: string } | { error: string }>;
};

export type CardsTool = {
  tool: BetaTool;
  check: (input: unknown, hits: readonly Citable[]) => { ok: true; cards: unknown[]; urls: string[]; note: string } | { ok: false; error: string };
  /** Cards guessed from a checked answer when the model showed none; null when nothing fits or nothing is supported. */
  fallback?: (segments: readonly CitedSegment[], hits: readonly Citable[]) => { cards: unknown[]; urls: string[] } | null;
};

/**
 * Agentic RAG: Claude decides when and what to search, code runs each search scoped to the session's track,
 * the fragments go back as search_result blocks, and the final text is checked so every number is grounded.
 */
export async function runAgent({ question, track, history = [], model, allowedCollections, customerFigures = [], cards, hostTools = [], preload = [] }: AgentInput, deps: AgentDeps): Promise<RagAnswer> {
  const system = buildSystem(track);
  const tools = [allowedCollections ? { ...SEARCH_TOOL, input_schema: { ...SEARCH_TOOL.input_schema,
    properties: { ...(SEARCH_TOOL.input_schema.properties as Record<string, unknown>), collection: { type: "string", enum: [...allowedCollections] } } } } : SEARCH_TOOL,
    ...hostTools.map((h) => h.tool), ...(cards ? [cards.tool] : [])];
  // The last accepted cards: a later call replaces them.
  let shown: { cards: unknown[]; urls: string[] } | null = null;
  const messages: BetaMessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: buildUserTurn(question, history.length === 0) },
  ];
  // Every search_result block shown to the model, in request order: citations point into this list.
  const hits: Citable[] = [];
  const searches: RagAnswer["searches"] = [];
  let attempts = 0;
  let nudged = false;

  // Preloaded host calls: run now, shown as the model's own earlier tool call. A failed or empty one is left out.
  for (const [i, call] of preload.entries()) {
    const host = hostTools.find((h) => h.tool.name === call.tool);
    if (!host) continue;
    const ran = await host.run(call.input, hits).catch(() => null);
    if (!ran || "error" in ran || !ran.citables.length) continue;
    hits.push(...ran.citables);
    const id = `preload_${i + 1}`;
    messages.push({ role: "assistant", content: [{ type: "tool_use", id, name: call.tool, input: call.input as Record<string, unknown> }] });
    // A tool result with search_result blocks may hold only those (Anthropic API), so the note follows as a system message
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: ran.citables.map(citableToSearchResult) }] });
    if (ran.note) messages.push({ role: "system", content: `${call.tool}: ${ran.note}` });
  }

  const result = (fields: Pick<RagAnswer, "status" | "text" | "segments" | "sources" | "checks">): RagAnswer => ({
    ...fields,
    model,
    promptVersion: RAG_PROMPT_VERSION,
    searches,
    retrieval: hits.map((hit) => ({ chunkId: hit.chunkId, score: hit.score })),
    // Cards only travel with a checked answer, and their cited results join the source list.
    ...(shown && fields.status === "answered" ? { cards: shown.cards, sources: addCardSources(fields.sources, shown.urls, hits) } : {}),
  });

  for (let call = 0; call < MAX_MODEL_CALLS; call++) {
    const response = await deps.createMessage({ system, tools, messages });

    if (response.stop_reason === "refusal") {
      return result({
        status: "refused",
        text: "",
        segments: [],
        sources: [],
        checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: Math.max(attempts, 1) },
      });
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const toolUses = response.content.filter((block): block is BetaToolUseBlock => block.type === "tool_use");
      const toolResults: BetaToolResultBlockParam[] = [];
      const searchResults: SearchKnowledgeResult[] = [];
      const hostNotes: string[] = [];
      for (const toolUse of toolUses) {
        if (cards && toolUse.name === cards.tool.name) {
          const checked = cards.check(toolUse.input, hits);
          if (checked.ok) shown = { cards: checked.cards, urls: checked.urls };
          toolResults.push(checked.ok ? { type: "tool_result", tool_use_id: toolUse.id, content: checked.note }
            : toolErrorResult(toolUse.id, `The cards were not shown: ${checked.error}. Fix them and call ${cards.tool.name} again, or answer without cards.`));
          continue;
        }
        const host = hostTools.find((h) => h.tool.name === toolUse.name);
        if (host) {
          const ran = await host.run(toolUse.input, hits).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "tool failed" }));
          if ("error" in ran) { toolResults.push(toolErrorResult(toolUse.id, ran.error)); continue; }
          hits.push(...ran.citables);
          // Citable rows alone in the result (the API rejects search_result mixed with text); a note without rows is the result itself
          if (ran.citables.length) {
            toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: ran.citables.map(citableToSearchResult) });
            if (ran.note) hostNotes.push(`${toolUse.name}: ${ran.note}`);
          } else toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: ran.note ?? "No usable results." });
          continue;
        }
        const { block, result } = await runTool(toolUse, deps, hits, searches);
        toolResults.push(block);
        if (result) searchResults.push(result);
      }
      messages.push({ role: "user", content: toolResults });
      // Harness notes go in their own system message, never inside the citable tool results.
      const note = [coverageNote(searchResults), ...hostNotes.splice(0)].filter(Boolean).join("\n");
      if (note) messages.push({ role: "system", content: note });
      continue;
    }

    // A truncated or otherwise unfinished response is never a complete answer, even if its numbers pass.
    if (response.stop_reason !== "end_turn") {
      return result({
        status: "failed_checks",
        text: "",
        segments: [],
        sources: [],
        checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: Math.max(attempts, 1) },
      });
    }

    // Only end_turn is a completed answer candidate.
    const segments = citedSegments(response.content);
    // A single search that ran and ends in an uncited "not found" gets one more chance with other words.
    // An unavailable collection is not a miss: searching elsewhere would stand in for it.
    const cites = segments.some((segment) => segment.hitIndexes.length > 0);
    if (!cites && searches.length === 1 && searches[0]!.status === "ok" && !nudged) {
      nudged = true;
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: searchAgainNote() });
      continue;
    }
    attempts++;
    const checks = checkNumbers(segments, hits, question, customerFigures);
    const passed = checks.ungroundedNumbers.length === 0 && checks.uncitedSegmentsWithNumbers === 0
      && !checks.invalidCitationIndexes;
    if (!passed && attempts < MAX_ANSWER_ATTEMPTS) {
      messages.push({ role: "assistant", content: response.content });
      const retryNotes = [
        ...(checks.ungroundedNumbers.length ? [retryNoteForNumbers(checks.ungroundedNumbers)] : []),
        ...(checks.invalidCitationIndexes ? ["A previous draft cited unavailable search results. Cite only the search results supplied in this conversation."] : []),
      ];
      messages.push({ role: "user", content: retryNotes.join("\n") });
      continue;
    }
    const status = !passed ? "failed_checks" : hits.length ? "answered" : "no_results";
    if (status === "answered" && !shown && cards?.fallback) shown = cards.fallback(segments, hits);
    return result({ status, ...assembleCitations(segments, hits), checks: { ...checks, attempts } });
  }

  return result({
    status: "failed_checks",
    text: "",
    segments: [],
    sources: [],
    checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: Math.max(attempts, 1) },
  });
}

async function runTool(
  toolUse: BetaToolUseBlock,
  deps: AgentDeps,
  hits: Citable[],
  searches: RagAnswer["searches"],
): Promise<{ block: BetaToolResultBlockParam; result?: SearchKnowledgeResult }> {
  if (toolUse.name.toLowerCase() !== SEARCH_TOOL_NAME) {
    return { block: toolErrorResult(toolUse.id, `Unknown tool "${toolUse.name}". The only tool is ${SEARCH_TOOL_NAME}.`) };
  }
  const input = searchKnowledgeInputSchema.safeParse(toolUse.input);
  if (!input.success) {
    return { block: toolErrorResult(toolUse.id, `Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}`) };
  }
  if (searches.length >= MAX_SEARCHES) {
    return { block: toolErrorResult(toolUse.id, `Search limit of ${MAX_SEARCHES} reached. Answer with the results you already have.`) };
  }
  const result = await deps.search(input.data);
  searches.push({ query: input.data.query, collection: result.collection, status: result.status, results: result.passages.length });
  hits.push(...result.passages.map(citableFromPassage));
  return { block: toToolResult(toolUse.id, result), result };
}

import type {
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { assembleCitations, checkNumbers, citedSegments, type RagAnswer } from "./answer";
import {
  buildSystem,
  buildUserTurn,
  MAX_SEARCHES,
  RAG_PROMPT_VERSION,
  retryNoteForNumbers,
  searchAgainNote,
  SEARCH_TOOL,
  SEARCH_TOOL_NAME,
  searchToolInputSchema,
  type SearchToolInput,
  toolErrorResult,
  toToolResult,
} from "./prompt";
import type { SearchHit, Track } from "./schemas";

/** Model calls per turn: searches, a search-again nudge, a final answer and one retry, plus a paused turn. */
const MAX_MODEL_CALLS = MAX_SEARCHES + 5;
const MAX_ANSWER_ATTEMPTS = 2;

export type ModelRequest = { system: BetaTextBlockParam[]; tools: BetaTool[]; messages: BetaMessageParam[] };

/** Side effects come in from the caller (Convex), so the loop itself stays pure and testable. */
export type AgentDeps = {
  createMessage: (request: ModelRequest) => Promise<BetaMessage>;
  search: (input: SearchToolInput) => Promise<SearchHit[]>;
};

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type AgentInput = {
  question: string;
  track: Track;
  /** Earlier turns of the conversation as plain text (no citations), oldest first. */
  history?: readonly HistoryTurn[];
  model: string;
};

/**
 * Agentic RAG: Claude decides when and what to search, code runs each search scoped to the session's track,
 * the fragments go back as search_result blocks, and the final text is checked so every number is grounded.
 */
export async function runAgent({ question, track, history = [], model }: AgentInput, deps: AgentDeps): Promise<RagAnswer> {
  const system = buildSystem(track);
  const tools = [SEARCH_TOOL];
  const messages: BetaMessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: buildUserTurn(question, history.length === 0) },
  ];
  // Every search_result block shown to the model, in request order: citations point into this list.
  const hits: SearchHit[] = [];
  const searches: RagAnswer["searches"] = [];
  let attempts = 0;
  let nudged = false;

  const result = (fields: Pick<RagAnswer, "status" | "text" | "segments" | "sources" | "checks">): RagAnswer => ({
    ...fields,
    model,
    promptVersion: RAG_PROMPT_VERSION,
    searches,
    retrieval: hits.map((hit) => ({
      chunkId: hit.chunkId,
      score: hit.score,
      ...(hit.denseRank ? { denseRank: hit.denseRank } : {}),
      ...(hit.lexicalRank ? { lexicalRank: hit.lexicalRank } : {}),
    })),
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
      for (const toolUse of toolUses) {
        toolResults.push(await runTool(toolUse, deps, hits, searches));
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // end_turn or max_tokens: this is the answer.
    const segments = citedSegments(response.content);
    // A single search that ends in an uncited "not found" gets one more chance to search with other words.
    const cites = segments.some((segment) => segment.hitIndexes.length > 0);
    if (!cites && searches.length === 1 && !nudged) {
      nudged = true;
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: searchAgainNote() });
      continue;
    }
    attempts++;
    const checks = checkNumbers(segments, hits, question);
    const passed = checks.ungroundedNumbers.length === 0 && checks.uncitedSegmentsWithNumbers === 0;
    if (!passed && attempts < MAX_ANSWER_ATTEMPTS) {
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: retryNoteForNumbers(checks.ungroundedNumbers) });
      continue;
    }
    const status = !passed ? "failed_checks" : hits.length ? "answered" : "no_results";
    return result({ status, ...assembleCitations(segments, hits), checks: { ...checks, attempts } });
  }

  return result({
    status: "failed_checks",
    text: "",
    segments: [],
    sources: [],
    checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts },
  });
}

async function runTool(
  toolUse: BetaToolUseBlock,
  deps: AgentDeps,
  hits: SearchHit[],
  searches: RagAnswer["searches"],
): Promise<BetaToolResultBlockParam> {
  if (toolUse.name.toLowerCase() !== SEARCH_TOOL_NAME) {
    return toolErrorResult(toolUse.id, `Unknown tool "${toolUse.name}". The only tool is ${SEARCH_TOOL_NAME}.`);
  }
  const input = searchToolInputSchema.safeParse(toolUse.input);
  if (!input.success) {
    return toolErrorResult(toolUse.id, `Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}`);
  }
  if (searches.length >= MAX_SEARCHES) {
    return toolErrorResult(toolUse.id, `Search limit of ${MAX_SEARCHES} reached. Answer with the results you already have.`);
  }
  const found = await deps.search(input.data);
  searches.push({ query: input.data.query, focus: input.data.focus, results: found.length });
  hits.push(...found);
  return toToolResult(toolUse.id, found);
}

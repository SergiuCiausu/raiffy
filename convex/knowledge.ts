import type { ActionCtx } from "./_generated/server";
import { requireAgentScope } from "./agentAuth";
import { hybridSearch } from "./rag";
import { NO_TRACE, type Trace } from "./trace";
import { searchKnowledgeInputSchema } from "../lib/agent/prompt";
import {
  buildKnowledgeResult,
  candidateCount,
  isPublicCollection,
  type SearchKnowledgeResult,
  unavailableResult,
} from "../lib/rag/knowledge";
import type { Track } from "../lib/rag/schemas";

/**
 * The search_knowledge tool handler (contract: lib/agent/prompt.ts). The track comes from the caller's
 * authenticated session, never from the tool input, and the identity is checked before any provider call.
 * Private or unknown collections return unavailable and never fall back to another collection.
 */
export async function searchKnowledge(
  ctx: ActionCtx,
  track: Track,
  rawInput: unknown,
  now: number = Date.now(),
  t: Trace = NO_TRACE,
): Promise<SearchKnowledgeResult> {
  // Authenticate before answering anything, even "unavailable".
  await requireAgentScope(ctx, track);
  return searchKnowledgeForTrack(ctx, track, rawInput, now, t);
}

/** The same handler without the identity check. Internal callers only (the retrieval eval). */
export async function searchKnowledgeForTrack(
  ctx: ActionCtx,
  track: Track,
  rawInput: unknown,
  now: number = Date.now(),
  t: Trace = NO_TRACE,
): Promise<SearchKnowledgeResult> {
  const requested = typeof rawInput === "object" && rawInput !== null ? (rawInput as Record<string, unknown>) : {};
  if (typeof requested.collection === "string" && !isPublicCollection(requested.collection)) {
    const limit = typeof requested.limit === "number" ? requested.limit : 0;
    const reason = requested.collection === "user_memory" ? "collection_not_connected" : "unknown_collection";
    return unavailableResult(requested.collection, reason, limit);
  }
  const input = searchKnowledgeInputSchema.parse(rawInput);
  if (!isPublicCollection(input.collection)) return unavailableResult(input.collection, "collection_not_connected", input.limit);
  const hits = await hybridSearch(ctx, {
    question: input.query,
    track,
    collection: input.collection,
    k: candidateCount(input.limit),
  }, t);
  const result = buildKnowledgeResult({ collection: input.collection, query: input.query, limit: input.limit, hits, now });
  t.step("knowledge.result", { collection: input.collection, status: result.status, requested: result.coverage.requested,
    returned: result.coverage.returned, gaps: result.coverage.gaps });
  return result;
}

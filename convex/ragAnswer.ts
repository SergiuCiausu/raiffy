import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { assembleCitations, checkNumbers, citedSegments, type RagAnswer } from "../lib/rag/answer";
import { buildSystem, buildUserContent, RAG_PROMPT_VERSION, retryNoteForNumbers } from "../lib/rag/prompt";
import { searchChunks } from "./rag";

const MODEL = "claude-sonnet-5-5";
const MAX_ATTEMPTS = 2;

/** Grounded answer from the public product chunks, with citations and a deterministic number check. */
export const answer = action({
  args: {
    question: v.string(),
    track: v.union(v.literal("personal"), v.literal("business")),
    firstTurn: v.optional(v.boolean()),
    k: v.optional(v.number()),
  },
  handler: async (ctx, { question, track, firstTurn = false, k = 5 }): Promise<RagAnswer> => {
    const hits = await searchChunks(ctx, { question, track, k });
    const retrieval = hits.map((hit) => ({
      chunkId: hit.chunkId,
      score: hit.score,
      ...(hit.denseRank ? { denseRank: hit.denseRank } : {}),
      ...(hit.lexicalRank ? { lexicalRank: hit.lexicalRank } : {}),
    }));
    const base = { model: MODEL, promptVersion: RAG_PROMPT_VERSION, retrieval };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on this Convex deployment");
    const client = new Anthropic({ apiKey });

    let retryNotes: string[] = [];
    let last: RagAnswer | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: buildSystem(track),
        messages: [{ role: "user", content: buildUserContent({ question, hits, firstTurn, retryNotes }) }],
      });

      if (response.stop_reason === "refusal") {
        return {
          ...base,
          status: "refused",
          text: "",
          segments: [],
          sources: [],
          checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: attempt },
        };
      }

      const segments = citedSegments(response.content);
      const checks = checkNumbers(segments, hits, question);
      const assembled = assembleCitations(segments, hits);
      const passed = checks.ungroundedNumbers.length === 0 && checks.uncitedSegmentsWithNumbers === 0;
      last = {
        ...base,
        ...assembled,
        status: passed ? (hits.length ? "answered" : "no_results") : "failed_checks",
        checks: { ...checks, attempts: attempt },
      };
      if (passed) return last;
      retryNotes = [retryNoteForNumbers(checks.ungroundedNumbers)];
    }
    return last!;
  },
});

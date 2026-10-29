import { z } from "zod";

export const modelConfigSchema = z.object({
  id: z.string().min(1),
  effort: z.enum(["low", "medium", "high"]),
});

export const agentPolicySchema = z.object({
  version: z.string(),
  classifierModel: z.string(),
  standardModel: modelConfigSchema,
  complexModel: modelConfigSchema,
  escalationModel: modelConfigSchema,
  allowEscalation: z.boolean(),
  thresholds: z.object({
    routingConfidence: z.number().min(0).max(1),
    riskReviewProbability: z.number().min(0).max(1),
    multiGoalProbability: z.number().min(0).max(1),
    /** Minimum P(kind) × P(durable) before Claude may propose an unrequested memory. */
    memoryCandidate: z.number().min(0).max(1),
    /** At or above this, nothing from the message is proposed for memory. */
    specialCategoryProbability: z.number().min(0).max(1),
    /** Per-inquiry floor on Jev's normalized confidence; labels not listed use routingConfidence. */
    perInquiry: z.record(z.string(), z.number().min(0).max(1)),
    /** Route the top label when its probability leads the runner-up by at least this much. */
    routingMargin: z.number().min(0).max(1),
    /** Combined probability of the top two labels before Raiffy asks which of them the customer meant. */
    candidatePair: z.number().min(0).max(1),
    /** P(the message answers Raiffy's pending question) at or above which the conversation keeps its pattern. */
    answersPending: z.number().min(0).max(1),
    /** Jev's normalized confidence on an input choice before the Haiku fallback is asked. */
    slotConfidence: z.number().min(0).max(1),
  }),
  inputs: z.object({ maxFieldsPerRound: z.number().int().positive(), maxRounds: z.number().int().positive() }),
  /** Small model asked only when Jev cannot decide between labels or input choices. */
  fallbackModel: z.string(),
  retrieval: z.object({ maxPublicChunks: z.number().int().positive(), maxPublicChunksSolution: z.number().int().positive(), maxMemories: z.number().int().positive() }),
  /** calculate_scenario (lib/calc/scenario.ts): policy parameters, not product facts. */
  calculator: z.object({
    /** Below this total-cost gap (bani) a loan and an overdraft count as a tie, and the fixed schedule wins. */
    nearTieMarginBani: z.number().int().min(0),
    /** Added to a variable rate for the stress test shown next to it (calculations.md: +2 pp). */
    variableStressBps: z.number().int().min(0),
  }),
  /** compare_routes (lib/advice): which routes a solution answer shows. Policy parameters, not product facts. */
  advice: z.object({
    /** How long the save-first route saves before borrowing the rest. */
    saveFirstMonths: z.number().int().min(1).max(36),
    /** A save-only route longer than this isn't shown. */
    maxSaveOnlyMonths: z.number().int().min(1).max(120),
    /** Other terms of the chosen loan shown next to it, as offsets from the customer's term. */
    alternativeTermOffsetsMonths: z.array(z.number().int().min(-120).max(120)).max(2),
  }),
});
export type AgentPolicy = z.infer<typeof agentPolicySchema>;

/** Initial engineering settings, not thresholds calibrated on banking inquiries. */
export const AGENT_POLICY = agentPolicySchema.parse({
  version: "raiffy-agent@14",
  classifierModel: "jev-1.14.0",
  standardModel: { id: "claude-sonnet-5-5", effort: "low" },
  complexModel: { id: "claude-sonnet-5-5", effort: "medium" },
  escalationModel: { id: "claude-opus-5-5", effort: "medium" },
  allowEscalation: false,
  thresholds: { routingConfidence: 0.8, riskReviewProbability: 0.3, multiGoalProbability: 0.7, memoryCandidate: 0.6, specialCategoryProbability: 0.2,
    perInquiry: {}, routingMargin: 0.35, candidatePair: 0.75, answersPending: 0.5, slotConfidence: 0.6 },
  inputs: { maxFieldsPerRound: 3, maxRounds: 2 },
  fallbackModel: "claude-haiku-5-5",
  // A solution answer weighs at least three routes, about three passages each; detail and compare need fewer.
  retrieval: { maxPublicChunks: 5, maxPublicChunksSolution: 9, maxMemories: 3 },
  calculator: { nearTieMarginBani: 5_000, variableStressBps: 200 },
  advice: { saveFirstMonths: 8, maxSaveOnlyMonths: 24, alternativeTermOffsetsMonths: [-12] },
});

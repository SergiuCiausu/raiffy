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
  }),
  retrieval: z.object({ maxPublicChunks: z.number().int().positive(), maxMemories: z.number().int().positive() }),
});
export type AgentPolicy = z.infer<typeof agentPolicySchema>;

/** Initial engineering settings, not thresholds calibrated on banking inquiries. */
export const AGENT_POLICY = agentPolicySchema.parse({
  version: "raiffy-agent@2",
  classifierModel: "jev-1.14.0",
  standardModel: { id: "claude-sonnet-5-5", effort: "low" },
  complexModel: { id: "claude-sonnet-5-5", effort: "medium" },
  escalationModel: { id: "claude-opus-5-5", effort: "medium" },
  allowEscalation: false,
  thresholds: { routingConfidence: 0.8, riskReviewProbability: 0.3, multiGoalProbability: 0.7, memoryCandidate: 0.6, specialCategoryProbability: 0.2 },
  retrieval: { maxPublicChunks: 5, maxMemories: 3 },
});

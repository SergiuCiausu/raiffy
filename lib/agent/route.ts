import { z } from "zod";
import { trackSchema } from "../rag/schemas";
import { AGENT_POLICY, agentPolicySchema, modelConfigSchema, type AgentPolicy } from "./config";
import { INQUIRIES, jevResponseSchema, RISKS } from "./jev";
import { memoryCandidateSchema, scoreMemoryCandidate } from "./memory";
import { bankSchema } from "../rag/schemas";

export const COLLECTIONS = ["bank_product_docs", "competitor_docs", "banking_help", "user_memory"] as const;
export const TOOLS = ["search_knowledge", "get_product_terms", "get_expense_summary", "get_approved_offers", "calculate_scenario", "propose_memory_change", "manage_memory", "request_human_handoff"] as const;
type Collection = typeof COLLECTIONS[number];
type Tool = typeof TOOLS[number];
type Inquiry = keyof typeof INQUIRIES;

export const routeContextSchema = z.object({
  /** Set by the authenticated application session, never by Jev or customer text. */
  track: trackSchema,
  /** Capabilities actually wired on this deployment. Does not grant access to any user's records. */
  availableTools: z.array(z.enum(TOOLS)),
  availableCollections: z.array(z.enum(COLLECTIONS)),
  requestedBanks: z.array(bankSchema).optional(),
});
export type RouteContext = z.infer<typeof routeContextSchema>;

export const routePlanSchema = z.object({
  policyVersion: z.string(),
  classifierModel: z.string().nullable(),
  handler: z.enum(["answer", "orchestrator", "clarify", "crisis", "fraud", "hardship", "safe_boundary", "professional_referral", "memory", "unavailable"]),
  reason: z.string(),
  inquiry: z.enum(Object.keys(INQUIRIES) as [Inquiry, ...Inquiry[]]).nullable(),
  memoryOperation: z.enum(["none", "remember", "update", "forget", "inspect"]).nullable(),
  /** Something the customer stated that Claude may propose for memory alongside the answer. */
  memoryCandidate: memoryCandidateSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  scope: z.enum(["compare", "solution", "detail"]).nullable(),
  track: trackSchema,
  suppressOffers: z.boolean(),
  model: modelConfigSchema.nullable(),
  collections: z.array(z.enum(COLLECTIONS)),
  tools: z.array(z.enum(TOOLS)),
  unavailable: z.array(z.string()),
  limits: z.object({ publicChunks: z.number().int(), memories: z.number().int() }),
});
export type RoutePlan = z.infer<typeof routePlanSchema>;

const RESOURCES: Record<Inquiry, { collections: Collection[]; tools: Tool[] }> = {
  purchase_goal: { collections: ["bank_product_docs", "user_memory"], tools: ["get_product_terms", "get_expense_summary", "calculate_scenario"] },
  product_comparison: { collections: ["bank_product_docs", "competitor_docs", "user_memory"], tools: ["get_product_terms", "calculate_scenario"] },
  affordability: { collections: ["bank_product_docs", "user_memory"], tools: ["get_expense_summary", "get_product_terms", "calculate_scenario"] },
  debt_refinancing: { collections: ["bank_product_docs", "user_memory"], tools: ["get_expense_summary", "get_product_terms", "calculate_scenario"] },
  saving_goal: { collections: ["bank_product_docs", "user_memory"], tools: ["get_expense_summary", "get_product_terms", "calculate_scenario"] },
  product_explanation: { collections: ["bank_product_docs", "banking_help"], tools: [] },
  fees_statements: { collections: ["bank_product_docs"], tools: ["get_product_terms", "get_expense_summary"] },
  life_event: { collections: ["bank_product_docs", "user_memory"], tools: ["get_expense_summary", "get_product_terms", "calculate_scenario"] },
  cash_shortfall: { collections: ["bank_product_docs", "user_memory"], tools: ["get_expense_summary", "get_product_terms", "calculate_scenario"] },
  security_complaint: { collections: [], tools: ["request_human_handoff"] },
  negotiation: { collections: ["bank_product_docs", "competitor_docs", "user_memory"], tools: ["get_product_terms", "get_approved_offers", "calculate_scenario", "request_human_handoff"] },
  expense_insights: { collections: ["user_memory"], tools: ["get_expense_summary"] },
  professional_advice: { collections: [], tools: ["request_human_handoff"] },
  other: { collections: [], tools: [] },
};

/** A retrieval plan is a cost and workflow hint. The tool adapter must independently authorize every call. */
export function planAgentRoute(rawResponse: unknown, rawContext: RouteContext, rawPolicy: AgentPolicy = AGENT_POLICY): RoutePlan {
  const context = routeContextSchema.parse(rawContext);
  const policy = agentPolicySchema.parse(rawPolicy);
  const parsed = jevResponseSchema.safeParse(rawResponse);
  const base: RoutePlan = {
    policyVersion: policy.version, classifierModel: parsed.success ? parsed.data.model : null,
    handler: "unavailable", reason: "invalid_classifier_response", inquiry: null, memoryOperation: null, memoryCandidate: null, confidence: null, scope: null,
    track: context.track, suppressOffers: true, model: null, collections: [], tools: [], unavailable: [],
    limits: { publicChunks: policy.retrieval.maxPublicChunks, memories: policy.retrieval.maxMemories },
  };
  if (!parsed.success) return routePlanSchema.parse(base);
  const a = parsed.data.answers;
  const inquiry = a.inquiry.choice;
  const plan = { ...base, inquiry, memoryOperation: a.memory_operation.choice, confidence: a.inquiry.confidence, scope: a.scope.choice };
  const finish = (changes: Partial<RoutePlan>) => routePlanSchema.parse({ ...plan, ...changes });

  // Risks are independent. A customer may be negotiating and in distress in the same message.
  for (const risk of RISKS) {
    if (a[risk].noul >= policy.thresholds.riskReviewProbability) {
      const handler = risk === "aml_evasion" || risk === "prompt_injection" ? "safe_boundary" : risk;
      return finish({ handler, reason: `risk_${risk}` });
    }
  }
  if (parsed.data.model !== policy.classifierModel) return finish({ reason: "unexpected_classifier_version" });
  const floor = policy.thresholds.routingConfidence;
  if (a.inquiry.confidence < floor || a.scope.confidence < floor || a.complexity.confidence < floor) {
    return finish({ handler: "clarify", reason: "low_route_confidence" });
  }
  if (a.audience.choice !== "unclear" && (a.audience.confidence < floor || a.audience.choice !== context.track)) {
    return finish({ handler: "clarify", reason: "confirm_track_before_access" });
  }
  if (a.memory_operation.confidence < floor) return finish({ handler: "clarify", reason: "uncertain_memory_request" });
  if (a.memory_operation.choice !== "none") {
    const tool: Tool = ["forget", "inspect"].includes(a.memory_operation.choice) ? "manage_memory" : "propose_memory_change";
    const available = context.availableTools.includes(tool);
    return finish({ handler: available ? "memory" : "unavailable", reason: "explicit_memory_request", tools: available ? [tool] : [], unavailable: available ? [] : [tool] });
  }
  if (inquiry === "other") return finish({ handler: "clarify", reason: "unknown_inquiry" });
  if (inquiry === "professional_advice") return finish({ handler: "professional_referral", reason: "regulated_advice_referral" });
  const multi = a.multi_goal.noul;
  if (multi > 1 - policy.thresholds.multiGoalProbability && multi < policy.thresholds.multiGoalProbability) {
    return finish({ handler: "clarify", reason: "uncertain_goal_count" });
  }
  const multiGoal = multi >= policy.thresholds.multiGoalProbability;
  const complex = multiGoal || a.complexity.choice === "complex";
  const defaultResources = RESOURCES[inquiry];
  const competitorOnly = context.requestedBanks?.length && context.requestedBanks.every(bank => bank !== "raiffeisen");
  const resources = competitorOnly ? { ...defaultResources,
    collections: [...new Set(defaultResources.collections.map(id => id === "bank_product_docs" || id === "banking_help" ? "competitor_docs" as const : id))] } : defaultResources;
  const collections = context.availableTools.includes("search_knowledge")
    ? resources.collections.filter((id) => context.availableCollections.includes(id)) : [];
  const requestedTools = [...new Set<Tool>([...resources.tools, ...(resources.collections.some((id) => context.availableCollections.includes(id)) ? ["search_knowledge" as const] : [])])];
  const tools = requestedTools.filter((id) => context.availableTools.includes(id));
  const unavailable = [...resources.collections.filter((id) => !collections.includes(id)), ...requestedTools.filter((id) => !tools.includes(id))];
  // A stated goal, preference, constraint or figure adds a proposal tool to the answer; it never changes the handler.
  const memoryCandidate = tools.length ? scoreMemoryCandidate(a, policy) : null;
  const canPropose = memoryCandidate !== null && context.availableTools.includes("propose_memory_change");
  return finish({
    handler: tools.length ? (complex ? "orchestrator" : "answer") : "unavailable", reason: multiGoal ? "multiple_goals" : "classified",
    suppressOffers: inquiry === "security_complaint",
    model: !tools.length ? null : complex ? (policy.allowEscalation ? policy.escalationModel : policy.complexModel) : policy.standardModel,
    memoryCandidate,
    collections,
    tools: canPropose ? [...tools, "propose_memory_change"] : tools,
    unavailable: memoryCandidate && !canPropose ? [...unavailable, "propose_memory_change"] : unavailable,
  });
}

import { z } from "zod";
import { trackSchema } from "../rag/schemas";
import { AGENT_POLICY, agentPolicySchema, modelConfigSchema, type AgentPolicy } from "./config";
import { INQUIRIES, jevResponseSchema, RISKS } from "./jev";
import { memoryCandidateSchema, scoreMemoryCandidate } from "./memory";
import { bankSchema } from "../rag/schemas";
import { decideInquiry, defaultScope, inquirySchema, topInquiries } from "./confidence";
import { sharesRequiredInputs } from "./inputs";

export const COLLECTIONS = ["bank_product_docs", "competitor_docs", "banking_help", "user_memory"] as const;
export const TOOLS = ["search_knowledge", "query_catalog", "get_product_terms", "get_expense_summary", "get_holdings", "get_approved_offers", "negotiate_offer", "calculate_scenario", "check_affordability", "propose_memory_change", "manage_memory", "request_human_handoff"] as const;
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
  /** Patterns the message clearly asks about by keyword (bankingIntent). Only consulted when Jev answers "other". */
  intentHints: z.array(inquirySchema).optional(),
});
export type RouteContext = z.infer<typeof routeContextSchema>;

export const routePlanSchema = z.object({
  policyVersion: z.string(),
  classifierModel: z.string().nullable(),
  handler: z.enum(["answer", "orchestrator", "clarify", "collect_inputs", "crisis", "fraud", "hardship", "safe_boundary", "professional_referral", "human_contact", "memory", "unavailable"]),
  reason: z.string(),
  inquiry: z.enum(Object.keys(INQUIRIES) as [Inquiry, ...Inquiry[]]).nullable(),
  memoryOperation: z.enum(["none", "remember", "update", "forget", "inspect"]).nullable(),
  /** Something the customer stated that Claude may propose for memory alongside the answer. */
  memoryCandidate: memoryCandidateSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  /** Why this pattern was chosen: Jev's confidence or margin, shared inputs, the conversation's pending question, a tapped choice or the fallback model. */
  routingBasis: z.enum(["confidence", "margin", "shared_inputs", "pending", "choice", "fallback"]).nullable(),
  /** Patterns Raiffy may offer as choices when it could not decide. */
  candidates: z.array(inquirySchema),
  scope: z.enum(["compare", "solution", "detail", "list"]).nullable(),
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
  purchase_goal: { collections: ["bank_product_docs", "user_memory"], tools: ["query_catalog", "get_product_terms", "get_expense_summary", "get_holdings", "calculate_scenario", "check_affordability"] },
  product_comparison: { collections: ["bank_product_docs", "competitor_docs", "user_memory"], tools: ["query_catalog", "get_product_terms", "calculate_scenario", "get_approved_offers", "negotiate_offer"] },
  affordability: { collections: ["bank_product_docs", "user_memory"], tools: ["query_catalog", "get_expense_summary", "get_holdings", "get_product_terms", "calculate_scenario", "check_affordability"] },
  debt_refinancing: { collections: ["bank_product_docs", "user_memory"], tools: ["query_catalog", "get_expense_summary", "get_holdings", "get_product_terms", "calculate_scenario"] },
  saving_goal: { collections: ["bank_product_docs", "user_memory"], tools: ["query_catalog", "get_expense_summary", "get_holdings", "get_product_terms", "calculate_scenario"] },
  product_explanation: { collections: ["bank_product_docs", "banking_help"], tools: ["query_catalog", "get_holdings"] },
  listing: { collections: ["bank_product_docs", "banking_help"], tools: ["query_catalog"] },
  fees_statements: { collections: ["bank_product_docs"], tools: ["query_catalog", "get_product_terms", "get_expense_summary", "get_holdings"] },
  life_event: { collections: ["bank_product_docs", "user_memory"], tools: ["query_catalog", "get_expense_summary", "get_holdings", "get_product_terms", "calculate_scenario"] },
  cash_shortfall: { collections: ["bank_product_docs", "user_memory"], tools: ["query_catalog", "get_expense_summary", "get_holdings", "get_product_terms", "calculate_scenario"] },
  security_complaint: { collections: [], tools: ["request_human_handoff"] },
  negotiation: { collections: ["bank_product_docs", "competitor_docs", "user_memory"], tools: ["query_catalog", "get_holdings", "get_product_terms", "get_approved_offers", "negotiate_offer", "calculate_scenario", "request_human_handoff"] },
  expense_insights: { collections: ["user_memory"], tools: ["get_expense_summary", "get_holdings"] },
  professional_advice: { collections: [], tools: ["request_human_handoff"] },
  human_contact: { collections: [], tools: ["request_human_handoff"] },
  other: { collections: [], tools: [] },
};

export type RouteOptions = {
  /** A pattern settled outside Jev's inquiry label: the conversation's pending question, a tapped choice or the fallback model. Risk checks still run first. */
  inquiry?: Inquiry; basis?: "pending" | "choice" | "fallback";
};

/** A retrieval plan is a cost and workflow hint. The tool adapter must independently authorize every call. */
export function planAgentRoute(rawResponse: unknown, rawContext: RouteContext, rawPolicy: AgentPolicy = AGENT_POLICY, options: RouteOptions = {}): RoutePlan {
  const context = routeContextSchema.parse(rawContext);
  const policy = agentPolicySchema.parse(rawPolicy);
  const parsed = jevResponseSchema.safeParse(rawResponse);
  const base: RoutePlan = {
    policyVersion: policy.version, classifierModel: parsed.success ? parsed.data.model : null,
    handler: "unavailable", reason: "invalid_classifier_response", inquiry: null, memoryOperation: null, memoryCandidate: null, confidence: null,
    routingBasis: null, candidates: [], scope: null,
    track: context.track, suppressOffers: true, model: null, collections: [], tools: [], unavailable: [],
    limits: { publicChunks: policy.retrieval.maxPublicChunks, memories: policy.retrieval.maxMemories },
  };
  if (!parsed.success) return routePlanSchema.parse(base);
  const a = parsed.data.answers;
  const plan = { ...base, inquiry: a.inquiry.choice, memoryOperation: a.memory_operation.choice, confidence: a.inquiry.confidence, scope: a.scope.choice };
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
  // Only the pattern needs confidence. An unsure scope follows from the pattern and an unsure complexity costs a stronger model, not a wrong answer.
  const decision = options.inquiry ? { kind: "route" as const, inquiry: options.inquiry, basis: options.basis ?? "choice" }
    : decideInquiry(a.inquiry, policy, sharesRequiredInputs);
  // A plain request for a person ("book a meeting with an adviser") gets the fixed contact answer, also when Jev
  // splits it across patterns: the answer makes no model call and offers nothing, so a keyword is enough.
  const wantsPerson = !options.inquiry && (context.intentHints ?? []).includes("human_contact");
  if (wantsPerson && (decision.kind !== "route" || decision.inquiry === "other")) {
    return finish({ handler: "human_contact", inquiry: "human_contact", reason: "human_contact_requested", candidates: [] });
  }
  // A memory request ("what do you remember about me?") names no banking pattern, so it is decided before the pattern is.
  if (a.memory_operation.choice !== "none") {
    const tool: Tool = ["forget", "inspect"].includes(a.memory_operation.choice) ? "manage_memory" : "propose_memory_change";
    // Without the handler the customer hears that memory is off; with it, an uncertain request is confirmed before any change.
    if (!context.availableTools.includes(tool)) return finish({ handler: "unavailable", reason: "explicit_memory_request", unavailable: [tool] });
    if (a.memory_operation.confidence < floor) return finish({ handler: "clarify", reason: "uncertain_memory_request" });
    // "Remember that…" goes to Claude with only the proposal tool; the customer still confirms in the app.
    if (tool === "propose_memory_change") return finish({ handler: "answer", reason: "explicit_memory_request", model: policy.standardModel, tools: [tool] });
    return finish({ handler: "memory", reason: "explicit_memory_request", tools: [tool] });
  }
  if (decision.kind !== "route") {
    return finish({ handler: "clarify", inquiry: null, reason: decision.kind === "candidates" ? "ambiguous_inquiry" : "low_route_confidence", candidates: decision.candidates });
  }
  const inquiry = decision.inquiry;
  const scope = a.scope.confidence >= floor ? a.scope.choice : defaultScope(inquiry, (context.requestedBanks?.length ?? 0) > 1);
  Object.assign(plan, { inquiry, scope, routingBasis: decision.basis, confidence: inquiry === a.inquiry.choice ? a.inquiry.confidence : null,
    limits: { ...plan.limits, publicChunks: scope === "solution" ? policy.retrieval.maxPublicChunksSolution : policy.retrieval.maxPublicChunks } });
  // The audience label never stops the chat or changes access: the customer is answered on their own signed-in track
  // (personal for every account today). A message that sounds like a business still gets the personal answer.
  if (inquiry === "other" && !options.inquiry) {
    // "other" is a dead end only when the message asks nothing recognisable. A clear banking request ("a credit of 50k")
    // goes to the fallback model and then to chips; either way the customer gets choices, not the open question.
    const hinted = context.intentHints ?? [];
    const candidates = [...new Set([...hinted, ...topInquiries(a.inquiry.probabilities)])].slice(0, 3);
    return finish({ handler: "clarify", inquiry: null, reason: hinted.length ? "ambiguous_inquiry" : "unknown_inquiry", candidates });
  }
  if (inquiry === "professional_advice") return finish({ handler: "professional_referral", reason: "regulated_advice_referral" });
  if (inquiry === "human_contact") return finish({ handler: "human_contact", reason: "human_contact_requested" });
  const multi = a.multi_goal.noul;
  const multiGoal = multi >= policy.thresholds.multiGoalProbability;
  // An uncertain goal count gets the stronger model rather than a clarifying question.
  const uncertainGoals = !multiGoal && multi > 1 - policy.thresholds.multiGoalProbability;
  const complex = multiGoal || uncertainGoals || a.complexity.choice === "complex" || a.complexity.confidence < floor;
  const defaultResources = RESOURCES[inquiry];
  const competitorOnly = context.requestedBanks?.length && context.requestedBanks.every(bank => bank !== "raiffeisen");
  const resources = competitorOnly ? { ...defaultResources,
    collections: [...new Set(defaultResources.collections.map(id => id === "bank_product_docs" || id === "banking_help" ? "competitor_docs" as const : id))] } : defaultResources;
  const collections = context.availableTools.includes("search_knowledge")
    ? resources.collections.filter((id) => context.availableCollections.includes(id)) : [];
  const requestedTools = [...new Set<Tool>([...resources.tools, ...(resources.collections.some((id) => context.availableCollections.includes(id)) ? ["search_knowledge" as const] : [])])];
  const tools = requestedTools.filter((id) => context.availableTools.includes(id));
  const unavailable = [...resources.collections.filter((id) => !collections.includes(id)), ...requestedTools.filter((id) => !tools.includes(id))];
  // Where proposals are possible, every answer may propose a memory, and the customer confirms each one. Jev's
  // single-choice candidate splits its probability when a message states several things (a goal, a figure and a
  // preference), so its score ranks proposals but doesn't gate them. Special-category messages never get the tool.
  const memoryCandidate = tools.length ? scoreMemoryCandidate(a, policy) : null;
  const canPropose = tools.length > 0 && a.special_category.noul < policy.thresholds.specialCategoryProbability
    && context.availableTools.includes("propose_memory_change");
  return finish({
    handler: tools.length ? (complex ? "orchestrator" : "answer") : "unavailable",
    reason: multiGoal ? "multiple_goals" : uncertainGoals ? "uncertain_goal_count" : "classified",
    inquiry,
    suppressOffers: inquiry === "security_complaint",
    model: !tools.length ? null : complex ? (policy.allowEscalation ? policy.escalationModel : policy.complexModel) : policy.standardModel,
    memoryCandidate,
    collections,
    tools: canPropose ? [...tools, "propose_memory_change"] : tools,
    unavailable: memoryCandidate && !canPropose ? [...unavailable, "propose_memory_change"] : unavailable,
  });
}

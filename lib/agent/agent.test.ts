import { describe, expect, it } from "vitest";
import { AGENT_POLICY } from "./config";
import { AUDIENCES, buildJevRequest, COMPLEXITIES, INQUIRIES, jevResponseSchema, MEMORY_CANDIDATES, MEMORY_OPERATIONS, SCOPES } from "./jev";
import { memoryProposalSchema, scoreMemoryCandidate, selectUserMemories } from "./memory";
import { AGENT_TOOLS } from "./prompt";
import { COLLECTIONS, planAgentRoute, TOOLS, type RouteContext } from "./route";

function choice<T extends Record<string, string>>(criteria: T, selected: keyof T & string, confidence = 0.95) {
  const labels = Object.keys(criteria);
  const top = confidence * (1 - 1 / labels.length) + 1 / labels.length;
  return {
    type: "choice" as const, choice: selected, confidence,
    probabilities: Object.fromEntries(labels.map((label) => [label, label === selected ? top : (1 - top) / (labels.length - 1)])),
  };
}
function response() {
  return {
    model: "jev-1.14.0",
    answers: {
      inquiry: choice(INQUIRIES, "negotiation"), scope: choice(SCOPES, "compare"),
      complexity: choice(COMPLEXITIES, "complex"), audience: choice(AUDIENCES, "personal"),
      memory_operation: choice(MEMORY_OPERATIONS, "none"), memory_candidate: choice(MEMORY_CANDIDATES, "none"),
      memory_durable: { type: "noul", noul: 0.1 }, special_category: { type: "noul", noul: 0.01 },
      multi_goal: { type: "noul", noul: 0.05 }, crisis: { type: "noul", noul: 0.01 },
      fraud: { type: "noul", noul: 0.01 }, hardship: { type: "noul", noul: 0.01 },
      aml_evasion: { type: "noul", noul: 0.01 }, prompt_injection: { type: "noul", noul: 0.01 },
    },
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}
const full: RouteContext = { track: "personal", availableTools: [...TOOLS], availableCollections: [...COLLECTIONS] };

describe("Jev request and provider validation", () => {
  it("asks independent risk and routing questions in one request with bounded state", () => {
    const request = buildJevRequest({ message: "Can you match their offer?" });
    expect(request.model).toBe("jev-1.14.0");
    expect(request.state).toEqual({ message: "Can you match their offer?", recentContext: "" });
    expect(request.questions.inquiry.type).toBe("choice");
    expect(request.questions).toHaveProperty("hardship.type", "noul");
    expect(request.questions.memory_candidate.criteria).toEqual(MEMORY_CANDIDATES);
    expect(request.questions).toHaveProperty("memory_durable.type", "noul");
    expect(request.questions).toHaveProperty("special_category.type", "noul");
    expect(() => buildJevRequest({ message: "x".repeat(4001) })).toThrow();
  });

  it("rejects missing risk signals, impossible distributions and invented labels", () => {
    const valid = response();
    expect(jevResponseSchema.safeParse(valid).success).toBe(true);
    expect(jevResponseSchema.safeParse({ ...valid, answers: { ...valid.answers, fraud: undefined } }).success).toBe(false);
    expect(jevResponseSchema.safeParse({ ...valid, answers: { ...valid.answers, inquiry: { ...valid.answers.inquiry, choice: "approve_credit" } } }).success).toBe(false);
    valid.answers.inquiry.probabilities = { negotiation: 0.9 };
    expect(jevResponseSchema.safeParse(valid).success).toBe(false);
  });

  it("rejects confidence inconsistent with the configured distribution", () => {
    const raw = response();
    raw.answers.inquiry = { ...choice(INQUIRIES, "negotiation", 0.1), confidence: 0.99 };
    expect(jevResponseSchema.safeParse(raw).success).toBe(false);
  });
});

describe("backend route policy", () => {
  it("routes negotiation to verified terms, authorized offers and bounded retrieval", () => {
    const plan = planAgentRoute(response(), full);
    expect(plan.handler).toBe("orchestrator");
    expect(plan.collections).toContain("competitor_docs");
    expect(plan.tools).toEqual(expect.arrayContaining(["get_product_terms", "get_approved_offers"]));
    expect(plan.model).toEqual(AGENT_POLICY.complexModel);
    expect(plan.limits).toEqual({ publicChunks: 5, memories: 3 });
  });

  it("records missing competitors and personal tools instead of pretending they exist", () => {
    const plan = planAgentRoute(response(), { track: "personal", availableTools: ["search_knowledge"], availableCollections: ["bank_product_docs"] });
    expect(plan.collections).toEqual(["bank_product_docs"]);
    expect(plan.tools).toEqual(["search_knowledge"]);
    expect(plan.unavailable).toEqual(expect.arrayContaining(["competitor_docs", "user_memory", "get_approved_offers"]));
  });

  it.each(["crisis", "fraud", "hardship", "aml_evasion", "prompt_injection"] as const)("lets %s override a confident negotiation", (risk) => {
    const raw = response(); raw.answers[risk].noul = 0.31;
    const plan = planAgentRoute(raw, full);
    expect(plan.handler).toBe(["aml_evasion", "prompt_injection"].includes(risk) ? "safe_boundary" : risk);
    expect(plan.suppressOffers).toBe(true);
    expect(plan.model).toBeNull();
    expect(plan.collections).toEqual([]);
    expect(plan.tools).toEqual([]);
  });

  it("clarifies low confidence without paying for a generation call", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "negotiation", 0.5);
    const plan = planAgentRoute(raw, full);
    expect(plan.handler).toBe("clarify"); expect(plan.model).toBeNull(); expect(plan.collections).toEqual([]);
  });

  it("never switches the authorized track from a classifier label", () => {
    const raw = response(); raw.answers.audience = choice(AUDIENCES, "business");
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "clarify", reason: "confirm_track_before_access", track: "personal", collections: [] });
  });

  it("routes multiple goals through orchestration and only opts into Opus by policy", () => {
    const raw = response(); raw.answers.multi_goal.noul = 0.95;
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "orchestrator", reason: "multiple_goals", model: AGENT_POLICY.complexModel });
    expect(planAgentRoute(raw, full, { ...AGENT_POLICY, allowEscalation: true }).model).toEqual(AGENT_POLICY.escalationModel);
    raw.answers.multi_goal.noul = 0.5;
    expect(planAgentRoute(raw, full).handler).toBe("clarify");
  });

  it("returns unavailable on malformed responses or unreviewed model changes", () => {
    expect(planAgentRoute({}, full)).toMatchObject({ handler: "unavailable", reason: "invalid_classifier_response", model: null });
    const raw = response(); raw.model = "jev-unreviewed";
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "unavailable", reason: "unexpected_classifier_version", model: null });
  });

  it("keeps memory operations out of generation and disables them when handlers are absent", () => {
    const raw = response(); raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "remember");
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "memory", tools: ["propose_memory_change"], model: null });
    expect(planAgentRoute(raw, { ...full, availableTools: [] })).toMatchObject({ handler: "unavailable", tools: [], unavailable: ["propose_memory_change"] });
  });

  it("does not use a product document to fabricate an expense analysis", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "expense_insights");
    const plan = planAgentRoute(raw, { track: "personal", availableTools: ["search_knowledge"], availableCollections: ["bank_product_docs"] });
    expect(plan.handler).toBe("unavailable"); expect(plan.collections).toEqual([]); expect(plan.model).toBeNull();
  });

  it("does not expose collections when the search adapter is unavailable", () => {
    const plan = planAgentRoute(response(), { ...full, availableTools: ["get_product_terms"] });
    expect(plan.collections).toEqual([]);
    expect(plan.unavailable).toContain("search_knowledge");
  });
});

describe("memory candidates from Jev", () => {
  function stated(kind: keyof typeof MEMORY_CANDIDATES, durable = 0.9) {
    const raw = response();
    raw.answers.memory_candidate = choice(MEMORY_CANDIDATES, kind);
    raw.answers.memory_durable.noul = durable;
    return raw;
  }

  it("adds a proposal tool to the answer without changing the handler or model", () => {
    const plan = planAgentRoute(stated("goal"), full);
    expect(plan).toMatchObject({ handler: "orchestrator", model: AGENT_POLICY.complexModel, memoryCandidate: { kind: "goal" } });
    expect(plan.memoryCandidate!.score).toBeCloseTo(0.96 * 0.9);
    expect(plan.tools).toContain("propose_memory_change");
    expect(plan.tools).toContain("get_approved_offers");
  });

  it("ignores statements that only matter for this question", () => {
    const plan = planAgentRoute(stated("stated_financial", 0.3), full);
    expect(plan.memoryCandidate).toBeNull();
    expect(plan.tools).not.toContain("propose_memory_change");
  });

  it("never proposes from special-category, risky or explicitly handled messages", () => {
    const sensitive = stated("goal"); sensitive.answers.special_category.noul = 0.2;
    expect(scoreMemoryCandidate(jevResponseSchema.parse(sensitive).answers)).toBeNull();
    const hardship = stated("goal"); hardship.answers.hardship.noul = 0.31;
    expect(scoreMemoryCandidate(jevResponseSchema.parse(hardship).answers)).toBeNull();
    expect(planAgentRoute(hardship, full)).toMatchObject({ handler: "hardship", memoryCandidate: null, tools: [] });
    const explicit = stated("goal"); explicit.answers.memory_operation = choice(MEMORY_OPERATIONS, "remember");
    expect(planAgentRoute(explicit, full)).toMatchObject({ handler: "memory", memoryCandidate: null, tools: ["propose_memory_change"] });
  });

  it("records the proposal tool as unavailable instead of dropping the candidate silently", () => {
    const plan = planAgentRoute(stated("constraint"), { ...full, availableTools: full.availableTools.filter((t) => t !== "propose_memory_change") });
    expect(plan.handler).toBe("orchestrator");
    expect(plan.memoryCandidate).toMatchObject({ kind: "constraint" });
    expect(plan.tools).not.toContain("propose_memory_change");
    expect(plan.unavailable).toContain("propose_memory_change");
  });
});

describe("user memory boundaries", () => {
  const now = 2000;
  const record = {
    id: "m1", ownerKey: "user-a", track: "personal", organizationKey: null, kind: "preference",
    text: "Prefers concise explanations.", sourceMessageId: "msg1", consentEventId: "consent1",
    status: "active", updatedAt: 1000, expiresAt: 3000,
  };
  const scope = { ownerKey: "user-a", track: "personal" as const, organizationKey: null };

  it("removes another user, expired, deleted, unconsented and future records before model context", () => {
    const selected = selectUserMemories({ scope, now, records: [
      record, { ...record, ownerKey: "user-b" }, { ...record, expiresAt: now },
      { ...record, status: "deleted" }, { ...record, consentEventId: "" }, { ...record, updatedAt: 2500 },
    ] });
    expect(selected).toEqual([{ id: "m1", kind: "preference", text: record.text, updatedAt: 1000, expiresAt: 3000 }]);
    expect(selected[0]).not.toHaveProperty("ownerKey");
  });

  it("keeps personal, business and organization scopes separate", () => {
    const business = { ...record, track: "business", organizationKey: "org1" };
    expect(selectUserMemories({ scope, now, records: [business] })).toEqual([]);
    expect(selectUserMemories({ scope: { ...scope, track: "business", organizationKey: "org2" }, now, records: [business] })).toEqual([]);
    expect(() => selectUserMemories({ scope: { ...scope, track: "business" }, now, records: [business] })).toThrow();
  });

  it("requires provenance and rejects model-supplied ownership or approval", () => {
    const proposal = { operation: "remember", kind: "goal", text: "Saving for a car.", sourceMessageId: "msg1", customerQuote: "Remember I am saving for a car." };
    expect(memoryProposalSchema.safeParse(proposal).success).toBe(true);
    expect(memoryProposalSchema.safeParse({ ...proposal, approved: true, ownerKey: "user-b" }).success).toBe(false);
    expect(memoryProposalSchema.safeParse({ ...proposal, sourceMessageId: "" }).success).toBe(false);
    expect(memoryProposalSchema.safeParse({ ...proposal, kind: "stated_financial", text: "Net income 7,500 lei a month." }).success).toBe(true);
    expect(memoryProposalSchema.safeParse({ ...proposal, kind: "risk_profile" }).success).toBe(false);
  });
});

it("exposes only specific custom tool contracts without a user selector or generic execution", () => {
  expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
  for (const tool of AGENT_TOOLS) {
    expect(tool.type).toBe("custom");
    expect(tool.input_schema.additionalProperties).toBe(false);
    expect(tool.input_schema.properties).not.toHaveProperty("ownerKey");
    expect(tool.input_schema.properties).not.toHaveProperty("userId");
  }
});

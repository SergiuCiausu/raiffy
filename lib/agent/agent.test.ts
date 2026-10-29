import { describe, expect, it } from "vitest";
import { AGENT_POLICY } from "./config";
import { AUDIENCES, buildJevRequest, COMPLEXITIES, INQUIRIES, jevResponseSchema, MEMORY_CANDIDATES, MEMORY_OPERATIONS, SCOPES } from "./jev";
import { memoryProposalSchema, scoreMemoryCandidate, selectUserMemories } from "./memory";
import { AGENT_TOOLS } from "./prompt";
import { COLLECTIONS, planAgentRoute, TOOLS, type RouteContext } from "./route";
import { scoreRouting } from "./routing-eval";
import { bankingIntent } from "./confidence";
import { routeResponse } from "./composer";

function choice<T extends Record<string, string>>(criteria: T, selected: keyof T & string, confidence = 0.95) {
  const labels = Object.keys(criteria);
  const top = confidence * (1 - 1 / labels.length) + 1 / labels.length;
  return {
    type: "choice" as const, choice: selected, confidence,
    probabilities: Object.fromEntries(labels.map((label) => [label, label === selected ? top : (1 - top) / (labels.length - 1)])),
  };
}
/** An inquiry distribution with the given probabilities and the rest spread evenly. */
function spread(p: Partial<Record<keyof typeof INQUIRIES, number>>) {
  const labels = Object.keys(INQUIRIES) as (keyof typeof INQUIRIES)[];
  const rest = (1 - Object.values(p).reduce((a, b) => a + b, 0)) / (labels.length - Object.keys(p).length);
  const probabilities = Object.fromEntries(labels.map(l => [l, p[l] ?? rest]));
  const selected = labels.reduce((a, b) => probabilities[b]! > probabilities[a]! ? b : a);
  return { type: "choice" as const, choice: selected, confidence: (probabilities[selected]! - 1 / labels.length) / (1 - 1 / labels.length), probabilities };
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
    const raw = response(); raw.answers.inquiry = spread({ negotiation: 0.3, product_comparison: 0.25, other: 0.2 });
    const plan = planAgentRoute(raw, full);
    expect(plan).toMatchObject({ handler: "clarify", reason: "low_route_confidence", model: null, collections: [] });
  });

  it("routes a clear leader below the confidence floor, and offers close labels as choices", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "negotiation", 0.5);
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "orchestrator", inquiry: "negotiation", routingBasis: "margin" });
    raw.answers.inquiry = spread({ negotiation: 0.45, product_comparison: 0.42 });
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "clarify", reason: "ambiguous_inquiry", candidates: ["negotiation", "product_comparison"], inquiry: null });
  });

  it("lets a pending question or a tapped choice set the pattern, but never skips the risk checks", () => {
    const raw = response(); raw.answers.inquiry = spread({ other: 0.9 });
    expect(planAgentRoute(raw, full, AGENT_POLICY, { inquiry: "affordability", basis: "pending" })).toMatchObject({ inquiry: "affordability", routingBasis: "pending", handler: "orchestrator" });
    raw.answers.hardship.noul = 0.6;
    expect(planAgentRoute(raw, full, AGENT_POLICY, { inquiry: "affordability", basis: "choice" }).handler).toBe("hardship");
  });

  it("reads clear banking requests in English and Romanian, and nothing from small talk", () => {
    expect(bankingIntent("i want to take a credit of 50k euro")).toEqual(["purchase_goal", "affordability", "cash_shortfall"]);
    expect(bankingIntent("Vreau un împrumut de 50.000 lei")[0]).toBe("purchase_goal");
    expect(bankingIntent("I need a loan")[0]).toBe("purchase_goal");
    expect(bankingIntent("vreau să economisesc")[0]).toBe("saving_goal");
    expect(bankingIntent("Can I refinance my mortgage?")[0]).toBe("debt_refinancing");
    expect(bankingIntent("De ce am plătit comision de 5 lei?")[0]).toBe("fees_statements");
    expect(bankingIntent("Hello, how are you?")).toEqual([]);
    expect(bankingIntent("Is my credit card accepted abroad?")[0]).toBe("purchase_goal"); // a hint only; Jev decides first
  });

  it("turns a confident 'other' into choices when the message clearly asks for a banking product", () => {
    const raw = response(); raw.answers.inquiry = spread({ other: 0.92, purchase_goal: 0.05, cash_shortfall: 0.02 });
    const hinted = planAgentRoute(raw, { ...full, intentHints: bankingIntent("i want to take a credit of 50k euro") });
    expect(hinted).toMatchObject({ handler: "clarify", inquiry: null, reason: "ambiguous_inquiry", candidates: ["purchase_goal", "affordability", "cash_shortfall"] });
    // Nothing recognisable: still choices (Jev's top labels), but no fallback call
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "clarify", reason: "unknown_inquiry", candidates: ["purchase_goal", "cash_shortfall", expect.any(String)] });
  });

  it("gives solution answers a larger passage budget than detail or compare answers", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "purchase_goal"); raw.answers.scope = choice(SCOPES, "solution");
    expect(planAgentRoute(raw, full).limits.publicChunks).toBe(AGENT_POLICY.retrieval.maxPublicChunksSolution);
    raw.answers.scope = choice(SCOPES, "compare");
    expect(planAgentRoute(raw, full).limits.publicChunks).toBe(AGENT_POLICY.retrieval.maxPublicChunks);
  });

  it("does not clarify over an unsure scope or complexity", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "product_explanation");
    raw.answers.scope = choice(SCOPES, "compare", 0.2); raw.answers.complexity = choice(COMPLEXITIES, "simple", 0.1);
    expect(planAgentRoute(raw, full)).toMatchObject({ scope: "detail", handler: "orchestrator", model: AGENT_POLICY.complexModel });
  });

  it("never switches the authorized track from a classifier label, and never asks personal or business", () => {
    for (const [audience, confidence] of [["business", 0.95], ["business", 0.4], ["personal", 0.3]] as const) {
      const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "product_comparison"); raw.answers.audience = choice(AUDIENCES, audience, confidence);
      const plan = planAgentRoute(raw, { ...full, requestedBanks: ["bcr"] });
      expect(plan.track).toBe("personal");
      expect(plan.handler).not.toBe("clarify");
      expect(plan.reason).not.toBe("confirm_track_before_access");
    }
  });

  it("routes an explicitly named competitor to its collection without broadening private access", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "product_explanation");
    const plan = planAgentRoute(raw, { ...full, requestedBanks: ["ing"] });
    expect(plan.collections).toEqual(["competitor_docs"]);
    expect(plan.track).toBe("personal");
    expect(plan.collections).not.toContain("user_memory");
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

describe("asking for a person at the bank", () => {
  const ASK = "How can I book a meeting with a Raiffeisen advisor?";

  it("recognises a request for a person in English and Romanian, and not a question about advisers", () => {
    for (const m of [ASK, "Can I talk to a person?", "I'd like to speak with a specialist", "Schedule a call with someone please",
      "Vreau o programare la bancă", "Aș vrea să vorbesc cu un consilier"]) expect(bankingIntent(m), m).toContain("human_contact");
    for (const m of ["What does a financial advisor do?", "Get the call log for my card", "What are the fees for calls abroad?", "I need a loan"])
      expect(bankingIntent(m), m).not.toContain("human_contact");
  });

  it("routes Jev's own human_contact label to the fixed contact answer", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "human_contact"); raw.answers.scope = choice(SCOPES, "detail");
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "human_contact", inquiry: "human_contact", reason: "human_contact_requested", model: null });
  });

  it("settles the split that showed the 'Which of these is closest?' menu, when the message plainly asks for a person", () => {
    // The screenshot: Jev split the advisor question across patterns, so Raiffy asked which one was meant
    const raw = response(); raw.answers.inquiry = spread({ professional_advice: 0.34, listing: 0.3, purchase_goal: 0.26 });
    expect(planAgentRoute(raw, full).handler).toBe("clarify");
    expect(planAgentRoute(raw, { ...full, intentHints: bankingIntent(ASK) })).toMatchObject({ handler: "human_contact", candidates: [] });
    // A confident "other" with the same words too
    const other = response(); other.answers.inquiry = spread({ other: 0.92, listing: 0.05 });
    expect(planAgentRoute(other, { ...full, intentHints: bankingIntent(ASK) }).handler).toBe("human_contact");
  });

  it("never lets the keyword override a confident pattern, a risk or a tapped choice", () => {
    const loan = response(); loan.answers.inquiry = choice(INQUIRIES, "purchase_goal"); loan.answers.scope = choice(SCOPES, "solution");
    expect(planAgentRoute(loan, { ...full, intentHints: bankingIntent("Can I talk to someone about a 30,000 lei loan?") }).inquiry).toBe("purchase_goal");
    const fraud = response(); fraud.answers.fraud = { type: "noul", noul: 0.9 };
    expect(planAgentRoute(fraud, { ...full, intentHints: bankingIntent("Someone took money from my account, can I talk to a person?") }).handler).toBe("fraud");
    const split = response(); split.answers.inquiry = spread({ professional_advice: 0.34, listing: 0.3, purchase_goal: 0.26 });
    expect(planAgentRoute(split, { ...full, intentHints: bankingIntent(ASK) }, AGENT_POLICY, { inquiry: "listing", basis: "choice" }).inquiry).toBe("listing");
  });

  it("answers with fixed text that hands over to the booking card, books nothing itself and has no figures", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "human_contact");
    const answer = routeResponse(planAgentRoute(raw, full));
    expect(answer.model).toBe("deterministic");
    expect(answer.text).toContain("nothing is booked until you press Book call");
    expect(answer.text).toContain("isn't financial advice or a credit decision");
    expect(answer.text).not.toMatch(/\d/);
    expect(answer.text).not.toMatch(/\b(you're booked|is booked for|scheduled for|confirmed for)\b/i);
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

describe("routing eval scoring", () => {
  it("counts a confident wrong pattern separately from a clarifying question", () => {
    const right = response();
    const wrong = response(); wrong.answers.inquiry = choice(INQUIRIES, "product_comparison");
    const unsure = response(); unsure.answers.inquiry = spread({ negotiation: 0.3, product_comparison: 0.25, other: 0.2 });
    const s = scoreRouting([right, wrong, unsure].map(r => ({ case: { message: "Can you match BT?", inquiry: "negotiation" as const }, response: r })));
    expect(s).toMatchObject({ cases: 3, routed: 2, correct: 1, wrongRouted: 1, clarified: 1, top1: 2, family: 3 });
  });
});

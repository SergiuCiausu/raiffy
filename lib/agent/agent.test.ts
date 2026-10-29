import { describe, expect, it } from "vitest";
import { AGENT_POLICY } from "./config";
import { AUDIENCES, buildJevRequest, COMPLEXITIES, INQUIRIES, jevResponseSchema, MEMORY_CANDIDATES, MEMORY_OPERATIONS, SCOPES } from "./jev";
import { memoryContextNote, memoryProposalSchema, scoreMemoryCandidate, selectUserMemories } from "./memory";
import { AGENT_TOOLS } from "./prompt";
import { COLLECTIONS, planAgentRoute, TOOLS, type RouteContext } from "./route";
import { composeAnswer, memoryResponse, routeResponse } from "./composer";
import { ragAnswerSchema } from "../rag/answer";

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

  it("accepts a rounded distribution that omits zero labels, and normalizes it", () => {
    const raw = response();
    // Two-decimal rounding over 14 labels: sums to 0.97, with every label at 0 left out.
    raw.answers.inquiry = { type: "choice", choice: "negotiation", confidence: 0.9, probabilities: { negotiation: 0.88, product_comparison: 0.05, purchase_goal: 0.04 } };
    const parsed = jevResponseSchema.parse(raw).answers.inquiry;
    expect(Object.keys(parsed.probabilities)).toHaveLength(Object.keys(INQUIRIES).length);
    expect(Object.values(parsed.probabilities).reduce((n, p) => n + p, 0)).toBeCloseTo(1);
    expect(parsed.confidence).toBeCloseTo((0.88 / 0.97 - 1 / 14) / (1 - 1 / 14));
    // Beyond rounding, or with an invented label, it is still rejected.
    raw.answers.inquiry = { ...raw.answers.inquiry, probabilities: { negotiation: 0.6, product_comparison: 0.05 } };
    expect(jevResponseSchema.safeParse(raw).success).toBe(false);
    raw.answers.inquiry = { type: "choice", choice: "negotiation", confidence: 0.9, probabilities: { negotiation: 0.92, approve_credit: 0.08 } };
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

  it("sends an uncertain or unmatched inquiry to Claude with public documents and the calculator only", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "negotiation", 0.5);
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "orchestrator", reason: "low_route_confidence", inquiry: null,
      collections: ["bank_product_docs", "banking_help"], tools: ["calculate_scenario", "search_knowledge", "propose_memory_change"] });
    raw.answers.inquiry = choice(INQUIRIES, "other", 1);
    expect(planAgentRoute(raw, full)).toMatchObject({ reason: "unknown_inquiry", inquiry: null, tools: ["calculate_scenario", "search_knowledge", "propose_memory_change"] });
    expect(planAgentRoute(raw, { ...full, availableTools: ["search_knowledge"] }).tools).toEqual(["search_knowledge"]);
    raw.answers.inquiry = choice(INQUIRIES, "professional_advice", 0.5);
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "orchestrator", collections: ["bank_product_docs", "banking_help"] });
  });

  it("still screens risks before an uncertain inquiry reaches Claude", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "other", 0.2); raw.answers.fraud.noul = 0.4;
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "fraud", model: null, collections: [] });
  });

  // Live Jev values for "I want to save up 10k euros" and "What's the maximum amount of loan I can take".
  it("answers a confident inquiry when only scope or complexity is uncertain", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "saving_goal", 1);
    raw.answers.complexity = choice(COMPLEXITIES, "simple", 0.06);
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "orchestrator", reason: "classified", scope: "compare", model: AGENT_POLICY.complexModel });
    raw.answers.complexity = choice(COMPLEXITIES, "simple"); raw.answers.scope = choice(SCOPES, "solution", 0.66);
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "answer", reason: "classified", scope: null, model: AGENT_POLICY.standardModel });
  });

  it("never switches the authorized track from a classifier label", () => {
    const raw = response(); raw.answers.audience = choice(AUDIENCES, "business");
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "clarify", reason: "confirm_track_before_access", track: "personal", collections: [] });
    raw.answers.audience = choice(AUDIENCES, "business", 0.34);
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "orchestrator", track: "personal" });
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
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "orchestrator", reason: "uncertain_goal_count" });
  });

  it("returns unavailable on malformed responses or unreviewed model changes", () => {
    expect(planAgentRoute({}, full)).toMatchObject({ handler: "unavailable", reason: "invalid_classifier_response", model: null });
    const raw = response(); raw.model = "jev-unreviewed";
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "unavailable", reason: "unexpected_classifier_version", model: null });
  });

  it("lets Claude only propose an explicit memory, keeps inspect and forget out of generation, and disables absent handlers", () => {
    const raw = response(); raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "remember");
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "answer", tools: ["propose_memory_change"], collections: [], model: AGENT_POLICY.standardModel });
    raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "inspect");
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "memory", tools: ["manage_memory"], model: null });
    raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "remember");
    expect(planAgentRoute(raw, { ...full, availableTools: [] })).toMatchObject({ handler: "unavailable", tools: [], unavailable: ["propose_memory_change"] });
  });

  // Live Jev values for "do you remember my age?": an uncertain memory request.
  it("never changes memory on an uncertain request and says when memory is off", () => {
    const raw = response(); raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "inspect", 0.64);
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "clarify", reason: "uncertain_memory_request", tools: [] });
    expect(planAgentRoute(raw, { ...full, availableTools: ["search_knowledge"] })).toMatchObject({ handler: "unavailable", reason: "explicit_memory_request", tools: [] });
    raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "none", 0.6);
    expect(planAgentRoute(raw, full).handler).toBe("orchestrator");
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

  // Live Jev on "I'm 29, my net salary is 4500 lei, I want a used car next year, I prefer a fixed payment": the
  // top candidate had confidence 0.30, because the message states three things at once.
  it("ranks with Jev's candidate but still offers the proposal tool when the candidate is weak or split", () => {
    const plan = planAgentRoute(stated("stated_financial", 0.3), full);
    expect(plan.memoryCandidate).toBeNull();
    expect(plan.tools).toContain("propose_memory_change");
    const sensitive = stated("goal"); sensitive.answers.special_category.noul = 0.2;
    expect(planAgentRoute(sensitive, full).tools).not.toContain("propose_memory_change");
  });

  it("never proposes from special-category, risky or explicitly handled messages", () => {
    const sensitive = stated("goal"); sensitive.answers.special_category.noul = 0.2;
    expect(scoreMemoryCandidate(jevResponseSchema.parse(sensitive).answers)).toBeNull();
    const hardship = stated("goal"); hardship.answers.hardship.noul = 0.31;
    expect(scoreMemoryCandidate(jevResponseSchema.parse(hardship).answers)).toBeNull();
    expect(planAgentRoute(hardship, full)).toMatchObject({ handler: "hardship", memoryCandidate: null, tools: [] });
    const explicit = stated("goal"); explicit.answers.memory_operation = choice(MEMORY_OPERATIONS, "remember");
    expect(planAgentRoute(explicit, full)).toMatchObject({ handler: "answer", memoryCandidate: null, tools: ["propose_memory_change"] });
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

describe("answer envelope", () => {
  const rag = (text: string) => ragAnswerSchema.parse({ status: "answered", text, segments: [{ text, sourceIds: [] }], sources: [],
    checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 }, model: "claude-sonnet-5-5", promptVersion: "test", searches: [], retrieval: [] });
  const list = "Routes:\n- **Save first** (recommended) — no debt. Why: you have time.\n- **Personal loan** — a fixed instalment.";

  it("adds route cards only when the answer scope calls for options side by side", () => {
    const raw = response(); raw.answers.scope = choice(SCOPES, "solution");
    expect(composeAnswer("m1", planAgentRoute(raw, full), rag(list)).blocks.at(-1)).toMatchObject({ type: "routes",
      routes: [{ title: "Save first", recommended: true, why: "you have time." }, { title: "Personal loan", recommended: false }] });
    raw.answers.scope = choice(SCOPES, "detail");
    expect(composeAnswer("m1", planAgentRoute(raw, full), rag(list)).blocks).toEqual([]);
  });

  const sourced = (title: string) => ragAnswerSchema.parse({ status: "answered", text: "Flexicredit is an unsecured loan.",
    segments: [{ text: "Flexicredit is an unsecured loan.", sourceIds: ["src-1"] }],
    sources: [{ id: "src-1", url: "https://www.raiffeisen.ro/flexicredit.html", title, collectedOn: "2026-10-28", sectionType: "faq", chunkIds: ["c1"] }],
    checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 }, model: "m", promptVersion: "p", searches: [], retrieval: [] });
  const followups = (envelope: ReturnType<typeof composeAnswer>) => envelope.actions.flatMap((a) => a.kind === "followup" ? [a.prompt] : []);

  it("names the product in follow-ups so they can be classified on their own", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "product_explanation"); raw.answers.scope = choice(SCOPES, "detail");
    expect(followups(composeAnswer("m1", planAgentRoute(raw, full), sourced("Raiffeisen Bank · Flexicredit · FAQ"))))
      .toEqual(["Which documents do I need for Flexicredit?", "Which other Raiffeisen products are similar to Flexicredit?"]);
    // A competitor page or a PDF names no Raiffeisen product, so no generic chip is offered instead.
    expect(followups(composeAnswer("m1", planAgentRoute(raw, full), sourced("BCR · Credit de nevoi personale · FAQ")))).toEqual([]);
    expect(followups(composeAnswer("m1", planAgentRoute(raw, full), sourced("Raiffeisen Bank · Fees and commissions: Tarife, p. 3")))).toEqual([]);
  });

  it("builds route follow-ups from the recommended route and an alternative that borrows", () => {
    const raw = response(); raw.answers.scope = choice(SCOPES, "solution");
    const list3 = `${list}\n- **Overdraft** — short gaps only.`;
    expect(followups(composeAnswer("m1", planAgentRoute(raw, full), rag(list3))))
      .toEqual(["What conditions and documents does Save first require?", "Compare Save first with Personal loan for my situation"]);
  });

  it("offers an adviser where a person can take it further, and never in a crisis", () => {
    const handoff = (inquiry: keyof typeof INQUIRIES, answer = rag("Sourced answer.")) => {
      const raw = response(); raw.answers.inquiry = choice(INQUIRIES, inquiry);
      return composeAnswer("m1", planAgentRoute(raw, full), answer).actions.find((a) => a.kind === "handoff");
    };
    expect(handoff("negotiation")).toEqual({ kind: "handoff", label: "Book an adviser", reason: "offer_review" });
    expect(handoff("purchase_goal")).toEqual({ kind: "handoff", label: "Book an adviser", reason: "customer_request" });
    expect(handoff("product_explanation")).toBeUndefined();
    const complaint = response(); complaint.answers.inquiry = choice(INQUIRIES, "security_complaint");
    const plan = planAgentRoute(complaint, { ...full, availableTools: ["search_knowledge"] });
    expect(routeResponse(plan).text).toMatch(/Talk to an adviser below/);
    expect(composeAnswer("m1", plan, routeResponse(plan)).actions).toEqual([{ kind: "handoff", label: "Talk to an adviser", reason: "complaint" }]);
    const crisis = response(); crisis.answers.crisis.noul = 0.9;
    expect(composeAnswer("m1", planAgentRoute(crisis, full), rag("Help.")).actions).toEqual([]);
  });
});

describe("memory in answers", () => {
  const saved = [{ kind: "goal" as const, text: "buy a used car next year", statedAt: Date.parse("2026-10-28T10:00:00Z") },
    { kind: "stated_financial" as const, text: "salariu de 4500 de lei", statedAt: Date.parse("2026-10-28T10:00:00Z") }];

  it("tells Claude what the customer confirmed, dated, and keeps stated figures as calculator inputs", () => {
    const note = memoryContextNote(saved)!;
    expect(note).toContain("- goal, stated 2026-10-28: buy a used car next year");
    expect(note).toMatch(/only a calculator input/);
    expect(note).toMatch(/never use them to judge creditworthiness/);
    expect(memoryContextNote([])).toBeUndefined();
  });

  it("answers inspect and forget from the store, and says plainly when memory is off", () => {
    expect(memoryResponse("inspect", saved, true).text).toContain("• buy a used car next year (you told me on 28 Oct 2026)");
    expect(memoryResponse("inspect", [], true).text).toMatch(/haven't saved anything/);
    expect(memoryResponse("forget", saved, true).text).toMatch(/Forget everything/);
    expect(memoryResponse("ineligible", saved, true).text).toMatch(/details I don't keep/);
    expect(memoryResponse("inspect", [], false).text).toMatch(/not enabled/);
  });

  it("adds the customer's pending proposals to the envelope, even in a degraded answer", () => {
    const rag = ragAnswerSchema.parse({ status: "no_results", text: "Noted.", segments: [{ text: "Noted.", sourceIds: [] }], sources: [],
      checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 }, model: "m", promptVersion: "p", searches: [], retrieval: [] });
    const proposals = [{ id: "p1", kind: "goal" as const, text: "buy a used car next year", customerQuote: "I want to buy a used car next year." }];
    expect(composeAnswer("m1", planAgentRoute(response(), full), rag, proposals).blocks).toEqual([{ type: "memory", proposals }]);
  });
});

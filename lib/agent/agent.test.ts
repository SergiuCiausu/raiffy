import { describe, expect, it } from "vitest";
import { AGENT_POLICY } from "./config";
import { AUDIENCES, buildJevRequest, COMPLEXITIES, INQUIRIES, jevResponseSchema, MEMORY_CANDIDATES, MEMORY_OPERATIONS, SCOPES } from "./jev";
import { memoryContextNote, memoryProposalSchema, notConnectedClause, scoreMemoryCandidate, selectUserMemories } from "./memory";
import { AGENT_TOOLS } from "./prompt";
import { COLLECTIONS, planAgentRoute, TOOLS, type RouteContext } from "./route";
import { scoreRouting } from "./routing-eval";
import { bankingIntent } from "./confidence";
import { composeAnswer, memoryResponse, offersSpecialist, routeResponse } from "./composer";
import { SPECIALIST_LABEL, handoffActionFor } from "./handoff";
import { EMPTY_STATE, nextState, readState } from "./state";
import { ragAnswerSchema } from "../rag/answer";

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

  // Live Jev values for "What do you remember about me?" on cloud dev: no banking pattern (other 0.50, affordability 0.45).
  it("answers a memory question from the store even when no banking pattern is clear", () => {
    const raw = response(); raw.answers.inquiry = spread({ other: 0.5, affordability: 0.45, purchase_goal: 0.05 });
    raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "inspect");
    expect(planAgentRoute(raw, { ...full, availableTools: ["search_knowledge"] })).toMatchObject({ handler: "unavailable", reason: "explicit_memory_request", memoryOperation: "inspect" });
    raw.answers.memory_operation = choice(MEMORY_OPERATIONS, "none");
    expect(planAgentRoute(raw, full)).toMatchObject({ handler: "clarify", reason: "low_route_confidence" });
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

  it("offers a specialist only where a person is needed, never on ordinary answers", () => {
    const handoff = (inquiry: keyof typeof INQUIRIES, answer = rag("Sourced answer."), offered = false) => {
      const raw = response(); raw.answers.inquiry = choice(INQUIRIES, inquiry);
      return composeAnswer("m1", planAgentRoute(raw, full), answer, { specialistOffered: offered }).actions.find((a) => a.kind === "handoff");
    };
    // Comparisons, purchases, affordability and refinancing answer without a button: the header's is always there
    for (const inquiry of ["purchase_goal", "product_comparison", "affordability", "debt_refinancing", "product_explanation", "negotiation"] as const) {
      expect(handoff(inquiry)).toBeUndefined();
    }
    // A negotiation the pricing rules escalated offers a specialist review, once
    const negotiation = response(); negotiation.answers.inquiry = choice(INQUIRIES, "negotiation");
    const priced = planAgentRoute(negotiation, full);
    expect(handoffActionFor(priced, "normal", { review: true })).toEqual({ kind: "handoff", label: SPECIALIST_LABEL, reason: "offer_review" });
    expect(handoffActionFor(priced, "normal", { review: true, offered: true })).toBeNull();
    // An answer Raiffy couldn't verify offers one, once
    const unverified = { ...rag(""), status: "failed_checks" as const };
    expect(handoff("product_explanation", unverified)).toEqual({ kind: "handoff", label: SPECIALIST_LABEL, reason: "missing_evidence" });
    expect(handoff("product_explanation", unverified, true)).toBeUndefined();
    // A complaint always does
    const complaint = response(); complaint.answers.inquiry = choice(INQUIRIES, "security_complaint");
    const plan = planAgentRoute(complaint, { ...full, availableTools: ["search_knowledge"] });
    expect(routeResponse(plan).text).toMatch(/Talk to a specialist below/);
    expect(composeAnswer("m1", plan, routeResponse(plan), { specialistOffered: true }).actions)
      .toEqual([{ kind: "handoff", label: SPECIALIST_LABEL, reason: "complaint" }]);
  });

  it("gives crisis, fraud and hardship their official channel, without a booking button", () => {
    for (const risk of ["crisis", "fraud", "hardship"] as const) {
      const raw = response(); raw.answers[risk].noul = 0.9;
      const plan = planAgentRoute(raw, full);
      expect(composeAnswer("m1", plan, routeResponse(plan)).actions).toEqual([]);
    }
    const fraud = response(); fraud.answers.fraud.noul = 0.9;
    expect(routeResponse(planAgentRoute(fraud, full)).text).toMatch(/official app or the number on your card/);
  });

  it("shows Claude's handoff card instead of the button, and only once per conversation", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "affordability");
    const plan = planAgentRoute(raw, full);
    const card = { type: "handoff", title: "Eligibility needs a person", reason: "Only the bank can assess a probation contract." };
    const first = composeAnswer("m1", plan, { ...rag("Sourced answer."), cards: [card] });
    expect(first.blocks.some((b) => b.type === "handoff")).toBe(true);
    expect(first.actions.some((a) => a.kind === "handoff")).toBe(false);
    expect(offersSpecialist(first, plan.handler)).toBe(true);
    const later = composeAnswer("m2", plan, { ...rag("Sourced answer."), cards: [card] }, { specialistOffered: true });
    expect(later.blocks.some((b) => b.type === "handoff")).toBe(false);
    expect(offersSpecialist(later, plan.handler)).toBe(false);
  });

  it("offers a specialist at most once in a six-turn loan chat, even when no answer could be verified", () => {
    const raw = response(); raw.answers.inquiry = choice(INQUIRIES, "purchase_goal");
    const plan = planAgentRoute(raw, full);
    const unverified = { ...rag(""), status: "failed_checks" as const };
    let state = EMPTY_STATE;
    const buttons = Array.from({ length: 6 }, (_, i) => {
      const envelope = composeAnswer(`m${i}`, plan, unverified, { specialistOffered: state.specialistOffered });
      state = readState(nextState(state, { inquiry: plan.inquiry, scope: plan.scope, specialist: offersSpecialist(envelope, plan.handler) }));
      return envelope.actions.filter((a) => a.kind === "handoff").length;
    });
    expect(buttons).toEqual([1, 0, 0, 0, 0, 0]);
    expect(state.specialistOffered).toBe(true);
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

  it("doesn't tell Claude saved memory is missing when the turn loaded some", () => {
    expect(notConnectedClause(saved.length)).not.toMatch(/memory/);
    expect(notConnectedClause(0)).toMatch(/saved memory are connected/);
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
    expect(composeAnswer("m1", planAgentRoute(response(), full), rag, { proposals }).blocks).toEqual([{ type: "memory", proposals }]);
  });
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

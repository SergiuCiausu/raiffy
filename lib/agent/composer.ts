import { z } from "zod";
import { ragAnswerSchema, type RagAnswer } from "../rag/answer";
import type { RoutePlan } from "./route";
import { routesBlockSchema, routesFromAnswer, type RoutesBlock } from "./routes";
import { MEMORY_KINDS, contextMemorySchema, type ContextMemory } from "./memory";
import { handoffActionFor, handoffActionSchema } from "./handoff";

/** Proposals queued this turn: the customer saves or dismisses each one in the app. */
export const memoryBlockSchema = z.object({
  type: z.literal("memory"),
  proposals: z.array(z.object({ id: z.string(), kind: z.enum(MEMORY_KINDS), text: z.string(), customerQuote: z.string() })).min(1),
});
export type MemoryBlock = z.infer<typeof memoryBlockSchema>;

export const answerEnvelopeSchema = z.object({
  id: z.string(), locale: z.literal("en-GB"), pattern: z.string(),
  mode: z.enum(["normal", "hardship", "crisis", "fraud", "degraded"]), text: z.string(),
  blocks: z.array(z.union([
    z.object({ type: z.literal("callout"), state: z.enum(["ready", "unavailable"]), text: z.string(), sourceIds: z.array(z.string()) }),
    routesBlockSchema,
    memoryBlockSchema,
  ])),
  sources: z.array(z.object({ id: z.string(), label: z.string(), publisher: z.string(), date: z.string(), url: z.url() })),
  actions: z.array(z.union([z.object({ kind: z.literal("followup"), label: z.string(), prompt: z.string() }), handoffActionSchema])),
  flags: z.object({ aiDisclosure: z.literal(true), suppressOffers: z.boolean(), indicativeOnly: z.literal(true), staleData: z.array(z.string()) }),
});

const RESPONSES: Partial<Record<RoutePlan["handler"], string>> = {
  crisis: "Your safety comes first. If you are in immediate danger, contact local emergency services or someone you trust now. We can return to finances when you are safe.",
  fraud: "Stop communicating with the suspected scammer and do not share codes or move money at their request. Contact Raiffeisen through the official app or the number on your card to secure the account.",
  hardship: "Let's focus on essential expenses and the repayments you are struggling with. Contact Raiffeisen's support team to discuss assistance; I cannot approve restructuring or offer new borrowing here. Which payment is most urgent?",
  safe_boundary: "I can help with legitimate banking questions, but cannot bypass banking checks, reveal private information or change access permissions.",
  professional_referral: "For personalized investment, legal or tax advice, please speak with an appropriately qualified professional. I can explain sourced banking product information.",
  memory: "Persistent memory is not enabled in this chat. I can use details within this conversation, but have not saved them for future chats.",
  clarify: "Which banking product or goal would you like help with, and what would you like to know about it?",
  unavailable: "I cannot verify the information needed to answer right now. Please try again or contact Raiffeisen through its official support channels.",
};

export function routeResponse(plan: RoutePlan): RagAnswer {
  const text = plan.reason === "explicit_memory_request" ? RESPONSES.memory!
    : plan.reason === "catalog_required" ? "Verified product prices are not available in this preview, so I cannot confirm exact rates, fees or amounts. Please check the bank's official product page or an adviser. I can help explain sourced conditions and documents."
    : plan.reason === "confirm_track_before_access" ? "Is this about a product for you personally or for a business? This chat uses your personal banking profile."
    : plan.reason === "uncertain_goal_count" ? "Which financial goal would you like us to work through first?"
    : plan.inquiry === "security_complaint" && plan.handler === "unavailable"
      ? "I'm sorry this happened. I can't open a formal complaint or change anything on your account myself, but a Raiffeisen adviser can. Choose Talk to an adviser below to send them this conversation; you'll see exactly what they receive first. You can also contact Raiffeisen through the Smart Mobile app or any branch."
    : RESPONSES[plan.handler] ?? RESPONSES.unavailable!;
  return ragAnswerSchema.parse({ status: "no_results", text, segments: [{ text, sourceIds: [] }], sources: [],
    checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 },
    model: "deterministic", promptVersion: "route-response@1", searches: [], retrieval: [] });
}

export { containsFinancialFigure } from "../rag/numbers";

const deterministic = (text: string) => ragAnswerSchema.parse({ status: "no_results", text, segments: [{ text, sourceIds: [] }], sources: [],
  checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 }, model: "deterministic", promptVersion: "memory-response@1", searches: [], retrieval: [] });

/**
 * "What do you remember about me?" and "Forget…", answered from the store, not by the model. Deletion itself
 * stays a deliberate click in the memory panel, so a misread message can never erase anything.
 */
export function memoryResponse(operation: "inspect" | "forget" | "ineligible", raw: readonly ContextMemory[], writesEnabled: boolean): RagAnswer {
  const memories = z.array(contextMemorySchema).parse(raw);
  if (!memories.length && !writesEnabled) return deterministic(RESPONSES.memory!);
  if (operation === "ineligible") {
    return deterministic("I can't save that message: it includes details I don't keep, such as health, identifiers, passwords or other people's information. Tell me just the part you'd like me to remember, without them.");
  }
  if (operation === "forget") {
    return deterministic(memories.length
      ? "You can delete what I remember under What Raiffy remembers in the side panel: remove one item, or choose Forget everything. Nothing is deleted until you do."
      : "I haven't saved anything about you, so there is nothing to forget.");
  }
  if (!memories.length) {
    return deterministic("I haven't saved anything about you yet. When you tell me about a goal, a preference or your finances, I ask before I remember it, and you can delete it anytime in the side panel.");
  }
  const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return deterministic(["Here's what you asked me to remember:", ...memories.map((m) => `• ${m.text} (you told me on ${day(m.statedAt)})`),
    "You can remove any of them, or everything, under What Raiffy remembers in the side panel."].join("\n"));
}

/** "Raiffeisen Bank · Flexicredit · FAQ" → "Flexicredit". PDFs and other banks' pages name no Raiffeisen product. */
function raiffeisenProducts(sources: RagAnswer["sources"]): string[] {
  const names = sources.flatMap((s) => {
    const [bank, product, section] = s.title.split(" · ");
    return bank === "Raiffeisen Bank" && product && section && product !== "product" ? [product.trim()] : [];
  });
  return [...new Set(names)];
}

const short = (name: string) => name.length > 60 ? `${name.slice(0, 57).trimEnd()}…` : name;

/**
 * Follow-up replies that name the product or route, so the classifier can route them without the earlier turns.
 * Generic chips ("What conditions should I check?") couldn't be classified on their own, so without a named
 * product there are none. In the detail scope one goes deeper and one opens a related Raiffeisen solution.
 */
export function followUps(rag: RagAnswer, routes: RoutesBlock | null): string[] {
  if (routes && routes.routes.length >= 2) {
    const pick = routes.routes.find((r) => r.recommended) ?? routes.routes[0]!;
    const other = routes.routes.find((r) => r !== pick && !/saving|savings|own money/i.test(r.title)) ?? routes.routes.find((r) => r !== pick)!;
    return [`What conditions and documents does ${short(pick.title)} require?`, `Compare ${short(pick.title)} with ${short(other.title)} for my situation`];
  }
  const product = raiffeisenProducts(rag.sources)[0];
  if (!product) return [];
  return [`Which documents do I need for ${short(product)}?`, `Which other Raiffeisen products are similar to ${short(product)}?`];
}

/** Build the UI contract from checked evidence; the model cannot invent block kinds or actions. */
export function composeAnswer(id: string, plan: RoutePlan, rag: RagAnswer, proposals: MemoryBlock["proposals"] = []) {
  const mode = plan.handler === "crisis" || plan.handler === "fraud" || plan.handler === "hardship" ? plan.handler
    : (plan.handler === "answer" || plan.handler === "orchestrator") && rag.status === "answered" ? "normal" : "degraded";
  const text = rag.status === "failed_checks" || rag.status === "refused"
    ? "I couldn't verify a supported answer. Please rephrase the question or contact a Raiffeisen adviser." : rag.text;
  // Route cards only where the answer scope calls for options side by side, and only from checked text.
  const routes = mode === "normal" && (plan.scope === "solution" || plan.scope === "compare") ? routesFromAnswer(rag.segments) : null;
  const followups = mode === "normal" ? followUps(rag, routes) : [];
  const handoff = handoffActionFor(plan, mode);
  return answerEnvelopeSchema.parse({ id, locale: "en-GB", pattern: plan.inquiry ?? "freeform", mode, text,
    blocks: [
      ...(rag.status === "answered" ? rag.segments.filter(s => s.sourceIds.length > 0).map(s => ({ type: "callout", state: "ready", text: s.text, sourceIds: s.sourceIds })) : []),
      ...(routes ? [routes] : []),
      // A proposal stays visible in any answer: the customer still decides about what they said.
      ...(proposals.length ? [{ type: "memory", proposals }] : []),
    ],
    sources: rag.status === "answered" ? rag.sources.map(s => ({ id: s.id, label: s.title, publisher: new URL(s.url).hostname, date: s.collectedOn, url: s.url })) : [],
    actions: [...followups.map(prompt => ({ kind: "followup", label: prompt, prompt })), ...(handoff ? [handoff] : [])],
    flags: { aiDisclosure: true, suppressOffers: mode !== "normal" || plan.suppressOffers || plan.inquiry === "negotiation", indicativeOnly: true, staleData: [] } });
}

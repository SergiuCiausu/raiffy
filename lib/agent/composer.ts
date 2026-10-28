import { z } from "zod";
import { ragAnswerSchema, type RagAnswer } from "../rag/answer";
import type { RoutePlan } from "./route";

export const answerEnvelopeSchema = z.object({
  id: z.string(), locale: z.literal("en-GB"), pattern: z.string(),
  mode: z.enum(["normal", "hardship", "crisis", "fraud", "degraded"]), text: z.string(),
  blocks: z.array(z.object({ type: z.literal("callout"), state: z.enum(["ready", "unavailable"]), text: z.string(), sourceIds: z.array(z.string()) })),
  sources: z.array(z.object({ id: z.string(), label: z.string(), publisher: z.string(), date: z.string(), url: z.url() })),
  actions: z.array(z.object({ kind: z.literal("followup"), label: z.string(), prompt: z.string() })),
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
    : RESPONSES[plan.handler] ?? RESPONSES.unavailable!;
  return ragAnswerSchema.parse({ status: "no_results", text, segments: [{ text, sourceIds: [] }], sources: [],
    checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 },
    model: "deterministic", promptVersion: "route-response@1", searches: [], retrieval: [] });
}

/** Exact financial figures require the reviewed catalog, even when a number occurs in a RAG passage. */
export function containsFinancialFigure(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return /\d[\d.,\s]*(?:%|RON\b|EUR\b|lei\b|leu\b|euros?\b|basis points?\b)/i.test(normalized)
    || /\b(?:APR|DAE|interest rate|fee|commission|comision|dobanda)\b[^.!?\n]{0,40}\d/i.test(normalized)
    || /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\s+(?:percent|lei|euros?)\b/i.test(normalized);
}

/** Build the UI contract from checked evidence; the model cannot invent block kinds or actions. */
export function composeAnswer(id: string, plan: RoutePlan, rag: RagAnswer) {
  const mode = ["crisis", "fraud", "hardship"].includes(plan.handler) ? plan.handler
    : (plan.handler === "answer" || plan.handler === "orchestrator") && rag.status === "answered" ? "normal" : "degraded";
  const text = rag.status === "failed_checks" || rag.status === "refused"
    ? "I couldn't verify a supported answer. Please rephrase the question or contact a Raiffeisen adviser." : rag.text;
  const followups = mode === "normal" ? ["What conditions should I check?", "Which official documents should I read?"] : [];
  return answerEnvelopeSchema.parse({ id, locale: "en-GB", pattern: plan.inquiry ?? "freeform", mode, text,
    blocks: rag.status === "answered" ? rag.segments.filter(s => s.sourceIds.length > 0).map(s => ({ type: "callout", state: "ready", text: s.text, sourceIds: s.sourceIds })) : [],
    sources: rag.status === "answered" ? rag.sources.map(s => ({ id: s.id, label: s.title, publisher: new URL(s.url).hostname, date: s.collectedOn, url: s.url })) : [],
    actions: followups.map(prompt => ({ kind: "followup", label: prompt, prompt })),
    flags: { aiDisclosure: true, suppressOffers: mode !== "normal" || plan.suppressOffers || plan.inquiry === "negotiation", indicativeOnly: true, staleData: [] } });
}

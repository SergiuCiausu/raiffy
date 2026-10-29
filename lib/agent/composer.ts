import { z } from "zod";
import { answerCardSchema } from "./blocks";
import { spendingBlockSchema } from "../expenses/schemas";
import { offerBlockSchema } from "../pricing/schemas";
import { compareBlockSchema } from "../compare/block";
import { ragAnswerSchema, type RagAnswer } from "../rag/answer";
import type { RoutePlan } from "./route";
import type { Inquiry } from "./confidence";
import { inputFieldSchema, parseNumber, type InputField } from "./inputs";

const calloutBlock = z.object({ type: z.literal("callout"), state: z.enum(["ready", "unavailable"]), text: z.string(), sourceIds: z.array(z.string()) });
/** Asks only for missing required inputs. The customer can fill it or answer in their own words. */
const inputsRequestBlock = z.object({ type: z.literal("inputs_request"), pattern: z.string(), round: z.number().int().positive(), fields: z.array(inputFieldSchema).min(1).max(3) });
const followupAction = z.object({ kind: z.literal("followup"), label: z.string(), prompt: z.string() });
/** Picks one of the patterns Raiffy offered when it could not tell them apart. */
const chooseAction = z.object({ kind: z.literal("choose"), label: z.string(), prompt: z.string(), inquiry: z.string() });
/** Answers without the missing inputs, with typical examples clearly labelled as examples. */
const skipAction = z.object({ kind: z.literal("skip_inputs"), label: z.string(), prompt: z.string() });

export const answerEnvelopeSchema = z.object({
  id: z.string(), locale: z.literal("en-GB"), pattern: z.string(),
  mode: z.enum(["normal", "hardship", "crisis", "fraud", "degraded"]), text: z.string(),
  blocks: z.array(z.union([calloutBlock, inputsRequestBlock, answerCardSchema, spendingBlockSchema, offerBlockSchema, compareBlockSchema])),
  sources: z.array(z.object({ id: z.string(), label: z.string(), publisher: z.string(), date: z.string(), url: z.url() })),
  actions: z.array(z.discriminatedUnion("kind", [followupAction, chooseAction, skipAction])),
  flags: z.object({ aiDisclosure: z.literal(true), suppressOffers: z.boolean(), indicativeOnly: z.literal(true), staleData: z.array(z.string()) }),
});

const RESPONSES: Partial<Record<RoutePlan["handler"], string>> = {
  crisis: "Your safety comes first. If you are in immediate danger, contact local emergency services or someone you trust now. We can return to finances when you are safe.",
  fraud: "Stop communicating with the suspected scammer and do not share codes or move money at their request. Contact Raiffeisen through the official app or the number on your card to secure the account.",
  hardship: "Let's focus on essential expenses and the repayments you are struggling with. Contact Raiffeisen's support team to discuss assistance; I cannot approve restructuring or offer new borrowing here. Which payment is most urgent?",
  safe_boundary: "I can help with legitimate banking questions, but cannot bypass banking checks, reveal private information or change access permissions.",
  professional_referral: "For personalized investment, legal or tax advice, please speak with an appropriately qualified professional. I can explain sourced banking product information.",
  human_contact: "You can book a call with a Raiffeisen specialist below: pick a time, and nothing is booked until you press Book call. The specialist goes through the information with you; it isn't financial advice or a credit decision. You can also reach Raiffeisen at a branch or through raiffeisen.ro.",
  memory: "Persistent memory is not enabled in this chat. I can use details within this conversation, but have not saved them for future chats.",
  clarify: "Which banking product or goal would you like help with, and what would you like to know about it?",
  unavailable: "I cannot verify the information needed to answer right now. Please try again or contact Raiffeisen through its official support channels.",
};

/** What each pattern is called on a choice chip, in the customer's words. */
export const CHOICE_LABELS: Record<Inquiry, string> = {
  purchase_goal: "Plan how to pay for something", product_comparison: "Compare products or banks", affordability: "Check what I can afford",
  debt_refinancing: "Deal with existing debts", saving_goal: "Save towards a goal", product_explanation: "Explain a product or term", listing: "List my options",
  fees_statements: "Explain a charge", life_event: "Plan for a life change", cash_shortfall: "Cover a short-term gap",
  security_complaint: "Report a problem", negotiation: "Get a better offer", expense_insights: "Understand my spending",
  professional_advice: "Investment, tax or legal advice", human_contact: "Talk to someone at the bank", other: "Something else",
};

const INPUT_LEADS: Partial<Record<Inquiry, string>> = {
  purchase_goal: "To compare ways to pay for it, I need a couple of details.",
  product_comparison: "To compare them on equal terms, I need a couple of details.",
  affordability: "To check what fits your budget, I need a few figures.",
  debt_refinancing: "To compare keeping, refinancing or prepaying your debts, I need a few details.",
  saving_goal: "To work out a saving plan, I need a couple of details.",
  cash_shortfall: "To compare short-term options, I need a couple of details.",
  negotiation: "To compare the offers on the same basis, I need a few details.",
};

export function inputsRequestText(inquiry: Inquiry, fields: InputField[], round: number): string {
  const lead = round > 1 ? "Thanks. One more thing before I compare options." : INPUT_LEADS[inquiry] ?? "I need a couple of details first.";
  return `${lead} ${fields.map(f => f.question).join(" ")}`;
}

export function routeResponse(plan: RoutePlan, extra: { inputs?: { fields: InputField[]; round: number } } = {}): RagAnswer {
  const text = plan.handler === "collect_inputs" && extra.inputs && plan.inquiry ? inputsRequestText(plan.inquiry, extra.inputs.fields, extra.inputs.round)
    : plan.handler === "clarify" && plan.candidates.length >= 2 ? "I want to make sure I help with the right thing. Which of these is closest?"
    : plan.reason === "explicit_memory_request" ? RESPONSES.memory!
    : plan.reason === "catalog_required" ? "Verified product prices are not available in this preview, so I cannot confirm exact rates, fees or amounts. Please check the bank's official product page or an adviser. I can help explain sourced conditions and documents."
    : plan.reason === "confirm_track_before_access" ? "Is this about a product for you personally or for a business? This chat uses your personal banking profile."
    : plan.reason === "uncertain_goal_count" ? "Which financial goal would you like us to work through first?"
    : RESPONSES[plan.handler] ?? RESPONSES.unavailable!;
  return ragAnswerSchema.parse({ status: "no_results", text, segments: [{ text, sourceIds: [] }], sources: [],
    checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 },
    model: "deterministic", promptVersion: "route-response@1", searches: [], retrieval: [] });
}

/**
 * Exact financial figures require the reviewed catalog, even when a number occurs in a RAG passage.
 * Amounts the customer stated themselves (`customerFigures`) may be repeated back.
 */
export function containsFinancialFigure(text: string, customerFigures: number[] = []): boolean {
  const normalized = text.normalize("NFKC").replace(/\d[\d.,\s]*\d|\d/g, token => {
    const value = parseNumber(token.trim());
    return value !== null && customerFigures.includes(value) ? "N" : token;
  });
  return /\d[\d.,\s]*(?:%|RON\b|EUR\b|lei\b|leu\b|euros?\b|basis points?\b)/i.test(normalized)
    || /\b(?:APR|DAE|interest rate|fee|commission|comision|dobanda)\b[^.!?\n]{0,40}\d/i.test(normalized)
    || /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\s+(?:percent|lei|euros?)\b/i.test(normalized);
}

/** Build the UI contract from checked evidence; the model cannot invent block kinds or actions. */
export function composeAnswer(id: string, plan: RoutePlan, rag: RagAnswer, extra: { inputs?: { fields: InputField[]; round: number }; followups?: string[] } = {}) {
  const mode = ["crisis", "fraud", "hardship"].includes(plan.handler) ? plan.handler
    : (plan.handler === "answer" || plan.handler === "orchestrator") && rag.status === "answered" ? "normal" : "degraded";
  const text = rag.status === "failed_checks" || rag.status === "refused"
    ? "I couldn't verify a supported answer. Please rephrase the question or contact a Raiffeisen adviser." : rag.text;
  const followups = mode === "normal" ? extra.followups ?? ["What conditions should I check?", "Which official documents should I read?"] : [];
  const asking = plan.handler === "collect_inputs" && extra.inputs;
  const choosing = plan.handler === "clarify" && plan.candidates.length >= 2;
  const actions = asking ? [{ kind: "skip_inputs", label: "Skip, show typical examples", prompt: "Skip the details and show me typical examples." }]
    : choosing ? plan.candidates.map(inquiry => ({ kind: "choose", label: CHOICE_LABELS[inquiry], prompt: CHOICE_LABELS[inquiry], inquiry }))
    : followups.map(prompt => ({ kind: "followup", label: prompt, prompt }));
  return answerEnvelopeSchema.parse({ id, locale: "en-GB", pattern: plan.inquiry ?? "freeform", mode: asking || choosing ? "normal" : mode, text,
    blocks: asking ? [{ type: "inputs_request", pattern: plan.inquiry, round: extra.inputs!.round, fields: extra.inputs!.fields }]
      : rag.status === "answered" ? [
        // Checked answer cards first (lib/agent/blocks.ts), then the cited text segments.
        // Model-filled cards (checked) and code-built cards such as the spending summary
        ...(rag.cards ?? []).flatMap((c): unknown[] => {
          const card = answerCardSchema.safeParse(c);
          if (card.success) return [card.data];
          const built = z.union([spendingBlockSchema, offerBlockSchema, compareBlockSchema]).safeParse(c);
          return built.success ? [built.data] : [];
        }),
        ...rag.segments.filter(s => s.sourceIds.length > 0).map(s => ({ type: "callout", state: "ready", text: s.text, sourceIds: s.sourceIds })),
      ] : [],
    sources: rag.status === "answered" ? rag.sources.map(s => ({ id: s.id, label: s.title, publisher: s.url.startsWith("raiffy:") ? "Raiffy" : new URL(s.url).hostname, date: s.collectedOn, url: s.url })) : [],
    actions,
    flags: { aiDisclosure: true, suppressOffers: mode !== "normal" || plan.suppressOffers || plan.inquiry === "negotiation", indicativeOnly: true, staleData: [] } });
}

import { CHOICE_LABELS, composeAnswer, offersSpecialist, routeResponse } from "../../lib/agent/composer";
import { checkCards, type AnswerCard } from "../../lib/agent/blocks";
import { CHAT_CARDS, type SeedCard } from "./chatCards";
import { AGENT_POLICY } from "../../lib/agent/config";
import { routePlanSchema, type RoutePlan } from "../../lib/agent/route";
import { ragAnswerSchema, type RagAnswer, type RagSource } from "../../lib/rag/answer";
import type { Citable } from "../../lib/rag/answer";
import type { SectionType } from "../../lib/rag/schemas";
import { PRODUCTS, type ChatScript, type Cite, type ProductKey, type Turn } from "./chatScripts";

/*
 * Turns a scripted chat (chatScripts.ts) into the rows a live chat would leave: user and assistant messages, each
 * answer in the stored shape convex/agent.ts saves (the checked RagAnswer, its routing and the UI envelope from
 * composeAnswer), the sentiment labels and the votes. Pure: the cited page passages and the sample customer's holdings
 * come in. Answer cards come from chatCards.ts and pass the same checkCards as a live answer's; follow-ups name the
 * options a card shows, and a specialist is offered at most once per chat, as in a live conversation.
 */

/** A public page passage (a `ragChunks` row), with its display label from lib/rag/titles. */
export type Passage = { chunkId: string; label: string; url: string; text: string; scrapedAt: string; sectionType: SectionType; docType?: string };

/** The `ragChunks` chunkId a citation like "savings#description-7" names. */
export const chunkIdOf = (cite: `${ProductKey}#${string}`) => {
  const [key, section] = cite.split("#") as [ProductKey, string];
  return `${PRODUCTS[key]}#${section}`;
};

export type SeedMessage =
  | { role: "user"; text: string; reply?: { kind: "choose"; inquiry: string }; sentiment: Turn["sentiment"]; about: Turn["about"]; inquiry: string }
  | { role: "assistant"; text: string; status: "done"; answer: Record<string, unknown>; vote?: { vote: "up" | "down"; reason?: string };
      trace: { inquiry: string | null; handler: string; status: RagAnswer["status"]; tools: { name: string; kinds?: string[] }[] } }
  | { role: "assistant"; text: ""; status: "stopped" }
  | { role: "assistant"; text: ""; status: "failed"; error: string };

export type SeedChat = { id: string; ownerKey: string; title: string; track: "personal" | "business"; entry: "web" | "smartMobile"; messages: SeedMessage[] };

export const SEED_OWNER_PREFIX = "seed|";
const NOTICE = "This is dated public information, not a binding offer; check the source dates below.";
const FAILED = "Raiffy couldn't verify an answer. Please try again.";

function plan(chat: ChatScript, p: Partial<RoutePlan> & Pick<RoutePlan, "handler" | "reason" | "inquiry">): RoutePlan {
  return routePlanSchema.parse({
    policyVersion: AGENT_POLICY.version, classifierModel: "seed", memoryOperation: "none", memoryCandidate: null, confidence: 0.9,
    routingBasis: "confidence", candidates: [], scope: null, track: chat.track, suppressOffers: false, model: null,
    collections: [], tools: [], unavailable: [], limits: { publicChunks: 0, memories: 0 }, ...p,
  });
}

/** The passages and holdings an answer cites, as the fragments the number check reads. */
export function citedTexts(cites: Cite[], passages: Map<string, Passage>, holdings: Citable[]): string[] {
  return cites.map((c) => c.startsWith("@") ? holding(c, holdings).text : passage(c as `${ProductKey}#${string}`, passages).text);
}

function holding(cite: string, holdings: Citable[]) {
  const h = holdings.find((x) => x.chunkId.endsWith(`:${cite.slice(1)}`));
  if (!h) throw new Error(`No holding ${cite} for this chat's sample customer`);
  return h;
}
function passage(cite: `${ProductKey}#${string}`, passages: Map<string, Passage>) {
  const p = passages.get(chunkIdOf(cite));
  if (!p) throw new Error(`Passage ${chunkIdOf(cite)} isn't in ragChunks`);
  return p;
}

/** One source per cited page or holding, its passages grouped as assembleCitations (lib/rag/answer.ts) groups them. */
function sourcesFor(cites: Cite[], passages: Map<string, Passage>, holdings: Citable[], today: string): RagSource[] {
  const sources: RagSource[] = [];
  for (const c of cites) {
    const p = c.startsWith("@") ? (({ chunkId, label, url, text }) => ({ chunkId, label, url, text, scrapedAt: today, sectionType: "overview" as const }))(holding(c, holdings))
      : passage(c as `${ProductKey}#${string}`, passages);
    const same = sources.find((s) => s.url === p.url);
    if (same) { if (!same.chunkIds.includes(p.chunkId)) same.chunkIds.push(p.chunkId); continue; }
    sources.push({ id: `src-${sources.length + 1}`, url: p.url, title: p.label, collectedOn: p.scrapedAt.slice(0, 10), sectionType: p.sectionType,
      ...("docType" in p && p.docType ? { docType: p.docType as never } : {}), chunkIds: [p.chunkId] });
  }
  return sources;
}

/**
 * A turn's cards from chatCards.ts, each citation replaced by its page or holding URL and checked like a live answer's:
 * every figure must be in a passage or holding the answer cites, or the customer's own words. Throws on anything dropped.
 */
export function seedCards(key: string, cites: Cite[], passages: Map<string, Passage>, holdings: Citable[], said: readonly string[]): AnswerCard[] {
  const cards = CHAT_CARDS[key];
  if (!cards) return [];
  const urlOf = (cite: string) => {
    if (!cites.includes(cite as Cite)) throw new Error(`${key}: a card cites ${cite}, which the answer doesn't`);
    return cite.startsWith("@") ? holding(cite, holdings).url : passage(cite as `${ProductKey}#${string}`, passages).url;
  };
  const resolve = (v: unknown): unknown => Array.isArray(v) ? v.map(resolve)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "source" && typeof x === "string" ? urlOf(x) : resolve(x)])) : v;
  const evidence = cites.map((c) => c.startsWith("@") ? { url: holding(c, holdings).url, text: holding(c, holdings).text, collectedAt: "" }
    : (({ url, text, scrapedAt }) => ({ url, text, collectedAt: scrapedAt }))(passage(c as `${ProductKey}#${string}`, passages)));
  const checked = checkCards({ cards: resolve(cards) as SeedCard[] }, evidence, said);
  if ("error" in checked) throw new Error(`${key}: ${checked.error}`);
  if (checked.dropped.length) throw new Error(`${key}: ${checked.dropped.join("; ")}`);
  return checked.cards;
}

/** Follow-up replies that name the options a card shows, so a tap routes on its own (lib/agent/composer.ts followUps). */
function cardFollowUps(cards: readonly AnswerCard[]): string[] | undefined {
  for (const c of cards) {
    if (c.type === "routes") {
      const pick = c.recommendation.option, alt = c.routes.find((r) => r.name !== pick)?.name;
      return [`What do I need for ${pick}?`, ...(alt ? [`Compare ${pick} with ${alt} for my situation`] : [])];
    }
    if (c.type === "comparison") {
      const [a, b] = c.options.map((o) => o.name);
      return [`What do I need to apply for ${c.recommendation?.option ?? a}?`, ...(b ? [`Which costs less overall, ${a} or ${b}?`] : [])];
    }
  }
  return undefined;
}

/** The answer field convex/agent.ts stores: the RagAnswer plus routing, verification and the UI envelope. */
function stored(id: string, p: RoutePlan, answer: RagAnswer, extra: { followups?: string[]; specialistOffered?: boolean } = {}) {
  const ui = composeAnswer(id, p, answer, extra);
  const verification = { status: answer.status, checks: answer.checks, searches: answer.searches, model: answer.model, financialTermsSupported: answer.status === "answered" };
  return {
    ...answer,
    routing: { handler: p.handler, inquiry: p.inquiry, confidence: p.confidence, classifierModel: p.classifierModel, collections: p.collections,
      unavailable: p.unavailable, reason: p.reason, basis: p.routingBasis, candidates: p.candidates, fallbackUsed: false, inputs: null },
    classifierConfidences: {}, inquiryProbabilities: {}, verification, ui,
    /** Marks test data from convex/seed/chats.ts */
    seeded: true,
  };
}

export function buildChat(chat: ChatScript, passages: Map<string, Passage>, holdings: Citable[], today: string): SeedChat {
  const messages: SeedMessage[] = [];
  let offered: string[] = [];
  // A specialist is offered once per conversation (lib/agent/handoff.ts), so the seeded chats carry the same state.
  let specialistOffered = false;
  const said = chat.turns.map((x) => x.user);
  const keep = (p: RoutePlan, answer: Record<string, unknown>) => {
    if (offersSpecialist(answer.ui as Parameters<typeof offersSpecialist>[0], p.handler)) specialistOffered = true;
    return answer;
  };
  chat.turns.forEach((turn, i) => {
    const r = turn.reply, id = `${chat.id}-a${i + 1}`;
    // A tap on a choice Raiffy just offered is sent with its label, as the chat's choice buttons do.
    const tapped = offered.find((inq) => CHOICE_LABELS[inq as keyof typeof CHOICE_LABELS] === turn.user);
    const inquiry = r.k === "clarify" ? "unknown" : (r.k === "route" ? r.inquiry : r.inquiry) ?? "unknown";
    messages.push({ role: "user", text: turn.user, sentiment: turn.sentiment, about: turn.about, inquiry,
      ...(tapped ? { reply: { kind: "choose" as const, inquiry: tapped } } : {}) });
    offered = r.k === "clarify" ? r.candidates : [];
    const basis = tapped ? { routingBasis: "choice" as const } : {};

    if (r.k === "stopped") { messages.push({ role: "assistant", text: "", status: "stopped" }); return; }
    if (r.k === "failed") { messages.push({ role: "assistant", text: "", status: "failed", error: FAILED }); return; }
    const vote = "vote" in r && r.vote ? { vote: r.vote[0], ...(r.vote[1] ? { reason: r.vote[1] } : {}) } : undefined;

    if (r.k === "clarify") {
      const p = plan(chat, { handler: "clarify", reason: "low_confidence", inquiry: null, candidates: r.candidates, confidence: 0.45 });
      const answer = routeResponse(p);
      messages.push({ role: "assistant", text: answer.text, status: "done", answer: keep(p, stored(id, p, answer, { specialistOffered })), trace: { inquiry: null, handler: "clarify", status: answer.status, tools: [] } });
      return;
    }
    if (r.k === "route") {
      const p = plan(chat, { handler: r.handler, reason: "classified", inquiry: r.inquiry, ...basis });
      const answer = routeResponse(p);
      messages.push({ role: "assistant", text: answer.text, status: "done", answer: keep(p, stored(id, p, answer, { specialistOffered })), ...(vote ? { vote } : {}),
        trace: { inquiry: r.inquiry, handler: r.handler, status: answer.status, tools: [] } });
      return;
    }
    const sources = sourcesFor(r.cite ?? [], passages, holdings, today);
    const ids = sources.map((s) => s.id);
    const text = sources.length ? `${r.text}\n\n${NOTICE}` : r.text;
    const cards = seedCards(`${chat.id}#${i}`, r.cite ?? [], passages, holdings, said);
    const answer = ragAnswerSchema.parse({
      ...(cards.length ? { cards } : {}),
      status: "answered", text, segments: [{ text: r.text, sourceIds: ids }, ...(sources.length ? [{ text: ` ${NOTICE}`, sourceIds: [] }] : [])], sources,
      checks: { ungroundedNumbers: [], uncitedSegmentsWithNumbers: 0, attempts: 1 }, model: "seed", promptVersion: "seed-chats@1", searches: [], retrieval: [],
    });
    const p = plan(chat, { handler: r.multi ? "orchestrator" : "answer", reason: r.multi ? "multiple_goals" : "classified", inquiry: r.inquiry, scope: r.scope ?? null, ...basis });
    const kinds = [...new Set((r.cite ?? []).filter((c) => c.startsWith("@")).map((c) => KIND[c.slice(1).split("_")[0]!]!))];
    const tools = kinds.length ? [{ name: "get_holdings", kinds }] : [];
    const followups = cardFollowUps(cards);
    messages.push({ role: "assistant", text: answer.text, status: "done", answer: keep(p, stored(id, p, answer, { specialistOffered, ...(followups ? { followups } : {}) })),
      ...(vote ? { vote } : {}), trace: { inquiry: r.inquiry, handler: p.handler, status: answer.status, tools: [...tools, ...(cards.length ? [{ name: "show_cards" }] : [])] } });
  });
  return { id: chat.id, ownerKey: `${SEED_OWNER_PREFIX}${chat.id}`, title: chat.title, track: chat.track, entry: chat.entry, messages };
}

/** Holding ref prefixes (lib/bank/schemas.ts) to get_holdings kinds */
const KIND: Record<string, string> = { acc: "accounts", sav: "savings", dep: "savings", loan: "loans", card: "cards", offer: "offers" };

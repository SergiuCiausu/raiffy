import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";

/*
 * Typed references to the agent functions in ../convex/agent.ts. The web app is built on its own (turbopack.root
 * is web/), so it can't import Convex's generated `api`; these mirror the function signatures instead.
 * Keep them in step with convex/agent.ts.
 */

export type Track = "personal" | "business";
export type ThreadId = GenericId<"ragThreads">;
export type MessageId = GenericId<"ragMessages">;

export type Source = {
  id: string;
  url: string;
  title: string;
  /** YYYY-MM-DD */
  collectedOn: string;
  sectionType: string;
  docType?: string;
};

/** The parts of lib/rag/answer.ts's RagAnswer the chat shows. */
export type Answer = {
  status: "answered" | "no_results" | "refused" | "failed_checks";
  text: string;
  segments: { text: string; sourceIds: string[] }[];
  sources: Source[];
  searches: { query: string; collection: string; status: "ok" | "unavailable"; results: number }[];
  routing?: { handler: string; inquiry: string | null; confidence: number | null; classifierModel: string | null; reason: string };
  ui?: { flags: { aiDisclosure: true; suppressOffers: boolean }; blocks?: UiBlock[]; actions: UiAction[] };
};

/** Mirrors lib/agent/inputs.ts InputField: one missing required input Raiffy asks for. */
export type InputField = {
  key: string; label: string; question: string; hint?: string;
  kind: "amount" | "months" | "percent" | "choice" | "options"; unit?: "RON" | "months" | "%";
  min?: number; max?: number; options?: { value: string; label: string }[];
};
/** Mirrors lib/agent/blocks.ts. Every figure was checked against `source`, the URL of one of the answer's sources. */
export type CardFact = { label: string; value: string; source?: string };
export type CardRecommendation = { option: string; reasons: string[]; whenOther: string };
export type AnswerCardBlock =
  | { type: "comparison"; title: string; options: { name: string; provider?: string; isRaiffeisen: boolean; facts: CardFact[] }[]; recommendation?: CardRecommendation }
  | { type: "routes"; title: string; routes: { name: string; summary: string; fit: string; facts: CardFact[]; chosen?: boolean }[]; recommendation: CardRecommendation }
  | { type: "keyFacts"; title: string; facts: CardFact[] }
  | { type: "checklist"; title: string; items: { text: string; detail?: string; source?: string }[] }
  | { type: "handoff"; title: string; reason: string }
  /** A loan rate copied from `source`; payments are computed here (lib/finance.ts), never sent by the model. */
  | { type: "simulation"; title: string; product: string; ratePercent: number; rateMaxPercent?: number; source: string; rateFor?: string;
      termMaxMonths?: number; fees?: CardFact[]; amount?: number; months?: number; income?: number; obligations?: number;
      maxDebtRatio?: { percent: number; source: string } };
/** Mirrors lib/expenses/schemas.ts SpendingBlock: built by code from a cited account summary. Amounts in bani. */
export type SpendingBlock = {
  type: "spending"; synthetic: true; period: { from: string; to: string; months: number }; sourceUrl: string;
  income?: number; outgoings?: number; total?: number;
  categories: { category: string; amount: number; previous: number }[];
  insights: { kind: "overdraftCost" | "atmFees" | "fxCardFees" | "idleCash" | "subscriptions"; figures: Record<string, number>; needs: string[] }[];
  notUsed: AccessSwitch[];
};
/** Mirrors lib/pricing/schemas.ts OfferBlock: built by code from the pricing tool. Bani and basis points. Sample pricing. */
export type PriceLine = { id: string; label: string; rateBps: number; upfrontFee: number; monthlyFee: number; monthly: number; totalPayable: number; daeBps: number;
  conditions: string[]; qualifies: boolean; requiredProducts: { label: string; monthlyCost: number }[] };
export type OfferBlock = {
  type: "offer"; synthetic: true; sourceUrl: string; competitorUrl?: string; logId?: string;
  resolution: "quote" | "not_needed" | "band" | "escalate" | "evidence_needed" | "affordability";
  quote: { productId: string; product: string; amount: number; months: number; unconditional: PriceLine; conditional: PriceLine[]; current: PriceLine;
    personalOffer?: { issuedBy?: { name: string; role: string }; validUntil: string }; expiredOffer?: { validUntil: string }; couldBeBetter: boolean };
  competitor?: { bank: string; sourceLabel: string; source: "official_store" | "client_secci" | "client_claim"; rateBps: number; upfrontFee: number; monthly: number; totalPayable: number; daeBps: number };
  offer?: { levers: { kind: "feeWaiver" | "marginCut"; label: string; deltaBps?: number; amount?: number }[]; line: PriceLine; validUntil: string };
};
/** Mirrors lib/compare/block.ts CompareBlock: the comparison card's fixed rows, built by code. Bani, basis points and months. */
export type CompareCellValue = { type: "exact"; amount: number } | { type: "range"; min: number; max: number } | { type: "from"; min: number }
  | { type: "up_to"; max: number } | { type: "text"; text: string };
export type CompareCell =
  | { state: "value"; value: CompareCellValue; unit: "bps" | "minor_ron" | "minor_eur" | "months" | "years" | "days" | "none";
      frequency?: "once" | "monthly" | "yearly"; source: { url: string; collectedAt?: string } | null; termId: string | null; computed: boolean }
  | { state: "not_confirmed"; reason: string; termId: string | null }
  | { state: "not_in_sources" };
export type CompareRowKey = "total_cost" | "monthly_payment" | "dae" | "interest_rate" | "amount" | "term" | "origination_fee" | "administration_fee"
  | "early_repayment_fee" | "insurance" | "documents_always" | "documents_sometimes" | "documents_online";
export type CompareBlock = {
  type: "compare_table"; title: string;
  table: {
    focus: "costs" | "documents";
    products: { productId: string | null; name: string; provider?: string; isRaiffeisen: boolean }[];
    groups: { key: "cost" | "amounts" | "commissions" | "documents"; rows: { key: CompareRowKey; cells: CompareCell[] }[] }[];
    deciding: CompareRowKey | null; best: number | null; scenario: { amount: number; months: number } | null; paymentUnavailable: boolean;
  };
  recommendation?: CardRecommendation;
};
export type UiBlock =
  | { type: "callout"; state: "ready" | "unavailable"; text: string; sourceIds: string[] }
  | { type: "inputs_request"; pattern: string; round: number; fields: InputField[] }
  | AnswerCardBlock
  | SpendingBlock
  | OfferBlock
  | CompareBlock;
/** Account sources (`raiffy:account/...`) aren't web pages: show them as chips without a link. */
export const isWebSource = (url: string) => /^https?:/i.test(url);
export const CARD_TYPES: readonly AnswerCardBlock["type"][] = ["comparison", "routes", "keyFacts", "checklist", "handoff", "simulation"];
export type UiAction =
  | { kind: "followup"; label: string; prompt: string }
  | { kind: "choose"; label: string; prompt: string; inquiry: string }
  | { kind: "skip_inputs"; label: string; prompt: string };
/** Structured part of a customer reply; the server accepts it only for what Raiffy offered in this thread. */
export type Reply =
  | { kind: "choose"; inquiry: string }
  | { kind: "inputs"; values: Record<string, string | number | string[]> }
  | { kind: "skip_inputs" };

export type Step = { query: string; focus: string; results?: number };

export type Message = {
  _id: MessageId;
  _creationTime: number;
  threadId: ThreadId;
  role: "user" | "assistant";
  text: string;
  answer?: Answer;
  /** Absent on rows written before streaming existed: those are done. */
  status?: "streaming" | "done" | "stopped" | "failed";
  steps?: Step[];
  error?: string;
};

export type ThreadSummary = { _id: ThreadId; _creationTime: number; title: string; track: Track };

export type VoteReason = "wrong" | "unclear" | "missing" | "other";
export const VOTE_REASONS: readonly [VoteReason, string][] = [["wrong", "Wrong"], ["unclear", "Unclear"], ["missing", "Missing information"], ["other", "Something else"]];

export const agentApi = {
  run: makeFunctionReference<"action", { messageId: MessageId }, null>("agent:run"),
  send: makeFunctionReference<"mutation", { question: string; track: Track; threadId?: ThreadId; reply?: Reply }, { threadId: ThreadId; messageId: MessageId }>("agent:send"),
  stop: makeFunctionReference<"mutation", { messageId: MessageId }, null>("agent:stop"),
  /** A thumbs up or down, with an optional reason after a thumbs down. Labels only, for the Console's Sentiment page. */
  rate: makeFunctionReference<"mutation", { messageId: MessageId; vote: "up" | "down"; reason?: VoteReason }, null>("sentiment:rate"),
  listThreads: makeFunctionReference<"query", { limit?: number }, ThreadSummary[]>("agent:listThreads"),
  listMessages: makeFunctionReference<"query", { threadId: ThreadId }, Message[]>("agent:listMessages"),
};

/** "What Raiffy can see" (convex/accounts.ts). In the preview the account is a sample persona. */
/** The six "What Raiffy can see" switches, mirroring lib/bank/schemas.ts SWITCHES. */
export type AccessSwitch = "account" | "transactions" | "savings" | "offers" | "loans" | "cards";
export type Access = { persona: string | null; assigned: string | null; personas: { id: string; label: string; summary: string }[] } & Record<AccessSwitch, boolean>;
export const accountsApi = {
  getAccess: makeFunctionReference<"query", Record<string, never>, Access>("accounts:getAccess"),
  resetSample: makeFunctionReference<"mutation", Record<string, never>, null>("accounts:resetSample"),
  setAccess: makeFunctionReference<"mutation", { persona?: string | null } & Partial<Record<AccessSwitch, boolean>>, null>("accounts:setAccess"),
};

/** Negotiation (convex/pricing.ts): the customer's consent to a review and simulated outcomes; operators' queue and KPI. */
export type LogId = GenericId<"counterOfferLogs">;
export type NegotiationStatus = { logId: LogId; outcome: "pending" | "accepted" | "declined" | "expired"; review: "requested" | "approved" | "declined" | null;
  approvedOffer: { rateBps: number; totalPayable: number; validUntil: string; approvedBy: string | null } | null };
export type ReviewCaseView = { id: GenericId<"reviewCases">; status: "open" | "approved" | "declined"; level: string; levelLabel: string; canDecide: boolean; product: string;
  segment: string; amount: number; months: number; competitor: { id: string; bank: string; source: string; totalPayable: number }; ourTotal: number;
  neededCutBps: number | null; createdAt: number; decidedBy: string | null; note: string | null };
export type WinRateRow = { key: string; offered: number; accepted: number; declined: number; expired: number; pending: number; winRate: number | null; averageGap: number };
export type WinRate = { total: number; notNeeded: number; evidenceNeeded: number; byProduct: WinRateRow[]; bySegment: WinRateRow[]; byCompetitor: WinRateRow[];
  byResolution: WinRateRow[]; reasonsLost: [string, number][] };
export const pricingApi = {
  myNegotiations: makeFunctionReference<"query", { logIds: LogId[] }, NegotiationStatus[]>("pricing:myNegotiations"),
  requestReview: makeFunctionReference<"mutation", { logId: LogId }, null>("pricing:requestReview"),
  setOutcome: makeFunctionReference<"mutation", { logId: LogId; outcome: "accepted" | "declined"; reasonLost?: "price" | "conditions" | "speed" | "other" }, null>("pricing:setOutcome"),
  listReviews: makeFunctionReference<"query", Record<string, never>, { open: ReviewCaseView[]; decided: ReviewCaseView[] }>("pricing:listReviews"),
  decideReview: makeFunctionReference<"mutation", { caseId: GenericId<"reviewCases">; decision: "approve" | "decline"; rateBps?: number; waiveFee?: boolean; note?: string }, null>("pricing:decideReview"),
  winRate: makeFunctionReference<"query", Record<string, never>, WinRate>("pricing:winRate"),
};

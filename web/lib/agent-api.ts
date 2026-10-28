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
  ui?: { flags: { aiDisclosure: true; suppressOffers: boolean }; actions: { kind: "followup"; label: string; prompt: string }[]; blocks?: Block[] };
};

/** One route card, reshaped by the backend composer from the checked answer's route list (lib/agent/routes.ts). */
export type RouteCard = { title: string; recommended: boolean; summary: string; mainRisk?: string; why?: string; sourceIds: string[] };
/** `start`/`end` locate the route list in the joined segment text; the cards replace it on screen. */
export type RoutesBlock = { type: "routes"; state: "partial"; start: number; end: number; routes: RouteCard[] };
export type MemoryKind = "goal" | "preference" | "constraint" | "stated_financial";
/** Memories Claude proposed this turn; each waits for the customer's Remember or Not now (convex/memory.ts). */
export type MemoryBlock = { type: "memory"; proposals: { id: string; kind: MemoryKind; text: string; customerQuote: string }[] };
export type Block = { type: "callout"; state: "ready" | "unavailable"; text: string; sourceIds: string[] } | RoutesBlock | MemoryBlock;

export type MemoryView = { id: string; kind: MemoryKind; text: string; statedAt: number; updatedAt: number; expiresAt: number };
export type ProposalView = { id: string; operation: "remember" | "update"; kind: MemoryKind; text: string; customerQuote: string; createdAt: number; expiresAt: number };
type MemoryChange = { status: "proposed" | "saved" | "rejected" | "forgotten"; id: string };

/** The customer's own memory store. Every call is scoped to the signed-in identity on the server. */
export const memoryApi = {
  listMine: makeFunctionReference<"query", { track: Track }, { memories: MemoryView[]; proposals: ProposalView[] }>("memory:listMine"),
  confirm: makeFunctionReference<"mutation", { track: Track; proposalId: string }, MemoryChange>("memory:confirm"),
  reject: makeFunctionReference<"mutation", { track: Track; proposalId: string }, MemoryChange>("memory:reject"),
  forgetOne: makeFunctionReference<"mutation", { track: Track; memoryId: string }, MemoryChange>("memory:forgetOne"),
  forgetAll: makeFunctionReference<"mutation", { track: Track }, { memoriesDeleted: number; proposalsDeleted: number }>("memory:forgetAll"),
};

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

export const agentApi = {
  run: makeFunctionReference<"action", { messageId: MessageId }, null>("agent:run"),
  send: makeFunctionReference<"mutation", { question: string; track: Track; threadId?: ThreadId }, { threadId: ThreadId; messageId: MessageId }>("agent:send"),
  stop: makeFunctionReference<"mutation", { messageId: MessageId }, null>("agent:stop"),
  listThreads: makeFunctionReference<"query", { limit?: number }, ThreadSummary[]>("agent:listThreads"),
  listMessages: makeFunctionReference<"query", { threadId: ThreadId }, Message[]>("agent:listMessages"),
};

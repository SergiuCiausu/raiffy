import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type { MessageId, ThreadId, Track, UiBlock } from "./agent-api";

/** The customer's edits to their own chats (convex/chatThreads.ts): renaming one, and pins in the Context panel. */
export type PinKind = "comparison" | "compare_table" | "routes" | "keyFacts" | "checklist" | "simulation" | "offer" | "spending" | "affordability";
export type PinView = { id: GenericId<"chatPins">; threadId: ThreadId; messageId: MessageId; kind: PinKind; title: string; meta: string; createdAt: number };
export type PinInput = { kind: PinKind; title: string; meta: string };

export const chatApi = {
  rename: makeFunctionReference<"mutation", { threadId: ThreadId; title: string }, { title: string }>("chatThreads:rename"),
  listPins: makeFunctionReference<"query", { track: Track }, PinView[]>("chatThreads:listPins"),
  pin: makeFunctionReference<"mutation", { messageId: MessageId } & PinInput, { id: GenericId<"chatPins"> }>("chatThreads:pin"),
  unpin: makeFunctionReference<"mutation", { pinId: GenericId<"chatPins"> }, { removed: boolean }>("chatThreads:unpin"),
};

const names = (list: { name: string }[]) => list.slice(0, 3).map((x) => x.name).join(" vs ");
const months = (n?: number | null) => n ? ` · ${n} months` : "";

/**
 * What a pin says about an answer's first pinnable card (chat.html PIN_META): the card's own title and a short line
 * that names what it covers. No figures beyond counts and months, so a pin never repeats a number without its source.
 */
export function pinFor(blocks: readonly UiBlock[]): PinInput | null {
  for (const b of blocks) {
    switch (b.type) {
      case "comparison": return { kind: b.type, title: b.title, meta: names(b.options) };
      case "compare_table": return { kind: b.type, title: b.title, meta: names(b.table.products) };
      case "routes": if ("title" in b) return { kind: b.type, title: b.title, meta: `${b.routes.length} routes` }; break;
      case "keyFacts": return { kind: b.type, title: b.title, meta: `${b.facts.length} facts` };
      case "checklist": return { kind: b.type, title: b.title, meta: `${b.items.length} items` };
      case "simulation": return { kind: b.type, title: "Repayment simulation", meta: `${b.title}${months(b.months)}` };
      case "offer": return { kind: b.type, title: "Counter-offer", meta: `${b.quote.product} · sample pricing` };
      case "spending": return { kind: b.type, title: "Where your money went", meta: `Sample data${months(b.period.months)}` };
      case "affordability": return { kind: b.type, title: "Affordability check", meta: `Indicative${months(b.inputs.termMonths)}` };
    }
  }
  return null;
}

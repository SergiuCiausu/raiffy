import { z } from "zod";
import { inquirySchema, type Inquiry } from "./confidence";
import { knownInputSchema, pendingInputsSchema, type KnownInput, type PendingInputs, type ResolvedInputs, type SlotKey, type Values } from "./inputs";

/** Per-conversation routing state, stored with the thread. Only the customer's stated inputs live here, never bank terms. */
export const conversationStateSchema = z.object({
  version: z.literal(1),
  inquiry: inquirySchema.nullable(),
  scope: z.enum(["compare", "solution", "detail", "list"]).nullable(),
  inputs: z.record(z.string(), knownInputSchema),
  pending: pendingInputsSchema.nullable(),
  /** Labels Raiffy offered as choices on its last turn; a tapped choice is accepted only if it was offered. */
  offered: z.array(inquirySchema),
});
export type ConversationState = Omit<z.infer<typeof conversationStateSchema>, "pending" | "inputs"> & {
  pending: PendingInputs | null; inputs: Partial<Record<SlotKey, KnownInput>>;
};

export const EMPTY_STATE: ConversationState = { version: 1, inquiry: null, scope: null, inputs: {}, pending: null, offered: [] };

export function readState(raw: unknown): ConversationState {
  const parsed = conversationStateSchema.safeParse(raw);
  return parsed.success ? parsed.data as ConversationState : EMPTY_STATE;
}

/** Earlier answers, as input values the resolver can fall back to. */
export function conversationValues(state: ConversationState): Values {
  return Object.fromEntries(Object.entries(state.inputs).map(([k, x]) => [k, x!.value])) as Values;
}

/**
 * The classifier's recentContext: a short structured summary instead of raw transcript, so a reply like
 * "60 months, about 7,000 lei" is read against the question Raiffy actually asked.
 */
export function buildRecentContext(state: ConversationState, history: { role: "user" | "assistant"; text: string }[]): string {
  const lines: string[] = [];
  if (state.inquiry) lines.push(`Current pattern: ${state.inquiry}${state.scope ? ` (${state.scope})` : ""}.`);
  const known = Object.keys(state.inputs);
  if (known.length) lines.push(`Inputs the customer already gave: ${known.join(", ")}.`);
  if (state.pending) lines.push(`Raiffy just asked the customer for: ${state.pending.keys.join(", ")}.`);
  if (state.offered.length) lines.push(`Raiffy just asked which of these the customer meant: ${state.offered.join(", ")}.`);
  const tail = history.slice(-2).map(m => `${m.role === "user" ? "Customer" : "Raiffy"}: ${m.text.replace(/\s+/g, " ").slice(0, 600)}`);
  return [...lines, ...tail].join("\n").slice(-2000);
}

/** The state after this turn. Inputs carry over between patterns; a question that was answered is cleared. */
export function nextState(prev: ConversationState, turn: {
  inquiry: Inquiry | null; scope: ConversationState["scope"]; resolved?: ResolvedInputs; asked?: PendingInputs | null; offered?: Inquiry[];
}): ConversationState {
  const inputs = { ...prev.inputs };
  for (const [key, x] of Object.entries(turn.resolved?.known ?? {})) {
    if (x && x.source !== "default") inputs[key as SlotKey] = { value: x.value, source: x.source === "conversation" ? (prev.inputs[key as SlotKey]?.source ?? "conversation") : x.source };
  }
  return { version: 1, inquiry: turn.inquiry ?? prev.inquiry, scope: turn.scope ?? prev.scope, inputs, pending: turn.asked ?? null, offered: turn.offered ?? [] };
}

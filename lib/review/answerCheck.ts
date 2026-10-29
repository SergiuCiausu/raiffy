import { z } from "zod";
import { handoffPreview } from "../agent/handoff";
import { screenChat } from "../agent/privacy";

/*
 * Answer checks: the customer flags one answer for a specialist ("Ask a specialist" under it), the specialist confirms
 * it, corrects it with a signed note, or sends it back with a reason. The specialist checks information, never a credit
 * decision. What they see is a snapshot taken when the customer sent it, with identifiers masked. Pure: no storage here.
 */

export const ANSWER_CHECK_STATUSES = ["open", "confirmed", "corrected", "returned"] as const;
export const answerCheckStatusSchema = z.enum(ANSWER_CHECK_STATUSES);
export type AnswerCheckStatus = z.infer<typeof answerCheckStatusSchema>;

export const ANSWER_CHECK_NOTE_MAX = 500;
const note = z.string().trim().min(1).max(ANSWER_CHECK_NOTE_MAX);

export const answerCheckRequestSchema = z.object({ note: z.string().trim().max(ANSWER_CHECK_NOTE_MAX).optional() }).strict();

/** A correction or a return reaches the customer as the specialist wrote it, so both need a note; a confirmation doesn't. */
export const answerCheckDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("confirm") }).strict(),
  z.object({ decision: z.literal("correct"), note }).strict(),
  z.object({ decision: z.literal("return"), note }).strict(),
]);
export type AnswerCheckDecision = z.infer<typeof answerCheckDecisionSchema>;

const STATUS_FOR: Record<AnswerCheckDecision["decision"], Exclude<AnswerCheckStatus, "open">> = {
  confirm: "confirmed", correct: "corrected", return: "returned",
};

/** Decisions are final: only an open check can be decided, once. */
export function decide(status: AnswerCheckStatus, decision: AnswerCheckDecision): { ok: true; status: Exclude<AnswerCheckStatus, "open"> } | { ok: false; reason: "already_decided" } {
  return status === "open" ? { ok: true, status: STATUS_FOR[decision.decision] } : { ok: false, reason: "already_decided" };
}

type FlaggableMessage = { role: "user" | "assistant"; status?: "streaming" | "done" | "stopped" | "failed"; text: string; answer?: unknown };

/** Only a finished answer with text can be flagged: not one still streaming, stopped, failed or refused. */
export function canFlag(message: FlaggableMessage): boolean {
  if (message.role !== "assistant" || (message.status !== undefined && message.status !== "done") || !message.text.trim()) return false;
  const status = (message.answer as { status?: unknown } | undefined)?.status;
  return status === "answered" || status === "no_results";
}

export const answerSnapshotSchema = z.object({
  /** The customer's recent questions, masked, newest last. */
  questions: z.array(z.string()),
  /** The answer as the customer saw it, masked, one entry per paragraph. */
  paragraphs: z.array(z.string()).min(1),
  sources: z.array(z.object({ title: z.string(), url: z.string(), collectedOn: z.string() })),
  inquiry: z.string().nullable(),
  handler: z.string().nullable(),
  /** The number check's result for this answer; a specialist looks at these first. */
  ungroundedNumbers: z.number().int().nonnegative(),
  note: z.string().nullable(),
}).strict();
export type AnswerSnapshot = z.infer<typeof answerSnapshotSchema>;

/** Under screenChat's 4000, with room for redaction markers that are longer than what they replace. */
const PARAGRAPH_CHARS = 3800;

/**
 * What the specialist sees: the customer's questions and note screened like a handoff, the answer screened paragraph
 * by paragraph (it can echo what the customer typed), and the answer's sources and route. Unknown answer fields are
 * read defensively, because older messages predate some of them.
 */
export function answerSnapshot(input: { customerMessages: readonly string[]; answerText: string; answer: unknown; note?: string }): AnswerSnapshot {
  const a = (input.answer ?? {}) as {
    sources?: { title?: unknown; url?: unknown; collectedOn?: unknown }[];
    routing?: { inquiry?: unknown; handler?: unknown };
    checks?: { ungroundedNumbers?: unknown };
  };
  const str = (x: unknown) => typeof x === "string" ? x : null;
  const paragraphs = input.answerText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => p.length > PARAGRAPH_CHARS ? `${screenChat(p.slice(0, PARAGRAPH_CHARS)).text}…` : screenChat(p).text);
  const trimmed = input.note?.trim();
  return answerSnapshotSchema.parse({
    questions: handoffPreview(input.customerMessages),
    paragraphs,
    sources: (Array.isArray(a.sources) ? a.sources : []).flatMap((s) => {
      const title = str(s?.title), url = str(s?.url);
      return title && url ? [{ title, url, collectedOn: str(s.collectedOn) ?? "" }] : [];
    }),
    inquiry: str(a.routing?.inquiry),
    handler: str(a.routing?.handler),
    ungroundedNumbers: Array.isArray(a.checks?.ungroundedNumbers) ? a.checks.ungroundedNumbers.length : 0,
    note: trimmed ? screenChat(trimmed.slice(0, ANSWER_CHECK_NOTE_MAX)).text : null,
  });
}

/** A short reference the customer can quote, such as "AC-7K2Q9D". */
export function answerCheckReference(random: () => number): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `AC-${Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("")}`;
}

/** What the customer's chat shows under the answer. The reviewer is named only once the check is decided. */
export const answerCheckViewSchema = z.object({
  reference: z.string(),
  status: answerCheckStatusSchema,
  createdAt: z.number(),
  decidedAt: z.number().nullable(),
  reviewer: z.object({ name: z.string(), role: z.string() }).nullable(),
  note: z.string().nullable(),
});
export type AnswerCheckView = z.infer<typeof answerCheckViewSchema>;

import { z } from "zod";
import { screenChat } from "./privacy";
import type { RoutePlan } from "./route";

/** Why a customer is offered a human: the reasons of the request_human_handoff contract in prompt.ts. */
export const HANDOFF_REASONS = ["customer_request", "offer_review", "complaint", "missing_evidence", "hardship", "fraud"] as const;
export const handoffReasonSchema = z.enum(HANDOFF_REASONS);
export type HandoffReason = z.infer<typeof handoffReasonSchema>;

export const handoffActionSchema = z.object({ kind: z.literal("handoff"), label: z.string(), reason: handoffReasonSchema });
export type HandoffAction = z.infer<typeof handoffActionSchema>;

type Mode = "normal" | "hardship" | "crisis" | "fraud" | "degraded";

/** The one label for reaching a person: it opens the booking card with an operator, who checks information, never advises. */
export const SPECIALIST_LABEL = "Talk to a specialist";

/**
 * The specialist button an answer carries, if any. It is offered by code, only where a person is needed, and at most
 * once per conversation (`offered`), so it never trails every answer:
 *
 *   complaint                                   → always (a person must act on it)
 *   negotiation the pricing rules escalated      → once (`review`: a specialist reviews the price)
 *   an answer Raiffy couldn't verify             → once
 *   crisis, fraud, hardship                      → never: their text names the official channel (emergency, fraud line, support)
 *   everything else                              → never; the header's Talk to a specialist is always there
 *
 * The customer starts every booking themselves; Raiffy never books or claims a handoff on its own.
 */
export function handoffActionFor(plan: RoutePlan, mode: Mode, seen: { offered?: boolean; review?: boolean } = {}): HandoffAction | null {
  const action = (reason: HandoffReason): HandoffAction => ({ kind: "handoff", label: SPECIALIST_LABEL, reason });
  if (mode === "crisis" || mode === "fraud" || mode === "hardship") return null;
  if (plan.inquiry === "security_complaint") return action("complaint");
  if (seen.offered) return null;
  if (plan.inquiry === "negotiation" && seen.review) return action("offer_review");
  if (mode === "degraded" && plan.handler !== "clarify") return action("missing_evidence");
  return null;
}

export const HANDOFF_PREVIEW_MESSAGES = 6;
const PREVIEW_CHARS = 1500;

/**
 * What the adviser receives: the customer's own recent messages, screened again for card numbers, CNP, IBAN,
 * e-mail and phone numbers, newest last and capped. The customer sees exactly this before sending.
 */
export function handoffPreview(customerMessages: readonly string[]): string[] {
  const lines = customerMessages.slice(-HANDOFF_PREVIEW_MESSAGES).flatMap((text) => text.trim() ? [screenChat(text.slice(0, 4000)).text] : []);
  const kept: string[] = [];
  let used = 0;
  for (const line of [...lines].reverse()) {
    const room = PREVIEW_CHARS - used;
    if (room <= 0) break;
    kept.unshift(line.length > room ? `${line.slice(0, Math.max(0, room - 1))}…` : line);
    used += Math.min(line.length, room);
  }
  return kept;
}

/** A short reference the customer can quote, such as "RF-7K2Q9D". */
export function handoffReference(random: () => number): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `RF-${Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("")}`;
}

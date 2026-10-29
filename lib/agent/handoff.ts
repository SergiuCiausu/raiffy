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

/** Inquiries where a person can take the decision further than Raiffy can: a loan, a comparison, an offer. */
const ADVISER_INQUIRIES = new Set<RoutePlan["inquiry"]>(["purchase_goal", "product_comparison", "affordability", "debt_refinancing"]);

/**
 * The adviser button an answer carries, if any. The customer starts every request themselves, after seeing what
 * the adviser will receive; Raiffy never books or claims a handoff on its own. Crisis gets emergency help instead.
 */
export function handoffActionFor(plan: RoutePlan, mode: Mode): HandoffAction | null {
  const action = (reason: HandoffReason, label = "Talk to an adviser"): HandoffAction => ({ kind: "handoff", label, reason });
  if (mode === "crisis") return null;
  if (mode === "fraud") return action("fraud");
  if (mode === "hardship") return action("hardship");
  if (plan.inquiry === "security_complaint") return action("complaint");
  if (plan.inquiry === "negotiation") return action("offer_review", "Book an adviser");
  if (mode === "degraded" && plan.handler !== "clarify") return action("missing_evidence");
  if (mode === "normal" && ADVISER_INQUIRIES.has(plan.inquiry)) return action("customer_request", "Book an adviser");
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

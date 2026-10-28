import { z } from "zod";

export const screenedChatSchema = z.object({ text: z.string().min(1).max(4000), redacted: z.boolean() });

/** Screen before storage and all provider calls. No original text or reversible mapping is retained. */
export function screenChat(raw: string) {
  let text = z.string().trim().min(1).max(4000).parse(raw).normalize("NFKC");
  const patterns = [
    /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/gi,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b[1-8]\d{12}\b/g,
    /(?:\+?40[\s.-]?)?\b0?7\d{2}(?:[\s.-]?\d){6}\b/g,
    /\b(?:\d[ -]?){13,19}\b/g,
    /\b(?:my name is|mă numesc|ma numesc|numele meu este)\s+[\p{L}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*){0,3}/giu,
    /\b(?:password|parola|pin|cvv|cvc|otp|one.time code)\s*(?:is|este|:|=)?\s*\S+/gi,
  ];
  const original = text;
  for (const pattern of patterns) text = text.replace(pattern, "[REDACTED]");
  return screenedChatSchema.parse({ text, redacted: text !== original });
}

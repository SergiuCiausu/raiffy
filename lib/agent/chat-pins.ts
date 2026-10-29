import { z } from "zod";

/*
 * Customer edits to their own chats: a chat's name and the answer cards they pin to the Context panel (chat.html
 * rename and PIN_META). Pure validation shared by Convex and the web app.
 */

/** Answer cards a customer may pin. A pin names its card; the server checks the answer really has one. */
export const PIN_KINDS = ["comparison", "compare_table", "routes", "keyFacts", "checklist", "simulation", "offer", "spending", "affordability"] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export const MAX_PINS = 50;

const oneLine = (max: number) => z.string().transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(max));

/** A chat name: one line, 1–80 characters after trimming. */
export const threadTitleSchema = oneLine(80);

export const pinInputSchema = z.object({ kind: z.enum(PIN_KINDS), title: oneLine(120), meta: oneLine(120) }).strict();
export type PinInput = z.infer<typeof pinInputSchema>;

/** The pinnable card types an answer carries. A partial `routes` block (text-derived, no title) isn't a card. */
export function pinnableKinds(blocks: readonly unknown[]): PinKind[] {
  return blocks.flatMap((b) => {
    const kind = (b as { type?: unknown })?.type;
    if (typeof kind !== "string" || !(PIN_KINDS as readonly string[]).includes(kind)) return [];
    if (kind === "routes" && typeof (b as { title?: unknown }).title !== "string") return [];
    return [kind as PinKind];
  });
}

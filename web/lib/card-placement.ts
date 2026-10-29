import type { Block, Line, Run } from "./markup";

/*
 * Where each answer card sits in the answer (DESIGN.md: answer cards in the live chat). Claude fills the cards before
 * writing its text, so the response doesn't say where they go. A card goes after the paragraph that introduces it:
 * one ending in a colon ("Here they are side by side:") that isn't a list's title, else the first paragraph citing
 * one of its sources, else the lead-in paragraph. The chat shows it once the word-by-word reveal has
 * typed that paragraph, so a card never arrives before the text that introduces it. Pure: no React.
 */

const runsOf = (lines: Line[]): Run[] => lines.flat();
function blockRuns(b: Block): Run[] {
  if (b.kind === "p") return runsOf(b.lines);
  return b.items.flatMap((it) => [...runsOf(it.lines), ...(it.sub ? blockRuns(it.sub) : [])]);
}

/** Every string in a card that is one of the answer's source URLs: the sources its figures come from. */
export function cardUrls(card: unknown, urls: ReadonlySet<string>, out = new Set<string>()): Set<string> {
  if (typeof card === "string") { if (urls.has(card)) out.add(card); }
  else if (Array.isArray(card)) for (const v of card) cardUrls(v, urls, out);
  else if (card && typeof card === "object") for (const v of Object.values(card)) cardUrls(v, urls, out);
  return out;
}

/** The index in the visible text where a block ends: the reveal has typed it once it reaches this point. */
export const blockEnd = (b: Block) => Math.max(0, ...blockRuns(b).map((r) => r.v + r.text.length));

/**
 * For each card, the index of the block it follows. Cards keep their order; with no blocks they go at -1 (after the
 * text, wherever the caller puts it).
 */
export function placeCards<C>(blocks: readonly Block[], cards: readonly C[], sources: readonly { id: string; url: string }[]): number[] {
  if (!blocks.length) return cards.map(() => -1);
  const urlOf = new Map(sources.map((s) => [s.id, s.url]));
  const all = new Set(sources.map((s) => s.url));
  const intro = blocks.findIndex((b, i) => b.kind === "p" && /:\s*$/.test(blockRuns(b).map((r) => r.text).join("")) && blocks[i + 1]?.kind !== "list");
  if (intro >= 0) return cards.map(() => intro);
  const cited = blocks.map((b) => new Set(blockRuns(b).flatMap((r) => r.cites.flatMap((c) => c.ids.map((id) => urlOf.get(id))))));
  return cards.map((card) => {
    const urls = cardUrls(card, all);
    const i = cited.findIndex((set) => [...urls].some((u) => set.has(u)));
    return i >= 0 ? i : 0;
  });
}

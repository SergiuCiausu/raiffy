import { z } from "zod";

export const routeCardSchema = z.object({
  title: z.string().min(1).max(80),
  recommended: z.boolean(),
  summary: z.string().max(600),
  mainRisk: z.string().max(300).optional(),
  why: z.string().max(400).optional(),
  sourceIds: z.array(z.string()),
});
export type RouteCard = z.infer<typeof routeCardSchema>;

export const routesBlockSchema = z.object({
  type: z.literal("routes"),
  /** Costs need the reviewed catalog, which isn't connected, so every card is partial. */
  state: z.literal("partial"),
  /** The list's character range in the joined segment text; the cards replace it on screen. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  routes: z.array(routeCardSchema).min(2).max(5),
});
export type RoutesBlock = z.infer<typeof routesBlockSchema>;

// "- **Overdraft (descoperit de cont)** (recommended) — what it is. Main risk: …. Why: …"
const ITEM = /^[-*•]\s+\*\*(.+?)\*\*\s*(\((?:recommended|my recommendation)\))?\s*[—–:-]*\s*(.*)$/i;
const MARK = /\s*\((?:recommended|my recommendation)\)\s*:?\s*$/i;

type Line = { start: number; end: number; text: string };
const parse = (line: Line) => ITEM.exec(line.text.trim())!;
const isMarked = (line: Line) => { const [, title, marker] = parse(line); return Boolean(marker) || MARK.test(title!); };

/**
 * Route cards from the checked answer's route list, which Claude writes in a fixed form (one item per route, the
 * recommended one marked). Code only reshapes that list: a card can't say anything the checked text doesn't.
 */
export function routesFromAnswer(segments: readonly { text: string; sourceIds: readonly string[] }[]): RoutesBlock | null {
  const text = segments.map((s) => s.text).join("");
  const lines: Line[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    lines.push({ start: pos, end: pos + line.length, text: line });
    pos += line.length + 1;
  }

  // The first list of at least two items, unless a later one carries the recommendation.
  const lists: Line[][] = [];
  let run: Line[] = [];
  for (const line of lines) {
    if (ITEM.test(line.text.trim())) run.push(line);
    else if (line.text.trim() !== "" || run.length === 0) { if (run.length) lists.push(run); run = []; }
  }
  if (run.length) lists.push(run);
  const candidates = lists.filter((list) => list.length >= 2);
  const items = candidates.find((list) => list.some(isMarked)) ?? candidates[0];
  if (!items || items.length > 5) return null;

  const offsets = segments.reduce<number[]>((acc, s, i) => [...acc, (acc[i] ?? 0) + s.text.length], [0]);
  const sourcesIn = (line: Line) => [...new Set(segments.flatMap((s, i) =>
    offsets[i]! < line.end && offsets[i + 1]! > line.start ? s.sourceIds : []))];

  let recommendedSeen = false;
  const routes = items.map((line) => {
    const [, rawTitle, , rawBody] = parse(line);
    const marked = isMarked(line);
    const title = rawTitle!.replace(MARK, "").replace(/:\s*$/, "").trim();
    const body = rawBody!.trim();
    const why = body.match(/\bWhy:\s*(.+)$/i)?.[1]?.trim();
    const mainRisk = body.match(/\bMain risk:\s*(.+?)(?=\s*\bWhy:|$)/i)?.[1]?.trim();
    const summary = body.split(/\s*\b(?:Main risk|Why):/i)[0]!.trim();
    // Exactly one option carries the recommendation (DESIGN.md), the first one marked.
    const recommended = marked && !recommendedSeen;
    recommendedSeen ||= recommended;
    return { title, recommended, summary, ...(mainRisk ? { mainRisk } : {}), ...(recommended && why ? { why } : {}), sourceIds: sourcesIn(line) };
  });

  const last = items[items.length - 1]!;
  const parsed = routesBlockSchema.safeParse({ type: "routes", state: "partial", start: items[0]!.start,
    end: text[last.end] === "\n" ? last.end + 1 : last.end, routes });
  return parsed.success ? parsed.data : null;
}

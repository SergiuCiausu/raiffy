/** A stretch of answer text in one style. */
export type Run = { text: string; bold: boolean };

/**
 * What the answer shows, in reading order. Offsets count displayed characters, so the word-by-word reveal and
 * the citation markers line up after markdown markers and the route list are taken out.
 */
export type Piece =
  | { kind: "text"; from: number; to: number; runs: Run[]; sourceIds: string[] }
  | { kind: "routes"; at: number };
export type AnswerView = { length: number; pieces: Piece[] };

type Segment = { text: string; sourceIds: readonly string[] };

/**
 * Light formatting for the checked answer: `**bold**` within a line, "- " list markers shown as bullets, and the
 * route list (`cut`, from the routes block) removed so its cards can stand in its place.
 */
export function answerView(segments: readonly Segment[], cut?: { start: number; end: number }): AnswerView {
  const full = segments.map((s) => s.text).join("");
  let [cutStart, cutEnd] = cut ? [cut.start, cut.end] : [-1, -1];
  // The line breaks around the list belong to it, or the paragraphs either side would open with a blank line.
  if (cut) {
    while (cutStart > 0 && full[cutStart - 1] === "\n") cutStart--;
    while (cutEnd < full.length && full[cutEnd] === "\n") cutEnd++;
  }

  const chars: { ch: string; bold: boolean }[] = [];
  const position: number[] = []; // displayed characters before each source index
  let bold = false;
  let cardsAt = -1;
  for (let i = 0; i < full.length; i++) {
    position[i] = chars.length;
    if (i >= cutStart && i < cutEnd) { if (i === cutStart) cardsAt = chars.length; continue; }
    if (full.startsWith("**", i)) {
      const close = full.indexOf("**", i + 2);
      const line = full.indexOf("\n", i + 2);
      if (bold || (close !== -1 && (line === -1 || close < line))) {
        bold = !bold;
        position[i + 1] = chars.length;
        i++;
        continue;
      }
    }
    const lineStart = i === 0 || full[i - 1] === "\n";
    const bullet = lineStart && "-*•".includes(full[i]!) && full[i + 1] === " ";
    chars.push({ ch: bullet ? "•" : full[i]!, bold });
  }
  position[full.length] = chars.length;

  const runsOf = (from: number, to: number) => chars.slice(from, to).reduce<Run[]>((runs, c) => {
    const last = runs[runs.length - 1];
    if (last && last.bold === c.bold) last.text += c.ch;
    else runs.push({ text: c.ch, bold: c.bold });
    return runs;
  }, []);

  const pieces: Piece[] = [];
  let offset = 0;
  for (const segment of segments) {
    const from = position[offset]!;
    const to = position[offset + segment.text.length]!;
    offset += segment.text.length;
    // A segment the cards replaced keeps no citations of its own: each card carries its sources.
    const parts = cardsAt > from && cardsAt < to ? [[from, cardsAt], [cardsAt, to]] : [[from, to]];
    parts.forEach(([a, b], i) => {
      if (a === cardsAt && !pieces.some((p) => p.kind === "routes")) pieces.push({ kind: "routes", at: cardsAt });
      if (b! > a!) pieces.push({ kind: "text", from: a!, to: b!, runs: runsOf(a!, b!), sourceIds: i === parts.length - 1 ? [...segment.sourceIds] : [] });
    });
  }
  if (cardsAt !== -1 && !pieces.some((p) => p.kind === "routes")) pieces.push({ kind: "routes", at: cardsAt });
  return { length: chars.length, pieces };
}

/*
 * The quote verifier: a catalog value counts as found only when every number in it appears in one chunk of the
 * same source page. The quote is the passage around the first number, so a reviewer can check it at a glance.
 */

export type QuoteChunk = { chunkId: string; text: string };
export type QuoteMatch = { chunkId: string; quote: string };

const QUOTE_RADIUS = 110;

/** Ways a source can print the same number: decimal comma or dot, with or without a trailing zero. */
export function spellings(num: string): string[] {
  const out = new Set([num]);
  const decimal = num.match(/^(\d+)[.,](\d{1,2})$/);
  if (decimal) {
    const whole = decimal[1]!;
    const frac = decimal[2]!;
    const short = frac.replace(/0+$/, "");
    for (const sep of [",", "."]) {
      out.add(`${whole}${sep}${frac}`);
      if (short) out.add(`${whole}${sep}${short}`);
      if (frac.length === 1) out.add(`${whole}${sep}${frac}0`);
    }
    if (!short) out.add(whole);
  }
  return [...out];
}

/** The numbers of a value, each marked when the value writes it as a percentage. */
function tokensIn(value: string): { num: string; percent: boolean }[] {
  return [...value.matchAll(/(\d+(?:[.,]\d+)*)(\s*%)?/g)].map((m) => ({ num: m[1]!, percent: Boolean(m[2]) }));
}

/**
 * Finds `num` as a whole number in `text`, not as part of a longer one ("5,5" must not match "15,55").
 * A percentage only matches a percentage, so "4%" never matches "4 luni".
 */
function indexOfNumber(text: string, num: string, percent: boolean): number {
  for (const spelling of spellings(num)) {
    const escaped = spelling.replace(/[.]/g, "\\.");
    const m = new RegExp(`(?<![\\d.,])${escaped}${percent ? "\\s*%" : "(?![\\d]|[.,]\\d)"}`).exec(text);
    if (m) return m.index;
  }
  return -1;
}

export function findQuote(value: string, chunks: QuoteChunk[]): QuoteMatch | null {
  const tokens = tokensIn(value);
  if (!tokens.length) return null;
  for (const chunk of chunks) {
    const positions = tokens.map((t) => indexOfNumber(chunk.text, t.num, t.percent));
    if (positions.some((p) => p < 0)) continue;
    const at = Math.min(...positions);
    const start = Math.max(0, at - QUOTE_RADIUS);
    const quote = chunk.text.slice(start, at + QUOTE_RADIUS).replace(/\s+/g, " ").trim();
    return { chunkId: chunk.chunkId, quote };
  }
  return null;
}

/*
 * The small Markdown subset Raiffy's answers may use, parsed into blocks of styled runs. Pure: no React, no HTML
 * strings (the renderer builds elements, so model text is never injected as markup).
 *
 *   **bold** / __bold__   → bold          *italic* / _italic_ → italic (not inside words: snake_case, 2*3 stay)
 *   "- " / "* " / "+ "    → bullet list    "1. " / "1) "       → numbered list, one level of nesting
 *   blank line            → new paragraph  "# Heading"         → a bold line (answers have no headings)
 *   [text](url)           → text only      ~~strike~~          → plain text; underline, code, tables, HTML stay literal
 *
 * Every run keeps its offsets in the original text, so citations can be placed at segment ends even when a
 * marker or a bold span crosses a segment boundary, and `v`, its index in the visible text, so the word-by-word
 * reveal counts only what is shown and never flashes a half-typed "**".
 */

export type Run = {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Offsets in the original text; the run's text is that exact slice. */
  from: number;
  to: number;
  /** Index of the run's first character in `plain` */
  v: number;
  /** Citations placed after `pos` characters of this run */
  cites: { pos: number; ids: string[] }[];
};
export type Line = Run[];
export type Paragraph = { kind: "p"; lines: Line[] };
export type ListItem = { lines: Line[]; sub?: List };
export type List = { kind: "list"; ordered: boolean; start: number; items: ListItem[] };
export type Block = Paragraph | List;
export type Parsed = { blocks: Block[]; plain: string };

type Style = { bold: boolean; italic: boolean };
const NONE: Style = { bold: false, italic: false };

const ESCAPABLE = new Set(["\\", "*", "_", "[", "]", "(", ")", "#", "~", "`", "-", "+", "."]);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** The closing double marker for one opened at `from`, or -1. Must not follow whitespace. */
function closeDouble(text: string, marker: string, from: number, end: number): number {
  for (let j = text.indexOf(marker, from); j !== -1 && j + 2 <= end; j = text.indexOf(marker, j + 1)) {
    if (text[j - 1] === "\\") continue;
    if (j > from && !isSpace(text[j - 1]) && (marker !== "__" || !isWordChar(text[j + 2]))) return j;
  }
  return -1;
}

/** The closing single "*" or "_" for one opened at `from - 1`, or -1. Not intraword, not part of a double. */
function closeSingle(text: string, c: string, from: number, end: number): number {
  for (let j = from + 1; j < end; j++) {
    if (text[j] !== c || text[j - 1] === "\\") continue;
    if (text[j + 1] === c) { j++; continue; }
    if (!isSpace(text[j - 1]) && text[j - 1] !== c && !isWordChar(text[j + 1])) return j;
  }
  return -1;
}

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/y;

function inline(text: string, from: number, end: number, style: Style, out: Run[]) {
  let start = from;
  const flush = (to: number) => {
    if (to > start) out.push({ text: text.slice(start, to), ...style, from: start, to, v: 0, cites: [] });
  };
  let i = from;
  while (i < end) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < end && ESCAPABLE.has(text[i + 1]!)) {
      flush(i); start = i + 1; i += 2; continue;
    }
    const pair = text.slice(i, i + 2);
    if ((pair === "**" || pair === "__" || pair === "~~") && !isSpace(text[i + 2]) && !(pair === "__" && isWordChar(text[i - 1]))) {
      const close = closeDouble(text, pair, i + 2, end);
      if (close !== -1) {
        flush(i);
        inline(text, i + 2, close, pair === "~~" ? style : { ...style, bold: true }, out);
        i = close + 2; start = i; continue;
      }
    }
    if ((c === "*" || c === "_") && text[i + 1] !== c && !isSpace(text[i + 1]) && !isWordChar(text[i - 1])) {
      const close = closeSingle(text, c, i, end);
      if (close !== -1) {
        flush(i);
        inline(text, i + 1, close, { ...style, italic: true }, out);
        i = close + 1; start = i; continue;
      }
    }
    if (c === "[") {
      LINK.lastIndex = i;
      const m = LINK.exec(text);
      if (m && m.index + m[0].length <= end) {
        flush(i);
        inline(text, i + 1, i + 1 + m[1]!.length, style, out); // the link text only; the URL is never rendered
        i += m[0].length; start = i; continue;
      }
    }
    i++;
  }
  flush(end);
}

const LIST_ITEM = /^( *)([-*+]|(\d{1,3})[.)])[ \t]+/;
const HEADING = /^ {0,3}#{1,6}[ \t]+/;

/**
 * Parses an answer and places citations: each `{ at, ids }` goes after the last visible character before
 * offset `at` (the end of its segment) in the original text.
 */
export function parseAnswer(text: string, cites: readonly { at: number; ids: string[] }[] = []): Parsed {
  const blocks: Block[] = [];
  let paragraph: Paragraph | null = null;
  let list: List | null = null;
  let gap = false; // a blank line since the last content line

  const lineRuns = (from: number, end: number, style: Style = NONE) => { const out: Run[] = []; inline(text, from, end, style, out); return out; };

  let offset = 0;
  for (const raw of text.split("\n")) {
    const lineStart = offset;
    const lineEnd = lineStart + raw.length;
    offset = lineEnd + 1;
    if (!raw.trim()) { paragraph = null; gap = true; continue; }

    const item = LIST_ITEM.exec(raw);
    if (item) {
      const ordered = item[3] !== undefined;
      const runs = lineRuns(lineStart + item[0].length, lineEnd);
      const nested = item[1]!.length >= 2 && list && list.items.length > 0;
      if (nested) {
        const parent = list!.items[list!.items.length - 1]!;
        if (!parent.sub || parent.sub.ordered !== ordered) parent.sub = { kind: "list", ordered, start: Number(item[3] ?? 1), items: [] };
        parent.sub.items.push({ lines: [runs] });
      } else {
        if (!list || list.ordered !== ordered) {
          list = { kind: "list", ordered, start: Number(item[3] ?? 1), items: [] };
          blocks.push(list);
        }
        list.items.push({ lines: [runs] });
      }
      paragraph = null; gap = false;
      continue;
    }

    const heading = HEADING.exec(raw);
    const indent = raw.length - raw.trimStart().length;
    const runs = heading ? lineRuns(lineStart + heading[0].length, lineEnd, { bold: true, italic: false }) : lineRuns(lineStart + indent, lineEnd);
    if (list && !gap && !heading) {
      // A wrapped line continues the last list item
      const last = list.items[list.items.length - 1]!;
      (last.sub ? last.sub.items[last.sub.items.length - 1]! : last).lines.push(runs);
      continue;
    }
    list = null;
    if (!paragraph || gap || heading) { paragraph = { kind: "p", lines: [] }; blocks.push(paragraph); }
    paragraph.lines.push(runs);
    if (heading) paragraph = null;
    gap = false;
  }

  // Visible indexes, in reading order. Each line ends in one virtual separator so words never merge.
  const all: Run[] = [];
  let plain = "";
  const visit = (lines: Line[]) => { for (const line of lines) { for (const run of line) { run.v = plain.length; plain += run.text; all.push(run); } plain += "\n"; } };
  const visitList = (l: List) => { for (const it of l.items) { visit(it.lines); if (it.sub) visitList(it.sub); } };
  for (const block of blocks) { if (block.kind === "p") visit(block.lines); else visitList(block); }
  plain = plain.replace(/\n$/, "");

  for (const { at, ids } of cites) {
    if (!ids.length) continue;
    let target: Run | undefined;
    for (const run of all) { if (run.from < at) target = run; else break; }
    if (target) target.cites.push({ pos: Math.min(at, target.to) - target.from, ids });
  }
  return { blocks, plain };
}

/** Citation positions for answer segments: each segment's ids go at the offset where its text ends. */
export function segmentCites(segments: readonly { text: string; sourceIds: string[] }[]) {
  let at = 0;
  return segments.map((s) => ({ at: (at += s.text.length), ids: s.sourceIds }));
}

/* ── List cards: a list of 2+ items renders as a card (components/agent/AgentChat.tsx → AnswerText) ── */

/** The most characters a lead-in line may have to become a card title. */
const TITLE_MAX = 60;

/**
 * A short, uncited paragraph ending in ":" right before a list ("Conditions to check:") is that list's title.
 * Returns the title without the colon, and the run the reveal waits for, or null.
 */
export function listTitle(block: Block | undefined): { title: string; run: Run } | null {
  if (block?.kind !== "p" || block.lines.length !== 1) return null;
  const runs = block.lines[0]!;
  if (!runs.length || runs.some((r) => r.cites.length)) return null;
  const text = runs.map((r) => r.text).join("").trim();
  if (!text.endsWith(":") || text.length > TITLE_MAX + 1) return null;
  const title = text.slice(0, -1).trim();
  return title ? { title, run: runs[0]! } : null;
}

/**
 * Splits a list item into a label (its leading bold text, colon removed) and a description (the rest).
 * Runs are copied, never changed, so the parsed answer can be memoized; offsets stay for citations and the reveal.
 */
export function splitItem(lines: Line[]): { label: Run[] | null; body: Line[] } {
  const first = lines[0] ?? [];
  let n = 0;
  while (n < first.length && first[n]!.bold) n++;
  if (n === 0 || n === first.length && lines.length === 1 && !first.slice(0, n).some((r) => /:\s*$/.test(r.text))) {
    return { label: null, body: lines };
  }
  const label = first.slice(0, n).map((r) => ({ ...r }));
  const last = label[label.length - 1]!;
  const trimmed = last.text.replace(/\s*:\s*$/, "");
  label[label.length - 1] = { ...last, text: trimmed, cites: last.cites.map((c) => ({ ...c, pos: Math.min(c.pos, trimmed.length) })) };
  const rest = first.slice(n);
  const body = [...(rest.length ? [rest] : []), ...lines.slice(1)];
  return { label: label.some((r) => r.text.trim()) ? label : null, body };
}

/* ── Cards over lists: an item an answer card already shows is not repeated in the text ── */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** What an item is matched on: its bold label, or its first line when it has none. */
export function itemKey(lines: Line[]): string {
  const { label } = splitItem(lines);
  return norm((label ?? lines[0] ?? []).map((r) => r.text).join(""));
}

/**
 * Drops list items whose key is in `shown` (the names and labels on the answer's cards). A list left empty goes,
 * with the "Conditions to check:" title line before it.
 */
export function withoutShown(blocks: Block[], shown: readonly string[]): Block[] {
  const keys = new Set(shown.map(norm).filter(Boolean));
  if (!keys.size) return blocks;
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind !== "list") { out.push(b); continue; }
    const items = b.items.filter((it) => !keys.has(itemKey(it.lines)));
    if (items.length) { out.push(items.length === b.items.length ? b : { ...b, items }); continue; }
    if (listTitle(out[out.length - 1])) out.pop();
  }
  return out;
}

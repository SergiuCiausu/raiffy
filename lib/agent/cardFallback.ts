import { findUngroundedNumbers } from "../rag/numbers";
import { FACT_LABEL_MAX, FACT_VALUE_MAX } from "./blocks";
import type { Inquiry } from "./confidence";

/*
 * Server-side card guess for when Claude answers without calling show_cards. It reads the checked answer text and the
 * search results the answer cites, and proposes show_cards input; checkCards (lib/agent/blocks.ts) then grounds it
 * exactly like a card Claude made, so a wrong guess is dropped, never shown.
 *
 *   asks for documents or steps, a cited list           → checklist (the first list of 2+ items)
 *   loan patterns, a cited interest rate                → simulation (amount and term from the customer, when given)
 *   saving goal, 2+ "- **Product:** rate…"               → savings options as key facts (no recommendation is invented)
 *   explanation, fees, listing: 2+ "- **Label:** value" → key facts (only items with a figure and a citation)
 *
 * The chat leaves list items a card shows out of the answer text (web/lib/markup.ts withoutShown).
 */

export type FallbackSegment = { text: string; hitIndexes: readonly number[] };
export type FallbackHit = { url: string; text: string; label: string };
export type Scenario = { amount?: number; months?: number; income?: number; obligations?: number };

const LOAN_PATTERNS: readonly Inquiry[] = ["purchase_goal", "affordability", "cash_shortfall", "debt_refinancing"];
const FACT_PATTERNS: readonly Inquiry[] = ["product_explanation", "fees_statements", "listing", "saving_goal"];
const CHECKLIST_PATTERNS: readonly Inquiry[] = ["product_explanation", "listing", "life_event", "purchase_goal", "fees_statements"];
/** The customer asks what to bring, or what to do. */
const DOCS = /\b(documents?|papers|paperwork|acte|documente\w*)\b/i;
const STEPS = /\b(steps?|pa[sș]i\w*|how (do|can) i (apply|open|get|close|cancel))\b/i;

/** Checklist limits, matching lib/agent/blocks.ts, so a guess is never refused whole for one long item. */
const ITEM_TEXT_MAX = 120;
const ITEM_DETAIL_MAX = 200;

const RATE = /(\d{1,2}(?:[.,]\d{1,2})?)\s?%/g;
const RATE_WORDS = /\b(interest|rate|dob[aâ]nd\w*)\b/i;
const NOT_INTEREST = /\b(DAE|APR|annual percentage|commission|comision\w*|fee)\b/i;
const BOLD = /\*\*([^*\n]{3,60}?)\*\*/g;
/** Right after a rate: the top of its range. */
const RANGE_END = /^\s*(?:-|–|—|to|and|until|p[aâ]n[aă] la|[sș]i)\s*(\d{1,2}(?:[.,]\d{1,2})?)\s?%/i;
/** The answer says the product asked about had no rate in the sources. */
const NO_RATE = /\b(found no|no)\b[^.]{0,50}\brates?\b|\bonly rates?\b/i;
const DEBT_RATIO = /\b(grad(?:ul)? (?:maxim )?de [îi]ndatorare|debt[- ]to[- ]income|debt ratio|DTI)\b[^.%]{0,40}?(\d{1,2}(?:[.,]\d)?)\s?%/i;
const ITEM = /^\s*(?:[-*+]|\d{1,2}[.)])\s+(.+)$/;
const LABELLED = /^\*\*([^*\n]{2,60}?):?\*\*:?\s*(.*)$/;

const plain = (s: string) => s.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
const grounds = (text: string, hit: FallbackHit | undefined) => !!hit && !findUngroundedNumbers(text, [hit.text]).length;

export function guessCards({ segments, hits, inquiry, question = "", scenario = {} }: {
  segments: readonly FallbackSegment[]; hits: readonly FallbackHit[]; inquiry: Inquiry | null; question?: string; scenario?: Scenario;
}): { cards: unknown[] } | null {
  if (!inquiry) return null;
  const asks = DOCS.test(question) ? "documents" : STEPS.test(question) ? "steps" : null;
  const card = (asks && CHECKLIST_PATTERNS.includes(inquiry) ? checklist(segments, hits, asks) : null)
    ?? (LOAN_PATTERNS.includes(inquiry) ? simulation(segments, hits, scenario) : null)
    ?? (FACT_PATTERNS.includes(inquiry) ? keyFacts(segments, hits, inquiry === "saving_goal" ? "Savings options" : "Key facts") : null);
  return card ? { cards: [card] } : null;
}

/** The first cited interest rate (not an APR or a fee), with the product named in bold before it, or the page title. */
function simulation(segments: readonly FallbackSegment[], hits: readonly FallbackHit[], scenario: Scenario) {
  for (const seg of segments) {
    if (!seg.hitIndexes.length) continue;
    for (const m of seg.text.matchAll(RATE)) {
      // The words right before this figure: back to the previous percentage or sentence end, at most 60 characters.
      const before = seg.text.slice(Math.max(0, m.index - 60), m.index).split(/%|[.;!?](?=\s)/).at(-1)!;
      if (!RATE_WORDS.test(before) || NOT_INTEREST.test(before)) continue;
      const hit = seg.hitIndexes.map((i) => hits[i]).find((h) => grounds(m[0], h));
      if (!hit) continue;
      const named = [...seg.text.slice(0, m.index).matchAll(BOLD)].at(-1)?.[1];
      const product = plain(named ?? hit.label).replace(/:$/, "").slice(0, 60).trim();
      if (!product) continue;
      // "between 5.55% and 17.95%", "5,55% – 17,95%", "de la 5,55% până la 17,95%": never one end of a range alone.
      const top = RANGE_END.exec(seg.text.slice(m.index + m[0].length));
      const rateMax = top && grounds(`${top[1]}%`, hit) ? Number(top[1]!.replace(",", ".")) : undefined;
      const answer = segments.map((s) => s.text).join("");
      const ratio = debtRatio(segments, hits);
      return {
        type: "simulation", title: "Repayment simulation", product, ratePercent: Number(m[1]!.replace(",", ".")), source: hit.url,
        ...(rateMax ? { rateMaxPercent: rateMax } : {}),
        ...(NO_RATE.test(answer) ? { rateFor: `The only rates in the sources are for ${product}.`.slice(0, 160) } : {}),
        ...(ratio ? { maxDebtRatio: ratio } : {}),
        ...(scenario.amount ? { amount: scenario.amount } : {}), ...(scenario.months ? { months: scenario.months } : {}),
        ...(scenario.income ? { income: scenario.income } : {}), ...(scenario.obligations !== undefined ? { obligations: scenario.obligations } : {}),
      };
    }
  }
  return null;
}

/** A maximum debt-to-income ratio that a cited result states, with that result. */
function debtRatio(segments: readonly FallbackSegment[], hits: readonly FallbackHit[]) {
  for (const seg of segments) {
    const m = DEBT_RATIO.exec(seg.text);
    if (!m) continue;
    const hit = seg.hitIndexes.map((i) => hits[i]).find((h) => grounds(`${m[2]}%`, h));
    if (hit) return { percent: Number(m[2]!.replace(",", ".")), source: hit.url };
  }
  return null;
}

type AnswerLine = { text: string; cited: number[] };

/** The answer's lines, each with the results cited by the segments it overlaps: list items can span segments. */
function answerLines(segments: readonly FallbackSegment[]): AnswerLine[] {
  let text = "";
  const citedAt: (readonly number[])[] = [];
  for (const seg of segments) { text += seg.text; for (let i = 0; i < seg.text.length; i++) citedAt.push(seg.hitIndexes); }
  let at = 0;
  return text.split("\n").map((line) => {
    const from = at;
    at += line.length + 1;
    return { text: line, cited: [...new Set(citedAt.slice(from, from + line.length).flat())] };
  });
}

/** The first cited result that contains every number in `text`. */
const sourceFor = (text: string, cited: readonly number[], hits: readonly FallbackHit[]) =>
  cited.map((i) => hits[i]).find((h) => grounds(text, h));

/** A value short enough for a card: the whole value, or its first clause with a figure ("3.5% a year"). */
function shortValue(value: string): string | null {
  if (value.length <= FACT_VALUE_MAX) return value;
  // A clause ends at ", " (not a decimal comma), ";", "(", a dash or a sentence end.
  const clause = value.split(/,\s|[;(—–]|\.\s/).map((c) => c.trim()).find((c) => /\d/.test(c));
  return clause && clause.length <= FACT_VALUE_MAX ? clause : null;
}

/** Bold-labelled list items whose value has a figure that one of the item's cited results contains. */
function keyFacts(segments: readonly FallbackSegment[], hits: readonly FallbackHit[], title: string) {
  const facts: { label: string; value: string; source: string }[] = [];
  for (const line of answerLines(segments)) {
    const m = LABELLED.exec(ITEM.exec(line.text)?.[1] ?? "");
    if (!m || !/\d/.test(m[2]!)) continue;
    const value = shortValue(plain(m[2]!));
    const hit = value && sourceFor(value, line.cited, hits);
    if (value && hit) facts.push({ label: plain(m[1]!).slice(0, FACT_LABEL_MAX), value, source: hit.url });
    if (facts.length === 8) break;
  }
  return facts.length >= 2 ? { type: "keyFacts", title, facts } : null;
}

/** The first run of 2+ list items in an answer that cites a result: documents to bring or steps to take. */
function checklist(segments: readonly FallbackSegment[], hits: readonly FallbackHit[], kind: "documents" | "steps") {
  const runs: AnswerLine[][] = [[]];
  for (const line of answerLines(segments)) {
    if (ITEM.test(line.text)) runs[runs.length - 1]!.push(line);
    else if (line.text.trim() && runs[runs.length - 1]!.length) runs.push([]);
  }
  const run = runs.find((r) => r.length >= 2 && r.some((l) => l.cited.length));
  if (!run) return null;
  const items = run.slice(0, 8).flatMap((line) => {
    const body = ITEM.exec(line.text)![1]!;
    const m = LABELLED.exec(body);
    const text = plain(m ? m[1]! : body);
    const detail = m?.[2] ? plain(m[2]) : undefined;
    if (!text || text.length > ITEM_TEXT_MAX || (detail && detail.length > ITEM_DETAIL_MAX)) return [];
    const hit = sourceFor(`${text} ${detail ?? ""}`, line.cited, hits);
    // A figure needs a cited result that prints it; plain items ("ID card") don't.
    if (/\d/.test(`${text}${detail ?? ""}`) && !hit) return [];
    return [{ text, ...(detail ? { detail } : {}), ...(hit ? { source: hit.url } : {}) }];
  });
  return items.length >= 2 ? { type: "checklist", title: kind === "documents" ? "Documents you'll need" : "Steps", items } : null;
}

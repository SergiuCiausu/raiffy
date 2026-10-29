import { z } from "zod";
import { termValueSchema, type TermRecord, type TermUnit, type TermValue } from "./schemas";

/*
 * Changing a catalog value from the console (raiffy-spec/docs/shared/console.md → Change lifecycle). An operator's
 * change waits for an admin; an admin's change is published at once. Published values are never edited in place
 * without a record: each change keeps the value before it, so a rollback restores that value as a new change.
 * Publishing marks the value reviewed by a person, which is what lets answers use it (lib/catalog/terms.ts gapReason).
 */

const DAY_MS = 86_400_000;
export const QUOTE_MAX = 500;
export const NOTE_MAX = 500;
/** A new review date can be at most this far ahead. */
export const REVIEW_MAX_DAYS = 730;

const isoDay = z.iso.date();
export const editableValueSchema = termValueSchema.refine((v) => v.type !== "unavailable", "value_invalid");

/** What someone types into the editor. Money and rates arrive in minor units and basis points, as stored. */
export const changeInputSchema = z.object({
  value: editableValueSchema,
  /** The exact words in the source that state the value. */
  quote: z.string().trim().min(1).max(QUOTE_MAX),
  url: z.url({ protocol: /^https$/ }),
  reviewBy: isoDay,
  note: z.string().trim().max(NOTE_MAX),
});
export type ChangeInput = z.infer<typeof changeInputSchema>;

/** The part of a term a change replaces, kept on the change so it can be rolled back. */
export const termSnapshotSchema = z.object({ value: termValueSchema, quote: z.string(), url: z.string(), reviewBy: isoDay });
export type TermSnapshot = z.infer<typeof termSnapshotSchema>;

export const CHANGE_REFUSALS = ["value_invalid", "quote_missing", "url_invalid", "review_date_invalid", "no_change"] as const;
export type ChangeRefusal = (typeof CHANGE_REFUSALS)[number];
export type ChangeCheck = { ok: true; kind: "edit" | "confirm"; input: ChangeInput } | { ok: false; reason: ChangeRefusal };

export const snapshotOf = (t: Pick<TermRecord, "value" | "quote" | "provenance">): TermSnapshot =>
  ({ value: t.value, quote: t.quote, url: t.provenance.url, reviewBy: t.provenance.reviewBy });

const sortKeys = (v: TermValue) => Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)));
export const sameValue = (a: TermValue, b: TermValue) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

function numbersOk(v: TermValue): boolean {
  const nums = v.type === "exact" ? [v.amount] : v.type === "range" ? [v.min, v.max] : v.type === "from" ? [v.min] : v.type === "up_to" ? [v.max] : [];
  if (nums.some((n) => !Number.isSafeInteger(n) || n < 0)) return false;
  return v.type !== "range" || v.min <= v.max;
}

/**
 * Whether a change can be proposed, and what kind it is. Keeping the value with a fresh source and review date
 * re-confirms it ("confirm"); that is only worth doing when the value isn't already usable and up to date.
 */
export function checkChange(current: TermRecord, raw: unknown, today: string, needsReview: boolean): ChangeCheck {
  const parsed = changeInputSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    return { ok: false, reason: path === "quote" ? "quote_missing" : path === "url" ? "url_invalid" : path === "reviewBy" ? "review_date_invalid" : "value_invalid" };
  }
  const input = parsed.data;
  if (!numbersOk(input.value)) return { ok: false, reason: "value_invalid" };
  const ahead = (Date.parse(input.reviewBy) - Date.parse(today)) / DAY_MS;
  if (ahead < 1 || ahead > REVIEW_MAX_DAYS) return { ok: false, reason: "review_date_invalid" };
  const same = sameValue(current.value, input.value);
  const sameSource = same && input.quote === current.quote.trim() && input.url === current.provenance.url && input.reviewBy === current.provenance.reviewBy;
  if (sameSource || (same && !needsReview && input.quote === current.quote.trim() && input.url === current.provenance.url)) return { ok: false, reason: "no_change" };
  return { ok: true, kind: same ? "confirm" : "edit", input };
}

/** The figures a value states, in the units a source would print them: 790 bps is 7.9, 24,900 bani is 249. */
export function displayNumbers(v: TermValue, unit: TermUnit): number[] {
  const nums = v.type === "exact" ? [v.amount] : v.type === "range" ? [v.min, v.max] : v.type === "from" ? [v.min] : v.type === "up_to" ? [v.max] : [];
  return nums.map((n) => (unit === "bps" || unit === "minor_ron" || unit === "minor_eur" ? n / 100 : n));
}

/** Numbers written in a quote, in Romanian ("7,90%", "1.500 lei") or English ("1,500", "7.9") style. */
export function quoteNumbers(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(/\d[\d.,\s]*\d|\d/g)) {
    const s = m[0].replace(/\s/g, "");
    const candidates = new Set<string>([s.replace(/\./g, "").replace(",", "."), s.replace(/,/g, "")]);
    for (const c of candidates) { const n = Number(c); if (Number.isFinite(n)) out.push(n); }
  }
  return out;
}

/** True when every figure of the value appears in the quote. Answers cite the quote, so a figure missing from it can't be checked. */
export function quoteShowsValue(v: TermValue, unit: TermUnit, quote: string): boolean {
  if (v.type === "text") return true;
  const found = quoteNumbers(quote);
  // An exact zero fee is often written as words ("fără comision"), so it isn't required in figures
  if (v.type === "exact" && v.amount === 0) return true;
  return displayNumbers(v, unit).every((n) => found.some((f) => Math.abs(f - n) < 0.005));
}

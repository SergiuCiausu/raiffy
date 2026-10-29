import { makeFunctionReference } from "convex/server";
import type { TermUnit, TermValue } from "./admin-api";

/*
 * Typed references to ../convex/catalogChanges.ts, and the editor's conversion between what people type (percent,
 * lei, months) and what the catalog stores (basis points, bani, whole numbers). quoteShowsValue mirrors
 * ../lib/catalog/changes.ts; the web app can't import the root lib, so catalog-api.test.ts pins the same cases.
 */

export type Snapshot = { value: TermValue; quote: string; url: string; reviewBy: string };
export type ChangeStatus = "pending" | "published" | "rejected" | "rolledBack";
export type CatalogChange = {
  changeId: string; termId: string; productId: string; product: string; label: string; unit: TermUnit;
  kind: "edit" | "confirm" | "rollback"; before: Snapshot; after: Snapshot; note: string; status: ChangeStatus;
  proposedBy: string; proposedByName: string; proposedAt: number;
  decidedByName: string | null; decidedAt: number | null; decisionNote: string | null; rollbackOf: string | null; latest: boolean;
};
export type ChangeResult = { changeId: string; status: "pending" | "published" };

export const catalogApi = {
  forProduct: makeFunctionReference<"query", { productId: string }, CatalogChange[]>("catalogChanges:forProduct"),
  pending: makeFunctionReference<"query", Record<string, never>, CatalogChange[]>("catalogChanges:pending"),
  decided: makeFunctionReference<"query", Record<string, never>, CatalogChange[]>("catalogChanges:decided"),
  propose: makeFunctionReference<"mutation", { termId: string; value: TermValue; quote: string; url: string; reviewBy: string; note: string }, ChangeResult>("catalogChanges:propose"),
  approve: makeFunctionReference<"mutation", { changeId: string; note?: string }, null>("catalogChanges:approve"),
  reject: makeFunctionReference<"mutation", { changeId: string; note: string }, null>("catalogChanges:reject"),
  rollBack: makeFunctionReference<"mutation", { changeId: string; note: string }, ChangeResult>("catalogChanges:rollBack"),
};

export const CHANGE_ERRORS: Record<string, string> = {
  forbidden: "Your role can’t do that.",
  value_invalid: "Check the value: whole amounts, no negatives, and a range’s lower end first.",
  quote_missing: "Add the exact words from the source that state this value.",
  url_invalid: "The source has to be an https link.",
  review_date_invalid: "Pick a review date between tomorrow and two years from now.",
  no_change: "Nothing changed. Change the value, or give a new source or review date to re-confirm it.",
  change_pending: "This value already has a change waiting for approval.",
  change_outdated: "The value changed since this was proposed. Reject it and propose again from the current value.",
  change_not_pending: "This change was already decided.",
  reason_required: "Add a reason.",
  rollback_not_latest: "Only the latest published change of a value can be rolled back.",
  rollback_review_lapsed: "The value before this change is past its review date. Propose a new value instead.",
  term_unavailable: "This value isn’t in the catalog any more.",
};

/** Units people type in: rates in percent, money in lei or euro. */
const SCALE: Partial<Record<TermUnit, number>> = { bps: 100, minor_ron: 100, minor_eur: 100 };
export const UNIT_HINT: Record<TermUnit, string> = {
  bps: "Percent", minor_ron: "Lei", minor_eur: "Euro", months: "Months", years: "Years", days: "Days", none: "Number",
};

export type ValueForm = { type: "exact" | "range" | "from" | "up_to" | "text"; a: string; b: string; text: string };

const shown = (n: number, unit: TermUnit) => String(n / (SCALE[unit] ?? 1));

export function formOf(value: TermValue, unit: TermUnit): ValueForm {
  switch (value.type) {
    case "exact": return { type: "exact", a: shown(value.amount, unit), b: "", text: "" };
    case "range": return { type: "range", a: shown(value.min, unit), b: shown(value.max, unit), text: "" };
    case "from": return { type: "from", a: shown(value.min, unit), b: "", text: "" };
    case "up_to": return { type: "up_to", a: shown(value.max, unit), b: "", text: "" };
    case "text": return { type: "text", a: "", b: "", text: value.text };
    default: return { type: unit === "none" ? "text" : "exact", a: "", b: "", text: "" };
  }
}

/** A typed number in stored units, or null. Accepts "7,5" and "1 500". */
function stored(raw: string, unit: TermUnit): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * (SCALE[unit] ?? 1) * 1000) / 1000;
  return Number.isSafeInteger(n) ? n : null;
}

export function valueOf(form: ValueForm, unit: TermUnit): TermValue | null {
  if (form.type === "text") return form.text.trim() ? { type: "text", text: form.text.trim() } : null;
  const a = stored(form.a, unit);
  if (a === null) return null;
  if (form.type === "exact") return { type: "exact", amount: a };
  if (form.type === "from") return { type: "from", min: a };
  if (form.type === "up_to") return { type: "up_to", max: a };
  const b = stored(form.b, unit);
  return b === null || b < a ? null : { type: "range", min: a, max: b };
}

function quoteNumbers(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(/\d[\d.,\s]*\d|\d/g)) {
    const s = m[0].replace(/\s/g, "");
    for (const c of new Set([s.replace(/\./g, "").replace(",", "."), s.replace(/,/g, "")])) { const n = Number(c); if (Number.isFinite(n)) out.push(n); }
  }
  return out;
}

/** True when every figure of the value appears in the quote, so a reader can check it against the source. */
export function quoteShowsValue(v: TermValue, unit: TermUnit, quote: string): boolean {
  if (v.type === "text" || v.type === "unavailable" || (v.type === "exact" && v.amount === 0)) return true;
  const nums = v.type === "exact" ? [v.amount] : v.type === "range" ? [v.min, v.max] : v.type === "from" ? [v.min] : [v.max];
  const found = quoteNumbers(quote);
  return nums.map((n) => n / (SCALE[unit] ?? 1)).every((n) => found.some((f) => Math.abs(f - n) < 0.005));
}

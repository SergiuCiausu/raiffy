import { z } from "zod";
import { gapReason, TERM_GAP_REASONS } from "./terms";
import type { TermKind, TermRecord } from "./schemas";

/*
 * Review state of catalog values for the admin console (raiffy-spec/docs/shared/console.md → Products): which values
 * are past or near their review date, and whether each one can be used in an answer. Pure: dates come in as arguments.
 */

export const REVIEW_STATES = ["ok", "due", "stale"] as const;
export const reviewStateSchema = z.enum(REVIEW_STATES);
export type ReviewState = z.infer<typeof reviewStateSchema>;

/** How close to its review date a value counts as due, in the console. */
export const REVIEW_DUE_DAYS = 14;

const DAY_MS = 86_400_000;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "stale" once the review date has passed, "due" within `dueDays` of it, "ok" otherwise. Dates are ISO days. */
export function reviewState(reviewBy: string, today: string, dueDays: number): ReviewState {
  isoDay.parse(reviewBy); isoDay.parse(today);
  if (reviewBy < today) return "stale";
  const left = (Date.parse(reviewBy) - Date.parse(today)) / DAY_MS;
  return left <= dueDays ? "due" : "ok";
}

/** Usable in an answer, or why not (the same rule get_product_terms applies). */
export const termUseSchema = z.union([z.literal("usable"), z.enum(TERM_GAP_REASONS)]);
export type TermUse = z.infer<typeof termUseSchema>;

export function termUse(record: TermRecord, now: number): TermUse {
  return gapReason(record, now) ?? "usable";
}

export const productReviewSchema = z.object({
  terms: z.number().int().min(0),
  usable: z.number().int().min(0),
  unreviewed: z.number().int().min(0),
  due: z.number().int().min(0),
  stale: z.number().int().min(0),
  /** The earliest review date among the product's values, or null with no values. */
  nextReviewBy: isoDay.nullable(),
  /** The interest rate to show in a list: a usable one first, then any with a figure. */
  headlineTermId: z.string().nullable(),
});
export type ProductReview = z.infer<typeof productReviewSchema>;

const HEADLINE_KINDS: TermKind[] = ["interest_rate", "dae"];
const hasFigure = (r: TermRecord) => r.value.type !== "text" && r.value.type !== "unavailable";

/** One product's values, summarized for the products list. */
export function productReview(records: readonly TermRecord[], today: string, now: number, dueDays: number): ProductReview {
  const states = records.map((r) => reviewState(r.provenance.reviewBy, today, dueDays));
  const uses = records.map((r) => termUse(r, now));
  const dates = records.map((r) => r.provenance.reviewBy).sort();
  const headline = HEADLINE_KINDS.flatMap((kind) => {
    const ofKind = records.map((r, i) => ({ r, use: uses[i] })).filter((x) => x.r.kind === kind && hasFigure(x.r));
    return [...ofKind.filter((x) => x.use === "usable"), ...ofKind.filter((x) => x.use !== "usable")];
  })[0];
  return productReviewSchema.parse({
    terms: records.length,
    usable: uses.filter((u) => u === "usable").length,
    unreviewed: uses.filter((u) => u === "unreviewed").length,
    due: states.filter((s) => s === "due").length,
    stale: states.filter((s) => s === "stale").length,
    nextReviewBy: dates[0] ?? null,
    headlineTermId: headline?.r.termId ?? null,
  });
}

/** Display order of value groups on a product page. */
export const TERM_GROUPS = [
  { key: "rate", kinds: ["interest_rate", "dae"] },
  { key: "fees", kinds: ["fee"] },
  { key: "limits", kinds: ["limit", "term"] },
  { key: "conditions", kinds: ["eligibility", "document", "benefit"] },
] as const satisfies readonly { key: string; kinds: readonly TermKind[] }[];
export type TermGroup = (typeof TERM_GROUPS)[number]["key"];

export function groupOf(kind: TermKind): TermGroup {
  return TERM_GROUPS.find((g) => (g.kinds as readonly TermKind[]).includes(kind))!.key;
}

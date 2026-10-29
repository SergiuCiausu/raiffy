import { makeFunctionReference } from "convex/server";
import type { Role } from "@/lib/roles";

/*
 * Typed references to ../convex/adminViews.ts, mirrored by hand because the web app builds on its own.
 * Keep them in step with the query return values there (and with lib/catalog/review.ts, lib/agent/rules.ts).
 */

export type TermValue =
  | { type: "exact"; amount: number } | { type: "range"; min: number; max: number } | { type: "from"; min: number }
  | { type: "up_to"; max: number } | { type: "text"; text: string } | { type: "unavailable"; reason: string };
export type TermUnit = "bps" | "minor_ron" | "minor_eur" | "months" | "years" | "days" | "none";
export type TermKind = "interest_rate" | "dae" | "fee" | "limit" | "term" | "eligibility" | "document" | "benefit";
export type Frequency = "once" | "monthly" | "yearly";
export type ReviewState = "ok" | "due" | "stale";
export type TermUse = "usable" | "unknown_product" | "not_in_catalog" | "stated_missing" | "stale" | "quote_not_found" | "unreviewed";
export type Track = "personal" | "business";

export type ProductReview = {
  terms: number; usable: number; unreviewed: number; due: number; stale: number; nextReviewBy: string | null; headlineTermId: string | null;
};

export type ProductRow = {
  productId: string; product: string; kind: string; category: string | null; track: Track | null; url: string; collectedAt: string;
  review: ProductReview;
  headline: { value: TermValue; unit: TermUnit; frequency: Frequency | null; use: TermUse } | null;
};

export type TermView = {
  termId: string; kind: TermKind; label: string; value: TermValue; unit: TermUnit; frequency: Frequency | null; conditions: string[];
  quote: string; url: string; collectedAt: string; reviewBy: string; reviewedBy: string | null; reviewedAt: string | null;
  review: ReviewState; use: TermUse; reviewedByName: string | null;
};

export type ProductDetail = Omit<ProductRow, "headline"> & { segment: string | null; summary: string; terms: TermView[] };

export type AuditRow = {
  actorUserId: string; actorRole: Role; action: string; targetUserId?: string; details?: Record<string, string>; note?: string; at: number;
  actorName: string | null; targetName: string | null;
};

export type AdminHome = {
  attention: (ProductReview & { productId: string; product: string })[];
  escalations: { open: number; oldestAt: number | null };
  recent: (Omit<AuditRow, "targetName">)[];
  week: { conversations: number; answers: number; failed: number; capped: boolean };
};

export type HardLimit = { id: string; name: string; text: string; enforcedIn: string[]; evals: { file: string; ids: string[] }[] };
export type PolicyParameter = { id: string; name: string; value: number; unit: "lei" | "percentagePoints" | "days" | "people"; usedBy: string; definedIn: string };

export type DataSource = "loans" | "limits" | "productsHeld" | "preApproved" | "deposits" | "feesCharged" | "ageResidency" | "idStatus" | "contractEvents" | "transactions";

/** The parts of lib/analytics AnalyticsSummary the page shows; outcome sections stay empty until events are connected. */
export type AnalyticsSummary = {
  kpis: { conversations: number | null; answers: number | null; accountDataShare: number | null };
  daily: { date: string; answers: number; conversations: number }[];
  dataUsage: { source: DataSource; answers: number | null; share: number | null }[];
  quality: { firstPassShare: number | null; fallbacks: number | null; escalations: number | null };
  minCount: number;
};
export type AnalyticsFilter = { from: string; to: string; track?: Track; entry?: "web" | "smartMobile" };

export const analyticsApi = {
  summary: makeFunctionReference<"query", AnalyticsFilter, AnalyticsSummary>("analytics:summary"),
};

export const adminApi = {
  products: makeFunctionReference<"query", Record<string, never>, ProductRow[]>("adminViews:products"),
  product: makeFunctionReference<"query", { productId: string }, ProductDetail | null>("adminViews:product"),
  audit: makeFunctionReference<"query", { limit?: number }, AuditRow[]>("adminViews:audit"),
  home: makeFunctionReference<"query", Record<string, never>, AdminHome>("adminViews:home"),
  rules: makeFunctionReference<"query", Record<string, never>, { hardLimits: HardLimit[]; parameters: PolicyParameter[] }>("adminViews:rules"),
};

/* Formatting for the console pages. Values arrive as numbers and keys; words and units are added here. */

const number = (n: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n);
function unit(n: number, u: TermUnit) {
  if (u === "bps") return `${number(n / 100)}%`;
  if (u === "minor_ron") return `${number(n / 100)} lei`;
  if (u === "minor_eur") return `${number(n / 100)} euro`;
  if (u === "months") return `${n} months`;
  if (u === "years") return `${n} years`;
  if (u === "days") return `${n} days`;
  return number(n);
}
const FREQ: Record<Frequency, string> = { once: " once", monthly: " a month", yearly: " a year" };

/** One catalog value as written on the page: "7.9%", "from 5.55%", "5 lei a month", "None", or the quoted text. */
export function valueLabel(value: TermValue, u: TermUnit, frequency: Frequency | null): string {
  if (value.type === "unavailable") return "Not stated";
  if (value.type === "text") return value.text;
  const none = value.type === "exact" && value.amount === 0 && (u === "minor_ron" || u === "minor_eur");
  const s = value.type === "exact" ? (none ? "None" : unit(value.amount, u))
    : value.type === "range" ? (u === "bps" ? `${number(value.min / 100)}–${unit(value.max, u)}` : `${unit(value.min, u)} – ${unit(value.max, u)}`)
    : value.type === "from" ? `from ${unit(value.min, u)}` : `up to ${unit(value.max, u)}`;
  return `${s}${frequency && !none ? FREQ[frequency] : ""}`;
}

export const USE_LABEL: Record<TermUse, string> = {
  usable: "Usable in answers", unreviewed: "Waiting for a reviewer", quote_not_found: "Quote not found on the page",
  stated_missing: "Not stated on the page", stale: "Past its review date", unknown_product: "Unknown product", not_in_catalog: "Not in the catalog",
};

export const KIND_LABEL: Record<string, string> = {
  mortgage: "Mortgage", car_loan: "Car loan", credit_card: "Credit card", overdraft: "Overdraft", personal_loan: "Personal loan",
  term_deposit: "Term deposit", savings_account: "Savings account", current_account: "Current account", other: "Other",
};

export const TRACK_LABEL: Record<Track, string> = { personal: "Individuals", business: "Business" };

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Bucharest" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
/** "27 Nov 2026" from an ISO day or a timestamp. */
export const day = (x: string | number) => dayFmt.format(typeof x === "number" ? x : new Date(x.length === 10 ? `${x}T12:00:00Z` : x));
export const time = (ms: number) => timeFmt.format(ms);

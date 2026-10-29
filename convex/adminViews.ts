import { ConvexError, v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requirePermission, requireRole } from "./roles";
import { productReview, REVIEW_DUE_DAYS, reviewState, termUse } from "../lib/catalog/review";
import type { TermRecord } from "../lib/catalog/schemas";
import { HARD_LIMITS, POLICY_PARAMETERS } from "../lib/agent/rules";

/*
 * Read-only views for the admin console (admin.html#home, #products, #rules, #audit): Raiffeisen's imported catalog with
 * review dates, the audit log with names, and what needs attention. Nothing here edits; versioned editing and
 * approvals come later (raiffy-spec/docs/shared/console.md → Change lifecycle). Every query checks the role again.
 */

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const termOf = ({ _id, _creationTime, ...record }: Doc<"productTerms">): TermRecord => record;

function byProduct(terms: TermRecord[]): Map<string, TermRecord[]> {
  const out = new Map<string, TermRecord[]>();
  for (const t of terms) out.set(t.productId, [...(out.get(t.productId) ?? []), t]);
  return out;
}

/** The track a product page belongs to, from the collections it was filed under. */
function trackOf(p: Doc<"products">): "personal" | "business" | null {
  if (p.personal_bank_product_docs) return "personal";
  if (p.business_bank_product_docs) return "business";
  return null;
}

async function raiffeisenTerms(ctx: QueryCtx): Promise<TermRecord[]> {
  const tracks = await Promise.all((["personal", "business"] as const).map((track) =>
    ctx.db.query("productTerms").withIndex("by_track_product", (q) => q.eq("track", track)).take(5_000)));
  return tracks.flat().filter((t) => t.bank === "raiffeisen").map(termOf);
}

async function namesOf(ctx: QueryCtx, ids: Iterable<string>): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(unique.map((id) => ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", id)).unique()));
  return Object.fromEntries(rows.flatMap((u, i) => (u ? [[unique[i]!, u.name || u.email || unique[i]!]] : [])));
}

const termView = (t: TermRecord, today: string, now: number) => ({
  termId: t.termId, kind: t.kind, label: t.label, value: t.value, unit: t.unit, frequency: t.frequency ?? null,
  conditions: t.conditions, quote: t.quote, url: t.provenance.url, collectedAt: t.provenance.collectedAt,
  reviewBy: t.provenance.reviewBy, reviewedBy: t.verification.reviewedBy ?? null, reviewedAt: t.verification.reviewedAt ?? null,
  review: reviewState(t.provenance.reviewBy, today, REVIEW_DUE_DAYS), use: termUse(t, now),
});

/** Raiffeisen's products with a summary of their imported values. */
export const products = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.read");
    const now = Date.now(), today = isoDay(now);
    const [rows, terms] = await Promise.all([
      ctx.db.query("products").withIndex("by_bank_kind", (q) => q.eq("bank", "raiffeisen")).take(2_000),
      raiffeisenTerms(ctx),
    ]);
    const grouped = byProduct(terms);
    return rows.map((p) => {
      const own = grouped.get(p.productId) ?? [];
      const review = productReview(own, today, now, REVIEW_DUE_DAYS);
      const headline = own.find((t) => t.termId === review.headlineTermId);
      return {
        productId: p.productId, product: p.product, kind: p.kind, category: p.category ?? null, track: trackOf(p),
        url: p.url, collectedAt: p.collectedAt, review,
        headline: headline ? { value: headline.value, unit: headline.unit, frequency: headline.frequency ?? null, use: termUse(headline, now) } : null,
      };
    });
  },
});

/** One product and all its imported values, newest review state first. */
export const product = query({
  args: { productId: v.string() },
  handler: async (ctx, { productId }) => {
    await requirePermission(ctx, "catalog.read");
    const p = await ctx.db.query("products").withIndex("by_productId", (q) => q.eq("productId", productId)).first();
    if (!p || p.bank !== "raiffeisen") return null;
    const now = Date.now(), today = isoDay(now);
    const track = trackOf(p);
    const terms = track
      ? (await ctx.db.query("productTerms").withIndex("by_track_product", (q) => q.eq("track", track).eq("productId", productId)).take(500)).map(termOf)
      : [];
    const names = await namesOf(ctx, terms.flatMap((t) => (t.verification.reviewedBy ? [t.verification.reviewedBy] : [])));
    return {
      productId: p.productId, product: p.product, kind: p.kind, category: p.category ?? null, segment: p.segment ?? null, track,
      url: p.url, collectedAt: p.collectedAt, summary: p.summary,
      review: productReview(terms, today, now, REVIEW_DUE_DAYS),
      terms: terms.map((t) => ({ ...termView(t, today, now), reviewedByName: t.verification.reviewedBy ? names[t.verification.reviewedBy] ?? null : null })),
    };
  },
});

/** The audit log, newest first, with the names of the people in it. */
export const audit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 200 }) => {
    await requirePermission(ctx, "audit.read");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ConvexError("audit_limit_invalid");
    const rows = await ctx.db.query("auditLog").withIndex("by_at").order("desc").take(limit);
    const names = await namesOf(ctx, rows.flatMap((r) => [r.actorUserId, ...(r.targetUserId ? [r.targetUserId] : [])]));
    return rows.map(({ _id, _creationTime, ...e }) => ({ ...e, actorName: names[e.actorUserId] ?? null, targetName: e.targetUserId ? names[e.targetUserId] ?? null : null }));
  },
});

/** The admin home: catalog values that need attention, open escalations, recent changes and last week's volume. */
export const home = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "admin");
    const now = Date.now(), today = isoDay(now), weekAgo = now - 7 * DAY_MS;
    const [productRows, terms, openCases, recent, threads, messages] = await Promise.all([
      ctx.db.query("products").withIndex("by_bank_kind", (q) => q.eq("bank", "raiffeisen")).take(2_000),
      raiffeisenTerms(ctx),
      ctx.db.query("reviewCases").withIndex("by_status", (q) => q.eq("status", "open")).take(500),
      ctx.db.query("auditLog").withIndex("by_at").order("desc").take(5),
      ctx.db.query("ragThreads").withIndex("by_creation_time", (q) => q.gte("_creationTime", weekAgo)).take(10_000),
      ctx.db.query("ragMessages").withIndex("by_creation_time", (q) => q.gte("_creationTime", weekAgo)).take(20_000),
    ]);
    const nameOf = new Map(productRows.map((p) => [p.productId, p.product]));
    const attention = [...byProduct(terms)].flatMap(([productId, own]) => {
      const r = productReview(own, today, now, REVIEW_DUE_DAYS);
      return r.stale || r.due || r.unreviewed ? [{ productId, product: nameOf.get(productId) ?? own[0]!.product, ...r }] : [];
    }).sort((a, b) => b.stale - a.stale || (a.nextReviewBy ?? "").localeCompare(b.nextReviewBy ?? ""));
    const names = await namesOf(ctx, recent.map((e) => e.actorUserId));
    const answers = messages.filter((m) => m.role === "assistant");
    return {
      attention,
      escalations: { open: openCases.length, oldestAt: openCases.length ? Math.min(...openCases.map((c) => c.createdAt)) : null },
      recent: recent.map(({ _id, _creationTime, ...e }) => ({ ...e, actorName: names[e.actorUserId] ?? null })),
      week: {
        conversations: threads.length,
        answers: answers.filter((m) => m.status === undefined || m.status === "done").length,
        failed: answers.filter((m) => m.status === "failed").length,
        capped: threads.length === 10_000 || messages.length === 20_000,
      },
    };
  },
});

/** The Rules page: hard limits in code with their eval cases, and the policy values the code uses today. */
export const rules = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "hardLimits.read");
    return { hardLimits: HARD_LIMITS, parameters: POLICY_PARAMETERS };
  },
});

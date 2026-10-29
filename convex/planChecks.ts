import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { schedulePlanEmail } from "./planCheckEmails";
import { ownedRows } from "./plans";
import { requirePermission } from "./roles";
import { screenChat } from "../lib/agent/privacy";
import type { TermRecord } from "../lib/catalog/schemas";
import { blocksConfirm, planCheckList } from "../lib/plan/checks";
import { planSummarySchema, type PlanSummary, type PlanVerification } from "../lib/plan/schemas";
import { ANSWER_CHECK_NOTE_MAX } from "../lib/review/answerCheck";

/*
 * Plan checks (chat.html "Check my plan", console.html pagePlan). The customer sends the latest version of their plan
 * from its card; an operator or admin confirms it or sends it back with a reason from /console/reviews. The figures
 * are never edited: the decision goes into that version's verification, so the card shows it and a rebuilt plan
 * says it changed after the check. Every decision is written to the audit log.
 */

const MAX_REQUESTS_PER_DAY = 5;
const QUEUE_LIMIT = 50;

function reference(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `PC-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")}`;
}

async function planRow(ctx: Pick<QueryCtx, "db">, planId: string, version: number) {
  const row = await ctx.db.query("planSummaries").withIndex("by_plan_version", (q) => q.eq("planId", planId).eq("version", version)).unique();
  if (!row) throw new ConvexError("plan_unavailable");
  return row;
}

/** Writes the check's state into the plan version it is about. */
async function setVerification(ctx: MutationCtx, row: Doc<"planSummaries">, verification: PlanVerification) {
  const plan = planSummarySchema.parse(row.plan);
  await ctx.db.patch(row._id, { plan: planSummarySchema.parse({ ...plan, verification }) });
}

/** Sends the latest version of the customer's plan for a check. Asking again for the same version returns the same check. */
export const request = mutation({
  args: { planId: v.string(), version: v.number(), note: v.optional(v.string()) },
  returns: v.object({ reference: v.string() }),
  handler: async (ctx, { planId, version, note }) => {
    const rows = await ownedRows(ctx, planId);
    const row = rows.at(-1)!;
    if (row.version !== version) throw new ConvexError("plan_outdated");
    const trimmed = note?.trim() ?? "";
    if (trimmed.length > ANSWER_CHECK_NOTE_MAX) throw new ConvexError("note_too_long");
    const existing = await ctx.db.query("planChecks").withIndex("by_plan", (q) => q.eq("planId", planId).eq("version", version)).first();
    if (existing) return { reference: existing.reference };
    const now = Date.now();
    const recent = await ctx.db.query("planChecks")
      .withIndex("by_owner", (q) => q.eq("ownerKey", row.ownerKey).gte("createdAt", now - 24 * 60 * 60 * 1000)).take(MAX_REQUESTS_PER_DAY);
    if (recent.length >= MAX_REQUESTS_PER_DAY) throw new ConvexError("plan_check_limit_reached");
    const ref = reference();
    const id = await ctx.db.insert("planChecks", {
      reference: ref, planId, version, threadId: row.threadId, ownerKey: row.ownerKey, track: row.track, organizationKey: row.organizationKey,
      status: "open", note: trimmed ? screenChat(trimmed).text : null, createdAt: now,
    });
    await setVerification(ctx, row, { level: "pending_review", forVersion: version, requestId: ref });
    await schedulePlanEmail(ctx, id, "received");
    return { reference: ref };
  },
});

/* ── Operators: the queue in /console/reviews ── */

function queueRow(c: Doc<"planChecks">, plan: PlanSummary) {
  return {
    id: c._id, reference: c.reference, status: c.status, track: c.track, planId: c.planId, version: c.version,
    product: plan.goal.product, amount: plan.goal.amount, termMonths: plan.goal.termMonths, monthly: plan.figures.monthly,
    hasNote: c.note !== null, createdAt: c.createdAt, decidedAt: c.decidedAt ?? null, decidedBy: c.decidedBy?.name ?? null,
  };
}

async function withPlan(ctx: Pick<QueryCtx, "db">, checks: Doc<"planChecks">[]) {
  return Promise.all(checks.map(async (c) => queueRow(c, planSummarySchema.parse((await planRow(ctx, c.planId, c.version)).plan))));
}

/** Open checks oldest first, and the most recently created decided ones. No customer identity. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "review.answer");
    const open = await ctx.db.query("planChecks").withIndex("by_status", (q) => q.eq("status", "open")).order("asc").take(QUEUE_LIMIT);
    const decided = (await ctx.db.query("planChecks").withIndex("by_created").order("desc").take(QUEUE_LIMIT)).filter((c) => c.status !== "open");
    return { open: await withPlan(ctx, open), decided: await withPlan(ctx, decided) };
  },
});

/** The automatic checks for a plan version, against today's catalog for its product and its template. */
async function automaticChecks(ctx: Pick<QueryCtx, "db">, plan: PlanSummary) {
  const rows = plan.figuresFrom === "catalog"
    ? await ctx.db.query("productTerms").withIndex("by_track_product", (q) => q.eq("track", plan.track).eq("productId", plan.goal.productId)).collect()
    : [];
  const records: TermRecord[] = rows.map(({ _id, _creationTime, ...r }) => r);
  const t = await ctx.db.query("planTemplates").withIndex("by_track_product", (q) => q.eq("track", plan.track).eq("productId", plan.goal.productId)).unique();
  const template = t ? {
    rateTermId: t.rateTermId, commissions: t.commissions, ...(t.rateRange ? { rateRange: true } : {}),
    ...(t.amountLimitTermId ? { amountLimitTermId: t.amountLimitTermId } : {}), ...(t.termLimitTermId ? { termLimitTermId: t.termLimitTermId } : {}),
    ...(t.debtShareCeilingTermId ? { debtShareCeilingTermId: t.debtShareCeilingTermId } : {}),
  } : undefined;
  return planCheckList({ plan, records, ...(template ? { template } : {}), now: Date.now() });
}

/** One check with the plan version it is about, and whether the customer has rebuilt the plan since. */
export const get = query({
  args: { checkId: v.id("planChecks") },
  handler: async (ctx, { checkId }) => {
    await requirePermission(ctx, "review.answer");
    const c = await ctx.db.get(checkId);
    if (!c) return null;
    const plan = planSummarySchema.parse((await planRow(ctx, c.planId, c.version)).plan);
    const latest = await ctx.db.query("planSummaries").withIndex("by_plan_version", (q) => q.eq("planId", c.planId)).order("desc").first();
    return { ...queueRow(c, plan), plan, note: c.note, customerNote: c.customerNote ?? null, reason: c.reason ?? null,
      emails: (c.emails ?? []).map(({ kind, outcome, reason, at }) => ({ kind, outcome, reason: reason ?? null, at })),
      latestVersion: latest?.version ?? c.version, checks: await automaticChecks(ctx, plan) };
  },
});

/**
 * Confirm (with an optional note), confirm with a correction (a note for the customer and a reason for the team; the
 * figures stay as built), or send back with a reason. Final; the plan card shows it. A failing automatic check blocks
 * both confirmations.
 */
export const decide = mutation({
  args: {
    checkId: v.id("planChecks"), decision: v.union(v.literal("confirm"), v.literal("correct"), v.literal("return")),
    note: v.optional(v.string()), reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { checkId, decision, note, reason }) => {
    const caller = await requirePermission(ctx, "review.answer");
    const text = note?.trim() ?? "", why = reason?.trim() ?? "";
    if ((decision === "return" || decision === "correct") && !text) throw new ConvexError("note_required");
    if (decision === "correct" && !why) throw new ConvexError("reason_required");
    if (text.length > ANSWER_CHECK_NOTE_MAX || why.length > ANSWER_CHECK_NOTE_MAX) throw new ConvexError("note_too_long");
    const c = await ctx.db.get(checkId as Id<"planChecks">);
    if (!c) throw new ConvexError("not_found");
    if (c.status !== "open") throw new ConvexError("already_decided");
    const row = await planRow(ctx, c.planId, c.version);
    if (decision !== "return" && blocksConfirm(await automaticChecks(ctx, planSummarySchema.parse(row.plan)))) throw new ConvexError("checks_failed");
    const name = caller.identity.name ?? caller.identity.email ?? "A specialist";
    const now = Date.now();
    const status = decision === "confirm" ? "confirmed" as const : decision === "correct" ? "corrected" as const : "returned" as const;
    await ctx.db.patch(c._id, { status, decidedBy: { name, role: "Specialist" }, decidedAt: now, ...(text ? { customerNote: text } : {}), ...(why ? { reason: why } : {}) });
    await setVerification(ctx, row, {
      level: status === "corrected" ? "edited" : status, forVersion: c.version, requestId: c.reference, reviewer: { id: c.reference, name, role: "Specialist" },
      reviewedAt: new Date(now).toISOString(), ...(text ? { note: text } : {}),
    });
    await schedulePlanEmail(ctx, c._id, "decided");
    await writeAudit(ctx, caller, { action: "planCheck.decide", details: { checkId: c._id, reference: c.reference, planId: c.planId, version: String(c.version), decision, ...(why ? { reason: why } : {}) }, note: text || undefined });
    return null;
  },
});

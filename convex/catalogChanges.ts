import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./audit";
import { requirePermission, type Caller } from "./roles";
import { can } from "../lib/auth/roles";
import { checkChange, NOTE_MAX, sameValue, snapshotOf, type TermSnapshot } from "../lib/catalog/changes";
import { REVIEW_DUE_DAYS, reviewState, termUse } from "../lib/catalog/review";
import type { TermRecord } from "../lib/catalog/schemas";

/*
 * Changing catalog values from the console (console.html#products, raiffy-spec/docs/shared/console.md → Change lifecycle).
 * An operator proposes and an admin approves; an admin's own change is published at once. Publishing writes the value
 * into productTerms, the table the chat's catalog tool reads, and marks it reviewed by a person. Every step is audited.
 * A rollback restores the value before a published change, as a new change through the same approval.
 */

const termOf = ({ _id, _creationTime, ...record }: Doc<"productTerms">): TermRecord => record;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sameSnapshot = (a: TermSnapshot, b: TermSnapshot) => sameValue(a.value, b.value) && a.quote === b.quote && a.url === b.url && a.reviewBy === b.reviewBy;

function changeId() {
  const a = new Uint8Array(3);
  crypto.getRandomValues(a);
  return `CH-${[...a].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

async function termRow(ctx: Pick<QueryCtx, "db">, termId: string) {
  const row = await ctx.db.query("productTerms").withIndex("by_termId", (q) => q.eq("termId", termId)).unique();
  if (!row || row.bank !== "raiffeisen") throw new ConvexError("term_unavailable");
  return row;
}

async function changeRow(ctx: Pick<QueryCtx, "db">, id: string) {
  const row = await ctx.db.query("catalogChanges").withIndex("by_changeId", (q) => q.eq("changeId", id)).unique();
  if (!row) throw new ConvexError("change_unavailable");
  return row;
}

async function pendingFor(ctx: Pick<QueryCtx, "db">, termId: string) {
  return (await ctx.db.query("catalogChanges").withIndex("by_term", (q) => q.eq("termId", termId)).order("desc").take(50)).find((c) => c.status === "pending") ?? null;
}

const fmtSnapshot = (s: TermSnapshot) => JSON.stringify(s.value);

/** Writes the change into the catalog. The term must still be what the change was proposed against. */
async function publish(ctx: MutationCtx, c: Doc<"catalogChanges">, by: Caller, note?: string) {
  const t = await termRow(ctx, c.termId);
  if (!sameSnapshot(snapshotOf(termOf(t)), c.before)) throw new ConvexError("change_outdated");
  const now = Date.now(), at = new Date(now).toISOString();
  const { chunkId: _chunk, effectiveFrom: _from, ...provenance } = t.provenance;
  await ctx.db.patch(t._id, {
    value: c.after.value, quote: c.after.quote,
    provenance: { ...provenance, ...(c.after.url === t.provenance.url && t.provenance.chunkId ? { chunkId: t.provenance.chunkId } : {}), url: c.after.url, collectedAt: at, reviewBy: c.after.reviewBy, status: "fresh" },
    verification: { quoteFound: true, reviewedBy: by.clerkUserId, reviewedAt: at },
  });
  await ctx.db.patch(c._id, { status: "published", decidedBy: by.clerkUserId, decidedAt: now, ...(note ? { decisionNote: note } : {}) });
  if (c.rollbackOf) {
    const original = await changeRow(ctx, c.rollbackOf);
    await ctx.db.patch(original._id, { status: "rolledBack" });
  }
  await writeAudit(ctx, by, {
    action: c.kind === "rollback" ? "catalog.rolled_back" : "catalog.published",
    details: { changeId: c.changeId, termId: c.termId, product: c.product, label: c.label, before: fmtSnapshot(c.before), after: fmtSnapshot(c.after) },
    ...(note ? { note } : {}),
  });
}

/** Records a change; an admin's is published at once, an operator's waits for approval. */
async function record(ctx: MutationCtx, caller: Caller, t: Doc<"productTerms">, kind: Doc<"catalogChanges">["kind"], after: TermSnapshot, note: string, rollbackOf?: string) {
  if (await pendingFor(ctx, t.termId)) throw new ConvexError("change_pending");
  const id = changeId();
  const row = {
    changeId: id, termId: t.termId, productId: t.productId, product: t.product, label: t.label, unit: t.unit, track: t.track,
    kind, before: snapshotOf(termOf(t)), after, note, status: "pending" as const,
    proposedBy: caller.clerkUserId, proposedByRole: caller.role, proposedAt: Date.now(), ...(rollbackOf ? { rollbackOf } : {}),
  };
  const _id = await ctx.db.insert("catalogChanges", row);
  if (can(caller.role, "change.publish")) {
    await publish(ctx, { ...row, _id, _creationTime: 0 }, caller);
    return { changeId: id, status: "published" as const };
  }
  await writeAudit(ctx, caller, {
    action: "catalog.proposed",
    details: { changeId: id, termId: t.termId, product: t.product, label: t.label, before: fmtSnapshot(row.before), after: fmtSnapshot(after) },
    ...(note ? { note } : {}),
  });
  return { changeId: id, status: "pending" as const };
}

const result = v.object({ changeId: v.string(), status: v.union(v.literal("pending"), v.literal("published")) });

/** Propose a new value, or re-confirm the current one with a fresh source and review date. */
export const propose = mutation({
  args: { termId: v.string(), value: v.any(), quote: v.string(), url: v.string(), reviewBy: v.string(), note: v.string() },
  returns: result,
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "change.propose");
    const t = await termRow(ctx, args.termId);
    const now = Date.now(), today = isoDay(now), current = termOf(t);
    const needsReview = termUse(current, now) !== "usable" || reviewState(current.provenance.reviewBy, today, REVIEW_DUE_DAYS) !== "ok";
    const check = checkChange(current, { value: args.value, quote: args.quote, url: args.url, reviewBy: args.reviewBy, note: args.note }, today, needsReview);
    if (!check.ok) throw new ConvexError(check.reason);
    const { value, quote, url, reviewBy, note } = check.input;
    return record(ctx, caller, t, check.kind, { value, quote, url, reviewBy }, note);
  },
});

/** An admin publishes an operator's change, after seeing its before and after. */
export const approve = mutation({
  args: { changeId: v.string(), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "change.approve");
    const c = await changeRow(ctx, args.changeId);
    if (c.status !== "pending") throw new ConvexError("change_not_pending");
    const note = args.note?.trim();
    if (note && note.length > NOTE_MAX) throw new ConvexError("note_too_long");
    await publish(ctx, c, caller, note || undefined);
    return null;
  },
});

/** An admin turns down an operator's change, with a reason the operator sees. */
export const reject = mutation({
  args: { changeId: v.string(), note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "change.approve");
    const c = await changeRow(ctx, args.changeId);
    if (c.status !== "pending") throw new ConvexError("change_not_pending");
    const note = args.note.trim();
    if (!note || note.length > NOTE_MAX) throw new ConvexError("reason_required");
    await ctx.db.patch(c._id, { status: "rejected", decidedBy: caller.clerkUserId, decidedAt: Date.now(), decisionNote: note });
    await writeAudit(ctx, caller, { action: "catalog.rejected", details: { changeId: c.changeId, termId: c.termId, product: c.product, label: c.label }, note });
    return null;
  },
});

/** Restore the value before the latest published change of a term. Goes through approval like any change. */
export const rollBack = mutation({
  args: { changeId: v.string(), note: v.string() },
  returns: result,
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "change.propose");
    const c = await changeRow(ctx, args.changeId);
    const latest = (await ctx.db.query("catalogChanges").withIndex("by_term", (q) => q.eq("termId", c.termId)).order("desc").take(50)).find((x) => x.status === "published");
    if (c.status !== "published" || latest?.changeId !== c.changeId) throw new ConvexError("rollback_not_latest");
    const t = await termRow(ctx, c.termId);
    if (!sameSnapshot(snapshotOf(termOf(t)), c.after)) throw new ConvexError("change_outdated");
    const note = args.note.trim();
    if (!note || note.length > NOTE_MAX) throw new ConvexError("reason_required");
    // The old review date may have passed; restoring a value doesn't restore a lapsed review
    const today = isoDay(Date.now());
    if (c.before.reviewBy <= today) throw new ConvexError("rollback_review_lapsed");
    return record(ctx, caller, t, "rollback", c.before, note, c.changeId);
  },
});

/* ───────────── Views ───────────── */

const snapshotView = v.object({ value: v.any(), quote: v.string(), url: v.string(), reviewBy: v.string() });
const changeView = v.object({
  changeId: v.string(), termId: v.string(), productId: v.string(), product: v.string(), label: v.string(), unit: v.string(),
  kind: v.union(v.literal("edit"), v.literal("confirm"), v.literal("rollback")),
  before: snapshotView, after: snapshotView, note: v.string(),
  status: v.union(v.literal("pending"), v.literal("published"), v.literal("rejected"), v.literal("rolledBack")),
  proposedBy: v.string(), proposedByName: v.string(), proposedAt: v.number(),
  decidedByName: v.union(v.null(), v.string()), decidedAt: v.union(v.null(), v.number()), decisionNote: v.union(v.null(), v.string()),
  rollbackOf: v.union(v.null(), v.string()),
  /** Whether this is the latest published change of its term, so it can be rolled back. */
  latest: v.boolean(),
});

async function views(ctx: Pick<QueryCtx, "db">, rows: Doc<"catalogChanges">[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.proposedBy, ...(r.decidedBy ? [r.decidedBy] : [])]))];
  const users = await Promise.all(ids.map((id) => ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", id)).unique()));
  const name = Object.fromEntries(users.map((u, i) => [ids[i]!, u?.name || u?.email || "A colleague"]));
  const latestOf = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => b.proposedAt - a.proposedAt)) if (r.status === "published" && !latestOf.has(r.termId)) latestOf.set(r.termId, r.changeId);
  return rows.map((r) => ({
    changeId: r.changeId, termId: r.termId, productId: r.productId, product: r.product, label: r.label, unit: r.unit, kind: r.kind,
    before: r.before, after: r.after, note: r.note, status: r.status,
    proposedBy: r.proposedBy, proposedByName: name[r.proposedBy]!, proposedAt: r.proposedAt,
    decidedByName: r.decidedBy ? name[r.decidedBy]! : null, decidedAt: r.decidedAt ?? null, decisionNote: r.decisionNote ?? null,
    rollbackOf: r.rollbackOf ?? null, latest: latestOf.get(r.termId) === r.changeId,
  }));
}

/** One product's changes, newest first. */
export const forProduct = query({
  args: { productId: v.string() },
  returns: v.array(changeView),
  handler: async (ctx, { productId }) => {
    await requirePermission(ctx, "catalog.read");
    return views(ctx, await ctx.db.query("catalogChanges").withIndex("by_product", (q) => q.eq("productId", productId)).order("desc").take(200));
  },
});

/** Changes waiting for an admin, oldest first. */
export const pending = query({
  args: {},
  returns: v.array(changeView),
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.read");
    return views(ctx, await ctx.db.query("catalogChanges").withIndex("by_status", (q) => q.eq("status", "pending")).take(200));
  },
});

/** The latest decided changes, newest decision first: the closed side of the review queue. */
export const decided = query({
  args: {},
  returns: v.array(changeView),
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.read");
    const rows = (await Promise.all((["published", "rejected", "rolledBack"] as const).map((status) =>
      ctx.db.query("catalogChanges").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(50)))).flat();
    return views(ctx, rows.sort((a, b) => (b.decidedAt ?? b.proposedAt) - (a.decidedAt ?? a.proposedAt)).slice(0, 50));
  },
});

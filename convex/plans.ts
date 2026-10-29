import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAgentScope, requireAgentThread } from "./agentAuth";
import { writeAudit } from "./audit";
import { requirePermission } from "./roles";
import { addMonths } from "../lib/calc/schedule";
import type { TermRecord } from "../lib/catalog/schemas";
import { buildPlan, planTemplateSchema, type PlanTemplate } from "../lib/plan/build";
import { COMMISSION_KEYS, planSummarySchema, type PlanGap, type PlanSummary } from "../lib/plan/schemas";

/*
 * Plan summaries (raiffy-spec/docs/shared/plan-summary-handoff.md). The customer asks for a plan in one of their
 * conversations; the figures come only from the catalog records and the product's template read here, never from
 * the client or the model. Each change is a new version. Only the owner of the conversation can read a plan;
 * operator access through a verification request comes with the operator flow.
 */

const track = v.union(v.literal("personal"), v.literal("business"));
/** A conversation keeps one plan with at most this many versions. */
export const MAX_PLAN_VERSIONS = 20;

const gapView = v.object({ role: v.string(), commission: v.optional(v.string()), termId: v.optional(v.string()), reason: v.string() });
const createResult = v.union(
  v.object({ status: v.literal("ok"), planId: v.string(), version: v.number() }),
  v.object({ status: v.literal("unavailable"), gaps: v.array(gapView) }),
);

/** An admin names the catalog records behind a product's plan. Every term ID must exist for that product. */
export const setTemplate = mutation({
  args: {
    track,
    productId: v.string(),
    rateTermId: v.string(),
    commissions: v.array(v.object({
      key: v.union(...COMMISSION_KEYS.map((key) => v.literal(key))),
      termId: v.optional(v.string()),
      use: v.union(v.literal("upfront"), v.literal("monthly"), v.literal("if_used")),
    })),
    amountLimitTermId: v.optional(v.string()),
    termLimitTermId: v.optional(v.string()),
    debtShareCeilingTermId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { track, productId, note, ...raw }) => {
    const caller = await requirePermission(ctx, "change.publish");
    const template = planTemplateSchema.parse(raw);
    const termIds = [template.rateTermId, template.amountLimitTermId, template.termLimitTermId, template.debtShareCeilingTermId, ...template.commissions.map((c) => c.termId)]
      .filter((id): id is string => !!id);
    for (const termId of termIds) {
      const row = await ctx.db.query("productTerms").withIndex("by_termId", (q) => q.eq("termId", termId)).unique();
      if (!row || row.productId !== productId || row.track !== track) throw new ConvexError("plan_template_term_unknown");
    }
    const existing = await ctx.db.query("planTemplates").withIndex("by_track_product", (q) => q.eq("track", track).eq("productId", productId)).unique();
    const fields = { track, productId, ...template, updatedBy: caller.clerkUserId, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("planTemplates", fields);
    await writeAudit(ctx, caller, { action: "plan.template_set", details: { track, productId }, note });
    return null;
  },
});

async function latestVersion(ctx: Pick<QueryCtx, "db">, threadId: Doc<"planSummaries">["threadId"]) {
  return ctx.db.query("planSummaries").withIndex("by_thread_version", (q) => q.eq("threadId", threadId)).order("desc").first();
}

/** A plan ID nobody has used yet. */
async function newPlanId(ctx: Pick<QueryCtx, "db">): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = `PS-${100_000 + Math.floor(Math.random() * 900_000)}`;
    if (!await ctx.db.query("planSummaries").withIndex("by_plan_version", (q) => q.eq("planId", id)).first()) return id;
  }
  throw new ConvexError("plan_id_unavailable");
}

/**
 * The customer asks for a plan for an amount and term in their conversation. Returns the plan's ID and version, or
 * the catalog gaps that stop it (nothing is saved then).
 */
export const create = mutation({
  args: {
    threadId: v.id("ragThreads"),
    productId: v.string(),
    /** Bani. */
    amount: v.number(),
    termMonths: v.number(),
    goal: v.string(),
    alternativeTerms: v.optional(v.array(v.number())),
    /** What the customer stated in the conversation, in bani. */
    affordability: v.optional(v.object({ income: v.number(), obligations: v.number() })),
  },
  returns: createResult,
  handler: async (ctx, { threadId, ...args }) => {
    const thread = await requireAgentThread(ctx, threadId);
    const result = await createPlan(ctx, thread, args);
    if (result === "no_template") throw new ConvexError("plan_template_unavailable");
    return result;
  },
});

type PlanAsk = { productId: string; amount: number; termMonths: number; goal: string; alternativeTerms?: number[];
  affordability?: { income: number; obligations: number }; messageId?: Id<"ragMessages"> };

/** Builds and saves the next version of the conversation's plan, or says why the catalog can't back it. */
async function createPlan(ctx: MutationCtx, thread: Doc<"ragThreads">, args: PlanAsk) {
  const template = await ctx.db.query("planTemplates").withIndex("by_track_product", (q) => q.eq("track", thread.track).eq("productId", args.productId)).unique();
  if (!template) return "no_template" as const;

  const latest = await latestVersion(ctx, thread._id);
  if (latest && latest.version >= MAX_PLAN_VERSIONS) throw new ConvexError("plan_version_limit");
  const previous = latest ? planSummarySchema.parse(latest.plan) : null;

  const rows = await ctx.db.query("productTerms").withIndex("by_track_product", (q) => q.eq("track", thread.track).eq("productId", args.productId)).collect();
  const records: TermRecord[] = rows.map(({ _id, _creationTime, ...record }) => record);
  const now = Date.now();
  const planTemplate: PlanTemplate = {
    rateTermId: template.rateTermId, commissions: template.commissions,
    ...(template.amountLimitTermId ? { amountLimitTermId: template.amountLimitTermId } : {}),
    ...(template.termLimitTermId ? { termLimitTermId: template.termLimitTermId } : {}),
  };
  const result = buildPlan({
    id: latest?.planId ?? await newPlanId(ctx),
    version: (latest?.version ?? 0) + 1,
    conversationId: thread._id,
    track: thread.track,
    now,
    createdAt: new Date(now).toISOString(),
    goal: args.goal,
    productId: args.productId,
    amount: args.amount,
    termMonths: args.termMonths,
    firstPaymentDate: addMonths(new Date(now).toISOString().slice(0, 10), 1),
    template: planTemplate,
    records,
    alternativeTerms: args.alternativeTerms ?? [],
    // The chosen route until the deterministic recommendation is wired in with the agent (phase 4)
    recommendedRoute: `term_${args.termMonths}`,
    ...(args.affordability ? { affordability: args.affordability } : {}),
    ...(previous ? { previousVerification: previous.verification } : {}),
  });
  if (result.status === "unavailable") return result;

  const plan = result.plan;
  await ctx.db.insert("planSummaries", {
    planId: plan.id, version: plan.version, threadId: thread._id, track: thread.track,
    ownerKey: thread.ownerKey!, organizationKey: thread.organizationKey ?? null, plan, createdAt: now, ...(args.messageId ? { messageId: args.messageId } : {}),
  });
  return { status: "ok" as const, planId: plan.id, version: plan.version };
}

const lei = (n: number) => Math.round(n * 100);

/**
 * "Build my plan" under a simulation card (chat.html mkplan): everything comes from the stored answer, never the
 * client. The product is the one whose page the simulation's rate was cited from, the amount and term are the
 * customer's own figures in the card, and the goal is their question. Without those, or without reviewed terms for
 * the product, nothing is saved and the customer is told why.
 */
export const buildFromAnswer = mutation({
  /** What the simulator shows: the customer's own amount (lei) and term, within the card's longest term. */
  args: { messageId: v.id("ragMessages"), amount: v.optional(v.number()), termMonths: v.optional(v.number()) },
  returns: v.union(
    v.object({ status: v.literal("ok"), planId: v.string(), version: v.number() }),
    v.object({ status: v.literal("unavailable"), why: v.union(v.literal("no_figures"), v.literal("not_in_catalog"), v.literal("no_template"), v.literal("catalog_gaps")), gaps: v.array(gapView) }),
  ),
  handler: async (ctx, { messageId, ...pick }) => {
    if (!await ctx.auth.getUserIdentity()) throw new ConvexError("authentication_required");
    const message = await ctx.db.get(messageId);
    if (!message || message.role !== "assistant") throw new ConvexError("plan_unavailable");
    const thread = await requireAgentThread(ctx, message.threadId);
    const blocks = (message.answer as { ui?: { blocks?: { type: string }[] } } | undefined)?.ui?.blocks ?? [];
    const sim = blocks.find((b) => b.type === "simulation") as
      { source: string; amount?: number; months?: number; termMaxMonths?: number; income?: number; obligations?: number } | undefined;
    if (!sim) throw new ConvexError("plan_unavailable");
    if (pick.amount !== undefined && !(Number.isFinite(pick.amount) && pick.amount >= 100 && pick.amount <= 10_000_000)) throw new ConvexError("plan_amount_invalid");
    if (pick.termMonths !== undefined && !(Number.isInteger(pick.termMonths) && pick.termMonths >= 1 && pick.termMonths <= (sim.termMaxMonths ?? 360))) throw new ConvexError("plan_term_invalid");
    const amount = pick.amount ?? sim.amount, months = pick.termMonths ?? sim.months;
    const unavailable = (why: "no_figures" | "not_in_catalog" | "no_template" | "catalog_gaps", gaps: PlanGap[] = []) =>
      ({ status: "unavailable" as const, why, gaps });
    if (!amount || !months) return unavailable("no_figures");
    const product = (await ctx.db.query("products").withIndex("by_url", (q) => q.eq("url", sim.source)).take(5))
      .find((p) => p.bank === "raiffeisen");
    if (!product) return unavailable("not_in_catalog");
    const question = message.requestMessageId ? (await ctx.db.get(message.requestMessageId))?.text?.trim() : undefined;
    const result = await createPlan(ctx, thread, {
      productId: product.productId, amount: lei(amount), termMonths: months, messageId,
      goal: (question || `Borrow ${amount} lei over ${months} months`).slice(0, 200),
      ...(sim.income ? { affordability: { income: lei(sim.income), obligations: lei(sim.obligations ?? 0) } } : {}),
    });
    if (result === "no_template") return unavailable("no_template");
    if (result.status === "unavailable") return unavailable("catalog_gaps", result.gaps);
    return result;
  },
});

/** The same answer for a plan that doesn't exist and one that isn't the caller's. */
async function ownedRows(ctx: Pick<QueryCtx, "auth" | "db">, planId: string): Promise<Doc<"planSummaries">[]> {
  if (!await ctx.auth.getUserIdentity()) throw new ConvexError("authentication_required");
  if (!/^PS-\d{3,8}$/.test(planId)) throw new ConvexError("plan_unavailable");
  const rows = await ctx.db.query("planSummaries").withIndex("by_plan_version", (q) => q.eq("planId", planId)).collect();
  const first = rows[0];
  if (!first) throw new ConvexError("plan_unavailable");
  const scope = await requireAgentScope(ctx, first.track);
  if (rows.some((r) => r.ownerKey !== scope.ownerKey || r.organizationKey !== scope.organizationKey)) throw new ConvexError("plan_unavailable");
  return rows.sort((a, b) => a.version - b.version);
}

/** One version of a plan, the newest when no version is given. */
export const get = query({
  args: { planId: v.string(), version: v.optional(v.number()) },
  returns: v.object({ plan: v.any(), latestVersion: v.number() }),
  handler: async (ctx, { planId, version }) => {
    const rows = await ownedRows(ctx, planId);
    const row = version === undefined ? rows.at(-1) : rows.find((r) => r.version === version);
    if (!row) throw new ConvexError("plan_unavailable");
    const plan: PlanSummary = planSummarySchema.parse(row.plan);
    return { plan, latestVersion: rows.at(-1)!.version };
  },
});

/** The versions of the plan in one of the caller's conversations, newest first, as a short summary each. */
export const listForThread = query({
  args: { threadId: v.id("ragThreads") },
  returns: v.array(v.object({
    planId: v.string(), version: v.number(), createdAt: v.number(), amount: v.number(), termMonths: v.number(), monthly: v.number(), checked: v.string(),
    messageId: v.optional(v.id("ragMessages")),
  })),
  handler: async (ctx, { threadId }) => {
    const thread = await requireAgentThread(ctx, threadId);
    const rows = await ctx.db.query("planSummaries").withIndex("by_thread_version", (q) => q.eq("threadId", thread._id)).order("desc").take(MAX_PLAN_VERSIONS);
    return rows.map((row) => {
      const plan = planSummarySchema.parse(row.plan);
      return { planId: plan.id, version: plan.version, createdAt: row.createdAt, amount: plan.goal.amount, termMonths: plan.goal.termMonths, monthly: plan.figures.monthly,
        checked: plan.verification.changed ? "changed" : plan.verification.level, ...(row.messageId ? { messageId: row.messageId } : {}) };
    });
  },
});

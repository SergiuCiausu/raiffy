import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalMutation, internalQuery, mutation, type MutationCtx, query } from "./_generated/server";
import { requireAgentScope } from "./agentAuth";
import { requirePermission } from "./roles";
import { personaById } from "./seed/demoPersonas";
import { COMPETITOR_OFFERS, COUNTER_OFFER_BANDS, competitorById, PRICING_RULES, ruleFor } from "./seed/pricing";
import { canApproveAt, approvalLevelSchema } from "../lib/auth/roles";
import { addDays, negotiate, quote } from "../lib/pricing/price";
import { profileFrom } from "../lib/pricing/profile";
import type { CompetitorOffer, Negotiation, OfferBlock, PersonalOffer } from "../lib/pricing/schemas";
import { negotiationCitables, pricingSourceUrl, quoteCitable } from "../lib/pricing/text";
import type { Citable } from "../lib/rag/answer";
import type { Track } from "../lib/rag/schemas";

/*
 * Negotiation, pattern 11 (docs/shared/pricing.md), on sample pricing and synthetic customers only. Prices come from
 * lib/pricing, never the model. The model gets outcomes as citable text; band limits stay in the log and the review
 * case. Escalation needs the customer's tap ("Ask a specialist to review this"); a specialist's price comes back as
 * a personal offer. Outcomes are simulated until the official application flow exists.
 */

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const PRODUCT_IDS = PRICING_RULES.map((r) => r.productId) as [string, ...string[]];

/* ── The two tools ── */

const amountsSchema = { amountLei: z.number().positive().max(10_000_000).optional(), months: z.number().int().min(1).max(420).optional() };
export const offersInputSchema = z.object({ productId: z.enum(PRODUCT_IDS), ...amountsSchema }).strict();
export const negotiateInputSchema = z.object({
  productId: z.enum(PRODUCT_IDS),
  ...amountsSchema,
  competitor: z.union([
    z.object({ offerId: z.string() }).strict(),
    z.object({ claimedBank: z.string().min(1).max(60) }).strict(),
  ]),
}).strict();

const schemaOf = (s: z.ZodType) => { const { $schema: _s, ...rest } = z.toJSONSchema(s, { io: "input" }) as Record<string, unknown>; return rest as { type: "object"; [key: string]: unknown }; };

export const OFFERS_TOOL = {
  name: "get_approved_offers",
  description: "Read the customer's Raiffeisen price for a product: the price without conditions, each conditional price (with the cost of what the condition requires inside total cost and DAE), the price they get today, and any valid personal offer. Sample pricing in this preview, indicative: say so. It cannot make a discount; use negotiate_offer when the customer compares with another bank.",
  input_schema: schemaOf(offersInputSchema),
};
export const NEGOTIATE_TOOL = {
  name: "negotiate_offer",
  description: "When the customer says another bank is cheaper or asks for a better price: compares total cost with a competitor offer from the store (offerId) or the customer's typed claim (claimedBank), then returns the outcome: no counter-offer needed, a counter-offer, a specialist review, evidence needed, or an affordability stop. Present exactly that outcome; never invent, promise or hint at another price.",
  input_schema: schemaOf(negotiateInputSchema),
};

type Stated = { amount?: { value: number }; months?: { value: number } };

async function setup(ctx: ActionCtx, track: Track, productId: string, input: { amountLei?: number; months?: number }, stated: Stated, figures: readonly string[]) {
  const scope = await requireAgentScope(ctx, track);
  const access = await ctx.runQuery(internal.accounts.accessFor, { ownerKey: scope.ownerKey });
  const persona = track === "personal" ? personaById(access.persona) : null;
  const rule = ruleFor(productId)!;
  // Amounts the customer gave, else the sample customer's own request; a model-chosen figure is used only if the customer said it
  const said = (n?: number) => n !== undefined && figures.some((f) => Number(f.replace(/[^\d.]/g, "")) === n);
  const fallback = persona?.request?.productId === productId ? persona.request : undefined;
  const amountLei = stated.amount?.value ?? (said(input.amountLei) ? input.amountLei : undefined) ?? (fallback ? fallback.amount / 100 : undefined);
  const months = stated.months?.value ?? (said(input.months) ? input.months : undefined) ?? fallback?.months;
  const profile = profileFrom(persona, access, productId);
  const offers = await ctx.runQuery(internal.pricing.offersFor, { ownerKey: scope.ownerKey, productId });
  return { scope, rule, profile, offers, amount: amountLei ? Math.round(amountLei * 100) : null, months: months ?? null };
}

export type { OfferBlock };

export async function offersTool(ctx: ActionCtx, track: Track, raw: unknown, stated: Stated, figures: readonly string[]):
  Promise<{ outcome: { citables: Citable[]; note?: string } | { error: string }; block?: OfferBlock }> {
  const input = offersInputSchema.safeParse(raw);
  if (!input.success) return { outcome: { error: `Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}` } };
  const s = await setup(ctx, track, input.data.productId, input.data, stated, figures);
  if (!s.amount || !s.months) return { outcome: { citables: [], note: "The amount or the term is missing: ask the customer for both before quoting a price." } };
  const q = quote({ rule: s.rule, profile: s.profile, amount: s.amount, months: s.months, today: today(), offers: s.offers });
  const stores = COMPETITOR_OFFERS.filter((c) => c.productType === s.rule.productType).map((c) => `${c.id} (${c.bank})`).join(", ");
  return {
    outcome: { citables: [quoteCitable(q)], note: `Competitor offers in the store for negotiate_offer: ${stores || "none"}.` },
    block: { type: "offer", synthetic: true, sourceUrl: pricingSourceUrl(q), resolution: "quote", quote: q },
  };
}

export async function negotiateTool(ctx: ActionCtx, track: Track, raw: unknown, stated: Stated, figures: readonly string[], messageId: Id<"ragMessages">):
  Promise<{ outcome: { citables: Citable[]; note?: string } | { error: string }; block?: OfferBlock; result?: Negotiation }> {
  const input = negotiateInputSchema.safeParse(raw);
  if (!input.success) return { outcome: { error: `Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}` } };
  const s = await setup(ctx, track, input.data.productId, input.data, stated, figures);
  if (!s.amount || !s.months) return { outcome: { citables: [], note: "The amount or the term is missing: ask the customer for both before comparing." } };
  const c = input.data.competitor;
  let competitor: CompetitorOffer | null;
  if ("offerId" in c) competitor = competitorById(c.offerId);
  else {
    // A typed claim: compared with that bank's published figures if the store has them, and never enough for an offer
    const published = COMPETITOR_OFFERS.find((x) => x.productType === s.rule.productType && x.bank.toLowerCase().startsWith(c.claimedBank.toLowerCase().slice(0, 6)));
    competitor = published ? { ...published, source: "client_claim", sourceLabel: "Published sample figures, not the customer's own offer" } : null;
    if (!competitor) return { outcome: { citables: [], note: `The store has no published figures for ${c.claimedBank}. Ask the customer for the competitor's SECCI form; a specialist can look at it, since uploading isn't available in this preview.` } };
  }
  if (!competitor || competitor.productType !== s.rule.productType) return { outcome: { error: "Unknown competitor offer for this product. Use an offerId from get_approved_offers." } };

  const n = negotiate({ rule: s.rule, bands: COUNTER_OFFER_BANDS, profile: s.profile, competitor, amount: s.amount, months: s.months, today: today(), offers: s.offers });
  const logged = await ctx.runMutation(internal.pricing.logNegotiation, { ownerKey: s.scope.ownerKey, messageId, productId: s.rule.productId, amount: s.amount, months: s.months, today: today(),
    segment: n.internal.segment, competitor: { id: competitor.id, bank: competitor.bank, source: competitor.source, totalPayable: n.competitor.totalPayable },
    ourListTotal: n.quote.unconditional.totalPayable, ourTotal: n.quote.current.totalPayable, resolution: n.resolution,
    offer: n.offer ? { levers: n.offer.levers.map((l) => l.label), rateBps: n.offer.line.rateBps, upfrontFee: n.offer.line.upfrontFee, monthlyFee: n.offer.line.monthlyFee,
      totalPayable: n.offer.line.totalPayable, validUntil: n.offer.validUntil } : undefined,
    internal: { bandId: n.internal.bandId, level: n.internal.level, neededCutBps: n.internal.neededCutBps } });
  // Asking again within the validity returns the same offer, with its original expiry
  const result: Negotiation = n.offer && logged.validUntil ? { ...n, offer: { ...n.offer, validUntil: logged.validUntil } } : n;
  const cits = negotiationCitables(result);
  const x = result.competitor;
  return {
    result,
    outcome: { citables: cits },
    block: { type: "offer", synthetic: true, sourceUrl: cits[0]!.url, competitorUrl: cits[1]!.url, logId: logged.logId, resolution: result.resolution, quote: result.quote,
      competitor: { bank: x.bank, sourceLabel: x.sourceLabel, source: x.source, rateBps: x.rateBps, upfrontFee: x.upfrontFee, monthly: x.monthly, totalPayable: x.totalPayable, daeBps: x.daeBps },
      ...(result.offer ? { offer: result.offer } : {}) },
  };
}

/* ── Data ── */

export const offersFor = internalQuery({
  args: { ownerKey: v.string(), productId: v.string() },
  handler: async (ctx, { ownerKey, productId }): Promise<PersonalOffer[]> => {
    const rows = await ctx.db.query("personalOffers").withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey).eq("productId", productId)).collect();
    return rows.map((r) => ({ id: r._id, productId: r.productId, rateBps: r.rateBps, upfrontFee: r.upfrontFee, monthlyFee: r.monthlyFee, amount: r.amount, months: r.months,
      origin: "specialist" as const, issuedBy: r.issuedBy, conditions: [], validUntil: r.validUntil }));
  },
});

const resolution = v.union(v.literal("not_needed"), v.literal("band"), v.literal("escalate"), v.literal("evidence_needed"), v.literal("affordability"));

export const logNegotiation = internalMutation({
  args: {
    ownerKey: v.string(), messageId: v.id("ragMessages"), productId: v.string(), amount: v.number(), months: v.number(), today: v.string(), segment: v.string(),
    competitor: v.object({ id: v.string(), bank: v.string(), source: v.string(), totalPayable: v.number() }),
    ourListTotal: v.number(), ourTotal: v.number(), resolution,
    offer: v.optional(v.object({ levers: v.array(v.string()), rateBps: v.number(), upfrontFee: v.number(), monthlyFee: v.number(), totalPayable: v.number(), validUntil: v.string() })),
    internal: v.object({ bandId: v.union(v.string(), v.null()), level: v.union(v.string(), v.null()), neededCutBps: v.union(v.number(), v.null()) }),
  },
  handler: async (ctx, a): Promise<{ logId: Id<"counterOfferLogs">; validUntil: string | null }> => {
    const message = await ctx.db.get(a.messageId);
    // The same question within an offer's validity gets the same offer and expiry
    if (a.offer) {
      const recent = await ctx.db.query("counterOfferLogs").withIndex("by_owner", (q) => q.eq("ownerKey", a.ownerKey)).order("desc").take(50);
      const same = recent.find((r) => r.resolution === "band" && r.outcome === "pending" && r.productId === a.productId && r.competitor.id === a.competitor.id
        && r.amount === a.amount && r.months === a.months && r.offer && r.offer.validUntil >= a.today && r.offer.totalPayable === a.offer!.totalPayable);
      if (same) return { logId: same._id, validUntil: same.offer!.validUntil };
    }
    const { messageId: _m, today: _t, ...row } = a;
    const logId = await ctx.db.insert("counterOfferLogs", { ...row, ...(message ? { threadId: message.threadId } : {}), outcome: "pending", createdAt: Date.now() });
    return { logId, validUntil: a.offer?.validUntil ?? null };
  },
});

async function ownLog(ctx: MutationCtx, logId: Id<"counterOfferLogs">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("authentication_required");
  const log = await ctx.db.get(logId);
  if (!log || log.ownerKey !== identity.tokenIdentifier) throw new ConvexError("not_found");
  return log;
}

/* ── The customer ── */

/** The customer agrees to send the case to a person. Only after an escalation outcome, once. */
export const requestReview = mutation({
  args: { logId: v.id("counterOfferLogs") },
  returns: v.null(),
  handler: async (ctx, { logId }) => {
    const log = await ownLog(ctx, logId);
    if (log.resolution !== "escalate" && log.resolution !== "evidence_needed") throw new ConvexError("review_not_available");
    if (await ctx.db.query("reviewCases").withIndex("by_log", (q) => q.eq("logId", logId)).first()) return null;
    await ctx.db.insert("reviewCases", { logId, ownerKey: log.ownerKey, productId: log.productId, level: log.internal.level ?? "specialist", status: "open", createdAt: Date.now() });
    await ctx.db.patch(logId, { review: "requested" });
    return null;
  },
});

/** Simulated: there is no official application flow yet, so the customer's choice is recorded here and labelled as such. */
export const setOutcome = mutation({
  args: { logId: v.id("counterOfferLogs"), outcome: v.union(v.literal("accepted"), v.literal("declined")),
    reasonLost: v.optional(v.union(v.literal("price"), v.literal("conditions"), v.literal("speed"), v.literal("other"))) },
  returns: v.null(),
  handler: async (ctx, { logId, outcome, reasonLost }) => {
    const log = await ownLog(ctx, logId);
    if (log.resolution !== "band" && log.review !== "approved") throw new ConvexError("no_offer");
    if (log.outcome !== "pending") throw new ConvexError("already_closed");
    if (log.offer && log.offer.validUntil < today()) { await ctx.db.patch(logId, { outcome: "expired", closedAt: Date.now() }); throw new ConvexError("offer_expired"); }
    await ctx.db.patch(logId, { outcome, ...(outcome === "declined" && reasonLost ? { reasonLost } : {}), closedAt: Date.now() });
    return null;
  },
});

/** The status of the customer's own negotiations, for the chat cards. */
export const myNegotiations = query({
  args: { logIds: v.array(v.id("counterOfferLogs")) },
  handler: async (ctx, { logIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("authentication_required");
    const now = today();
    const out = [];
    for (const id of logIds.slice(0, 20)) {
      const log = await ctx.db.get(id);
      if (!log || log.ownerKey !== identity.tokenIdentifier) continue;
      const expired = log.outcome === "pending" && !!log.offer && log.offer.validUntil < now;
      out.push({ logId: id, outcome: expired ? "expired" as const : log.outcome, review: log.review ?? null,
        approvedOffer: log.review === "approved" && log.offer ? { rateBps: log.offer.rateBps, totalPayable: log.offer.totalPayable, validUntil: log.offer.validUntil, approvedBy: log.offer.approvedBy ?? null } : null });
    }
    return out;
  },
});

/* ── Operators: review queue and win rate ── */

const LEVEL_LABEL: Record<string, string> = { specialist: "Credit specialist", branchManager: "Branch manager", pricingCommittee: "Pricing committee" };

export const listReviews = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requirePermission(ctx, "counterOffer.decide");
    const open = await ctx.db.query("reviewCases").withIndex("by_status", (q) => q.eq("status", "open")).order("desc").take(50);
    const decided = (await ctx.db.query("reviewCases").order("desc").take(50)).filter((c) => c.status !== "open").slice(0, 10);
    const view = async (c: (typeof open)[number]) => {
      const log = (await ctx.db.get(c.logId))!;
      const level = approvalLevelSchema.safeParse(c.level);
      return { id: c._id, status: c.status, level: c.level, levelLabel: LEVEL_LABEL[c.level] ?? c.level, canDecide: level.success && canApproveAt(caller.role, level.data),
        product: ruleFor(c.productId)?.product ?? c.productId, segment: log.segment, amount: log.amount, months: log.months,
        competitor: log.competitor, ourTotal: log.ourTotal, neededCutBps: log.internal.neededCutBps, createdAt: c.createdAt, decidedBy: c.decidedBy ?? null, note: c.note ?? null };
    };
    return { open: await Promise.all(open.map(view)), decided: await Promise.all(decided.map(view)) };
  },
});

export const decideReview = mutation({
  args: { caseId: v.id("reviewCases"), decision: v.union(v.literal("approve"), v.literal("decline")), rateBps: v.optional(v.number()), waiveFee: v.optional(v.boolean()), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { caseId, decision, rateBps, waiveFee, note }) => {
    const caller = await requirePermission(ctx, "counterOffer.decide");
    const c = await ctx.db.get(caseId);
    if (!c || c.status !== "open") throw new ConvexError("not_found");
    const level = approvalLevelSchema.safeParse(c.level);
    if (!level.success || !canApproveAt(caller.role, level.data)) throw new ConvexError("forbidden");
    const log = (await ctx.db.get(c.logId))!;
    const name = caller.identity.name ?? caller.identity.email ?? "A specialist";
    const now = Date.now();
    if (decision === "decline") {
      await ctx.db.patch(caseId, { status: "declined", decidedBy: name, decidedAt: now, ...(note ? { note } : {}) });
      await ctx.db.patch(log._id, { review: "declined" });
      return null;
    }
    const rule = ruleFor(log.productId);
    if (!rule || rateBps === undefined || rateBps < 0 || rateBps > rule.baseRateBps + 500) throw new ConvexError("invalid_rate");
    const validUntil = addDays(today(now), 7);
    const upfrontFee = waiveFee ? 0 : rule.fees.upfront;
    const q = quote({ rule, profile: null, amount: log.amount, months: log.months, today: today(now),
      offers: [{ id: "new", productId: log.productId, rateBps, upfrontFee, monthlyFee: rule.fees.monthly, amount: log.amount, months: log.months, origin: "specialist", conditions: [], validUntil }] });
    await ctx.db.insert("personalOffers", { ownerKey: log.ownerKey, caseId, productId: log.productId, rateBps, upfrontFee, monthlyFee: rule.fees.monthly,
      amount: log.amount, months: log.months, issuedBy: { name, role: LEVEL_LABEL[c.level] ?? "Specialist" }, validUntil, createdAt: now });
    await ctx.db.patch(caseId, { status: "approved", decidedBy: name, decidedAt: now, ...(note ? { note } : {}) });
    await ctx.db.patch(log._id, { review: "approved", offer: { levers: [waiveFee ? "Specialist price, fee waived" : "Specialist price"], rateBps, upfrontFee,
      monthlyFee: rule.fees.monthly, totalPayable: q.current.totalPayable, validUntil, approvedBy: name, level: c.level } });
    return null;
  },
});

/** Counter-offer win rate = accepted / (band + escalated), by product, segment, competitor and resolution. Pseudonymous. */
export const winRate = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "counterOffer.decide");
    const logs = await ctx.db.query("counterOfferLogs").withIndex("by_created").order("desc").take(1000);
    const now = today();
    const rows = logs.map((l) => ({ ...l, outcome: l.outcome === "pending" && l.offer && l.offer.validUntil < now ? "expired" as const : l.outcome }));
    const offered = rows.filter((l) => l.resolution === "band" || l.resolution === "escalate");
    const tally = (key: (l: (typeof rows)[number]) => string) => {
      const m = new Map<string, { offered: number; accepted: number; declined: number; expired: number; pending: number; gap: number }>();
      for (const l of offered) {
        const k = key(l);
        const t = m.get(k) ?? { offered: 0, accepted: 0, declined: 0, expired: 0, pending: 0, gap: 0 };
        t.offered += 1; t[l.outcome] += 1; t.gap += l.ourTotal - l.competitor.totalPayable;
        m.set(k, t);
      }
      return [...m.entries()].map(([k, t]) => ({ key: k, ...t, winRate: t.offered ? t.accepted / t.offered : null, averageGap: t.offered ? Math.round(t.gap / t.offered) : 0 }))
        .sort((a, b) => b.offered - a.offered);
    };
    return {
      total: rows.length,
      notNeeded: rows.filter((l) => l.resolution === "not_needed").length,
      evidenceNeeded: rows.filter((l) => l.resolution === "evidence_needed").length,
      byProduct: tally((l) => ruleFor(l.productId)?.product ?? l.productId),
      bySegment: tally((l) => l.segment),
      byCompetitor: tally((l) => l.competitor.bank),
      byResolution: tally((l) => (l.resolution === "band" ? "Inside the band" : "Escalated")),
      reasonsLost: Object.entries(rows.reduce<Record<string, number>>((m, l) => (l.reasonLost ? { ...m, [l.reasonLost]: (m[l.reasonLost] ?? 0) + 1 } : m), {})),
    };
  },
});

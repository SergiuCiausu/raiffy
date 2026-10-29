import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type ActionCtx, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireAgentScope } from "./agentAuth";
import { writeAudit } from "./audit";
import { requirePermission } from "./roles";
import { DEMO_PERSONAS, personaById } from "./seed/demoPersonas";
import { holdingsCitables, holdingsInputSchema, holdingsNote, holdingsView, type HoldingsView, type Switches } from "../lib/bank/holdings";
import { SWITCHES } from "../lib/bank/schemas";
import { INSIGHT_RULES } from "../lib/expenses/rules";
import { type ExpenseSummary, expensePeriodSchema } from "../lib/expenses/schemas";
import { summarizeExpenses } from "../lib/expenses/summary";
import type { Track } from "../lib/rag/schemas";
import type { Citable } from "../lib/rag/answer";
import { expenseCitable, expenseGapsNote } from "../lib/rag/tools";

/*
 * "What Raiffy can see", get_expense_summary and get_holdings. In the POC the account is a sample customer the user
 * picks, labelled as sample data everywhere; nothing is a real account. Every function checks the caller's identity,
 * and each tool reads only what the customer has switched on (the six Smart Mobile switches, lib/bank/schemas.ts).
 */

const OFF: Switches = Object.fromEntries(SWITCHES.map((k) => [k, false])) as Switches;

async function owner(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("authentication_required");
  return identity.tokenIdentifier;
}

const accessRow = (ctx: QueryCtx, ownerKey: string) => ctx.db.query("accountAccess").withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey)).unique();

/** The six switches of a stored row. A row from before the six switches had `cards` for card spending, now `transactions`. */
function switchesOf(row: Doc<"accountAccess"> | null): Switches {
  if (!row) return { ...OFF };
  if (row.transactions === undefined) return { ...OFF, account: row.account, savings: row.savings, transactions: row.cards };
  return { account: row.account, transactions: row.transactions, savings: row.savings, offers: row.offers ?? false, loans: row.loans ?? false, cards: row.cards };
}

export const getAccess = query({
  args: {},
  handler: async (ctx) => {
    const row = await accessRow(ctx, await owner(ctx));
    return {
      persona: row?.persona ?? null, ...switchesOf(row),
      assigned: row?.assignedPersona ?? null,
      personas: DEMO_PERSONAS.map((p) => ({ id: p.id, label: p.label, summary: p.summary })),
    };
  },
});

const switchArgs = Object.fromEntries(SWITCHES.map((k) => [k, v.optional(v.boolean())])) as Record<(typeof SWITCHES)[number], ReturnType<typeof v.optional<ReturnType<typeof v.boolean>>>>;

export const setAccess = mutation({
  args: { persona: v.optional(v.union(v.string(), v.null())), ...switchArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerKey = await owner(ctx);
    if (args.persona !== undefined && args.persona !== null && !personaById(args.persona)) throw new ConvexError("unknown_persona");
    const row = await accessRow(ctx, ownerKey);
    const next = { persona: row?.persona ?? null, ...switchesOf(row), ...Object.fromEntries(Object.entries(args).filter(([, x]) => x !== undefined)) };
    // Without a sample account there is nothing to switch on.
    const fields = next.persona ? next : { persona: null, ...OFF };
    if (row) await ctx.db.patch(row._id, { ...fields, updatedAt: Date.now() });
    else await ctx.db.insert("accountAccess", { ownerKey, ...fields, updatedAt: Date.now() });
    return null;
  },
});

/** Back to the sample customer an admin assigned (or none), every switch off: a tester's clean start. */
export const resetSample = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const row = await accessRow(ctx, await owner(ctx));
    if (row) await ctx.db.patch(row._id, { persona: row.assignedPersona ?? null, ...OFF, updatedAt: Date.now() });
    return null;
  },
});

const MAX_USERS = 200;

/** Admin: the sample customer each user has assigned and in use, by Clerk user ID. Users who never signed in have no row. */
export const assignments = query({
  args: {},
  returns: v.object({
    users: v.array(v.object({ clerkUserId: v.string(), assigned: v.union(v.string(), v.null()), inUse: v.union(v.string(), v.null()), assignedAt: v.union(v.number(), v.null()) })),
    personas: v.array(v.object({ id: v.string(), label: v.string(), summary: v.string() })),
  }),
  handler: async (ctx) => {
    await requirePermission(ctx, "users.manage");
    const users = await ctx.db.query("users").order("desc").take(MAX_USERS);
    return {
      users: await Promise.all(users.map(async (u) => {
        const row = await accessRow(ctx, u.tokenIdentifier);
        return { clerkUserId: u.clerkUserId, assigned: row?.assignedPersona ?? null, inUse: row?.persona ?? null, assignedAt: row?.assignedAt ?? null };
      })),
      personas: DEMO_PERSONAS.map((p) => ({ id: p.id, label: p.label, summary: p.summary })),
    };
  },
});

/**
 * Admin: assigns a sample customer to a tester (or clears it), audited in the same transaction. The tester's sample
 * account switches to it with every switch off: they still choose what Raiffy may read.
 */
export const assignSample = mutation({
  args: { targetUserId: v.string(), persona: v.union(v.string(), v.null()), note: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, { targetUserId, persona, note }) => {
    const caller = await requirePermission(ctx, "users.manage");
    if (persona !== null && !personaById(persona)) throw new ConvexError("unknown_persona");
    const user = await ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", targetUserId)).unique();
    if (!user) throw new ConvexError("user_never_signed_in");
    const row = await accessRow(ctx, user.tokenIdentifier);
    const from = row?.assignedPersona ?? null;
    if (from === persona) return null;
    const now = Date.now();
    const fields = { persona, assignedPersona: persona, assignedBy: caller.clerkUserId, assignedAt: now, ...OFF, updatedAt: now };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("accountAccess", { ownerKey: user.tokenIdentifier, ...fields });
    await writeAudit(ctx, caller, { action: "user.sample_assigned", targetUserId, details: { from: from ?? "none", to: persona ?? "none" }, note });
    return null;
  },
});

export const accessFor = internalQuery({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    const row = await accessRow(ctx, ownerKey);
    return { persona: row?.persona ?? null, ...switchesOf(row) };
  },
});

const switchesFrom = (access: Switches): Switches => Object.fromEntries(SWITCHES.map((k) => [k, access[k]])) as Switches;

export const expenseInputSchema = z.object({ period: expensePeriodSchema }).strict();

/** The customer's summary for this turn; business conversations have no sample account yet. */
export async function expenseSummaryFor(ctx: ActionCtx, track: Track, period: z.infer<typeof expensePeriodSchema>, now = Date.now(), statement = false): Promise<ExpenseSummary> {
  const scope = await requireAgentScope(ctx, track);
  const access = await ctx.runQuery(internal.accounts.accessFor, { ownerKey: scope.ownerKey });
  // Attaching the statement shares it for that question: the account and its transactions, whatever the switches say
  const switches = statement ? { ...switchesFrom(access), account: true, transactions: true } : switchesFrom(access);
  return summarizeExpenses({ persona: track === "personal" ? personaById(access.persona) : null, switches, period,
    today: new Date(now).toISOString().slice(0, 10), rules: INSIGHT_RULES });
}

const schemaOf = (schema: z.ZodType) => { const { $schema: _s, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>; return rest as { type: "object"; [key: string]: unknown }; };

export const EXPENSE_TOOL = {
  name: "get_expense_summary",
  description: "Read the customer's monthly income, spending by category, debt payments, fees, balances and spending insights for the last complete month or the last three, from what the customer has switched on in \"What Raiffy can see\". In this preview it is sample data, never a real account: say so. Returns one citable summary, or why there is none.",
  input_schema: schemaOf(expenseInputSchema),
};

export async function expenseTool(ctx: ActionCtx, track: Track, raw: unknown, statement = false): Promise<{ outcome: { citables: Citable[]; note?: string } | { error: string }; summary?: ExpenseSummary }> {
  const input = expenseInputSchema.safeParse(raw);
  if (!input.success) return { outcome: { error: `Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}` } };
  const summary = await expenseSummaryFor(ctx, track, input.data.period, Date.now(), statement);
  const citable = expenseCitable(summary);
  return { summary, outcome: citable ? { citables: [citable], ...(summary.notUsed.length ? { note: expenseGapsNote(summary) } : {}) } : { citables: [], note: expenseGapsNote(summary) } };
}

export const HOLDINGS_TOOL = {
  name: "get_holdings",
  description: "Read the customer's Raiffeisen products as the Smart Mobile app shows them: current accounts and overdraft (accounts), savings accounts and term deposits with rates and maturity dates (savings), loans with the amount left, rate, fixed-rate end, payments left and early-repayment fee (loans), cards with limits and annual fees (cards), bank-issued pre-approved offers (offers), and age, residency and digital-signing status (profile). Each kind is read only if the customer switched it on in \"What Raiffy can see\". In this preview it is sample data, never a real account: say so. Returns one citable per product, or why there is none.",
  input_schema: schemaOf(holdingsInputSchema),
};

/** get_holdings for this turn: the customer's holdings, only the kinds switched on. */
export async function holdingsFor(ctx: ActionCtx, track: Track, kinds?: z.infer<typeof holdingsInputSchema>["kinds"], now = Date.now()): Promise<HoldingsView> {
  const scope = await requireAgentScope(ctx, track);
  const access = await ctx.runQuery(internal.accounts.accessFor, { ownerKey: scope.ownerKey });
  const persona = track === "personal" ? personaById(access.persona) : null;
  return holdingsView({ customer: persona?.id ?? null, holdings: persona?.holdings, switches: switchesFrom(access), kinds, today: new Date(now).toISOString().slice(0, 10) });
}

/** The product pages the holdings link to, from the catalog. */
export const productUrls = internalQuery({
  args: { productIds: v.array(v.string()) },
  handler: async (ctx, { productIds }) => {
    const rows = await Promise.all([...new Set(productIds)].map((productId) => ctx.db.query("products").withIndex("by_productId", (q) => q.eq("productId", productId)).first()));
    return Object.fromEntries(rows.filter((r) => r !== null).map((r) => [r.productId, r.url]));
  },
});

export async function holdingsTool(ctx: ActionCtx, track: Track, raw: unknown): Promise<{ citables: Citable[]; note?: string } | { error: string }> {
  const input = holdingsInputSchema.safeParse(raw ?? {});
  if (!input.success) return { error: `Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}` };
  const view = await holdingsFor(ctx, track, input.data.kinds);
  const h = view.holdings;
  const ids = [...(h.accounts ?? []), ...(h.savings?.accounts ?? []), ...(h.savings?.deposits ?? []), ...(h.loans ?? []), ...(h.cards ?? []), ...(h.offers ?? [])].map((x) => x.productId);
  const urls = ids.length ? await ctx.runQuery(internal.accounts.productUrls, { productIds: ids }) : {};
  const note = holdingsNote(view);
  return { citables: holdingsCitables(view, urls), ...(note ? { note } : {}) };
}

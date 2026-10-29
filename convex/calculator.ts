import { v } from "convex/values";
import { z } from "zod";
import { getProductTermsInputSchema } from "../lib/agent/prompt";
import { internal } from "./_generated/api";
import { type ActionCtx, internalQuery } from "./_generated/server";
import { requireAgentScope } from "./agentAuth";
import { getProductTerms } from "./catalog";
import { resolveScenarioInputs, runScenario, scenarioRequestSchema, type ScenarioResult } from "../lib/calc/scenario";
import type { TermRecord } from "../lib/catalog/schemas";
import type { PlanTemplate } from "../lib/plan/build";
import { AGENT_POLICY } from "../lib/agent/config";
import { findUngroundedNumbers } from "../lib/rag/numbers";
import type { Track } from "../lib/rag/schemas";
import { scenarioCitable, scenarioGapsNote, termCitables, termGapsNote } from "../lib/rag/tools";
import type { Citable } from "../lib/rag/answer";

/*
 * The live handlers for get_product_terms and calculate_scenario in the answer loop (lib/rag/agent.ts HostTool).
 * The track comes from the authenticated session. Figures come only from reviewed catalog records and the pure
 * calculator (lib/calc/scenario.ts); the model points at records, it never supplies a value.
 */

const track = v.union(v.literal("personal"), v.literal("business"));

const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return rest as { type: "object"; [key: string]: unknown };
};

export const PRODUCT_TERMS_TOOL = {
  name: "get_product_terms",
  description: "Look up exact, reviewed catalog terms (rates, fees, limits) for products named by their catalog ID. Returns citable results; terms that are unreviewed, stale, a starting value or missing are listed as unavailable, never as zero. Indicative only: it can't approve credit or make an offer.",
  input_schema: jsonSchema(getProductTermsInputSchema),
};
export const CALCULATE_TOOL = {
  name: "calculate_scenario",
  description: "Calculate a loan's or an overdraft's monthly payment, total interest, fees, total payable and DAE, or compare the two, from catalog term IDs returned by get_product_terms (the rate, each fee, and the amount and term limits). Send the customer's own amount (in lei) and term only if they gave them; otherwise the conversation's inputs are used and the result says when they are an example. Returns one citable calculation, or what is missing. Never calculate yourself.",
  input_schema: jsonSchema(scenarioRequestSchema),
};

/** The products the catalog knows in a track, so the model can name them by ID. */
export const catalogProducts = internalQuery({
  args: { track },
  handler: async (ctx, { track }) => {
    const rows = await ctx.db.query("productTerms").withIndex("by_track_product", (q) => q.eq("track", track)).take(2000);
    return [...new Map(rows.map((r) => [r.productId, { productId: r.productId, product: r.product, bank: r.bank }])).values()];
  },
});

/** A product's plan template (convex/plans.ts), or null. */
export const templateFor = internalQuery({
  args: { track, productId: v.string() },
  handler: async (ctx, { track, productId }): Promise<PlanTemplate | null> => {
    const row = await ctx.db.query("planTemplates").withIndex("by_track_product", (q) => q.eq("track", track).eq("productId", productId)).unique();
    if (!row) return null;
    const { _id, _creationTime, track: _t, productId: _p, ...template } = row as typeof row & Record<string, unknown>;
    return template as unknown as PlanTemplate;
  },
});

export type ToolOutcome = { citables: Citable[]; note?: string } | { error: string };

export async function productTermsTool(ctx: ActionCtx, trackName: Track, raw: unknown): Promise<ToolOutcome> {
  const result = await getProductTerms(ctx, trackName, raw);
  const citables = termCitables(result);
  return { citables, ...(termGapsNote(result) ? { note: termGapsNote(result)! } : {}) };
}

/** The customer's amount and term, from the conversation's inputs (lei and months). */
export type StatedInputs = Parameters<typeof resolveScenarioInputs>[1];

export async function scenarioTool(ctx: ActionCtx, trackName: Track, raw: unknown, stated: StatedInputs, customerFigures: readonly string[],
  index: number, now = Date.now()): Promise<{ outcome: ToolOutcome; result?: ScenarioResult }> {
  await requireAgentScope(ctx, trackName);
  const parsed = scenarioRequestSchema.safeParse(raw);
  if (!parsed.success) return { outcome: { error: `Invalid input: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` } };
  const request = parsed.data;
  const productIds = [request.loan?.productId, request.overdraft?.productId].filter((x): x is string => !!x);
  const records: TermRecord[] = await ctx.runQuery(internal.catalog.termsFor, { track: trackName, productIds });
  const loanTemplate = request.loan ? await ctx.runQuery(internal.calculator.templateFor, { track: trackName, productId: request.loan.productId }) : null;
  const inputs = resolveScenarioInputs(request, stated, (n) => findUngroundedNumbers(String(n), customerFigures).length === 0);
  const result = runScenario({
    request, records, now, today: new Date(now).toISOString().slice(0, 10), ...inputs,
    ...(loanTemplate ? { loanTemplate } : {}),
    params: AGENT_POLICY.calculator,
  });
  const citable = scenarioCitable(result, index);
  return { result, outcome: citable ? { citables: [citable], ...(result.gaps.length ? { note: scenarioGapsNote(result) } : {}) } : { citables: [], note: scenarioGapsNote(result) } };
}

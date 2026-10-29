import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { type ActionCtx, internalQuery } from "./_generated/server";
import type { ToolOutcome } from "./calculator";
import type { ProductRecord } from "../lib/catalog/products";
import { catalogCitables, catalogNote, catalogQuerySchema, queryProducts, queryTerms, type CatalogScope } from "../lib/catalog/query";
import type { TermRecord } from "../lib/catalog/schemas";

/*
 * The query_catalog host tool (lib/catalog/query.ts): the product list and the term catalog, read before the vector
 * search. The track and the readable banks come from the authenticated turn's plan, never from the model.
 */

const track = v.union(v.literal("personal"), v.literal("business"));

const { $schema: _s, ...inputSchema } = z.toJSONSchema(catalogQuerySchema, { io: "input" }) as Record<string, unknown>;

export const QUERY_CATALOG_TOOL = {
  name: "query_catalog",
  description: "Query the bank's structured catalog before searching documents. find \"products\" lists which products exist (name, kind, link, short description); find \"terms\" returns their rates, fees, limits, terms and conditions, each with its exact source text. Filter by bank, product kind, product IDs, kind of term, currency, term in months or rate type, and sort terms lowest or highest first. Terms marked \"not reviewed yet\" are dated public figures copied from the bank's page: say so when you use one. What the catalog doesn't hold is listed as a gap: then use search_knowledge, and never estimate.",
  input_schema: inputSchema as { type: "object"; [key: string]: unknown },
};

/** Every product row (a few hundred): the scope filter runs in code (lib/catalog/query.ts), so no flag escapes it. */
export const allProducts = internalQuery({
  args: {},
  handler: async (ctx): Promise<ProductRecord[]> => {
    const rows = await ctx.db.query("products").take(2000);
    return rows.map(({ _id, _creationTime, ...p }) => p as ProductRecord);
  },
});

/** The term catalog of one track. */
export const termsOfTrack = internalQuery({
  args: { track },
  handler: async (ctx, { track }): Promise<TermRecord[]> => {
    const rows = await ctx.db.query("productTerms").withIndex("by_track_product", (q) => q.eq("track", track)).take(5000);
    return rows.map(({ _id, _creationTime, ...r }) => r as unknown as TermRecord);
  },
});

export async function queryCatalogTool(ctx: ActionCtx, scope: CatalogScope, raw: unknown, now: number = Date.now()): Promise<ToolOutcome> {
  const parsed = catalogQuerySchema.safeParse(raw);
  if (!parsed.success) return { error: `Invalid query_catalog input: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const q = parsed.data;
  const result = q.find === "products"
    ? queryProducts(await ctx.runQuery(internal.catalogQuery.allProducts, {}), q, scope)
    : queryTerms(await ctx.runQuery(internal.catalogQuery.termsOfTrack, { track: scope.track }), q, scope, now);
  const note = catalogNote(result);
  return { citables: catalogCitables(result), ...(note ? { note } : {}) };
}

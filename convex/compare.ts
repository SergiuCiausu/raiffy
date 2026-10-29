import { z } from "zod";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { ToolOutcome } from "./calculator";
import { compareCitables, compareProductsRequestSchema, groundedScenario } from "../lib/compare/block";
import { fromCatalog } from "../lib/compare/rows";
import type { CompareTable, Focus } from "../lib/compare/schemas";
import { banksInScope, type CatalogScope } from "../lib/catalog/query";
import type { TermRecord } from "../lib/catalog/schemas";

/*
 * The compare_products host tool: the comparison card's fixed rows (lib/compare) from the term catalog, for exactly
 * the products the customer named. The track and the readable banks come from the authenticated turn; the customer's
 * amount and term count only when they appear in the customer's own words. The card is built here, never by the model.
 */

const { $schema: _s, ...inputSchema } = z.toJSONSchema(compareProductsRequestSchema, { io: "input" }) as Record<string, unknown>;

export const COMPARE_PRODUCTS_TOOL = {
  name: "compare_products",
  description: "When the customer compares named products (two to four), show them side by side in the comparison card's fixed rows, from the reviewed catalog. Pass the catalog product IDs of exactly the products they named, in their order, and focus \"costs\" (rates, DAE, amounts, fees) or \"documents\" (only when they ask about documents). Send amountLei and months only if the customer gave them. Returns one citable per product with every row as written; cite them. The chat shows the card itself, so don't repeat every row in the text, and don't make a comparison card for these products.",
  input_schema: inputSchema as { type: "object"; [key: string]: unknown },
};

const BANK_NAMES: Record<string, string> = { raiffeisen: "Raiffeisen", bcr: "BCR", ing: "ING", bt: "Banca Transilvania", brd: "BRD" };

/** A table, or why there is none. The host keeps the table to show; the model gets the citables. */
export async function compareProductsTool(
  ctx: ActionCtx, scope: CatalogScope, raw: unknown, customerTexts: readonly string[], now: number = Date.now(),
): Promise<{ outcome: ToolOutcome; table: CompareTable | null }> {
  const parsed = compareProductsRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { outcome: { error: `Invalid compare_products input: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }, table: null };
  }
  const req = parsed.data;
  if (new Set(req.productIds).size !== req.productIds.length) return { outcome: { error: "Each product once." }, table: null };
  const banks = banksInScope(scope);
  const all: TermRecord[] = await ctx.runQuery(internal.catalogQuery.termsOfTrack, { track: scope.track });
  const records = all.filter((r) => banks.includes(r.bank) && req.productIds.includes(r.productId));
  const missing = req.productIds.filter((id) => !records.some((r) => r.productId === id));
  if (missing.length) {
    return { outcome: { error: `Not in the catalog for this conversation: ${missing.join(", ")}. Use product IDs from query_catalog, or search the documents instead.` }, table: null };
  }
  const products = req.productIds.map((id) => {
    const r = records.find((x) => x.productId === id)!;
    return { productId: id, name: r.product, provider: BANK_NAMES[r.bank] ?? r.bank, isRaiffeisen: r.bank === "raiffeisen" };
  });
  const scenario = groundedScenario(req, customerTexts);
  const firstPaymentDate = new Date(now + 31 * 86_400_000).toISOString().slice(0, 10);
  const table = fromCatalog({ products, records, now, focus: req.focus as Focus, scenario, ...(scenario ? { firstPaymentDate } : {}) });
  if (!table.groups.length) {
    return { outcome: { citables: [], note: req.focus === "documents"
      ? "The catalog has no document lists for these products: search the documents and show them as a comparison card."
      : "The catalog has no usable terms for these products: search the documents instead." }, table: null };
  }
  const notes = [
    ...(req.amountLei !== undefined && !scenario ? ["The amount or term wasn't in the customer's own words, so no payment was calculated for it."] : []),
    ...(table.paymentUnavailable ? ["No monthly payment: each rate is a published range, and the rate depends on the bank's assessment. Say so."] : []),
    "Rows marked not confirmed or not in the sources have no figure: never estimate them.",
  ];
  return { outcome: { citables: compareCitables(table), note: notes.join(" ") }, table };
}

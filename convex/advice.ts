import { z } from "zod";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { requireAgentScope } from "./agentAuth";
import type { ToolOutcome } from "./calculator";
import { AGENT_POLICY } from "../lib/agent/config";
import type { AnswerCard } from "../lib/agent/blocks";
import { needByMonthsOf, type InputsBrief } from "../lib/agent/inputs";
import { routesCard, routesCitable } from "../lib/advice/copy";
import { debtShareCeiling, recommendRoute } from "../lib/advice/recommend";
import { buildRoutes } from "../lib/advice/routes";
import type { RecommendationResult, RoutesResult } from "../lib/advice/schemas";
import { compareRoutesRequestSchema, resolveAdviceInputs, type AdviceStated } from "../lib/advice/tool";
import type { TermRecord } from "../lib/catalog/schemas";
import { findUngroundedNumbers } from "../lib/rag/numbers";
import type { Track } from "../lib/rag/schemas";

/*
 * The live compare_routes handler for solution answers (lib/advice). The track comes from the authenticated session;
 * terms come from reviewed catalog records and the product's plan template; the customer's figures come from the
 * conversation's inputs. The routes, the recommendation and the card are worked out in code: the model frames them.
 */

const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return rest as { type: "object"; [key: string]: unknown };
};

export const COMPARE_ROUTES_TOOL = {
  name: "compare_routes",
  description: "For a customer's borrowing goal, work out the routes side by side (the loan over their term and another term, the overdraft, saving first then borrowing less, saving only) and Raiffy's recommendation by the bank's fixed rule, from catalog term IDs returned by get_product_terms. Send the customer's own figures (amount and income in lei, term in months, other loan payments, how much they can save a month) only if they gave them, and their timing: now, can_wait (with waitMonths when they said how long) or unknown. Returns one citable comparison and shows the routes card itself; if it needs an input, it says which one to ask for. Never pick a different route or calculate yourself.",
  input_schema: jsonSchema(compareRoutesRequestSchema),
};

/** The customer's figures from the conversation's inputs (lei and months), as given or defaulted. */
export function adviceStatedOf(brief: InputsBrief | null): AdviceStated {
  const rows = [...(brief?.required ?? []), ...(brief?.optional ?? [])];
  const pick = (key: string) => {
    const r = rows.find((x) => x.key === key);
    return r && typeof r.value === "number" ? { value: r.value, source: r.source === "default" ? "default" as const : "customer" as const } : undefined;
  };
  const out: AdviceStated = {};
  for (const key of ["amount", "months", "income", "obligations", "monthlySaving"] as const) {
    const v = pick(key);
    if (v) out[key] = v;
  }
  // A choice ("Within a year") or stated months; "Not sure yet" and defaults stay unknown.
  const needBy = rows.find((x) => x.key === "needBy");
  const months = needBy && needBy.source !== "default" ? needByMonthsOf(needBy.value) : null;
  if (months !== null) out.needBy = { value: months, source: "customer" };
  return out;
}

export type CompareRoutesOutcome = { outcome: ToolOutcome; card?: AnswerCard; result?: { routes: RoutesResult; recommendation: RecommendationResult } };

export async function compareRoutesTool(ctx: ActionCtx, trackName: Track, raw: unknown, stated: AdviceStated, customerFigures: readonly string[],
  index: number, now = Date.now()): Promise<CompareRoutesOutcome> {
  await requireAgentScope(ctx, trackName);
  const parsed = compareRoutesRequestSchema.safeParse(raw);
  if (!parsed.success) return { outcome: { error: `Invalid input: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` } };
  const request = parsed.data;
  const inputs = resolveAdviceInputs(request, stated, (n) => findUngroundedNumbers(String(n), customerFigures).length === 0);
  if (inputs.amount === null || inputs.months === null) {
    return { outcome: { citables: [], note: "No routes worked out: ask for the customer's own amount and term first. Don't estimate or recommend." } };
  }

  const productIds = [request.loan.productId, request.overdraft?.productId].filter((x): x is string => !!x);
  const records: TermRecord[] = await ctx.runQuery(internal.catalog.termsFor, { track: trackName, productIds });
  const template = await ctx.runQuery(internal.calculator.templateFor, { track: trackName, productId: request.loan.productId });
  const policy = AGENT_POLICY;
  const today = new Date(now).toISOString().slice(0, 10);
  const routes = buildRoutes({
    records, now, today, loan: request.loan, ...(template ? { loanTemplate: template } : {}),
    ...(request.overdraft ? { overdraft: request.overdraft } : {}),
    alternativeTerms: policy.advice.alternativeTermOffsetsMonths.map((o) => inputs.months! + o).filter((n) => n >= 1 && n <= 600),
    customer: { amount: inputs.amount, months: inputs.months, income: inputs.income, obligations: inputs.obligations, monthlySaving: inputs.monthlySaving },
    params: { ...policy.calculator, saveFirstMonths: policy.advice.saveFirstMonths, maxSaveOnlyMonths: policy.advice.maxSaveOnlyMonths },
  });
  const recommendation = recommendRoute({
    routes: routes.routes, needByMonths: inputs.needByMonths,
    policy: { nearTieMarginBani: policy.calculator.nearTieMarginBani, debtShareCeiling: debtShareCeiling(records, template?.debtShareCeilingTermId, request.loan.productId, now) },
  });

  // The source chip links the loan's rate record
  const rateTermId = template?.rateTermId ?? request.loan.rateTermId;
  const rate = records.find((r) => r.termId === rateTermId) ?? records[0];
  const termIds = [...new Set(routes.routes.flatMap((r) => r.termIds))];
  const result = { routes, recommendation };
  if (!rate || !termIds.length) {
    return { result, outcome: { citables: [], note: "No routes worked out: the catalog has no reviewed terms for these products. Say so; don't estimate or recommend." } };
  }
  const citable = routesCitable(routes, recommendation, { url: rate.provenance.url, collectedAt: rate.provenance.collectedAt, termIds }, index);
  const card = routesCard(routes, recommendation, rate.provenance.url, "Ways to reach your goal");
  const note = recommendation.status === "ok"
    ? "The routes card with Raiffy's recommendation is shown to the customer. Frame it in two or three sentences; don't pick another route or repeat every figure."
    : recommendation.status === "needs_input"
      ? `No recommendation yet. Ask for ${recommendation.needs.join(" and ")} in one short question.`
      : "No route can be recommended. Say so plainly and offer a specialist.";
  return { result, ...(card ? { card } : {}), outcome: { citables: [citable], note } };
}

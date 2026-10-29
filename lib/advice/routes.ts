import { z } from "zod";
import { termRecordSchema } from "../catalog/schemas";
import { addMonths } from "../calc/schedule";
import { runScenario, scenarioRequestSchema, type ScenarioResult } from "../calc/scenario";
import { planTemplateSchema } from "../plan/build";
import { routesResultSchema, type Route, type RoutesResult } from "./schemas";

/*
 * The routes to a customer's borrowing goal, side by side: the loan over the customer's term, other terms of the same
 * loan, the overdraft, saving part first and then borrowing less, and saving the whole amount. Pure. Every borrowing
 * figure comes from runScenario over reviewed catalog records; a route the catalog can't back comes back unavailable
 * with its gaps, never estimated. Saving routes count no interest on savings (no reviewed savings rate yet), which
 * understates how fast savings grow, and they never use the savings the customer already has.
 */

const productRefsSchema = scenarioRequestSchema.shape.loan.unwrap();

export const buildRoutesInputSchema = z.object({
  records: z.array(termRecordSchema),
  /** The caller's clock: decides freshness. */
  now: z.number().int(),
  today: z.iso.date(),
  loan: productRefsSchema,
  loanTemplate: planTemplateSchema.optional(),
  overdraft: productRefsSchema.optional(),
  /** Other terms of the same loan to show next to the customer's. */
  alternativeTerms: z.array(z.number().int().min(1).max(600)).max(2).default([]),
  /** What the customer stated, in bani and months. */
  customer: z.object({
    amount: z.number().int().positive(),
    months: z.number().int().min(1).max(600),
    income: z.number().int().positive().nullable(),
    obligations: z.number().int().min(0).nullable(),
    monthlySaving: z.number().int().min(0).nullable(),
  }),
  /** Policy parameters, from lib/agent/config.ts. */
  params: z.object({
    nearTieMarginBani: z.number().int().min(0),
    variableStressBps: z.number().int().min(0),
    /** How long the save-first route saves before borrowing. */
    saveFirstMonths: z.number().int().min(1).max(36),
    /** A save-only route longer than this isn't shown. */
    maxSaveOnlyMonths: z.number().int().min(1).max(120),
  }),
});
export type BuildRoutesInput = z.input<typeof buildRoutesInputSchema>;

type Input = z.infer<typeof buildRoutesInputSchema>;

function affordability(input: Input, repayment: number | null, saving: number | null) {
  const { income, obligations } = input.customer;
  if (income === null || obligations === null) return { debtShareBps: null, leftEachMonth: null };
  return {
    debtShareBps: Math.round(((repayment ?? 0) + obligations) * 10_000 / income),
    leftEachMonth: income - obligations - Math.max(repayment ?? 0, saving ?? 0),
  };
}

function priced(input: Input, calculation: "loan_cost" | "overdraft_cost", amount: number, months: number): ScenarioResult {
  return runScenario({
    request: calculation === "loan_cost" ? { calculation, loan: input.loan } : { calculation, overdraft: input.overdraft! },
    records: input.records, now: input.now, today: input.today, amount, months, basis: "customer",
    ...(calculation === "loan_cost" && input.loanTemplate ? { loanTemplate: input.loanTemplate } : {}),
    params: { nearTieMarginBani: input.params.nearTieMarginBani, variableStressBps: input.params.variableStressBps },
  });
}

/** A borrowing route from a scenario result, starting after `startsIn` months of saving `saving` a month. */
function borrowingRoute(input: Input, base: Omit<Route, "status" | "gaps" | "monthly" | "stressedMonthly" | "cost" | "rateBps" | "rateType" | "debtShareBps" | "leftEachMonth" | "termIds" | "product">, result: ScenarioResult): Route {
  const side = base.kind === "overdraft" ? result.overdraft : result.loan;
  const fits = base.kind !== "overdraft" || (result.overdraft?.fitsAmount !== false && result.overdraft?.fitsTerm !== false);
  if (result.status !== "ok" || !side || !fits) {
    return { ...base, status: "unavailable", gaps: result.gaps, monthly: null, stressedMonthly: null, cost: null, rateBps: null, rateType: null,
      debtShareBps: null, leftEachMonth: null, termIds: result.sources.map((s) => s.termId) };
  }
  const forAffordability = side.stressTest?.monthly ?? side.monthly;
  return {
    ...base, product: side.product, status: "ok", gaps: [],
    monthly: side.monthly, stressedMonthly: side.stressTest?.monthly ?? null,
    cost: side.totalInterest + side.totalFees, rateBps: side.rateBps, rateType: side.rateType,
    ...affordability(input, forAffordability, base.saving?.monthly ?? null),
    termIds: result.sources.map((s) => s.termId),
  };
}

export function buildRoutes(raw: BuildRoutesInput): RoutesResult {
  const input = buildRoutesInputSchema.parse(raw);
  const { amount, months, monthlySaving } = input.customer;
  const today = input.today;
  const routes: Route[] = [];
  const assumptions = new Set<string>();
  const loanKey = (n: number) => `loan_${n}`;
  const now = { saving: null, startsInMonths: 0, startDate: today };

  // The customer's loan, then other terms of it
  routes.push(borrowingRoute(input, { key: loanKey(months), kind: "loan", productId: input.loan.productId, chosen: true, borrowed: amount, repaymentMonths: months, ...now },
    priced(input, "loan_cost", amount, months)));
  for (const n of [...new Set(input.alternativeTerms)].filter((n) => n !== months)) {
    routes.push(borrowingRoute(input, { key: loanKey(n), kind: "loan", productId: input.loan.productId, chosen: false, variantOf: loanKey(months), borrowed: amount, repaymentMonths: n, ...now },
      priced(input, "loan_cost", amount, n)));
  }

  if (input.overdraft) {
    routes.push(borrowingRoute(input, { key: "overdraft", kind: "overdraft", productId: input.overdraft.productId, chosen: false, borrowed: amount, repaymentMonths: months, ...now },
      priced(input, "overdraft_cost", amount, months)));
  }

  if (monthlySaving) {
    assumptions.add("savings_interest_not_counted").add("savings_buffer_kept");
    const saveMonths = input.params.saveFirstMonths;
    const saved = saveMonths * monthlySaving;
    const rest = amount - saved;
    if (rest > 0) {
      // Saving first, then the same loan for what's left, over the same term
      assumptions.add("same_term_after_saving");
      routes.push(borrowingRoute(input, {
        key: "save_then_borrow", kind: "save_then_borrow", productId: input.loan.productId, chosen: false, borrowed: rest, repaymentMonths: months,
        saving: { monthly: monthlySaving, months: saveMonths, saved }, startsInMonths: saveMonths, startDate: addMonths(today, saveMonths),
      }, priced(input, "loan_cost", rest, months)));
    }
    const saveOnly = Math.ceil(amount / monthlySaving);
    if (saveOnly <= input.params.maxSaveOnlyMonths) {
      routes.push({
        key: "save_only", kind: "save_only", status: "ok", gaps: [], chosen: false, borrowed: 0,
        saving: { monthly: monthlySaving, months: saveOnly, saved: saveOnly * monthlySaving },
        startsInMonths: saveOnly, startDate: addMonths(today, saveOnly), repaymentMonths: null,
        monthly: null, stressedMonthly: null, cost: 0, rateBps: null, rateType: null,
        ...affordability(input, null, monthlySaving), termIds: [],
      });
    }
  }

  return routesResultSchema.parse({ routes, assumptions: [...assumptions] });
}

import { z } from "zod";
import { repaymentSchedule, type Schedule } from "../calc/schedule";
import { termRecordSchema, type TermRecord } from "../catalog/schemas";
import { gapReason } from "../catalog/terms";
import { trackSchema } from "../rag/schemas";
import {
  buildPlanResultSchema, commissionKeySchema, planRouteSchema, planVerificationSchema,
  type BuildPlanResult, type Commission, type PlanGap, type PlanNote, type PlanRoute, type PlanSource, type PlanSummary,
} from "./schemas";

/*
 * Builds a PlanSummary from the customer's inputs and catalog records. Pure: the records, the clock and the IDs
 * come in as arguments. Every figure comes from a fresh, quoted and reviewed catalog value read through the
 * product's template; anything else returns gaps instead of a plan. In particular a starting rate ("de la 5,05%"),
 * a ceiling or a range is never used as the customer's rate, and a charge the catalog doesn't confirm is never zero.
 */

/**
 * Which catalog record fills which part of the plan, per product. It is configuration owned with the catalog
 * (it names term IDs, never values). A commission without a termId isn't confirmed by the catalog.
 */
export const planTemplateSchema = z.object({
  rateTermId: z.string().min(1),
  commissions: z.array(z.object({
    key: commissionKeySchema,
    termId: z.string().min(1).optional(),
    /** upfront and monthly are counted in the total and must be confirmed; if_used never blocks the plan. */
    use: z.enum(["upfront", "monthly", "if_used"]),
  })).min(1).refine((list) => new Set(list.map((c) => c.key)).size === list.length, "Each commission line appears once"),
  amountLimitTermId: z.string().min(1).optional(),
  termLimitTermId: z.string().min(1).optional(),
  /** The bank's stated maximum debt share for this product (an eligibility term in bps). Used by lib/advice, not the plan. */
  debtShareCeilingTermId: z.string().min(1).optional(),
});
export type PlanTemplate = z.infer<typeof planTemplateSchema>;

export const buildPlanInputSchema = z.object({
  id: z.string().regex(/^PS-\d{3,8}$/),
  version: z.number().int().positive(),
  conversationId: z.string().min(1),
  track: trackSchema,
  /** The caller's clock: stamps the plan and decides freshness. */
  now: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  goal: z.string().trim().min(1).max(200),
  productId: z.string().min(1),
  /** Bani. */
  amount: z.number().int().positive(),
  termMonths: z.number().int().min(1).max(600),
  firstPaymentDate: z.iso.date(),
  template: planTemplateSchema,
  /** The product's records from get_product_terms. They are checked again here. */
  records: z.array(termRecordSchema),
  /** Other terms of the same product to show side by side. Terms outside the product's limits are left out. */
  alternativeTerms: z.array(z.number().int().min(1).max(600)).max(3).default([]),
  /** Routes worked out by their own tools (an overdraft, saving first). */
  otherRoutes: z.array(planRouteSchema.omit({ chosen: true })).max(3).default([]),
  /** The route Raiffy recommends, from the deterministic recommendation. It may differ from the chosen one. */
  recommendedRoute: z.string().min(1),
  /** What the customer stated, in bani. Without it the plan says affordability isn't checked. */
  affordability: z.object({ income: z.number().int().positive(), obligations: z.number().int().min(0) }).optional(),
  /** The check of the version this one replaces. A confirmation carries over as "changed after the check". */
  previousVerification: planVerificationSchema.optional(),
});
export type BuildPlanInput = z.input<typeof buildPlanInputSchema>;

const routeKey = (months: number) => `term_${months}`;

/** A record that exists, belongs to this product and track, and is fresh, quoted and reviewed. */
function usable(input: z.infer<typeof buildPlanInputSchema>, termId: string, role: PlanGap["role"], commission?: Commission["key"]): TermRecord | PlanGap {
  const gap = (reason: PlanGap["reason"]): PlanGap => ({ role, termId, reason, ...(commission ? { commission } : {}) });
  const record = input.records.find((r) => r.termId === termId);
  if (!record) return gap("not_found");
  if (record.productId !== input.productId || record.track !== input.track) return gap("wrong_product");
  const reason = gapReason(record, input.now);
  return reason ? gap(reason) : record;
}
const isGap = (x: TermRecord | PlanGap): x is PlanGap => "reason" in x;

/** An exact number, or why the value can't stand for what the customer gets. Shared with lib/calc/scenario.ts. */
export function exactAmount(record: TermRecord): number | PlanGap["reason"] {
  switch (record.value.type) {
    case "exact": return record.value.amount;
    case "from": return "floor_value";
    case "up_to": return "ceiling_value";
    case "range": return "range_value";
    case "text": return "not_a_number";
    case "unavailable": return "stated_missing";
  }
}

export function bounds(record: TermRecord): { min?: number; max?: number } | null {
  switch (record.value.type) {
    case "range": return { min: record.value.min, max: record.value.max };
    case "from": return { min: record.value.min };
    case "up_to": return { max: record.value.max };
    case "exact": return { max: record.value.amount };
    default: return null;
  }
}

function source(record: TermRecord): PlanSource {
  return {
    termId: record.termId, url: record.provenance.url, collectedAt: record.provenance.collectedAt,
    reviewBy: record.provenance.reviewBy, reviewedAt: record.verification.reviewedAt ?? "",
  };
}

export function buildPlan(raw: BuildPlanInput): BuildPlanResult {
  const input = buildPlanInputSchema.parse(raw);
  const gaps: PlanGap[] = [];
  const used: TermRecord[] = [];

  // The rate: exact, fixed, in basis points
  let rateBps = 0;
  const rate = usable(input, input.template.rateTermId, "rate");
  if (isGap(rate)) gaps.push(rate);
  else {
    const gap = (reason: PlanGap["reason"]) => gaps.push({ role: "rate", termId: rate.termId, reason });
    const amount = exactAmount(rate);
    if (rate.kind !== "interest_rate") gap("wrong_kind");
    else if (rate.unit !== "bps") gap("wrong_unit");
    else if (typeof amount !== "number") gap(amount);
    else if (rate.comparability.rateType !== "fixed") gap("not_fixed_rate");
    else { rateBps = amount; used.push(rate); }
  }

  // Commission lines, in the template's order
  const commissions: Commission[] = [];
  const missing: PlanNote[] = [];
  let upfrontFee = 0;
  let monthlyFee = 0;
  for (const line of input.template.commissions) {
    const notConfirmed = (): void => {
      commissions.push({ key: line.key, amount: null, basis: "missing", conditions: [] });
      missing.push({ key: "conditional_fee_unconfirmed", params: { commission: line.key } });
    };
    if (!line.termId) {
      if (line.use === "if_used") notConfirmed();
      else gaps.push({ role: "commission", commission: line.key, reason: "missing_charge" });
      continue;
    }
    const record = usable(input, line.termId, "commission", line.key);
    if (isGap(record)) {
      if (line.use === "if_used") notConfirmed();
      else gaps.push(record);
      continue;
    }
    if (record.kind !== "fee") { gaps.push({ role: "commission", commission: line.key, termId: record.termId, reason: "wrong_kind" }); continue; }
    if (line.use === "if_used") {
      commissions.push({ key: line.key, termId: record.termId, amount: null, basis: "if_used", conditions: record.conditions });
      used.push(record);
      continue;
    }
    const gap = (reason: PlanGap["reason"]) => gaps.push({ role: "commission", commission: line.key, termId: record.termId, reason });
    const amount = exactAmount(record);
    const frequency = line.use === "upfront" ? "once" : "monthly";
    if (record.unit !== "minor_ron") gap("wrong_unit");
    else if (typeof amount !== "number") gap(amount);
    else if (record.frequency !== frequency) gap("frequency_mismatch");
    else {
      if (line.use === "upfront") upfrontFee += amount;
      else monthlyFee += amount;
      commissions.push({ key: line.key, termId: record.termId, amount, basis: amount ? "charged" : "none", frequency, conditions: record.conditions });
      used.push(record);
    }
  }

  // The product's limits, when the template names them
  const limits = { amount: null as { min?: number; max?: number } | null, term: null as { min?: number; max?: number } | null };
  for (const [which, termId, kind, unit, role] of [
    ["amount", input.template.amountLimitTermId, "limit", "minor_ron", "amount_limit"],
    ["term", input.template.termLimitTermId, "term", "months", "term_limit"],
  ] as const) {
    if (!termId) continue;
    const record = usable(input, termId, role);
    if (isGap(record)) { gaps.push(record); continue; }
    const b = bounds(record);
    if (record.kind !== kind) gaps.push({ role, termId, reason: "wrong_kind" });
    else if (record.unit !== unit) gaps.push({ role, termId, reason: "wrong_unit" });
    else if (!b) gaps.push({ role, termId, reason: "not_a_number" });
    else { limits[which] = b; used.push(record); }
  }
  const within = (value: number, b: { min?: number; max?: number } | null) => !b || ((b.min ?? -Infinity) <= value && value <= (b.max ?? Infinity));
  if (limits.amount) {
    if (limits.amount.min !== undefined && input.amount < limits.amount.min) gaps.push({ role: "amount_limit", termId: input.template.amountLimitTermId, reason: "amount_below_limit" });
    if (limits.amount.max !== undefined && input.amount > limits.amount.max) gaps.push({ role: "amount_limit", termId: input.template.amountLimitTermId, reason: "amount_above_limit" });
  }
  if (limits.term) {
    if (limits.term.min !== undefined && input.termMonths < limits.term.min) gaps.push({ role: "term_limit", termId: input.template.termLimitTermId, reason: "term_below_limit" });
    if (limits.term.max !== undefined && input.termMonths > limits.term.max) gaps.push({ role: "term_limit", termId: input.template.termLimitTermId, reason: "term_above_limit" });
  }

  // Routes side by side: the chosen term, other terms of the same product, then routes from other tools
  const scheduleFor = (months: number): Schedule => repaymentSchedule({
    principal: input.amount, months, annualRateBps: rateBps, upfrontFee, monthlyFee, firstPaymentDate: input.firstPaymentDate,
  });
  const terms = [input.termMonths, ...input.alternativeTerms.filter((n) => n !== input.termMonths && within(n, limits.term))];
  const keys = new Set([...terms.map(routeKey), ...input.otherRoutes.map((r) => r.key)]);
  if (!keys.has(input.recommendedRoute)) gaps.push({ role: "recommendation", reason: "unknown_route" });

  if (gaps.length) return buildPlanResultSchema.parse({ status: "unavailable", gaps });

  const schedules = new Map(terms.map((n) => [n, scheduleFor(n)] as const));
  const s = schedules.get(input.termMonths)!;
  const routes: PlanRoute[] = [
    ...terms.map((n) => {
      const x = schedules.get(n)!;
      return { key: routeKey(n), productId: input.productId, termMonths: n, monthly: x.monthly, cost: x.totals.interest + x.totals.fees, fits: true, chosen: n === input.termMonths, recommended: routeKey(n) === input.recommendedRoute };
    }),
    ...input.otherRoutes.map((r) => ({ ...r, chosen: false, recommended: r.key === input.recommendedRoute })),
  ];

  const assumptions: PlanNote[] = [
    { key: "first_payment_date", params: { date: input.firstPaymentDate } },
    { key: "fixed_rate_whole_term", params: { rateBps } },
    { key: "repaid_on_schedule" },
    { key: "monthly_interest_rounding" },
    { key: "optional_insurance_excluded" },
  ];
  if (!input.affordability) missing.unshift({ key: "affordability_not_checked" });
  missing.push({ key: "credit_assessment" });

  const prev = input.previousVerification;
  const verification = prev && (prev.level === "confirmed" || prev.level === "edited")
    ? { ...prev, changed: true, forVersion: prev.forVersion ?? input.version - 1 }
    : { level: "none" as const };

  const sources = [...new Map(used.map((r) => [r.termId, source(r)])).values()];
  const product = used.find((r) => r.termId === input.template.rateTermId)!.product;

  const plan: PlanSummary = {
    id: input.id, version: input.version, conversationId: input.conversationId, track: input.track, label: "indicative", createdAt: input.createdAt,
    goal: { summary: input.goal, productId: input.productId, product, amount: input.amount, termMonths: input.termMonths },
    terms: { annualRateBps: rateBps, rateType: "fixed", rateTermId: input.template.rateTermId, upfrontFee, monthlyFee, firstPaymentDate: input.firstPaymentDate },
    figures: { monthly: s.monthly, instalment: s.instalment, interest: s.totals.interest, fees: s.totals.fees, total: s.totals.payable, dae: s.dae, commissions },
    routes,
    affordability: input.affordability ? {
      income: input.affordability.income, obligations: input.affordability.obligations,
      debtShareBps: Math.round(((s.monthly + input.affordability.obligations) * 10_000) / input.affordability.income),
      leftEachMonth: input.affordability.income - input.affordability.obligations - s.monthly,
    } : null,
    repaymentSchedule: s.rows,
    assumptions, missing, sources, verification,
    handoff: { target: input.track === "business" ? "business_lead" : "smart_mobile", productId: input.productId, amount: input.amount, termMonths: input.termMonths },
  };
  return buildPlanResultSchema.parse({ status: "ok", plan });
}

/**
 * The checks a plan must pass before anyone sees it (and the console's automatic checks): the schedule adds up to
 * the figures to the ban, every template line is listed, and the label is there. Returns the failed check keys.
 */
export function planInvariants(plan: PlanSummary, template?: PlanTemplate): string[] {
  const rows = plan.repaymentSchedule;
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const failed: string[] = [];
  if (sum((r) => r.principal) !== plan.goal.amount) failed.push("principal_sum");
  if (rows.at(-1)?.balance !== 0) failed.push("final_balance");
  if (sum((r) => r.payment) + plan.terms.upfrontFee !== plan.figures.total) failed.push("total_sum");
  if (sum((r) => r.interest) !== plan.figures.interest) failed.push("interest_sum");
  if (rows.length !== plan.goal.termMonths) failed.push("row_count");
  if (plan.label !== "indicative") failed.push("label");
  if (template && template.commissions.some((line) => !plan.figures.commissions.some((c) => c.key === line.key))) failed.push("commission_lines");
  if (plan.figures.commissions.some((c) => c.basis === "missing" && c.amount !== null)) failed.push("missing_is_not_zero");
  if (!plan.routes.some((r) => r.chosen) || plan.routes.filter((r) => r.recommended).length !== 1) failed.push("routes");
  return failed;
}

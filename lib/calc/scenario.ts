import { z } from "zod";
import { termRecordSchema, type TermRecord } from "../catalog/schemas";
import { gapReason } from "../catalog/terms";
import { bounds, exactAmount as exactValue, planTemplateSchema, type PlanTemplate } from "../plan/build";
import { PLAN_GAP_REASONS } from "../plan/schemas";
import { quoteOverdraft, recommendLoanOrOverdraft } from "./loan";
import { addMonths, repaymentSchedule } from "./schedule";

/*
 * calculate_scenario (contract: lib/agent/prompt.ts): loan cost, overdraft cost and loan vs overdraft, worked out
 * from catalog records the model names by term ID. Pure: the records, the clock, the customer's amount and term and
 * the policy parameters come in as arguments. The model never supplies a rate, a fee or a result: it only points at
 * records, and every record is checked again here (fresh, quoted, reviewed, same product). A starting rate
 * ("de la"), a ceiling, a range or a fee the catalog doesn't confirm returns a gap, never an estimate.
 * Money is integer bani, rates are integer basis points.
 */

export const productRefsSchema = z.object({
  productId: z.string().min(1),
  rateTermId: z.string().min(1),
  /** Every fee that applies: once (upfront), monthly or yearly. A fee left out is not counted. */
  feeTermIds: z.array(z.string().min(1)).max(6).default([]),
  amountLimitTermId: z.string().min(1).optional(),
  termLimitTermId: z.string().min(1).optional(),
}).strict();
export type ProductRefs = z.infer<typeof productRefsSchema>;

export const CALCULATIONS = ["loan_cost", "overdraft_cost", "loan_vs_overdraft"] as const;

/** What the model sends. Amount and term are the customer's; the caller checks them before running. */
export const scenarioRequestSchema = z.object({
  calculation: z.enum(CALCULATIONS),
  loan: productRefsSchema.optional(),
  overdraft: productRefsSchema.optional(),
  /** The amount in lei, as the customer gave it. */
  amountLei: z.number().positive().max(100_000_000).optional(),
  months: z.number().int().min(1).max(600).optional(),
}).strict().superRefine((r, ctx) => {
  if (r.calculation !== "overdraft_cost" && !r.loan) ctx.addIssue({ code: "custom", path: ["loan"], message: "loan references are required" });
  if (r.calculation !== "loan_cost" && !r.overdraft) ctx.addIssue({ code: "custom", path: ["overdraft"], message: "overdraft references are required" });
});
export type ScenarioRequest = z.infer<typeof scenarioRequestSchema>;

/** The plan's gap reasons (one vocabulary for "this value can't be used"), plus the scenario's own. */
export const SCENARIO_ONLY_GAP_REASONS = ["missing_amount", "missing_term", "unsupported_rate_type", "unsupported_frequency"] as const;
export const scenarioGapSchema = z.object({
  side: z.enum(["loan", "overdraft", "inputs"]),
  role: z.enum(["rate", "fee", "amount_limit", "term_limit", "amount", "term"]),
  termId: z.string().optional(),
  reason: z.union([z.enum(PLAN_GAP_REASONS), z.enum(SCENARIO_ONLY_GAP_REASONS)]),
});
export type ScenarioGap = z.infer<typeof scenarioGapSchema>;

const feeLineSchema = z.object({ termId: z.string(), label: z.string(), amount: z.number().int(), frequency: z.enum(["once", "monthly", "yearly"]), conditions: z.array(z.string()) });
const stressTestSchema = z.object({ rateBps: z.number().int(), monthly: z.number().int(), totalPayable: z.number().int() });

export const loanResultSchema = z.object({
  productId: z.string(), product: z.string(), rateTermId: z.string(), rateBps: z.number().int(), rateType: z.enum(["fixed", "variable"]),
  fees: z.array(feeLineSchema),
  /** What the customer pays each month, monthly fee included. */
  monthly: z.number().int(),
  totalInterest: z.number().int(), totalFees: z.number().int(), totalPayable: z.number().int(),
  /** DAE of the costs counted here, in basis points. Insurance or other costs not in the catalog are not counted. */
  daeBps: z.number().int(),
  /** A stress test, never the rate: the same loan at the variable rate plus the stress (calculations.md: +2 pp next to every variable-rate estimate). */
  stressTest: stressTestSchema.optional(),
});
export const overdraftResultSchema = z.object({
  productId: z.string(), product: z.string(), rateTermId: z.string(), rateBps: z.number().int(), rateType: z.enum(["fixed", "variable"]),
  fees: z.array(feeLineSchema),
  /** Repaid in equal parts: the average monthly outlay. */
  monthly: z.number().int(),
  totalInterest: z.number().int(), totalFees: z.number().int(), totalPayable: z.number().int(),
  /** Within the amount and term limits the catalog gives; null when no limit was named. */
  fitsAmount: z.boolean().nullable(), fitsTerm: z.boolean().nullable(),
  stressTest: stressTestSchema.optional(),
});

export const scenarioSourceSchema = z.object({ termId: z.string(), label: z.string(), url: z.string(), collectedAt: z.string(), reviewedAt: z.string() });

export const scenarioResultSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  calculation: z.enum(CALCULATIONS),
  /** customer: the customer's own amount and term; example: the pattern's example, to be labelled as one. */
  basis: z.enum(["customer", "example"]),
  amount: z.number().int(),
  months: z.number().int(),
  loan: loanResultSchema.optional(),
  overdraft: overdraftResultSchema.optional(),
  /** The cheaper option that fits, with a near tie going to the fixed-rate loan (lib/calc/loan.ts). */
  recommendation: z.object({ pick: z.enum(["loan", "overdraft"]), reason: z.enum(["onlyFit", "nearTie", "cheaper"]), gap: z.number().int() }).optional(),
  assumptions: z.array(z.enum(["first_payment_next_month", "insurance_not_included", "fees_listed_only", "overdraft_equal_parts", "overdraft_renewal_not_checked", "example_amount", "fees_from_template"])),
  gaps: z.array(scenarioGapSchema),
  sources: z.array(scenarioSourceSchema),
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;

export const runScenarioInputSchema = z.object({
  request: scenarioRequestSchema,
  records: z.array(termRecordSchema),
  /** The caller's clock: decides freshness. */
  now: z.number().int(),
  /** Today, for the first payment date. */
  today: z.iso.date(),
  /** Resolved by the caller from the customer's inputs (resolveScenarioInputs). Bani and months. */
  amount: z.number().int().positive().nullable(),
  months: z.number().int().min(1).max(600).nullable(),
  basis: z.enum(["customer", "example"]),
  /**
   * The product's plan template (convex/plans.ts), when one exists. It names the rate, every charged commission and
   * the limits, so the scenario and a plan read the same records; the model's references are then ignored.
   */
  loanTemplate: planTemplateSchema.optional(),
  /** Policy parameters, from lib/agent/config.ts. */
  params: z.object({ nearTieMarginBani: z.number().int().min(0), variableStressBps: z.number().int().min(0) }),
});
export type RunScenarioInput = z.input<typeof runScenarioInputSchema>;

/**
 * The amount and term to calculate with. A value the model sends counts only when it is the customer's own figure;
 * otherwise the conversation's input is used, and a defaulted input makes the result an example.
 */
export function resolveScenarioInputs(
  request: Pick<ScenarioRequest, "amountLei" | "months">,
  stated: { amount?: { value: number; source: "customer" | "default" }; months?: { value: number; source: "customer" | "default" } },
  isCustomerFigure: (n: number) => boolean,
): { amount: number | null; months: number | null; basis: "customer" | "example" } {
  const pick = (asked: number | undefined, input: { value: number; source: "customer" | "default" } | undefined) =>
    asked !== undefined && isCustomerFigure(asked) ? { value: asked, own: true } : input ? { value: input.value, own: input.source === "customer" } : null;
  const amount = pick(request.amountLei, stated.amount);
  const months = pick(request.months, stated.months);
  return {
    amount: amount ? Math.round(amount.value * 100) : null,
    months: months ? Math.round(months.value) : null,
    basis: amount?.own !== false && months?.own !== false ? "customer" : "example",
  };
}

type Side = "loan" | "overdraft";
type Resolved = { rateTermId: string; rateBps: number; rateType: "fixed" | "variable"; fees: z.infer<typeof feeLineSchema>[]; product: string; productId: string;
  limits: { amount?: { min?: number; max?: number }; term?: { min?: number; max?: number } }; used: TermRecord[] };

/** The product's rate, fees and limits, each from a usable record of that product. Gaps are collected, never guessed. */
function resolve(side: Side, refs: ProductRefs, records: readonly TermRecord[], now: number, gaps: ScenarioGap[],
  uses?: ReadonlyMap<string, "upfront" | "monthly">): Resolved | null {
  const start = gaps.length;
  const gap = (role: ScenarioGap["role"], reason: ScenarioGap["reason"], termId?: string) => gaps.push({ side, role, reason, ...(termId ? { termId } : {}) });
  const used: TermRecord[] = [];
  const usable = (termId: string, role: ScenarioGap["role"]): TermRecord | null => {
    const record = records.find((r) => r.termId === termId);
    if (!record) { gap(role, "not_found", termId); return null; }
    if (record.productId !== refs.productId) { gap(role, "wrong_product", termId); return null; }
    const reason = gapReason(record, now);
    if (reason) { gap(role, reason, termId); return null; }
    return record;
  };

  let rateBps = 0;
  let rateType: "fixed" | "variable" = "fixed";
  const rate = usable(refs.rateTermId, "rate");
  if (rate) {
    const value = exactValue(rate);
    const type = rate.comparability.rateType;
    if (rate.kind !== "interest_rate") gap("rate", "wrong_kind", rate.termId);
    else if (rate.unit !== "bps") gap("rate", "wrong_unit", rate.termId);
    else if (typeof value !== "number") gap("rate", value, rate.termId);
    else if (type !== undefined && type !== "fixed" && type !== "variable") gap("rate", "unsupported_rate_type", rate.termId);
    else { rateBps = value; rateType = type ?? "fixed"; used.push(rate); }
  }

  const fees: Resolved["fees"] = [];
  for (const termId of [...new Set(refs.feeTermIds)]) {
    const fee = usable(termId, "fee");
    if (!fee) continue;
    const value = exactValue(fee);
    if (fee.kind !== "fee") gap("fee", "wrong_kind", termId);
    else if (fee.unit !== "minor_ron") gap("fee", "wrong_unit", termId);
    else if (typeof value !== "number") gap("fee", value, termId);
    else if (!fee.frequency || (side === "loan" && fee.frequency === "yearly")) gap("fee", "unsupported_frequency", termId);
    else if (uses?.has(termId) && fee.frequency !== (uses.get(termId) === "upfront" ? "once" : "monthly")) gap("fee", "frequency_mismatch", termId);
    else { fees.push({ termId, label: fee.label, amount: value, frequency: fee.frequency, conditions: fee.conditions }); used.push(fee); }
  }

  const limits: Resolved["limits"] = {};
  for (const [which, termId, kind, unit, role] of [
    ["amount", refs.amountLimitTermId, "limit", "minor_ron", "amount_limit"],
    ["term", refs.termLimitTermId, "term", "months", "term_limit"],
  ] as const) {
    if (!termId) continue;
    const record = usable(termId, role);
    if (!record) continue;
    const b = bounds(record);
    if (record.kind !== kind) gap(role, "wrong_kind", termId);
    else if (record.unit !== unit) gap(role, "wrong_unit", termId);
    else if (!b) gap(role, "not_a_number", termId);
    else { limits[which] = b; used.push(record); }
  }

  if (gaps.length > start || !rate) return null;
  return { rateTermId: rate.termId, rateBps, rateType, fees, product: rate.product, productId: refs.productId, limits, used };
}

const within = (n: number, b?: { min?: number; max?: number }) => !b || ((b.min === undefined || n >= b.min) && (b.max === undefined || n <= b.max));
const sum = (fees: Resolved["fees"], frequency: "once" | "monthly" | "yearly") => fees.filter((f) => f.frequency === frequency).reduce((s, f) => s + f.amount, 0);

function loanFigures(r: Resolved, amount: number, months: number, today: string, rateBps: number) {
  const schedule = repaymentSchedule({
    principal: amount, months, annualRateBps: rateBps, upfrontFee: sum(r.fees, "once"), monthlyFee: sum(r.fees, "monthly"),
    firstPaymentDate: addMonths(today, 1),
  });
  return { monthly: schedule.monthly, totalInterest: schedule.totals.interest, totalFees: schedule.totals.fees, totalPayable: schedule.totals.payable,
    daeBps: Math.round(schedule.dae * 10_000) };
}

/** Equal repayments: interest on the average balance, the yearly fee once per started year, other fees as charged. */
function overdraftFigures(r: Resolved, amount: number, months: number, rateBps: number) {
  const q = quoteOverdraft({ amount, months }, { annualRate: rateBps / 10_000, annualFee: 0, maxAmount: Number.MAX_SAFE_INTEGER, maxMonths: Number.MAX_SAFE_INTEGER });
  const totalInterest = Math.round(q.totalCost);
  const totalFees = sum(r.fees, "yearly") * Math.ceil(months / 12) + sum(r.fees, "once") + sum(r.fees, "monthly") * months;
  const totalPayable = amount + totalInterest + totalFees;
  return { monthly: Math.round(totalPayable / months), totalInterest, totalFees, totalPayable };
}

/**
 * A template's references: the rate, the commissions counted in the total and the limits. A counted commission the
 * template doesn't confirm with a term is a gap, never zero ("if_used" lines aren't counted, as in a plan).
 */
export function refsFromTemplate(productId: string, template: PlanTemplate): { refs: ProductRefs; gaps: ScenarioGap[]; uses: Map<string, "upfront" | "monthly"> } {
  const counted = template.commissions.filter((c) => c.use !== "if_used");
  const uses = new Map(counted.flatMap((c) => (c.termId ? [[c.termId, c.use as "upfront" | "monthly"] as const] : [])));
  return {
    refs: { productId, rateTermId: template.rateTermId, feeTermIds: [...uses.keys()],
      ...(template.amountLimitTermId ? { amountLimitTermId: template.amountLimitTermId } : {}),
      ...(template.termLimitTermId ? { termLimitTermId: template.termLimitTermId } : {}) },
    gaps: counted.filter((c) => !c.termId).map(() => ({ side: "loan" as const, role: "fee" as const, reason: "missing_charge" as const })),
    uses,
  };
}

export function runScenario(raw: RunScenarioInput): ScenarioResult {
  const input = runScenarioInputSchema.parse(raw);
  const { request, params } = input;
  const gaps: ScenarioGap[] = [];
  const fromTemplate = input.loanTemplate && request.loan ? refsFromTemplate(request.loan.productId, input.loanTemplate) : null;
  if (fromTemplate) gaps.push(...fromTemplate.gaps);
  if (input.amount === null) gaps.push({ side: "inputs", role: "amount", reason: "missing_amount" });
  if (input.months === null) gaps.push({ side: "inputs", role: "term", reason: "missing_term" });
  const loanRefs = request.calculation !== "overdraft_cost" ? fromTemplate?.refs ?? request.loan : undefined;
  const odRefs = request.calculation !== "loan_cost" ? request.overdraft : undefined;
  const loanR = loanRefs ? resolve("loan", loanRefs, input.records, input.now, gaps, fromTemplate?.uses) : null;
  const odR = odRefs ? resolve("overdraft", odRefs, input.records, input.now, gaps) : null;
  const amount = input.amount ?? 0;
  const months = input.months ?? 0;

  const assumptions: ScenarioResult["assumptions"] = ["insurance_not_included", fromTemplate ? "fees_from_template" : "fees_listed_only"];
  if (input.basis === "example") assumptions.push("example_amount");
  let loan: ScenarioResult["loan"];
  if (loanR && !(fromTemplate?.gaps.length) && input.amount !== null && input.months !== null) {
    if (!within(amount, loanR.limits.amount)) gaps.push({ side: "loan", role: "amount", reason: amount < (loanR.limits.amount?.min ?? 0) ? "amount_below_limit" : "amount_above_limit", termId: loanRefs!.amountLimitTermId });
    else if (!within(months, loanR.limits.term)) gaps.push({ side: "loan", role: "term", reason: months < (loanR.limits.term?.min ?? 0) ? "term_below_limit" : "term_above_limit", termId: loanRefs!.termLimitTermId });
    else {
      const stressBps = loanR.rateBps + params.variableStressBps;
      const stressTest = loanR.rateType === "variable" ? loanFigures(loanR, amount, months, input.today, stressBps) : null;
      loan = { productId: loanR.productId, product: loanR.product, rateTermId: loanR.rateTermId, rateBps: loanR.rateBps, rateType: loanR.rateType, fees: loanR.fees,
        ...loanFigures(loanR, amount, months, input.today, loanR.rateBps),
        ...(stressTest ? { stressTest: { rateBps: stressBps, monthly: stressTest.monthly, totalPayable: stressTest.totalPayable } } : {}) };
      assumptions.push("first_payment_next_month");
    }
  }
  let overdraft: ScenarioResult["overdraft"];
  if (odR && input.amount !== null && input.months !== null) {
    const stressBps = odR.rateBps + params.variableStressBps;
    const stressTest = odR.rateType === "variable" ? overdraftFigures(odR, amount, months, stressBps) : null;
    overdraft = { productId: odR.productId, product: odR.product, rateTermId: odR.rateTermId, rateBps: odR.rateBps, rateType: odR.rateType, fees: odR.fees,
      ...overdraftFigures(odR, amount, months, odR.rateBps),
      fitsAmount: odR.limits.amount ? within(amount, odR.limits.amount) : null,
      fitsTerm: odR.limits.term ? within(months, odR.limits.term) : null,
      ...(stressTest ? { stressTest: { rateBps: stressBps, monthly: stressTest.monthly, totalPayable: stressTest.totalPayable } } : {}) };
    assumptions.push("overdraft_equal_parts");
    if (!odR.limits.term) assumptions.push("overdraft_renewal_not_checked");
  }

  let recommendation: ScenarioResult["recommendation"];
  if (loan && overdraft) {
    const r = recommendLoanOrOverdraft(
      { monthly: loan.monthly, totalCost: loan.totalPayable - amount },
      { fits: overdraft.fitsAmount !== false && overdraft.fitsTerm !== false, monthly: overdraft.monthly, totalCost: overdraft.totalPayable - amount },
      params.nearTieMarginBani,
    );
    recommendation = { pick: r.pick, reason: r.reason, gap: Math.round(r.gap) };
  }

  const used = [...(loan ? loanR!.used : []), ...(overdraft ? odR!.used : [])];
  const sources = [...new Map(used.map((r) => [r.termId, {
    termId: r.termId, label: r.label, url: r.provenance.url, collectedAt: r.provenance.collectedAt, reviewedAt: r.verification.reviewedAt ?? "",
  }])).values()];
  const ok = request.calculation === "loan_cost" ? !!loan : request.calculation === "overdraft_cost" ? !!overdraft : !!(loan && overdraft);
  return scenarioResultSchema.parse({
    status: ok ? "ok" : "unavailable", calculation: request.calculation, basis: input.basis, amount, months,
    ...(loan ? { loan } : {}), ...(overdraft ? { overdraft } : {}), ...(recommendation ? { recommendation } : {}),
    assumptions: [...new Set(assumptions)], gaps, sources,
  });
}

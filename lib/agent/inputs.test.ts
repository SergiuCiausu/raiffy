import { describe, expect, it } from "vitest";
import { AGENT_POLICY } from "./config";
import { containsFinancialFigure, composeAnswer, routeResponse } from "./composer";
import { decideInquiry, defaultScope } from "./confidence";
import { fallbackSchema, readFallback } from "./fallback";
import { NEED_BY_REPLIES, needByMonthsOf, buildInputsBrief, customerAllowedFigures, customerFigures, extractInputs, gateInputs, inputFields, openChoiceSlots, parseNumber, readFigures, resolveInputs,
  sharesRequiredInputs, validateFormValues } from "./inputs";
import { INQUIRIES } from "./jev";
import { planAgentRoute, type RoutePlan } from "./route";
import { buildRecentContext, EMPTY_STATE, nextState, readState } from "./state";
import cases from "../../evals/agent-inputs.json";

describe("parseNumber", () => {
  it.each([["50.000", 50000], ["50,000", 50000], ["7 500", 7500], ["7.500,50", 7500.5], ["1,500.50", 1500.5], ["7.5", 7.5], ["1,5", 1.5], ["300000", 300000]])(
    "%s → %d", (raw, value) => expect(parseNumber(raw)).toBe(value));
});

describe("readFigures", () => {
  it("separates income from the target payment", () => {
    const f = readFigures("My net salary is 7,500 lei a month. Can I afford a 2,000 lei monthly payment?");
    expect(f.map(x => [x.value, x.cue])).toEqual([[7500, "income"], [2000, "monthly"]]);
  });
  it("reads terms in months or years, EN and RO", () => {
    expect(readFigures("over 5 years").map(x => x.value)).toEqual([60]);
    expect(readFigures("pe 60 de luni").map(x => [x.kind, x.value])).toEqual([["months", 60]]);
    expect(readFigures("in doi ani").map(x => x.value)).toEqual([24]);
  });
  it("never reads 'a month' as a one-month term or a model year as money", () => {
    expect(readFigures("2,000 lei a month").filter(x => x.kind === "months")).toEqual([]);
    expect(readFigures("I want to buy a 2016 BMW X5")).toEqual([]);
  });
  it("scales k and mii", () => {
    expect(readFigures("about 50k").map(x => x.value)).toEqual([50000]);
    expect(readFigures("am nevoie de 30 mii lei").map(x => x.value)).toEqual([30000]);
  });
});

describe("extractInputs", () => {
  it("fills the pending question from a bare reply, in the order asked", () => {
    expect(extractInputs("affordability", "7500 and 0", ["income", "obligations"])).toEqual({ income: 7500, obligations: 0 });
    expect(extractInputs("affordability", "7,500, nothing else to pay", ["income", "obligations"])).toEqual({ income: 7500, obligations: 0 });
  });
  it("leaves an ambiguous choice open instead of guessing", () => {
    expect(extractInputs("purchase_goal", "a car or a flat, not sure").item).toBeUndefined();
  });
  it("implies Raiffeisen when one competitor is named", () => {
    expect(extractInputs("product_comparison", "Is your personal loan better than BT's?")).toMatchObject({ productKind: "personal_loan", options: ["raiffeisen", "bt"] });
  });
});

describe("evals/agent-inputs.json", () => {
  for (const c of cases as { message: string; inquiry: keyof typeof INQUIRIES; pending?: string[]; values?: Record<string, unknown>; ask: string[] }[]) {
    it(c.message, () => {
      const values = extractInputs(c.inquiry, c.message, (c.pending ?? []) as never);
      if (c.values) expect(values).toMatchObject(c.values);
      const gate = gateInputs(resolveInputs(c.inquiry, { message: values }), null, AGENT_POLICY);
      expect(gate.action === "ask" ? gate.keys : []).toEqual(c.ask);
    });
  }
});

describe("resolveInputs and gateInputs", () => {
  it("prefers what the customer just said over earlier turns, and earlier turns over account data", () => {
    const r = resolveInputs("affordability", { message: { amount: 40000 }, conversation: { amount: 30000, income: 7000 }, account: { income: 9000, obligations: 500 } });
    expect(r.known).toMatchObject({ amount: { value: 40000, source: "message" }, income: { value: 7000, source: "conversation" }, obligations: { value: 500, source: "account" } });
    expect(r.missingRequired).toEqual([]);
  });
  it("accepts account data only for inputs that can come from the account", () => {
    expect(resolveInputs("saving_goal", { account: { amount: 1 } }).known.amount).toBeUndefined();
  });

  it("lists the customer's own figures for the answer check, with the short form they wrote, never rates", () => {
    const q = "i want to take a credit of 50k euro";
    const r = resolveInputs("purchase_goal", { message: extractInputs("purchase_goal", q, []) });
    expect(r.known.amount).toMatchObject({ value: 50000, source: "message" });
    expect(customerAllowedFigures(q, r).sort()).toEqual(["50", "50000"]);
    const neg = "BT offered me 7.1% on 40.000 lei over 5 years, can you match it?";
    const n = resolveInputs("negotiation", { message: extractInputs("negotiation", neg, []) });
    expect(customerAllowedFigures(neg, n)).not.toContain("7.1");
    expect(customerAllowedFigures(neg, n)).toContain("40000");
  });
  it("treats alternatives as one requirement and asks for the first", () => {
    expect(resolveInputs("affordability", { message: { monthlyPayment: 2000, income: 1, obligations: 0 } }).missingRequired).toEqual([]);
    expect(resolveInputs("affordability", {}).missingRequired).toEqual(["amount", "income", "obligations"]);
  });
  it("makes amount and term conditional on the product being compared", () => {
    expect(resolveInputs("product_comparison", { message: { productKind: "current_account", options: ["raiffeisen", "bt"] } }).missingRequired).toEqual([]);
    expect(resolveInputs("product_comparison", { message: { productKind: "personal_loan", options: ["raiffeisen", "bt"] } }).missingRequired).toEqual(["amount", "months"]);
  });
  it("asks at most three required inputs, never optional ones, for at most two rounds", () => {
    const r = resolveInputs("negotiation", {});
    const first = gateInputs(r, null, AGENT_POLICY);
    expect(first).toEqual({ action: "ask", keys: ["productKind", "competitor", "amount"], round: 1 });
    expect(gateInputs(r, { inquiry: "negotiation", keys: ["productKind"], round: 1 }, AGENT_POLICY)).toMatchObject({ action: "ask", round: 2 });
    expect(gateInputs(r, { inquiry: "negotiation", keys: ["productKind"], round: 2 }, AGENT_POLICY)).toMatchObject({ action: "proceed", examplesRequested: true });
    expect(gateInputs(r, null, AGENT_POLICY, { skip: true })).toMatchObject({ action: "proceed", examplesRequested: true });
  });
  it("uses defaults without asking", () => {
    const r = resolveInputs("expense_insights", {});
    expect(r.defaultsUsed).toEqual(["period"]);
    expect(gateInputs(r, null, AGENT_POLICY).action).toBe("proceed");
  });
});

describe("form values, brief and output check", () => {
  it("accepts only the inputs asked, in range", () => {
    expect(validateFormValues(["amount", "months"], { amount: "50000", months: 60.4, income: 9000 })).toEqual({ amount: 50000, months: 60 });
    expect(validateFormValues(["amount"], { amount: -5 })).toEqual({});
    expect(validateFormValues(["item"], { item: "yacht" })).toEqual({});
  });
  it("sends every required and optional input to the model, known or null", () => {
    const r = resolveInputs("saving_goal", { message: { amount: 20000, months: 24 } });
    const brief = buildInputsBrief(r, false);
    expect(brief.required.map(x => [x.key, x.value, x.source])).toEqual([["amount", 20000, "message"], ["months", 24, "message"]]);
    expect(brief.optional.filter(x => x.key !== "currency").every(x => x.value === null)).toBe(true);
    expect(brief.defaultsUsed).toEqual(["currency"]);
  });
  it("lets the customer's own figures through the catalog check, but not new ones", () => {
    const figures = customerFigures(resolveInputs("saving_goal", { message: { amount: 20000, months: 24 } }));
    expect(containsFinancialFigure("To reach 20,000 lei in 24 months, compare these routes.", figures)).toBe(false);
    expect(containsFinancialFigure("To reach 20,000 lei you need 833 lei a month.", figures)).toBe(true);
  });
  it("describes form fields without inventing options", () => {
    expect(inputFields("purchase_goal", ["item", "amount"])).toMatchObject([{ key: "item", kind: "choice" }, { key: "amount", kind: "amount", unit: "RON" }]);
    expect(openChoiceSlots(resolveInputs("life_event", {}))).toMatchObject([{ key: "event" }]);
  });
});

describe("pattern confidence", () => {
  const dist = (p: Record<string, number>) => {
    const rest = (1 - Object.values(p).reduce((a, b) => a + b, 0)) / (14 - Object.keys(p).length);
    const probabilities = Object.fromEntries(Object.keys(INQUIRIES).map(k => [k, p[k] ?? rest]));
    const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
    return { choice: choice as keyof typeof INQUIRIES, confidence: (probabilities[choice]! - 1 / 14) / (1 - 1 / 14), probabilities };
  };
  it("routes on confidence or a clear margin", () => {
    expect(decideInquiry(dist({ negotiation: 0.9 }), AGENT_POLICY)).toMatchObject({ kind: "route", basis: "confidence" });
    expect(decideInquiry(dist({ negotiation: 0.6, product_comparison: 0.2 }), AGENT_POLICY)).toMatchObject({ kind: "route", inquiry: "negotiation", basis: "margin" });
  });
  it("offers the two close labels instead of the generic question", () => {
    expect(decideInquiry(dist({ negotiation: 0.45, product_comparison: 0.42 }), AGENT_POLICY)).toEqual({ kind: "candidates", candidates: ["negotiation", "product_comparison"] });
  });
  it("skips the question when both labels need the same inputs", () => {
    expect(sharesRequiredInputs("saving_goal", "cash_shortfall")).toBe(true);
    expect(decideInquiry(dist({ saving_goal: 0.45, cash_shortfall: 0.42 }), AGENT_POLICY, sharesRequiredInputs)).toMatchObject({ kind: "route", inquiry: "saving_goal", basis: "shared_inputs" });
  });
  it("is unclear when no pair dominates", () => {
    expect(decideInquiry(dist({ negotiation: 0.3, product_comparison: 0.25, other: 0.2 }), AGENT_POLICY).kind).toBe("unclear");
  });
  it("derives scope from the pattern", () => {
    expect([defaultScope("negotiation"), defaultScope("fees_statements"), defaultScope("purchase_goal"), defaultScope("purchase_goal", true)]).toEqual(["compare", "detail", "solution", "compare"]);
  });
});

describe("fallback model contract", () => {
  const req = { candidates: ["negotiation", "product_comparison"] as const, slots: [{ key: "item", options: { car: "A car", home: "A home" } }] };
  it("accepts only offered labels and drops unsure", () => {
    expect(readFallback({ inquiry: "negotiation", inputs: { item: "unsure" } }, { ...req, candidates: [...req.candidates] })).toEqual({ inquiry: "negotiation", inputs: {} });
    expect(readFallback({ inquiry: "approve_credit", inputs: { item: "car" } }, { ...req, candidates: [...req.candidates] })).toEqual({ inquiry: null, inputs: {} });
    expect(fallbackSchema({ candidates: [], slots: [] }).safeParse({ inquiry: "unsure", inputs: {} }).success).toBe(true);
  });
});

describe("conversation state and composed replies", () => {
  it("summarises the pending question for the classifier", () => {
    const s = nextState(EMPTY_STATE, { inquiry: "affordability", scope: "solution", resolved: resolveInputs("affordability", { message: { amount: 40000 } }),
      asked: { inquiry: "affordability", keys: ["income", "obligations"], round: 1 } });
    expect(buildRecentContext(s, [])).toContain("Raiffy just asked the customer for: income, obligations.");
    expect(readState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(readState({ version: 9 })).toEqual(EMPTY_STATE);
  });
  it("renders an inputs form with a skip action, and choice chips for close labels", () => {
    const base = planAgentRoute({}, { track: "personal", availableTools: [], availableCollections: [] });
    const asking: RoutePlan = { ...base, handler: "collect_inputs", inquiry: "saving_goal" };
    const inputs = { fields: inputFields("saving_goal", ["amount", "months"]), round: 1 };
    const envelope = composeAnswer("m1", asking, routeResponse(asking, { inputs }), { inputs });
    expect(envelope.blocks[0]).toMatchObject({ type: "inputs_request", round: 1 });
    expect(envelope.actions).toEqual([expect.objectContaining({ kind: "skip_inputs" })]);
    const choosing: RoutePlan = { ...base, handler: "clarify", reason: "ambiguous_inquiry", candidates: ["negotiation", "product_comparison"] };
    expect(composeAnswer("m2", choosing, routeResponse(choosing)).actions.map(a => a.kind)).toEqual(["choose", "choose"]);
  });
});

describe("needBy: when the customer needs the money", () => {
  it("keeps a repayment term as the term, not as a deadline", () => {
    const v = extractInputs("purchase_goal", "I want a 15,000 lei laptop and to pay it back in 2 years");
    expect(v).toMatchObject({ item: "goods", amount: 15000, months: 24 });
    expect(v.needBy).toBeUndefined();
  });

  it("maps choices to the deadline they name, and 'not sure' to unknown", () => {
    expect(["now", "within_6_months", "within_a_year", "two_years_plus", "unsure"].map(needByMonthsOf)).toEqual([0, 6, 12, 24, null]);
    expect([7, 0, 500, undefined, "soon"].map(v => needByMonthsOf(v as never))).toEqual([7, 0, null, null, null]);
  });

  it("reads every offered timing reply back as a choice", () => {
    expect(NEED_BY_REPLIES.map(r => needByMonthsOf(extractInputs("purchase_goal", r).needBy))).toEqual([0, 6, 12, 24]);
  });
});

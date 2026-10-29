import { describe, expect, it } from "vitest";
import cases from "../../evals/expense-insights.json";
import { DEMO_PERSONAS, personaById } from "../../convex/seed/demoPersonas";
import { INSIGHT_RULES } from "./rules";
import { personaSchema } from "./schemas";
import { accountInputs, summarizeExpenses } from "./summary";
import { history, monthTransactions } from "./synthetic";

const TODAY = "2026-10-29";
const OFF = { account: false, transactions: false, savings: false, offers: false, loans: false, cards: false };
const ALL = { ...OFF, account: true, transactions: true, savings: true };
const run = (id: string, switches = ALL, period: "last_complete_month" | "last_three_complete_months" = "last_complete_month") =>
  summarizeExpenses({ persona: personaById(id), switches, period, today: TODAY, rules: INSIGHT_RULES });

describe("synthetic statements", () => {
  it("are valid, reproducible and add up per month", () => {
    for (const p of DEMO_PERSONAS) expect(personaSchema.safeParse(p).success).toBe(true);
    const p = personaById("long-time-client")!;
    expect(monthTransactions(p, TODAY, 1)).toEqual(monthTransactions(p, TODAY, 1));
    const groceries = monthTransactions(p, TODAY, 1).filter(t => t.category === "groceries").reduce((s, t) => s - t.amount, 0);
    expect(groceries).toBe(160_000);
    expect(history(p, TODAY, 3).every(t => t.date >= "2026-07-01" && t.date < "2026-10-01")).toBe(true);
  });
});

describe("summarizeExpenses", () => {
  it("summarizes a month and finds the card-based insights for a long-time client", () => {
    const s = run("long-time-client");
    expect(s).toMatchObject({ status: "ok", synthetic: true, period: { from: "2026-09-01", to: "2026-09-30", months: 1 }, notUsed: [] });
    expect(s.account).toMatchObject({ currentBalance: 1_850_000 });
    expect(s.flows).toMatchObject({ income: 950_000, debtPayments: 0 });
    expect(s.spending!.byCategory[0]).toMatchObject({ category: "housing", amount: 250_000 });
    expect(s.spending!.atmOther).toEqual({ count: 3, fees: 1_500 });
    expect(s.insights.map(i => i.kind).sort()).toEqual(["atmFees", "fxCardFees", "idleCash", "subscriptions"]);
    const fx = s.insights.find(i => i.kind === "fxCardFees")!.figures;
    expect(fx.spentInEuros).toBe(124_000);
    expect(Math.abs(fx.fees! - 3_100)).toBeLessThanOrEqual(6); // 2.5% per payment, each rounded to the ban
    expect(s.spending!.subscriptions.find(x => x.label === "Streaming service")).toMatchObject({ amount: 5_900, previousAmount: 4_900 });
  });

  it("flags overdraft cost from two months of interest and never suggests idle cash while the overdraft is used", () => {
    const s = run("new-client");
    const od = s.insights.find(i => i.kind === "overdraftCost");
    expect(od?.figures).toMatchObject({ interestLastMonth: 7_667, used: 800_000, limit: 1_000_000 });
    expect(s.insights.some(i => i.kind === "idleCash")).toBe(false);
  });

  it("reads only what is switched on and says what wasn't used", () => {
    const s = run("long-time-client", { ...OFF, account: true });
    expect(s.spending).toBeUndefined();
    expect(s.flows).toBeUndefined();
    expect(s.savings).toBeUndefined();
    expect(s.notUsed).toEqual(["transactions", "savings"]);
    expect(s.insights.every(i => i.needs.every(n => n === "account"))).toBe(true);
    // Loans, cards and offers are get_holdings' switches: on their own they give no summary.
    expect(run("long-time-client", { ...OFF, loans: true, cards: true, offers: true })).toMatchObject({ status: "unavailable", reason: "all_switches_off" });
    expect(summarizeExpenses({ persona: null, switches: ALL, period: "last_complete_month", today: TODAY, rules: INSIGHT_RULES }))
      .toMatchObject({ status: "unavailable", reason: "no_persona" });
  });

  it("averages three months and compares with the three before", () => {
    const s = run("cheaper-competitor", ALL, "last_three_complete_months");
    expect(s.period).toMatchObject({ from: "2026-07-01", to: "2026-09-30", months: 3 });
    const groceries = s.spending!.byCategory.find(c => c.category === "groceries")!;
    expect(groceries).toEqual({ category: "groceries", amount: 180_000, previous: 180_000 });
  });

  it("gives income and existing debt payments to the inputs gate only from the transactions switch", () => {
    expect(accountInputs(run("competitor-secci"))).toEqual({ income: 8_000, obligations: 1_200 });
    expect(accountInputs(run("competitor-secci", { ...ALL, transactions: false }))).toEqual({});
  });
});

describe("what reaches the model", () => {
  it("is aggregates labelled as sample data, with no transaction or account identifiers", async () => {
    const { expenseCitable, expenseGapsNote } = await import("../rag/tools");
    const c = expenseCitable(run("long-time-client"))!;
    expect(c.text).toMatch(/^SAMPLE DATA/);
    expect(c.url).toBe("raiffy:account/long-time-client/2026-09-01_2026-09-30");
    expect(c.text).toContain("Spending on groceries: 1,600.00 lei a month");
    expect(c.text).not.toMatch(/RO\d{2}[A-Z]{4}|\b\d{4} ?\d{4} ?\d{4} ?\d{4}\b|long-time-client:2026/);
    expect(expenseCitable(run("long-time-client", OFF))).toBeNull();
    expect(expenseGapsNote(run("long-time-client", { ...OFF, account: true }))).toContain("transactions, savings");
  });
});

describe("evals/expense-insights.json", () => {
  for (const c of cases) it(`${c.id}: ${c.title}`, () => {
    const s = summarizeExpenses({ persona: personaById(c.persona), switches: c.switches, period: c.period as "last_complete_month", today: TODAY, rules: INSIGHT_RULES });
    expect(s.status).toBe(c.expect.status);
    if ("reason" in c.expect) expect(s.reason).toBe(c.expect.reason);
    expect(s.insights.map(i => i.kind).sort()).toEqual([...c.expect.insights].sort());
    expect((["account", "flows", "savings", "spending"] as const).filter(k => s[k] !== undefined)).toEqual(c.expect.sections);
  });
});

import { type InsightRules, insightRulesSchema } from "./rules";
import {
  type AccessSwitches, accessSwitchesSchema, type Category, type ExpensePeriod, type ExpenseSummary, expenseSummarySchema, type Insight,
  type Persona, personaSchema, type Transaction,
} from "./schemas";
import { history, monthOf, monthTransactions } from "./synthetic";

/*
 * get_expense_summary, pure: monthly aggregates and the insight rules over the switches the customer has on.
 * Only aggregates leave here (no transaction list, no account numbers); a switched-off source is never read and is
 * listed in `notUsed`. The figures are averages per month over complete months, in bani.
 */

const out = (t: Transaction) => (t.amount < 0 ? -t.amount : 0);
const sum = (list: readonly Transaction[], f: (t: Transaction) => number) => list.reduce((s, t) => s + f(t), 0);
const perMonth = (total: number, months: number) => Math.round(total / months);
const lastDay = (month: string) => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const isCard = (t: Transaction) => t.kind === "card_payment" || t.kind === "atm_withdrawal";

export function summarizeExpenses(input: {
  persona: Persona | null;
  switches: AccessSwitches;
  period: ExpensePeriod;
  today: string;
  rules: InsightRules;
}): ExpenseSummary {
  const switches = accessSwitchesSchema.parse(input.switches);
  const rules = insightRulesSchema.parse(input.rules);
  const months = input.period === "last_complete_month" ? 1 : 3;
  const period = { kind: input.period, from: `${monthOf(input.today, months)}-01`, to: lastDay(monthOf(input.today, 1)), months };
  // The summary reads three of the six switches; loans, cards and offers are get_holdings'.
  const notUsed = (["account", "transactions", "savings"] as const).filter((k) => !switches[k]);
  const empty = (reason: "no_persona" | "all_switches_off"): ExpenseSummary =>
    expenseSummarySchema.parse({ status: "unavailable", synthetic: true, persona: input.persona?.id ?? "", period, insights: [], notUsed, reason });
  if (!input.persona) return empty("no_persona");
  if (!switches.account && !switches.transactions && !switches.savings) return empty("all_switches_off");
  const p = personaSchema.parse(input.persona);

  const now = history(p, input.today, months);
  const before = Array.from({ length: months }, (_, i) => monthTransactions(p, input.today, 2 * months - i)).flat();
  const last = monthTransactions(p, input.today, 1);
  const prev = monthTransactions(p, input.today, 2);

  const flows = switches.transactions ? {
    income: perMonth(sum(now, (t) => (t.amount > 0 ? t.amount : 0)), months),
    outgoings: perMonth(sum(now, out), months),
    debtPayments: perMonth(sum(now.filter((t) => t.kind === "loan_payment"), out), months),
    feesAndInterest: perMonth(sum(now.filter((t) => t.kind === "fee" || t.kind === "interest"), out), months),
  } : undefined;

  const account = switches.account ? {
    currentBalance: p.balances.current,
    ...(p.overdraft ? { overdraft: { limit: p.overdraft.limit, used: p.overdraft.used,
      interestLastMonth: sum(last.filter((t) => t.kind === "interest"), out) } } : {}),
  } : undefined;

  const savings = switches.savings ? { savings: p.balances.savings, deposits: p.balances.deposits } : undefined;

  let cards: ExpenseSummary["spending"];
  if (switches.transactions) {
    const spend = (list: readonly Transaction[]) => {
      const m = new Map<Category, number>();
      for (const t of list.filter((x) => isCard(x) || (x.kind === "standing_order" && x.category !== "savings"))) m.set(t.category, (m.get(t.category) ?? 0) + out(t));
      return m;
    };
    const cur = spend(now);
    const old = spend(before);
    const byCategory = [...cur.entries()].map(([category, amount]) => ({ category, amount: perMonth(amount, months), previous: perMonth(old.get(category) ?? 0, months) }))
      .sort((a, b) => b.amount - a.amount);
    const subs = p.recurring.filter((r) => r.kind === "card_payment" && r.category === "subscriptions" && (r.startedMonthsAgo === undefined || r.startedMonthsAgo >= 1));
    const atmOther = last.filter((t) => t.kind === "atm_withdrawal" && t.ownAtm === false);
    cards = {
      byCategory,
      total: byCategory.reduce((s, c) => s + c.amount, 0),
      subscriptions: subs.map((r) => ({ label: r.label, amount: r.amount,
        ...(r.startedMonthsAgo !== undefined ? { startedMonthsAgo: r.startedMonthsAgo } : {}),
        ...(r.priceChange && r.priceChange.monthsAgo >= 1 && r.priceChange.monthsAgo <= months ? { previousAmount: r.priceChange.from } : {}) })),
      atmOther: { count: atmOther.length, fees: sum(last.filter((t) => t.kind === "fee" && t.label === "ATM withdrawal fee"), out) },
      fxFees: sum(last, (t) => t.fxFee ?? 0),
    };
  }

  // The insight rules, each only from the switches it needs
  const insights: Insight[] = [];
  if (account?.overdraft) {
    const interest = (list: readonly Transaction[]) => sum(list.filter((t) => t.kind === "interest"), out);
    if (interest(last) >= rules.overdraftInterestMin && interest(prev) >= rules.overdraftInterestMin) {
      insights.push({ kind: "overdraftCost", needs: ["account"], figures: { interestLastMonth: interest(last), used: account.overdraft.used, limit: account.overdraft.limit } });
    }
  }
  if (cards && cards.atmOther.count >= rules.atmOtherMin) insights.push({ kind: "atmFees", needs: ["transactions"], figures: { count: cards.atmOther.count, fees: cards.atmOther.fees } });
  if (cards && cards.fxFees >= rules.fxFeesMin) {
    insights.push({ kind: "fxCardFees", needs: ["transactions"], figures: { fees: cards.fxFees, spentInEuros: sum(last.filter((t) => t.fxFee !== undefined), out) } });
  }
  if (account && cards && !(account.overdraft?.used)) {
    const idle = account.currentBalance - cards.total;
    if (idle >= rules.idleCashMin) insights.push({ kind: "idleCash", needs: ["account", "transactions"], figures: { idle, usualMonthlySpending: cards.total } });
  }
  if (cards) {
    const changed = cards.subscriptions.filter((s) => s.previousAmount !== undefined || s.startedMonthsAgo === 1);
    if (changed.length) insights.push({ kind: "subscriptions", needs: ["transactions"], figures: { count: cards.subscriptions.length,
      monthly: cards.subscriptions.reduce((s, x) => s + x.amount, 0), changed: changed.length } });
  }

  return expenseSummarySchema.parse({
    status: "ok", synthetic: true, persona: p.id, period,
    ...(account ? { account } : {}), ...(flows ? { flows } : {}), ...(savings ? { savings } : {}), ...(cards ? { spending: cards } : {}),
    insights, notUsed,
  });
}

/** Income and existing debt payments for the inputs gate (source "account"), only when the transactions switch is on. */
export function accountInputs(summary: ExpenseSummary): { income?: number; obligations?: number } {
  if (summary.status !== "ok" || !summary.flows) return {};
  return { income: summary.flows.income / 100, obligations: summary.flows.debtPayments / 100 };
}

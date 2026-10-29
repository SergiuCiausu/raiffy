import type { BetaSearchResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { TermRecord } from "../catalog/schemas";
import type { ProductTermsResult } from "../catalog/terms";
import type { ScenarioResult } from "../calc/scenario";
import type { ExpenseSummary } from "../expenses/schemas";
import type { Citable } from "./answer";

/*
 * Catalog terms and calculator results as citable search results. The model cites them like document passages, so
 * the existing citation and number checks apply unchanged: a figure in the answer must appear in a result it cites,
 * and these results are the only place a computed figure can come from. Text is in English for the model; the
 * figures underneath stay integer bani and basis points.
 */

const money = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const lei = (bani: number) => `${money.format(bani / 100)} lei`;
export const pct = (bps: number) => `${money.format(bps / 100)}%`;

function unitValue(n: number, unit: TermRecord["unit"]): string {
  switch (unit) {
    case "bps": return pct(n);
    case "minor_ron": return lei(n);
    case "minor_eur": return `${money.format(n / 100)} euro`;
    case "months": return `${n} months`;
    case "years": return `${n} years`;
    case "days": return `${n} days`;
    case "none": return String(n);
  }
}

/** A catalog value in words, saying plainly when it is a starting value or a ceiling. */
export function termValueText(record: TermRecord): string {
  const v = record.value;
  switch (v.type) {
    case "exact": return unitValue(v.amount, record.unit);
    case "range": return `${unitValue(v.min, record.unit)} to ${unitValue(v.max, record.unit)}`;
    case "from": return `from ${unitValue(v.min, record.unit)} (a starting value, not the customer's)`;
    case "up_to": return `up to ${unitValue(v.max, record.unit)} (a ceiling, not what the customer gets)`;
    case "text": return v.text;
    case "unavailable": return `not stated (${v.reason})`;
  }
}

const SECTION: Partial<Record<TermRecord["kind"], Citable["sectionType"]>> = { interest_rate: "interest_rates", dae: "interest_rates", fee: "fees", eligibility: "eligibility", document: "required_documents" };

/** One citable per usable term: what it is, its value, its conditions and the exact source quote. */
export function termCitables(result: ProductTermsResult): Citable[] {
  return result.products.flatMap((p) => p.terms.map((t): Citable => ({
    chunkId: `term:${t.termId}`,
    label: `${p.product}: ${t.label}`,
    url: t.provenance.url,
    text: [
      `Catalog term ${t.termId} (${t.kind}${t.frequency ? `, charged ${t.frequency}` : ""}${t.comparability.rateType ? `, ${t.comparability.rateType} rate` : ""}), reviewed ${t.verification.reviewedAt?.slice(0, 10) ?? ""}.`,
      `${t.label}: ${termValueText(t)}.`,
      ...(t.conditions.length ? [`Conditions: ${t.conditions.join("; ")}.`] : []),
      ...(t.quote ? [`Source text: ${t.quote}`] : []),
    ].join("\n"),
    collectedAt: t.provenance.collectedAt,
    sectionType: SECTION[t.kind] ?? "table",
    score: 1,
  })));
}

/** What the catalog couldn't give, for the model to say plainly. Not citable. */
export function termGapsNote(result: ProductTermsResult): string | null {
  if (!result.unavailable.length) return null;
  return `Not usable from the catalog (don't estimate these): ${result.unavailable.map((g) => `${g.productId}${g.label ? ` ${g.label}` : g.kind ? ` ${g.kind}` : ""}: ${g.reason}`).join("; ")}.`;
}

const ASSUMPTION_TEXT: Record<ScenarioResult["assumptions"][number], string> = {
  first_payment_next_month: "First payment one month from today.",
  insurance_not_included: "Insurance and costs not in the catalog are not included.",
  fees_listed_only: "Only the fees named for this calculation are counted.",
  fees_from_template: "Every fee the product's template counts is included.",
  overdraft_equal_parts: "The overdraft is repaid in equal monthly parts.",
  overdraft_renewal_not_checked: "The overdraft's renewal period was not checked.",
  example_amount: "The amount or term is an example, not the customer's own: say so.",
};

/** The calculator's figures as one citable result, labelled as Raiffy's calculation from the cited catalog terms. */
export function scenarioCitable(result: ScenarioResult, index: number): Citable | null {
  if (result.status !== "ok") return null;
  // The source chip links the first product's rate record.
  const first = result.sources.find((s) => s.termId === (result.loan ?? result.overdraft)?.rateTermId) ?? result.sources[0];
  if (!first) return null;
  const lines = [
    `Raiffy calculation from reviewed catalog terms (${result.sources.map((s) => s.termId).join(", ")}) for ${lei(result.amount)} over ${result.months} months, ${result.basis === "customer" ? "the customer's own amount and term" : "an example amount and term"}.`,
  ];
  for (const [name, x] of [["Loan", result.loan], ["Overdraft", result.overdraft]] as const) {
    if (!x) continue;
    lines.push(
      `${name}, ${x.product}: ${pct(x.rateBps)} ${x.rateType} interest.`,
      `${name} monthly payment: ${lei(x.monthly)}${name === "Overdraft" ? " on average" : ""}.`,
      `${name} total interest: ${lei(x.totalInterest)}.`,
      `${name} total fees: ${lei(x.totalFees)}${x.fees.length ? ` (${x.fees.map((f) => `${f.label} ${lei(f.amount)} ${f.frequency}`).join("; ")})` : ""}.`,
      `${name} total payable: ${lei(x.totalPayable)}.`,
    );
    if ("daeBps" in x) lines.push(`${name} DAE of these costs: ${pct(x.daeBps)}.`);
    if ("fitsTerm" in x && x.fitsTerm !== null) lines.push(`${name} fits its term limit: ${x.fitsTerm ? "yes" : "no"}.`);
    if ("fitsAmount" in x && x.fitsAmount !== null) lines.push(`${name} fits its amount limit: ${x.fitsAmount ? "yes" : "no"}.`);
    if (x.stressTest) lines.push(`${name} stress test, not the rate: if the variable rate rose to ${pct(x.stressTest.rateBps)}, the monthly payment would be ${lei(x.stressTest.monthly)} and the total payable ${lei(x.stressTest.totalPayable)}.`);
  }
  if (result.recommendation) {
    const why = { cheaper: "it costs less in total", nearTie: "the totals are close, so the fixed schedule wins", onlyFit: "it is the only option that fits" }[result.recommendation.reason];
    lines.push(`Raiffy's recommendation by the rule: the ${result.recommendation.pick === "loan" ? "loan" : "overdraft"}, because ${why} (difference in total cost: ${lei(result.recommendation.gap)}).`);
  }
  lines.push(...result.assumptions.map((a) => ASSUMPTION_TEXT[a]), "Indicative, not an offer: the bank's own calculation decides.");
  return {
    chunkId: `calc:${index}`,
    label: "Raiffy calculation",
    url: first.url,
    text: lines.join("\n"),
    collectedAt: first.collectedAt,
    sectionType: "representative_example",
    score: 1,
  };
}

/** Why a calculation didn't run, for the model to say plainly. Not citable. */
export function scenarioGapsNote(result: ScenarioResult): string {
  return `Not calculated: ${result.gaps.map((g) => `${g.side} ${g.role}${g.termId ? ` ${g.termId}` : ""}: ${g.reason}`).join("; ") || "missing inputs"}. Don't estimate the figures; say what's missing, or ask for the amount and term.`;
}

/** A citable as a search_result block, as document passages are shown (lib/rag/prompt.ts toSearchResult). */
export function citableToSearchResult(c: Citable): BetaSearchResultBlockParam {
  return {
    type: "search_result",
    source: c.url,
    title: c.label,
    content: [`Collected on ${c.collectedAt.slice(0, 10)}.`, ...c.text.split("\n").filter(Boolean)].map((text) => ({ type: "text", text })),
    citations: { enabled: true },
  };
}

/* Account data (get_expense_summary): sample data in the POC, said so in the text the model cites. */

const CATEGORY_TEXT: Record<string, string> = {
  groceries: "groceries", housing: "housing", utilities: "utilities", transport: "transport", dining: "eating out", shopping: "shopping",
  health: "health", entertainment: "entertainment", subscriptions: "subscriptions", travel: "travel", cash: "cash withdrawals", fees: "fees",
  debt: "loan payments", savings: "savings", salary: "salary", other_income: "other income",
};
export const categoryText = (c: string) => CATEGORY_TEXT[c] ?? c;

/** The address of a summary as a source: not a web page, so the chat shows it as a chip without a link. */
export const accountSourceUrl = (summary: ExpenseSummary) => `raiffy:account/${summary.persona}/${summary.period.from}_${summary.period.to}`;

const INSIGHT_TEXT: Record<ExpenseSummary["insights"][number]["kind"], (f: Record<string, number>) => string> = {
  overdraftCost: (f) => `The overdraft cost ${lei(f.interestLastMonth ?? 0)} in interest last month, with ${lei(f.used ?? 0)} of the ${lei(f.limit ?? 0)} limit in use.`,
  atmFees: (f) => `${f.count} withdrawals at other banks' ATMs last month cost ${lei(f.fees ?? 0)} in fees.`,
  fxCardFees: (f) => `Currency conversion on card payments cost ${lei(f.fees ?? 0)} last month, on ${lei(f.spentInEuros ?? 0)} spent in euros.`,
  idleCash: (f) => `About ${lei(f.idle ?? 0)} in the current account is above the usual monthly card spending of ${lei(f.usualMonthlySpending ?? 0)}.`,
  subscriptions: (f) => `${f.count} card subscriptions cost ${lei(f.monthly ?? 0)} a month; ${f.changed} started or changed price recently.`,
};

export function expenseCitable(summary: ExpenseSummary): Citable | null {
  if (summary.status !== "ok") return null;
  const months = summary.period.months === 1 ? "last month" : `the last ${summary.period.months} months, as monthly averages`;
  const lines = [`SAMPLE DATA: a synthetic account ("${summary.persona}") in this preview, not the customer's real account. Period: ${summary.period.from} to ${summary.period.to}, ${months}.`];
  const f = summary.flows;
  if (f) lines.push(
    `Income: ${lei(f.income)} a month. Money going out: ${lei(f.outgoings)} a month.`,
    `Existing loan and card payments: ${lei(f.debtPayments)} a month. Fees and interest: ${lei(f.feesAndInterest)} a month.`,
  );
  const a = summary.account;
  if (a) lines.push(
    `Current account balance: ${lei(a.currentBalance)}.`,
    ...(a.overdraft ? [`Overdraft: ${lei(a.overdraft.used)} used of a ${lei(a.overdraft.limit)} limit; interest last month ${lei(a.overdraft.interestLastMonth)}.`] : []),
  );
  if (summary.savings) lines.push(`Savings account: ${lei(summary.savings.savings)}. Term deposits: ${lei(summary.savings.deposits)}.`);
  const c = summary.spending;
  if (c) lines.push(
    `Card and regular spending: ${lei(c.total)} a month.`,
    ...c.byCategory.map((x) => `Spending on ${categoryText(x.category)}: ${lei(x.amount)} a month (period before: ${lei(x.previous)}).`),
    ...c.subscriptions.map((s) => `Subscription, ${s.label}: ${lei(s.amount)} a month${s.previousAmount !== undefined ? `, up from ${lei(s.previousAmount)}` : ""}${s.startedMonthsAgo === 1 ? ", started last month" : ""}.`),
  );
  lines.push(...summary.insights.map((i) => `Insight: ${INSIGHT_TEXT[i.kind](i.figures)}`));
  return {
    chunkId: `account:${summary.period.from}_${summary.period.to}`,
    label: "Your account (sample data)",
    url: accountSourceUrl(summary),
    text: lines.join("\n"),
    collectedAt: `${summary.period.to}T23:59:59+00:00`,
    sectionType: "table",
    score: 1,
  };
}

/** Why there is no summary, or which switches were off. Not citable. */
export function expenseGapsNote(summary: ExpenseSummary): string {
  if (summary.reason === "no_persona") return "No account is connected: the customer hasn't chosen a sample account in \"What Raiffy can see\". Say so, don't estimate their spending, and answer from what they tell you.";
  if (summary.reason === "all_switches_off") return "Every source in \"What Raiffy can see\" is switched off, so no account data was read. Say so and answer from what the customer tells you.";
  return `Switched off, so not read: ${summary.notUsed.join(", ")}. Don't guess these; the customer can switch them on in "What Raiffy can see".`;
}

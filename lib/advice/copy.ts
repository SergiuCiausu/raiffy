import { checkCards, type AnswerCard, type CardEvidence } from "../agent/blocks";
import type { Citable } from "../rag/answer";
import { lei, pct } from "../rag/tools";
import type { RecommendationResult, Route, RoutesResult } from "./schemas";

/*
 * The English words for a route comparison: one citable text the model reads and cites, and the routes card the host
 * shows. Both come from the same numbers, so every figure on the card is in the citable and the card check passes;
 * the model never writes the recommendation. Like lib/rag/tools.ts, this is where tool results become English.
 */

const monthYear = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

export function routeName(r: Route): string {
  switch (r.kind) {
    case "loan": return `${r.product ?? "Loan"}, ${months(r.repaymentMonths!)}`;
    case "overdraft": return r.product ?? "Overdraft";
    case "save_then_borrow": return `Save ${months(r.saving!.months)}, then borrow ${lei(r.borrowed)}`;
    case "save_only": return `Save ${lei(r.saving!.monthly)} a month`;
  }
}

const startsText = (r: Route) => r.startsInMonths === 0 ? "the money is there now" : `the money is there in ${monthYear(r.startDate)}`;

const REASON_TEXT: Record<RecommendationResult["reasons"][number]["key"], (p: Record<string, string | number>, r: Route) => string> = {
  starts_now: () => "The money is there now, so the plan can start straight away.",
  debt_share_room: (p) => `With your other payments, about ${pct(Number(p.debtShareBps))} of your income goes to loans each month, under the bank's ${pct(Number(p.ceilingBps))} limit.`,
  debt_share: (p) => `With your other payments, about ${pct(Number(p.debtShareBps))} of your income goes to loans each month.`,
  fixed_rate: (p) => `The rate is fixed, so the payment stays the same for all ${months(Number(p.months))}.`,
  lowest_payment: () => "It has the lowest monthly payment of these routes.",
  lowest_payment_now: () => "It has the lowest monthly payment of the routes that start now.",
  cheapest: () => "It costs the least in interest and fees.",
  your_term: () => "It keeps the term you chose.",
  near_tie: (p) => `The costs are close (${lei(Number(p.gap))} apart), so the fixed payment wins.`,
  chosen_term_too_high: () => "The term you chose would take too much of your income, so this term of the same loan fits better.",
};
/** Most telling first; a card shows three. */
const REASON_ORDER: RecommendationResult["reasons"][number]["key"][] =
  ["chosen_term_too_high", "debt_share_room", "debt_share", "fixed_rate", "starts_now", "lowest_payment", "lowest_payment_now", "cheapest", "near_tie", "your_term"];

const NEEDS_TEXT = {
  income_obligations: "the customer's monthly income and other loan payments",
  need_by: "when the customer needs the money",
} as const;
const EXCLUDED_TEXT = {
  not_available: "can't be worked out from reviewed catalog terms",
  debt_share_over_ceiling: "would take more of the income than the bank's limit",
  no_room_left: "would leave nothing each month",
  starts_too_late: "isn't ready by when the customer needs the money",
} as const;
const ASSUMPTION_TEXT: Record<string, string> = {
  savings_interest_not_counted: "Saving routes count no interest on savings.",
  savings_buffer_kept: "Saving routes don't use the savings the customer already has.",
  same_term_after_saving: "After saving, the rest is borrowed over the same term.",
};

const ordered = (rec: RecommendationResult) => [...rec.reasons].sort((a, b) => REASON_ORDER.indexOf(a.key) - REASON_ORDER.indexOf(b.key));
const reasonText = (rec: RecommendationResult, pick: Route) => ordered(rec).map((x) => REASON_TEXT[x.key](x.params ?? {}, pick));

/**
 * When another route fits better, in one sentence. The card adds "Every option stays open, and the choice is
 * yours." (web/components/agent/AnswerCards.tsx Why), so it isn't repeated here.
 */
function whenOther(routes: Route[], rec: RecommendationResult): string {
  const byKey = new Map(routes.map((r) => [r.key, r]));
  if (rec.betterIf) {
    return `${routeName(byKey.get(rec.betterIf.route)!)} is the better pick if it can wait until ${monthYear(rec.betterIf.startDate)}: it costs ${lei(rec.betterIf.saves)} less.`;
  }
  const t = rec.tradeOffs.find((x) => x.key === "higher_payment_lower_cost" || x.key === "cheaper_starts_later");
  if (t && t.monthlyDiff !== null && t.monthlyDiff > 0) {
    return `${routeName(byKey.get(t.route)!)} costs ${lei(-t.costDiff)} less in total if ${lei(t.monthlyDiff)} more a month fits.`;
  }
  return "Another route fits better if paying less in total matters more to you than the monthly payment.";
}

function routeLines(r: Route): string {
  const name = routeName(r);
  if (r.status !== "ok") return `Route "${name}": can't be worked out from reviewed catalog terms (${r.gaps.map((g) => g.reason).join(", ") || "no terms"}).`;
  const parts = [
    r.saving ? `saving ${lei(r.saving.monthly)} a month for ${months(r.saving.months)} first (${lei(r.saving.saved)} saved)` : null,
    r.borrowed ? `borrows ${lei(r.borrowed)}` : "borrows nothing",
    r.monthly !== null ? `monthly payment ${lei(r.monthly)}` : null,
    r.stressedMonthly !== null ? `stress test, not the rate: ${lei(r.stressedMonthly)} a month if the variable rate rose` : null,
    `interest and fees ${lei(r.cost!)}`,
    r.rateBps !== null ? `${pct(r.rateBps)} ${r.rateType} interest` : null,
    startsText(r),
    r.debtShareBps !== null && r.borrowed ? `about ${pct(r.debtShareBps)} of income to loans each month` : null,
  ].filter(Boolean);
  return `Route "${name}": ${parts.join("; ")}.`;
}

/** The citable text for one comparison: every figure the card or the model may use. Indicative, never an offer. */
export function routesCitable(result: RoutesResult, rec: RecommendationResult, src: { url: string; collectedAt: string; termIds: string[] }, index: number): Citable {
  const pick = result.routes.find((r) => r.key === rec.pick);
  const lines = [
    `Raiffy route comparison from reviewed catalog terms (${src.termIds.join(", ")}), worked out from the customer's own figures.`,
    ...result.routes.map(routeLines),
  ];
  if (rec.status === "ok" && pick) {
    lines.push(`Raiffy's recommendation by the rule: "${routeName(pick)}". ${reasonText(rec, pick).join(" ")}`, whenOther(result.routes, rec));
    for (const t of rec.tradeOffs) {
      const other = routeName(result.routes.find((r) => r.key === t.route)!);
      lines.push(`Compared with the recommendation, "${other}" ${t.costDiff < 0 ? `costs ${lei(-t.costDiff)} less` : t.costDiff > 0 ? `costs ${lei(t.costDiff)} more` : "costs the same"} in interest and fees${t.monthlyDiff ? `, and ${lei(Math.abs(t.monthlyDiff))} ${t.monthlyDiff > 0 ? "more" : "less"} a month` : ""}.`);
    }
  } else if (rec.status === "needs_input") {
    lines.push(`No recommendation yet: ask for ${rec.needs.map((n) => NEEDS_TEXT[n]).join(" and ")}. Don't recommend a route before then.`);
  } else if (rec.status === "none_fits") {
    lines.push("No route fits the customer's figures within the limits, so Raiffy recommends none. Offer a specialist instead of pushing a route.");
  } else {
    lines.push("No route could be worked out from reviewed catalog terms, so Raiffy recommends none.");
  }
  for (const e of rec.excluded) {
    const r = result.routes.find((x) => x.key === e.route);
    if (r && e.reason !== "not_available") lines.push(`"${routeName(r)}" isn't recommended: it ${EXCLUDED_TEXT[e.reason]}.`);
  }
  lines.push(...result.assumptions.map((a) => ASSUMPTION_TEXT[a] ?? a), "Indicative, not an offer: the bank's own assessment decides.");
  return { chunkId: `routes:${index}`, label: "Raiffy route comparison", url: src.url, text: lines.join("\n"), collectedAt: src.collectedAt, sectionType: "representative_example", score: 1 };
}

const SUMMARY: Record<RecommendationResult["tradeOffs"][number]["key"], string> = {
  higher_payment_lower_cost: "A higher payment, but less interest in total.",
  lower_payment_higher_cost: "A lower payment, but more interest in total.",
  cheaper_starts_later: "The cheapest way there, but it starts later.",
  costs_more: "It costs more in total.",
  same_cost: "About the same cost in total.",
};

const PICK_SUMMARY: Record<Route["kind"], string> = {
  loan: "A loan with the same payment every month.",
  overdraft: "Borrow only what you use, and repay it as you go.",
  save_then_borrow: "Save part of it first, then borrow less.",
  save_only: "Save the whole amount, with nothing borrowed.",
};

/** The routes card, recommendation included, or null when there is no recommendation to show. */
export function routesCard(result: RoutesResult, rec: RecommendationResult, url: string, title: string): AnswerCard | null {
  if (rec.status !== "ok" || !rec.pick) return null;
  const shown = result.routes.filter((r) => r.status === "ok");
  const pick = shown.find((r) => r.key === rec.pick);
  if (!pick || shown.length < 2) return null;
  const others = shown.filter((r) => r !== pick).slice(0, 3);
  const trade = new Map(rec.tradeOffs.map((t) => [t.route, t]));
  const facts = (r: Route) => [
    r.monthly !== null ? { label: r.saving ? "Then each month" : "Monthly payment", value: lei(r.monthly), source: url } : null,
    r.saving ? { label: "Saving first, each month", value: lei(r.saving.monthly), source: url } : null,
    { label: "Interest and fees", value: lei(r.cost!), source: url },
    r.rateBps !== null ? { label: "Interest rate", value: `${pct(r.rateBps)} ${r.rateType}`, source: url } : null,
  ].filter((f): f is { label: string; value: string; source: string } => f !== null).slice(0, 4);
  const fit = (r: Route) => r.startsInMonths === 0 ? "Starts now." : `Starts after saving first.`;
  return {
    type: "routes",
    title: title.slice(0, 80),
    routes: [pick, ...others].map((r) => ({
      name: routeName(r).slice(0, 60),
      summary: r === pick ? PICK_SUMMARY[r.kind] : SUMMARY[trade.get(r.key)?.key ?? "costs_more"],
      fit: fit(r),
      facts: facts(r),
      ...(r.chosen ? { chosen: true } : {}),
    })),
    recommendation: { option: routeName(pick).slice(0, 60), reasons: reasonText(rec, pick).slice(0, 3), whenOther: whenOther(result.routes, rec).slice(0, 240) },
  };
}

/**
 * The cards to show when compare_routes built a routes card this turn: the host card first, in place of any routes
 * card the model made, then the model's other cards. The host card passes the same check against the comparison
 * it came from; its wording is host-written from that comparison, so the comparison text grounds its prose too.
 * Null when there is no host card; `dropped` when any part of it fails the check. The model's cards then stand as checked.
 */
export function withHostRoutesCard(host: { card: AnswerCard; text: string } | null, shown: readonly AnswerCard[], urls: readonly string[],
  hits: readonly CardEvidence[], customerFigures: readonly string[]): { cards: AnswerCard[]; urls: string[]; replaced: boolean } | { dropped: string } | null {
  if (!host) return null;
  const checked = checkCards({ cards: [host.card] }, hits, [...customerFigures, host.text]);
  if ("error" in checked) return { dropped: checked.error };
  // Built by code, so any dropped part means something is wrong: shown whole or not at all
  if (!checked.cards.length || checked.dropped.length) return { dropped: checked.dropped.join("; ") || "no card" };
  return { cards: [...checked.cards, ...shown.filter((c) => c.type !== "routes")].slice(0, 3), urls: [...new Set([...checked.urls, ...urls])], replaced: shown.some((c) => c.type === "routes") };
}

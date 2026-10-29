import { z } from "zod";
import type { Citable } from "../rag/answer";
import { lei, pct } from "../rag/tools";
import { HOLDING_KINDS, type HoldingKind, type Holdings, holdingsSchema, KIND_SWITCH, type Switch, SWITCHES } from "./schemas";

/*
 * get_holdings, pure: the customer's holdings with dates worked out from today, only for the switches that are on.
 * A switched-off kind is never read and is listed in `notUsed`, never returned as empty or zero.
 */

export const holdingsInputSchema = z.object({ kinds: z.array(z.enum(HOLDING_KINDS)).min(1).max(HOLDING_KINDS.length).optional() }).strict();
export type HoldingsInput = z.infer<typeof holdingsInputSchema>;
export type Switches = Record<Switch, boolean>;

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const at = (today: string) => Date.parse(`${today}T00:00:00Z`);
export const addDays = (today: string, days: number) => iso(at(today) + days * DAY);
export function addMonths(today: string, months: number, day?: number): string {
  const d = new Date(at(today));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day ?? d.getUTCDate(), last));
  return iso(target.getTime());
}
const monthsLeftOf = (l: Holdings["loans"][number]) => Math.max(0, l.termMonths - l.startedMonthsAgo);

/** The holdings with dates and simple derived figures, as the tool returns them. */
export function resolveHoldings(holdings: Holdings, today: string) {
  const h = holdingsSchema.parse(holdings);
  const nextPayment = (day: number) => { const d = new Date(at(today)); return d.getUTCDate() <= day ? addMonths(today, 0, day) : addMonths(today, 1, day); };
  return {
    accounts: h.currentAccounts.map((a) => ({ ...a, overdraft: a.overdraft ? { ...a.overdraft, renewsOn: addDays(today, a.overdraft.renewsInDays),
      interestPerMonth: Math.round(a.overdraft.used * a.overdraft.rateBps / 10_000 / 12) } : undefined })),
    savings: {
      accounts: h.savingsAccounts,
      deposits: h.deposits.map((d) => ({ ...d, maturesOn: addDays(today, d.maturesInDays),
        /** Gross interest for the whole term, before the 10% tax on interest. */
        interestAtMaturity: Math.round(d.amount * d.rateBps / 10_000 * d.termMonths / 12) })),
    },
    loans: h.loans.map((l) => ({ ...l, monthsLeft: monthsLeftOf(l), endsOn: addMonths(today, monthsLeftOf(l), l.paymentDay), nextPaymentOn: nextPayment(l.paymentDay),
      ...(l.rate.fixedMonthsLeft !== undefined ? { fixedUntil: addMonths(today, l.rate.fixedMonthsLeft, l.paymentDay) } : {}),
      /** The fee to repay all of it today, from the contract's early-repayment fee. */
      earlyRepaymentFeeToday: Math.round(l.outstanding * l.earlyRepaymentFeeBps / 10_000) })),
    cards: h.cards.map((c) => ({ ...c, ...(c.annualFeeDueInDays !== undefined ? { annualFeeDueOn: addDays(today, c.annualFeeDueInDays) } : {}) })),
    offers: h.offers.map((o) => ({ ...o, validUntil: addDays(today, o.validForDays) })),
    profile: h.profile,
  };
}
export type ResolvedHoldings = ReturnType<typeof resolveHoldings>;

export type HoldingsView = {
  status: "ok" | "unavailable";
  synthetic: true;
  customer: string;
  asOf: string;
  reason?: "no_persona" | "switched_off";
  holdings: Partial<ResolvedHoldings>;
  /** Asked for but switched off, so not read: the answer should say these weren't used. */
  notUsed: Switch[];
};

export function holdingsView(input: { customer: string | null; holdings: Holdings | null | undefined; switches: Switches; kinds?: readonly HoldingKind[]; today: string }): HoldingsView {
  const kinds = [...new Set(input.kinds?.length ? input.kinds : HOLDING_KINDS)];
  const notUsed = [...new Set(kinds.map((k) => KIND_SWITCH[k]).filter((s) => !input.switches[s]))].sort((a, b) => SWITCHES.indexOf(a) - SWITCHES.indexOf(b));
  const base = { synthetic: true as const, customer: input.customer ?? "", asOf: input.today, notUsed };
  if (!input.customer || !input.holdings) return { ...base, status: "unavailable", reason: "no_persona", holdings: {} };
  const allowed = kinds.filter((k) => input.switches[KIND_SWITCH[k]]);
  if (!allowed.length) return { ...base, status: "unavailable", reason: "switched_off", holdings: {} };
  const all = resolveHoldings(input.holdings, input.today);
  return { ...base, status: "ok", holdings: Object.fromEntries(allowed.map((k) => [k, all[k]])) as Partial<ResolvedHoldings> };
}

const RATE_TYPE = { fixed: "fixed", variable: "variable", fixed_then_variable: "fixed, then variable" } as const;

/**
 * One citable per holding, so a figure in the answer must come from the holding it cites. The source is the sample
 * account (a local `raiffy:` link), never the product page: the figures are the customer's, not the bank's list.
 */
export function holdingsCitables(view: HoldingsView, productUrls: Readonly<Record<string, string>>): Citable[] {
  if (view.status !== "ok") return [];
  const h = view.holdings;
  const intro = `SAMPLE DATA: a synthetic customer ("${view.customer}") in this preview, not the customer's real account. As of ${view.asOf}.`;
  const page = (productId: string) => (productUrls[productId] ? [`Product page: ${productUrls[productId]}`] : []);
  const cite = (ref: string, label: string, lines: string[]): Citable => ({
    chunkId: `holding:${view.customer}:${ref}`, label: `Your ${label} (sample data)`, url: `raiffy:account/${view.customer}/${ref}`,
    text: [intro, ...lines].join("\n"), collectedAt: `${view.asOf}T00:00:00+00:00`, sectionType: "table", score: 1,
  });
  const out: Citable[] = [];
  for (const a of h.accounts ?? []) out.push(cite(a.ref, a.name, [
    `${a.name} ${a.ibanMask}: balance ${lei(a.balance)}.`,
    ...(a.package ? [`Account package: ${a.package.name}, ${lei(a.package.monthlyFee)} a month.`] : []),
    ...(a.overdraft ? [`Overdraft: ${lei(a.overdraft.used)} used of a ${lei(a.overdraft.limit)} limit, at ${pct(a.overdraft.rateBps)} a year, about ${lei(a.overdraft.interestPerMonth)} interest a month at that use. Renews on ${a.overdraft.renewsOn}.`] : []),
    ...page(a.productId),
  ]));
  for (const s of h.savings?.accounts ?? []) out.push(cite(s.ref, s.name, [`${s.name}: balance ${lei(s.balance)}, interest ${pct(s.rateBps)} a year.`, ...page(s.productId)]));
  for (const d of h.savings?.deposits ?? []) out.push(cite(d.ref, d.name, [
    `${d.name}: ${lei(d.amount)}${d.currency === "EUR" ? " equivalent, held in euros" : ""} for ${d.termMonths} months at ${pct(d.rateBps)} a year.`,
    `Matures on ${d.maturesOn}; ${d.renewal === "automatic" ? "renews automatically for the same term at the rate then in force" : "does not renew: the money returns to the current account"}.`,
    `Interest at maturity, before the 10% tax on interest: ${lei(d.interestAtMaturity)}.`,
    ...page(d.productId),
  ]));
  for (const l of h.loans ?? []) out.push(cite(l.ref, l.name, [
    `${l.name}: borrowed ${lei(l.principal)}, ${lei(l.outstanding)} still to repay.`,
    `Monthly payment ${lei(l.monthly)}, on day ${l.paymentDay}; next on ${l.nextPaymentOn}. ${l.monthsLeft} payments left; the last on ${l.endsOn}.`,
    `Interest: ${RATE_TYPE[l.rate.type]}, ${pct(l.rate.rateBps)} a year now${"fixedUntil" in l && l.fixedUntil ? `; the fixed rate ends on ${l.fixedUntil}${l.rate.afterFixed ? `, then ${l.rate.afterFixed}` : ""}` : ""}.`,
    l.earlyRepaymentFeeBps > 0
      ? `Early repayment fee: ${pct(l.earlyRepaymentFeeBps)} of the amount repaid; ${lei(l.earlyRepaymentFeeToday)} to repay all of it today.`
      : "No early repayment fee.",
    ...page(l.productId),
  ]));
  for (const c of h.cards ?? []) out.push(cite(c.ref, c.name, [
    `${c.name} ${c.mask}, ${c.type} card.${c.limit !== undefined ? ` Limit ${lei(c.limit)}, ${lei(c.used ?? 0)} used.` : ""}`,
    ...(c.annualFee !== undefined ? [`Annual fee ${lei(c.annualFee)}${"annualFeeDueOn" in c && c.annualFeeDueOn ? `, next due on ${c.annualFeeDueOn}` : ""}.`] : []),
    `Used for ${c.usesLastYear} payments in the last 12 months.`,
    ...page(c.productId),
  ]));
  for (const o of h.offers ?? []) out.push(cite(o.ref, `pre-approved ${o.name}`, [
    `Pre-approved by the bank: ${o.name} up to ${lei(o.maxAmount)}, at ${pct(o.rateBps)} a year, fee ${lei(o.fee)}, for ${o.minMonths} to ${o.maxMonths} months. Valid until ${o.validUntil}.`,
    ...page(o.productId),
  ]));
  if (h.profile) out.push(cite("profile", "profile", [
    `Age ${h.profile.age}. Residency: ${{ RO: "Romania", EU: "another EU country", non_EU: "outside the EU" }[h.profile.residency]}. Identity ${h.profile.idVerified ? "verified for digital signing" : "not verified for digital signing: an application needs a branch visit"}.`,
  ]));
  return out;
}

/** Why nothing came back, or which switches were off. Not citable. */
export function holdingsNote(view: HoldingsView): string | undefined {
  if (view.reason === "no_persona") return "No sample account is selected in \"What Raiffy can see\", so there are no holdings to read. Don't invent any.";
  if (!view.notUsed.length) return undefined;
  return `Switched off in "What Raiffy can see", so not read: ${view.notUsed.join(", ")}. Say so, and don't assume the customer has none.`;
}

/** Existing Raiffeisen loan payments for the inputs gate (source "account"), from the loans switch alone. */
export function holdingInputs(view: HoldingsView): { obligations?: number } {
  const loans = view.status === "ok" ? view.holdings.loans : undefined;
  return loans?.length ? { obligations: loans.reduce((s, l) => s + l.monthly, 0) / 100 } : {};
}

import {
  CalculatorIcon, CalendarIcon, FileBadgeIcon, FileTextIcon, GlobeIcon, LandmarkIcon, ListChecksIcon,
  MessageCircleIcon, PiggyBankIcon, ReceiptIcon, ScaleIcon, type LucideIcon,
} from "lucide-react";
import { compareRevolving, recommend, type Comparison } from "@/lib/finance";
import { CHAT_LOAN_FEE, CHAT_OVERDRAFT, OFFER_LOAN_RATE, PUBLIC_LOAN_RATE } from "@/lib/demo-terms";
import { lei } from "@/lib/format";

/* Scripted demo content for the chat, ported from chat.html. The real answers come from the LLM pipeline. */

export type SourceKey = "offer" | "rates" | "fees" | "statement" | "savings" | "docs" | "public";
export const SOURCES: Record<SourceKey, { icon: LucideIcon; label: string; detail: string }> = {
  offer: { icon: FileBadgeIcon, label: "Your pre-approved offer", detail: "Personal loan · 7.9% fixed · valid until 30 Nov" },
  rates: { icon: CalendarIcon, label: "Rates as of 28 Oct", detail: "Overdraft 11.5% variable · published rates" },
  fees: { icon: ReceiptIcon, label: "Fee schedule 2026", detail: "Published list of fees and commissions" },
  statement: { icon: FileTextIcon, label: "October statement", detail: "Current account ••4821" },
  savings: { icon: PiggyBankIcon, label: "Savings rates as of 28 Oct", detail: "Savings account, deposits and bonds" },
  docs: { icon: ListChecksIcon, label: "Personal loan document list", detail: "What the bank needs before approval" },
  public: { icon: GlobeIcon, label: "Standard published rates", detail: "Used because offer access is off" },
};

export type PermKey = "account" | "offers" | "savings" | "cards";
export type Perms = Record<PermKey, boolean>;
export const INITIAL_PERMS: Perms = { account: true, offers: true, savings: true, cards: false };

export type Card =
  | { type: "compare"; rate: number; amount: number; term: number }
  | { type: "sim"; rate: number; amount: number; term: number }
  | { type: "savings" }
  | { type: "fee" }
  | { type: "docs"; uploaded?: boolean; slot?: string | null; share?: boolean; booked?: { when: string; share: boolean } | null }
  | { type: "handoff" };

export type FlowKey = "compare" | "sim" | "early" | "fee" | "savings" | "docs" | "handoff" | "fallback";
export type Plan = { thinking: string[]; paras: string[]; card: Card | null; sources: SourceKey[]; chips: string[] };

export type UserMsg = { id: string; role: "user"; text: string; file: string | null; enter?: boolean };
export type RaiffyMsg = {
  id: string; role: "raiffy"; flow: FlowKey; thinking: string[]; paras: string[]; card: Card | null; sources: SourceKey[];
  stopped?: boolean; pinned?: string | null; vote?: "up" | "down" | null; enter?: boolean;
};
export type Msg = UserMsg | RaiffyMsg;
export type Group = "Today" | "This week" | "Earlier";
export type Conv = { id: string; title: string; group: Group; time: string; icon: LucideIcon; messages: Msg[] };
export type Pin = { id: string; conv: string; icon: LucideIcon; title: string; meta: string };

/* ───────────── Maths and the recommendation copy ───────────── */

const loanTerms = (rate: number) => ({ annualRate: rate, oneOffFee: CHAT_LOAN_FEE });
export const simCalc = (amount: number, months: number, rate: number) =>
  compareRevolving({ amount, months }, loanTerms(rate), CHAT_OVERDRAFT);

export type RecCopy = { k: "loan" | "od"; name: string; reasons: string[]; alt: string };

/** Always returns the reasons and when the other option is the better pick. The pick itself is lib/finance's rule. */
export function recCopy(s: Comparison, P: number, n: number): RecCopy {
  const r = recommend(s);
  const d = r.difference;
  if (r.rule === "only-fit") return {
    k: "loan", name: "the personal loan", reasons: [
      s.overdraft.unavailableBecause === "limit" ? `Overdrafts go up to 15,000 lei, so it’s the only option for ${lei(P)}.` : `Overdrafts renew every 12 months, so it’s the only option over ${n} months.`,
      `Its rate is fixed, so your ${lei(s.loan.monthly)} payment never changes.`],
    alt: P <= 15000 ? "Over 12 months or less, the overdraft becomes an option too." : "A shorter term lowers the total cost.",
  };
  if (r.rule === "near-tie") return {
    k: "loan", name: "the personal loan", reasons: [
      `Both cost almost the same: ${lei(d)} apart in total.`,
      "Its rate is fixed, so your payment can’t go up if rates rise."],
    alt: "The overdraft is the better pick if you want to repay whenever you like, with no fee.",
  };
  if (r.pick === "overdraft") return {
    k: "od", name: "the overdraft", reasons: [
      `It costs ${lei(d)} less in total, because the loan adds a one-off 249 lei fee.`,
      "You can repay any amount, anytime, for free."],
    alt: "The loan is the better pick if you’d rather have a fixed rate and the same payment every month.",
  };
  return {
    k: "loan", name: "the personal loan", reasons: [`It costs ${lei(d)} less in total.`, "Its rate is fixed, so your payment can’t go up."],
    alt: "The overdraft is the better pick if you want to repay early with no fee.",
  };
}

/* ───────────── Scripted replies ───────────── */

export const FLOWS: Record<FlowKey, (perms: Perms) => Plan> = {
  compare: (perms) => {
    const own = perms.offers, rate = own ? OFFER_LOAN_RATE : PUBLIC_LOAN_RATE, rec = recCopy(simCalc(8000, 12, rate), 8000, 12);
    return {
      thinking: own ? ["Reading your pre-approved offer…", "Checking today’s overdraft rate…"] : ["Checking standard published rates…", "Checking today’s overdraft rate…"],
      paras: own
        ? [`For 8,000 lei over 12 months, I recommend ${rec.name}. ${rec.reasons.join(" ")}`,
          `${rec.alt} Here they are side by side, with the same amount and the same term:`]
        : ["I can’t see your pre-approved offer, because you’ve turned that access off, so I’ve used the standard published rates. Your own offer may be better, which could change my recommendation.",
          `On these rates I recommend ${rec.name}. ${rec.reasons[0]} Here they are side by side:`],
      card: { type: "compare", rate, amount: 8000, term: 12 },
      sources: own ? ["offer", "rates"] : ["public", "rates"],
      chips: ["What if I stretch it to 24 months?", "Can I repay the loan early?", "Book an advisor"],
    };
  },
  sim: (perms) => {
    const rate = perms.offers ? OFFER_LOAN_RATE : PUBLIC_LOAN_RATE, s = simCalc(8000, 24, rate), rec = recCopy(s, 8000, 24);
    return {
      thinking: ["Running the numbers for 24 months…"],
      paras: [`Over 24 months I recommend ${rec.name}. Overdrafts renew every 12 months, so it’s the only option that fits. Your payment drops to about ${lei(s.loan.monthly)} a month, but you’d pay more interest overall.`,
        "Move the amount or change the term, and I’ll update the recommendation and the reasons:"],
      card: { type: "sim", rate, amount: 8000, term: 24 },
      sources: [perms.offers ? "offer" : "public", "fees"],
      chips: ["Can I repay the loan early?", "Which documents do I need?", "Book an advisor"],
    };
  },
  early: (perms) => ({
    thinking: ["Checking the early repayment terms…"],
    paras: ["Yes. You can repay the personal loan early at any time, in part or in full. The fee is 0.5% of the amount you repay early, and there’s no fee in the last 12 months of the loan.",
      "An overdraft has no early repayment fee, since you can top it up whenever you like."],
    card: null, sources: [perms.offers ? "offer" : "public", "fees"],
    chips: ["What if I stretch it to 24 months?", "Book an advisor"],
  }),
  fee: () => ({
    thinking: ["Reading your October statement…", "Checking your account package…"],
    paras: ["You withdrew cash from another bank’s ATM on 22 October. Your account package includes free withdrawals only at Raiffeisen ATMs, so the other bank’s machine cost 5 lei.",
      "The nearest Raiffeisen ATM to that one is 350 m away, on Str. Barbu Văcărescu."],
    card: { type: "fee" }, sources: ["statement", "fees"],
    chips: ["Show me all fees this year", "Is there a package with free ATMs?"],
  }),
  savings: () => ({
    thinking: ["Checking today’s savings rates…", "Comparing access to your money…"],
    paras: ["Before rates, the question that matters is how fast you might need the money. For an emergency fund, you usually want it within a few days.",
      "Here are your options, from the most flexible to the least. I’ve marked the one that matches access within a week, but the choice is yours:"],
    card: { type: "savings" }, sources: ["savings"],
    chips: ["What happens if I break a deposit early?", "Split it between two options"],
  }),
  docs: () => ({
    thinking: ["Checking the documents already in the app…", "Looking for advisor slots this week…"],
    paras: ["For a personal loan you need three documents. Two are already in the app, so only proof of address is missing.",
      "You can also book a time with your advisor. If you agree, Andreea gets a short summary of what we’ve discussed, so you don’t start from scratch."],
    card: { type: "docs" }, sources: ["docs"],
    chips: ["What counts as proof of address?", "Can I do the meeting by video?"],
  }),
  handoff: () => ({
    thinking: ["Checking whether I can answer this reliably…"],
    paras: ["Tax depends on your personal situation, so I’d rather not guess. A Raiffeisen advisor can confirm what applies to you, or you can check with a tax consultant.",
      "If you book a meeting, I can pass on your question so you don’t have to explain it again."],
    card: { type: "handoff" }, sources: [],
    chips: ["Book an advisor", "Compare savings options instead"],
  }),
  fallback: () => ({
    thinking: ["Reading your question…"],
    paras: ["I can help with loans and overdrafts, savings, fees on your statement and getting ready for an advisor meeting.",
      "Could you tell me a bit more about what you’d like to do? For example, how much money and for how long."],
    card: null, sources: [],
    chips: ["Compare a loan and an overdraft", "Explain a fee on my statement", "Where should I keep my savings?"],
  }),
};

/** Demo router: keyword rules standing in for the real intent router. */
export function route(text: string, file: string | null): FlowKey {
  const t = text.toLowerCase();
  if (/tax|impozit|legal|inherit|lawyer/.test(t)) return "handoff";
  if (/early|repay|ramburs/.test(t)) return "early";
  if (/(24|36|48|60)\s*month|stretch|longer|simulat/.test(t)) return "sim";
  if (/overdraft|loan|borrow|credit|împrumut/.test(t)) return "compare";
  if (/fee|charge|comision|paid|atm|statement/.test(t) || (file && !t)) return "fee";
  if (/sav|deposit|emergency|economi|bond|interest/.test(t)) return "savings";
  if (/advisor|meeting|document|appointment|book|proof|video/.test(t)) return "docs";
  return "fallback";
}

/* ───────────── Seed conversations ───────────── */

function seed(id: string, flow: FlowKey, userText: string, file: string | null = null): Msg[] {
  const f = FLOWS[flow](INITIAL_PERMS);
  return [
    { id: `${id}u`, role: "user", text: userText, file },
    { id: `${id}r`, role: "raiffy", flow, thinking: f.thinking, paras: f.paras, card: f.card, sources: f.sources, pinned: id === "s1" ? "p0" : null },
  ];
}

export const SEED_CONVS: Conv[] = [
  { id: "c1", title: "Loan or overdraft for 8,000 lei", group: "Today", time: "18:42", icon: ScaleIcon,
    messages: [...seed("s1", "compare", "I need 8,000 lei for about a year to fix up the kitchen. Is an overdraft or a personal loan better?"),
      ...seed("s2", "sim", "What if I stretch it to 24 months?")] },
  { id: "c2", title: "Why I paid a 5 lei ATM fee", group: "Today", time: "09:15", icon: ReceiptIcon,
    messages: seed("s3", "fee", "Why was I charged 5 lei on 22 October?", "Statement_Oct_2026.pdf") },
  { id: "c3", title: "Where to keep my emergency fund", group: "This week", time: "Mon", icon: PiggyBankIcon,
    messages: seed("s4", "savings", "I have 15,000 lei saved for emergencies. Where should I keep it?") },
  { id: "c4", title: "Documents for my loan meeting", group: "This week", time: "Sun", icon: ListChecksIcon,
    messages: seed("s5", "docs", "What do I need to bring to my loan meeting?") },
  { id: "c5", title: "Tax on term deposit interest", group: "Earlier", time: "12 Oct", icon: LandmarkIcon,
    messages: seed("s6", "handoff", "Do I pay tax on the interest from a term deposit, and how much?") },
];

export const SAVED_SIMS = [
  { title: "8,000 lei · 12 months", conv: "c1" },
  { title: "8,000 lei · 24 months", conv: "c1" },
];

export const SEED_PINS: Pin[] = [{ id: "p0", conv: "c1", icon: ScaleIcon, title: "Loan vs overdraft", meta: "8,000 lei · 12 months" }];

export const NEW_CHAT_ICON = MessageCircleIcon;
export const GROUPS: Group[] = ["Today", "This week", "Earlier"];

export const PIN_META: Partial<Record<Card["type"], (c: Card) => Omit<Pin, "id" | "conv">>> = {
  compare: (c) => ({ icon: ScaleIcon, title: "Loan vs overdraft", meta: "amount" in c ? `${lei(c.amount)} · ${c.term} months` : "" }),
  sim: (c) => ({ icon: CalculatorIcon, title: "Repayment simulation", meta: "amount" in c ? `${lei(c.amount)} · ${c.term} months` : "" }),
  savings: () => ({ icon: PiggyBankIcon, title: "Savings options", meta: "15,000 lei · rates 28 Oct" }),
  fee: () => ({ icon: ReceiptIcon, title: "ATM fee explained", meta: "5 lei · 22 Oct" }),
  docs: () => ({ icon: ListChecksIcon, title: "Loan meeting checklist", meta: "2 of 3 documents" }),
};

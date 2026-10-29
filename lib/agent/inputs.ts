import { z } from "zod";
import type { AgentPolicy } from "./config";
import type { Inquiry } from "./confidence";

/**
 * Inputs a recommendation needs, per answer pattern. Required inputs gate the answer and are the only ones Raiffy asks for;
 * optional inputs refine it and are sent to the model as known or unknown. Values here are what the customer stated or
 * what account data supplied, never bank terms: rates, fees and limits still come from the catalog.
 */

export const INPUT_SOURCES = ["form", "message", "conversation", "account", "memory", "default"] as const;
export type InputSource = typeof INPUT_SOURCES[number];
export const inputValueSchema = z.union([z.number(), z.string(), z.array(z.string())]);
export type InputValue = z.infer<typeof inputValueSchema>;
export const knownInputSchema = z.object({ value: inputValueSchema, source: z.enum(INPUT_SOURCES) });
export type KnownInput = z.infer<typeof knownInputSchema>;
export type Values = Partial<Record<SlotKey, InputValue>>;

type Cue = "none" | "income" | "obligation" | "monthly" | "down_payment" | "savings" | "balance";
type Base = { label: string; question: string; hint?: string; fromAccount?: true };
type AmountSlot = Base & { kind: "amount"; cues: Cue[]; min: number; max: number };
type MonthsSlot = Base & { kind: "months"; min: number; max: number };
type PercentSlot = Base & { kind: "percent"; min: number; max: number };
type ChoiceSlot = Base & { kind: "choice"; options: Record<string, { label: string; match?: RegExp }> };
type OptionsSlot = Base & { kind: "options"; minCount: number };
export type Slot = AmountSlot | MonthsSlot | PercentSlot | ChoiceSlot | OptionsSlot;

const LENDING = ["personal_loan", "mortgage", "car_loan", "overdraft", "credit_card"];

export const SLOTS = {
  item: { kind: "choice", label: "What it's for", question: "What are you planning to buy or pay for?", options: {
    car: { label: "A car", match: /\b(car|auto|vehicle|bmw|dacia|vw|audi|masin[aă]|autoturism)\b/i },
    home: { label: "A home", match: /\b(home|flat|apartment|house|property|apartament|cas[aă]|locuin[tț][aă]|garsonier[aă])\b/i },
    renovation: { label: "Renovation", match: /\b(renovat\w*|renovare|repair the (house|flat)|amenaj\w*)\b/i },
    goods: { label: "Electronics or furniture", match: /\b(laptop|phone|tv|furniture|appliance|fridge|telefon|mobil[aă]|electrocasnic\w*|frigider)\b/i },
    education: { label: "Studies", match: /\b(course|university|tuition|master'?s?|studies|facultat\w*|curs|studii)\b/i },
    event: { label: "An event or holiday", match: /\b(wedding|holiday|vacation|honeymoon|nunt[aă]|vacan[tț][aă]|concediu|botez)\b/i },
    other: { label: "Something else" },
  } },
  amount: { kind: "amount", label: "Amount", question: "How much money is involved?", cues: ["none"], min: 1, max: 10_000_000 },
  monthlyPayment: { kind: "amount", label: "Monthly payment", question: "What monthly payment do you have in mind?", cues: ["monthly"], min: 10, max: 100_000 },
  months: { kind: "months", label: "Term", question: "Over how many months?", min: 1, max: 420 },
  downPayment: { kind: "amount", label: "Down payment", question: "How much can you pay upfront?", cues: ["down_payment"], min: 0, max: 10_000_000 },
  income: { kind: "amount", label: "Net monthly income", question: "What is your net monthly income?", cues: ["income"], min: 0, max: 1_000_000, fromAccount: true },
  obligations: { kind: "amount", label: "Monthly loan and card payments", question: "How much do you already pay each month for loans and cards?", hint: "Enter 0 if none", cues: ["obligation"], min: 0, max: 1_000_000, fromAccount: true },
  priority: { kind: "choice", label: "Priority", question: "What matters most to you?", options: {
    lowest_monthly: { label: "Lowest monthly payment", match: /\b(lowest|smallest|small|low|mic[aă]|mici)\s+(monthly|rat[aă]|monthly payment)|\b(rat[aă] mic[aă])\b/i },
    lowest_total: { label: "Lowest total cost", match: /\b(lowest|cheapest|least)\s+(total|overall)|\b(cost total minim|cel mai ieftin)\b/i },
    flexibility: { label: "Flexibility", match: /\b(flexib\w*|repay early|pay (it )?off early|rambursare anticipat[aă])\b/i },
  } },
  productKind: { kind: "choice", label: "Product", question: "Which product is it about?", options: {
    mortgage: { label: "Mortgage", match: /\b(mortgage|home loan|ipotecar|credit imobiliar|noua cas[aă])\b/i },
    car_loan: { label: "Car loan or leasing", match: /\b(car loan|leasing|credit auto)\b/i },
    credit_card: { label: "Credit card", match: /\b(credit card|card de credit)\b/i },
    overdraft: { label: "Overdraft", match: /\b(overdraft|descoperit de cont|linie de credit)\b/i },
    personal_loan: { label: "Personal loan", match: /\b(personal loan|loan|credit de nevoi personale|nevoi personale|flexicredit|credit|[iî]mprumut)\b/i },
    term_deposit: { label: "Term deposit", match: /\b(term deposit|deposit|depozit\w*)\b/i },
    savings_account: { label: "Savings account", match: /\b(savings account|cont de economii|super acces)\b/i },
    current_account: { label: "Current account", match: /\b(current account|account package|cont curent|pachet)\b/i },
  } },
  options: { kind: "options", label: "Options to compare", question: "Which banks or products should I compare?", minCount: 2 },
  competitor: { kind: "options", label: "Other bank", question: "Which bank's offer are you comparing with?", minCount: 1 },
  competitorRate: { kind: "percent", label: "Their interest rate or APR", question: "What rate or APR did they offer?", min: 0, max: 100 },
  debtBalance: { kind: "amount", label: "Total left to repay", question: "How much do you still owe in total?", cues: ["balance", "none"], min: 1, max: 10_000_000, fromAccount: true },
  rate: { kind: "percent", label: "Current interest rate", question: "What interest rate do you pay now?", min: 0, max: 100 },
  debtGoal: { kind: "choice", label: "Goal", question: "What would you like to change?", options: {
    lower_monthly: { label: "Lower monthly payments", match: /\b(lower|reduce|smaller)\s+(my\s+)?(monthly|payments?|rat[aă])\b|\b(rat[aă] mai mic[aă])\b/i },
    lower_total: { label: "Pay less in total", match: /\b(pay less|save on interest|lower (the )?total)\b/i },
    pay_off_faster: { label: "Be debt-free sooner", match: /\b(pay (it )?off (early|faster|sooner)|debt[- ]free)\b/i },
  } },
  currentSavings: { kind: "amount", label: "Savings already set aside", question: "How much have you already saved?", cues: ["savings"], min: 0, max: 10_000_000, fromAccount: true },
  monthlySaving: { kind: "amount", label: "Monthly amount you can save", question: "How much can you put aside each month?", cues: ["monthly"], min: 0, max: 1_000_000 },
  event: { kind: "choice", label: "Life event", question: "What's changing?", options: {
    baby: { label: "A new baby", match: /\b(baby|pregnan\w*|bebe|copil|n[aă]scut)\b/i },
    move: { label: "Moving home", match: /\b(moving|relocat\w*|m[aă] mut|mutare)\b/i },
    marriage: { label: "Getting married", match: /\b(married|wedding|c[aă]s[aă]tor\w*|nunt[aă])\b/i },
    retirement: { label: "Retiring", match: /\b(retir\w*|pension|pensie|pensionare)\b/i },
    job_change: { label: "Changing jobs", match: /\b(new job|job change|lost my job|redundan\w*|[sș]omaj|loc de munc[aă])\b/i },
    studies: { label: "Starting studies", match: /\b(university|studies|facultat\w*)\b/i },
    business_start: { label: "Starting a business", match: /\b(start(ing)? a business|pfa|srl|afacere)\b/i },
    other: { label: "Something else" },
  } },
  feeKind: { kind: "choice", label: "Charge", question: "Which charge is it about?", options: {
    card_fee: { label: "Card fee", match: /\b(card fee|card (annual|monthly) fee|comision (de )?card|taxa card)\b/i },
    account_fee: { label: "Account or package fee", match: /\b(account fee|monthly fee|package|maintenance|administrare|pachet)\b/i },
    transfer_fee: { label: "Transfer fee", match: /\b(transfer|payment order|plat[aă]|ordin)\b/i },
    cash_withdrawal: { label: "Cash withdrawal", match: /\b(atm|withdraw\w*|cash|retrager\w*|numerar)\b/i },
    currency_exchange: { label: "Currency exchange", match: /\b(exchange|conversion|currency|schimb valutar|conversie)\b/i },
    loan_fee: { label: "Loan fee", match: /\b(loan fee|early repayment fee|comision (de )?(analiz[aă]|rambursare)|loan)\b/i },
    other: { label: "Something else" },
  } },
  purpose: { kind: "choice", label: "What it's for", question: "What do you need it for?", options: {
    repair: { label: "A repair", match: /\b(repair|broke down|broken|repara\w*|s-a stricat)\b/i },
    bills: { label: "Bills", match: /\b(bills?|rent|utilities|facturi|chirie|[iî]ntre[tț]inere)\b/i },
    other: { label: "Something else" },
  } },
  /** When the customer needs the money. A stated "in 7 months" is kept as 7; a tapped choice maps through NEED_BY_MONTHS. */
  needBy: { kind: "choice", label: "When you need it", question: "When do you need the money?", options: {
    now: { label: "Now", match: /\b(right now|need (it|the money) now|asap|as soon as possible|urgent(ly)?|immediately|right away|acum|imediat|c[aâ]t mai (repede|cur[aâ]nd)|de urgen[tț][aă])\b/i },
    within_6_months: { label: "Within 6 months", match: /\bwithin (the next )?(6|six) months\b/i },
    within_a_year: { label: "Within a year", match: /\b(within a year|within (the next )?12 months|next year|anul viitor)\b/i },
    two_years_plus: { label: "In 2 years or more", match: /\b(in (2|two) years or more|can wait (a couple of|2|two) years)\b/i },
    unsure: { label: "Not sure yet", match: /\b(not sure (yet )?when|nu [sș]tiu c[aâ]nd)\b/i },
  } },
  currency: { kind: "choice", label: "Currency", question: "Which currency?", options: { RON: { label: "Lei" }, EUR: { label: "Euro" } } },
  period: { kind: "choice", label: "Period", question: "Which period?", options: {
    last_complete_month: { label: "Last month", match: /\b(last month|luna trecut[aă])\b/i },
    last_three_complete_months: { label: "Last three months", match: /\b(last (three|3) months|ultimele (trei|3) luni)\b/i },
  } },
} as const satisfies Record<string, Slot>;
export type SlotKey = keyof typeof SLOTS;
export const slotKeySchema = z.enum(Object.keys(SLOTS) as [SlotKey, ...SlotKey[]]);

type Entry = {
  key: SlotKey;
  /** true, or a condition on the values known so far. Optional inputs are never asked for. */
  required?: true | ((v: Values) => boolean);
  /** Required inputs in the same group are alternatives: one of them is enough. */
  group?: string;
  label?: string;
  question?: string;
  hint?: string;
  default?: InputValue;
};
const lendingOrDeposit = (v: Values) => typeof v.productKind !== "string" || [...LENDING, "term_deposit"].includes(v.productKind);

export const INPUT_SPECS: Record<Inquiry, Entry[]> = {
  purchase_goal: [
    { key: "item", required: true },
    { key: "amount", required: true, label: "Price or amount needed", question: "Roughly how much does it cost?" },
    { key: "downPayment" }, { key: "months", label: "Repayment term" }, { key: "monthlyPayment", label: "Highest monthly payment" },
    { key: "priority" }, { key: "income" }, { key: "obligations" }, { key: "needBy" },
  ],
  product_comparison: [
    { key: "productKind", required: true },
    { key: "options", required: true },
    { key: "amount", required: lendingOrDeposit, label: "Amount", question: "For what amount should I compare them?" },
    { key: "months", required: lendingOrDeposit, label: "Term", question: "Over what term?" },
    { key: "priority" },
  ],
  affordability: [
    { key: "amount", required: true, group: "target", label: "Amount to borrow", question: "How much would you borrow?", hint: "Or tell me the monthly payment you have in mind" },
    { key: "monthlyPayment", required: true, group: "target" },
    { key: "income", required: true }, { key: "obligations", required: true },
    { key: "months", label: "Repayment term" }, { key: "downPayment" },
  ],
  debt_refinancing: [
    { key: "debtBalance", required: true },
    { key: "obligations", required: true, label: "Monthly payments on these debts", question: "How much do you pay on them each month?" },
    { key: "rate" }, { key: "months", label: "Remaining term" }, { key: "debtGoal" },
  ],
  saving_goal: [
    { key: "amount", required: true, label: "Goal amount", question: "How much would you like to have saved?" },
    { key: "months", required: true, label: "Months until you need it", question: "When do you need the money?" },
    { key: "currentSavings" }, { key: "monthlySaving" },
  ],
  product_explanation: [],
  listing: [],
  fees_statements: [{ key: "feeKind", required: true }, { key: "amount", label: "Amount charged" }],
  life_event: [{ key: "event", required: true }, { key: "months", label: "Months until it happens" }, { key: "amount", label: "Expected cost" }],
  cash_shortfall: [
    { key: "amount", required: true, label: "Amount needed", question: "How much do you need?" },
    { key: "months", required: true, label: "How long you need it for", question: "For how many months?" },
    { key: "purpose" }, { key: "currentSavings" }, { key: "needBy" },
  ],
  security_complaint: [],
  negotiation: [
    { key: "productKind", required: true }, { key: "competitor", required: true },
    { key: "amount", required: true, label: "Amount", question: "What amount is the offer for?" },
    { key: "months", required: true, label: "Term", question: "Over what term?" },
    { key: "competitorRate" },
  ],
  expense_insights: [{ key: "period", default: "last_complete_month" }],
  professional_advice: [],
  human_contact: [],
  other: [],
};

// Amounts are lei unless the customer wrote euro; the currency travels with them to the model.
for (const spec of Object.values(INPUT_SPECS)) if (spec.some(e => SLOTS[e.key].kind === "amount")) spec.push({ key: "currency", default: "RON" });

const requiredKeys = (inquiry: Inquiry, v: Values) => INPUT_SPECS[inquiry]
  .filter(e => e.required === true || (typeof e.required === "function" && e.required(v))).map(e => e.key);

/** Whether two patterns need the same required inputs, so asking for them also settles which pattern applies. */
export function sharesRequiredInputs(a: Inquiry, b: Inquiry): boolean {
  const ka = requiredKeys(a, {}), kb = requiredKeys(b, {});
  return ka.length > 0 && ka.length === kb.length && ka.every(k => kb.includes(k));
}

// ── Reading figures from customer text (EN and RO) ────────────────────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  // "a"/"o" are left out so "2,000 lei a month" never reads as a one-month term.
  one: 1, un: 1, unu: 1, two: 2, doi: 2, "două": 2, doua: 2, three: 3, trei: 3, four: 4, patru: 4,
  five: 5, cinci: 5, six: 6, "șase": 6, sase: 6, seven: 7, "șapte": 7, sapte: 7, eight: 8, opt: 8, nine: 9, "nouă": 9,
  noua: 9, ten: 10, zece: 10, twelve: 12, "douăsprezece": 12,
};

/** "50.000", "50,000", "7 500" and "7.500,50" are grouped thousands; "7.5" and "1,5" are decimals. */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/\s(?=\d{3}\b)/g, "");
  const seps = [...s.matchAll(/[.,]/g)];
  if (!seps.length) return Number(s);
  const last = seps[seps.length - 1]!;
  const after = s.slice(last.index! + 1);
  const grouped = seps.every(m => /^\d{3}(?:\D|$)/.test(s.slice(m.index! + 1)));
  if (grouped && (seps.length > 1 || after.length === 3)) return Number(s.replace(/[.,]/g, ""));
  const n = Number(s.slice(0, last.index).replace(/[.,]/g, "") + "." + after);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?`;
const AMOUNT_RE = new RegExp(String.raw`(?<![\w.,])(${NUM})\s*(k|mii|mie|thousand|million|milioane|milion|m)?\b\s*(lei|ron|leu|eur|euro|euros|€)?`, "gi");
const DURATION_RE = new RegExp(String.raw`(?<![\w.,])(${NUM}|${Object.keys(WORD_NUMBERS).join("|")})\s*(?:de\s+)?(months?|luni|lun[aă]|years?|yrs?|ani|an)\b`, "gi");
const PERCENT_RE = new RegExp(String.raw`(?<![\w.,])(${NUM})\s*(%|percent|la sut[aă]|procente?)`, "gi");

const CUES: [Exclude<Cue, "none">, RegExp][] = [
  ["income", /\b(salary|salariu\w*|income|venit\w*|earn\w*|c[aâ]știg\w*|castig\w*|take[- ]home|leaf[aă]|net pay|i make)\b/i],
  ["obligation", /\b(already pay|i pay\b.*\b(loan|card|mortgage)|existing (loan|debt)s?|other (loan|debt)s?|obligations?|obliga[tț]ii|instal(l)?ments?|repayments?|rat[aă]|ratele|datorii|(on|for) (my|the|a) (\w+ )?(loan|card|mortgage|leasing)|pentru (credit|rata|card))\b/i],
  ["down_payment", /\b(down ?payment|upfront|avans\w*)\b/i],
  ["savings", /\b(saved|savings|economii|economisit|put aside|set aside|am str[aâ]ns)\b/i],
  ["balance", /\b(owe|datorez|balance|sold\w*|left to (pay|repay)|remaining|rest de plat[aă])\b/i],
  ["monthly", /\b(a month|per month|monthly|each month|every month|pe lun[aă]|lunar\w*)\b|\/\s*(month|lun[aă])/i],
];

/** Folds Romanian diacritics so word boundaries work: JavaScript's \b treats "ă" as a non-word character. */
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Months for each needBy choice: the deadline it names. "Not sure yet" is null, never a guess. */
export const NEED_BY_MONTHS: Record<keyof typeof SLOTS.needBy.options, number | null> = { now: 0, within_6_months: 6, within_a_year: 12, two_years_plus: 24, unsure: null };

/** Months until the customer needs the money, from a needBy value: a stated number of months or a choice. */
export function needByMonthsOf(value: InputValue | null | undefined): number | null {
  if (typeof value === "number") return value >= 0 && value <= 120 ? Math.round(value) : null;
  return typeof value === "string" && value in NEED_BY_MONTHS ? NEED_BY_MONTHS[value as keyof typeof NEED_BY_MONTHS] : null;
}

/** The replies offered when a recommendation waits on timing; each one reads back as a needBy choice. */
export const NEED_BY_REPLIES = ["I need it as soon as possible", "I need it within 6 months", "I need it within a year", "I can wait 2 years or more"];

// "in 7 months", "within 2 years", "peste 3 luni", "în 6 luni": a deadline, unless it's how long to repay over.
const NEED_BY_RE = new RegExp(String.raw`\b(?:in|within|peste|[iî]n|by)\s+(?:the next\s+|urm[aă]toarele\s+)?(${NUM}|${Object.keys(WORD_NUMBERS).join("|")})\s*(?:de\s+)?(months?|luni|lun[aă]|years?|ani|an)\b`, "gi");
const REPAY_BEFORE = /\b(repay\w*|pay (it |this |that )?(back|off)|return it|ramburs\w*|achit\w*|pl[aă]t\w*)\b[^.!?\n]{0,24}$/i;

function needByFrom(text: string): { months: number; span: [number, number] } | null {
  for (const m of text.matchAll(NEED_BY_RE)) {
    if (REPAY_BEFORE.test(text.slice(Math.max(0, m.index! - 40), m.index!))) continue;
    const n = WORD_NUMBERS[m[1]!.toLowerCase()] ?? parseNumber(m[1]!);
    if (n === null || n <= 0) continue;
    const months = Math.round(/^(y|a)/i.test(m[2]!) ? n * 12 : n);
    if (months <= 120) return { months, span: [m.index!, m.index! + m[0].length] };
  }
  return null;
}

export type Figure = { kind: "amount" | "months" | "percent"; value: number; cue: Cue; currency: "RON" | "EUR" | null; index: number };

function clauseAround(text: string, start: number, end: number) {
  const boundary = /[;!?\n]|[.,](?=\s)|\s(?:and|but|while|și|si|dar|iar)\s/gi;
  let from = 0, to = text.length;
  for (const m of text.matchAll(boundary)) {
    if (m.index! + m[0].length <= start) from = m.index! + m[0].length;
    else if (m.index! >= end) { to = m.index!; break; }
  }
  return { before: text.slice(Math.max(from, start - 48), start), after: text.slice(end, Math.min(to, end + 24)) };
}

function cueFor(text: string, start: number, end: number): Cue {
  const { before, after } = clauseAround(text, start, end);
  const around = `${before} # ${after}`;
  return CUES.find(([, re]) => re.test(around))?.[0] ?? "none";
}

/** Every amount, duration and percentage the customer wrote, with the nearby words that say what it is. */
export function readFigures(raw: string, options: { allowSmall?: boolean } = {}): Figure[] {
  const text = fold(raw);
  const taken: [number, number][] = [];
  const out: Figure[] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  for (const m of text.matchAll(PERCENT_RE)) {
    const value = parseNumber(m[1]!); if (value === null) continue;
    taken.push([m.index!, m.index! + m[0].length]);
    out.push({ kind: "percent", value, cue: "none", currency: null, index: m.index! });
  }
  for (const m of text.matchAll(DURATION_RE)) {
    if (overlaps(m.index!, m.index! + m[0].length)) continue;
    const n = WORD_NUMBERS[m[1]!.toLowerCase()] ?? parseNumber(m[1]!);
    if (n === null || n <= 0) continue;
    taken.push([m.index!, m.index! + m[0].length]);
    out.push({ kind: "months", value: Math.round(/^(y|a)/i.test(m[2]!) ? n * 12 : n), cue: "none", currency: null, index: m.index! });
  }
  for (const m of text.matchAll(AMOUNT_RE)) {
    const start = m.index!, end = start + m[0].length;
    if (overlaps(start, end)) continue;
    const base = parseNumber(m[1]!); if (base === null) continue;
    const scale = m[2]?.toLowerCase();
    const value = base * (!scale ? 1 : /^(k|mii|mie|thousand)$/.test(scale) ? 1_000 : 1_000_000);
    const currency = m[3] ? (/^(eur|euro|euros|€)$/i.test(m[3]) ? "EUR" : "RON") : null;
    // A bare four-digit year ("a 2016 BMW") or a small count is not money unless a currency or scale says so.
    if (!currency && !scale && ((value < 50 && !options.allowSmall) || /^(19|20)\d{2}$/.test(m[1]!))) continue;
    out.push({ kind: "amount", value, cue: cueFor(text, start, end), currency, index: start });
  }
  return out.sort((a, b) => a.index - b.index);
}

const NO_OBLIGATIONS = /\b(no (other )?(loans?|debts?|credits?|credit cards?)|nu am (alte )?(credite|datorii|rate|[iî]mprumuturi)|debt[- ]free|zero debts?|nothing else to pay)\b/i;
const COMPETITORS: [string, RegExp][] = [
  ["bt", /\b(bt|banca transilvania)\b/i], ["bcr", /\b(bcr|george)\b/i], ["ing", /\bing\b/i], ["brd", /\bbrd\b/i],
  ["cec", /\bcec\b/i], ["unicredit", /\bunicredit\b/i], ["otp", /\botp\b/i], ["garanti", /\bgaranti\b/i], ["libra", /\blibra\b/i],
];
const RAIFFEISEN = /\b(raiffeisen|your (bank|loan|card|offer|deposit|account|rate)|yours|voastr[aă]|vostru|dumneavoastr[aă])\b/i;

function choiceFrom(slot: ChoiceSlot, text: string): string | undefined {
  const hits = Object.entries(slot.options).filter(([, o]) => "match" in o && o.match?.test(text)).map(([k]) => k);
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Reads the inputs a pattern can use from one customer message. `pending` lists inputs Raiffy just asked for, so a bare
 * "7,500" fills the first of them that it can. Numbers are only ever copied from the customer's own text.
 */
export function extractInputs(inquiry: Inquiry, raw: string, pending: SlotKey[] = []): Values {
  const text = fold(raw);
  const spec = INPUT_SPECS[inquiry];
  const keys = [...new Set([...spec.map(e => e.key), ...pending])];
  const v: Values = {};
  for (const key of keys) {
    const slot: Slot = SLOTS[key];
    if (slot.kind === "choice") { const c = choiceFrom(slot, text); if (c) v[key] = c; }
    if (key === "options" || key === "competitor") {
      const banks = COMPETITORS.filter(([, re]) => re.test(text)).map(([b]) => b);
      if (key === "competitor") { if (banks.length) v[key] = banks; continue; }
      const kinds = Object.entries(SLOTS.productKind.options).filter(([, o]) => o.match.test(text)).map(([k]) => k);
      const named = banks.length ? [...(RAIFFEISEN.test(text) || banks.length === 1 ? ["raiffeisen"] : []), ...banks] : kinds;
      if (named.length >= 2) v[key] = [...new Set(named)];
    }
  }
  if (keys.includes("obligations") && NO_OBLIGATIONS.test(text)) v.obligations = 0;
  // An exact deadline beats a choice, and its words are blanked so the figure isn't read again as the term.
  let figureText = text;
  const deadline = keys.includes("needBy") ? needByFrom(text) : null;
  if (deadline) {
    v.needBy = deadline.months;
    figureText = text.slice(0, deadline.span[0]) + " ".repeat(deadline.span[1] - deadline.span[0]) + text.slice(deadline.span[1]);
  }

  // A reply to Raiffy's question may be just the numbers, so bare figures go to the inputs asked for first, in order.
  const figures = readFigures(figureText, { allowSmall: pending.length > 0 });
  const fits = (key: SlotKey, f: Figure, cues?: readonly Cue[]) => {
    const slot: Slot = SLOTS[key];
    if (f.kind === "months") return slot.kind === "months";
    if (f.kind === "percent") return slot.kind === "percent";
    if (slot.kind !== "amount" || f.value < slot.min || f.value > slot.max) return false;
    // Debt payments are often described only as "a month".
    const accepted: readonly Cue[] = cues ?? (key === "obligations" && inquiry === "debt_refinancing" ? [...slot.cues, "monthly"] : slot.cues);
    return accepted.includes(f.cue);
  };
  for (const f of figures) {
    const key = (f.cue === "none" ? pending.find(k => v[k] === undefined && fits(k, f, ["none"])) : undefined) ?? keys.find(k => v[k] === undefined && fits(k, f));
    if (key) { v[key] = f.value; if (f.currency === "EUR" && keys.includes("currency")) v.currency = "EUR"; }
  }
  return v;
}

// ── Resolving, gating and briefing ────────────────────────────────────────────────────────────────────────────────

export type InputSourcesMap = Partial<Record<Exclude<InputSource, "default">, Values>>;
const PRECEDENCE: Exclude<InputSource, "default">[] = ["form", "message", "conversation", "account", "memory"];

export const resolvedInputsSchema = z.object({
  inquiry: z.string(),
  known: z.record(z.string(), knownInputSchema),
  missingRequired: z.array(slotKeySchema),
  missingOptional: z.array(slotKeySchema),
  defaultsUsed: z.array(slotKeySchema),
});
export type ResolvedInputs = { inquiry: Inquiry; known: Partial<Record<SlotKey, KnownInput>>; missingRequired: SlotKey[]; missingOptional: SlotKey[]; defaultsUsed: SlotKey[] };

/** Fills each input from the most direct source available. Account data and memory fill inputs only when supplied. */
export function resolveInputs(inquiry: Inquiry, sources: InputSourcesMap): ResolvedInputs {
  const known: Partial<Record<SlotKey, KnownInput>> = {};
  const spec = INPUT_SPECS[inquiry];
  for (const { key } of spec) {
    for (const source of PRECEDENCE) {
      const value = sources[source]?.[key];
      if (value !== undefined && (source !== "account" && source !== "memory" || "fromAccount" in SLOTS[key])) { known[key] = { value, source }; break; }
    }
  }
  const values = Object.fromEntries(Object.entries(known).map(([k, x]) => [k, x!.value])) as Values;
  const required = requiredKeys(inquiry, values);
  const groupsMet = new Set(spec.filter(e => e.group && known[e.key]).map(e => e.group));
  const missingRequired = spec.filter(e => required.includes(e.key) && !known[e.key] && !(e.group && groupsMet.has(e.group)))
    // Alternatives are asked once, through the first of them.
    .filter((e, i, all) => !e.group || all.findIndex(x => x.group === e.group) === i).map(e => e.key);
  const defaultsUsed: SlotKey[] = [];
  for (const e of spec) if (!known[e.key] && e.default !== undefined) { known[e.key] = { value: e.default, source: "default" }; defaultsUsed.push(e.key); }
  const missingOptional = spec.filter(e => !required.includes(e.key) && !known[e.key]).map(e => e.key);
  return { inquiry, known, missingRequired, missingOptional, defaultsUsed };
}

export const pendingInputsSchema = z.object({ inquiry: z.string(), keys: z.array(slotKeySchema).min(1), round: z.number().int().positive() });
export type PendingInputs = { inquiry: Inquiry; keys: SlotKey[]; round: number };

export type InputGate = { action: "ask"; keys: SlotKey[]; round: number } | { action: "proceed"; examplesRequested: boolean; stillMissing: SlotKey[] };

/** Ask only for missing required inputs, a few at a time and for a bounded number of rounds; then answer with what is known. */
export function gateInputs(resolved: ResolvedInputs, pending: PendingInputs | null, policy: AgentPolicy, options: { skip?: boolean } = {}): InputGate {
  const missing = resolved.missingRequired;
  if (!missing.length || options.skip) return { action: "proceed", examplesRequested: !!options.skip && missing.length > 0, stillMissing: missing };
  const round = pending?.inquiry === resolved.inquiry ? pending.round + 1 : 1;
  if (round > policy.inputs.maxRounds) return { action: "proceed", examplesRequested: true, stillMissing: missing };
  return { action: "ask", keys: missing.slice(0, policy.inputs.maxFieldsPerRound), round };
}

const entryFor = (inquiry: Inquiry, key: SlotKey) => INPUT_SPECS[inquiry].find(e => e.key === key);

export const inputFieldSchema = z.object({
  key: slotKeySchema, label: z.string(), question: z.string(), hint: z.string().optional(),
  kind: z.enum(["amount", "months", "percent", "choice", "options"]), unit: z.enum(["RON", "months", "%"]).optional(),
  min: z.number().optional(), max: z.number().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});
export type InputField = z.infer<typeof inputFieldSchema>;

/** What the chat form shows for each requested input. */
export function inputFields(inquiry: Inquiry, keys: SlotKey[]): InputField[] {
  return keys.map(key => {
    const slot: Slot = SLOTS[key]; const e = entryFor(inquiry, key);
    const hint = e?.hint ?? slot.hint;
    return inputFieldSchema.parse({
      key, label: e?.label ?? slot.label, question: e?.question ?? slot.question, ...(hint ? { hint } : {}), kind: slot.kind,
      unit: slot.kind === "amount" ? "RON" : slot.kind === "months" ? "months" : slot.kind === "percent" ? "%" : undefined,
      ...("min" in slot ? { min: slot.min, max: slot.max } : {}),
      options: slot.kind === "choice" ? Object.entries(slot.options).map(([value, o]) => ({ value, label: o.label })) : undefined,
    });
  });
}

/** Validates values submitted from the chat form against the inputs Raiffy asked for. Unknown keys are dropped. */
export function validateFormValues(asked: SlotKey[], raw: Record<string, unknown>): Values {
  const out: Values = {};
  for (const key of asked) {
    const value = raw[key]; if (value === undefined || value === "") continue;
    const slot: Slot = SLOTS[key];
    const parsed = slot.kind === "choice" ? z.enum(Object.keys(slot.options) as [string, ...string[]]).safeParse(value)
      : slot.kind === "options" ? z.array(z.string().min(1).max(40)).min(slot.minCount).max(4).safeParse(value)
      : z.coerce.number().min(slot.min).max(slot.max).safeParse(value);
    if (parsed.success) out[key] = slot.kind === "months" ? Math.round(parsed.data as number) : parsed.data;
  }
  return out;
}

export const inputsBriefSchema = z.object({
  pattern: z.string(),
  required: z.array(z.object({ key: z.string(), label: z.string(), value: inputValueSchema.nullable(), source: z.string().nullable() })),
  optional: z.array(z.object({ key: z.string(), label: z.string(), value: inputValueSchema.nullable(), source: z.string().nullable() })),
  defaultsUsed: z.array(z.string()),
  examplesRequested: z.boolean(),
});
export type InputsBrief = z.infer<typeof inputsBriefSchema>;

/** The structured inputs block the answer model receives: every input, its value or null, and where it came from. */
export function buildInputsBrief(resolved: ResolvedInputs, examplesRequested: boolean): InputsBrief {
  const spec = INPUT_SPECS[resolved.inquiry];
  const values = Object.fromEntries(Object.entries(resolved.known).map(([k, x]) => [k, x!.value])) as Values;
  const required = requiredKeys(resolved.inquiry, values);
  const row = (e: Entry) => ({ key: e.key, label: e.label ?? SLOTS[e.key].label, value: resolved.known[e.key]?.value ?? null, source: resolved.known[e.key]?.source ?? null });
  return inputsBriefSchema.parse({
    pattern: resolved.inquiry,
    required: spec.filter(e => required.includes(e.key)).map(row),
    optional: spec.filter(e => !required.includes(e.key)).map(row),
    defaultsUsed: resolved.defaultsUsed, examplesRequested,
  });
}

/** The numbers the customer supplied, so the output check can tell them apart from unsupported bank figures. */
export function customerFigures(resolved: ResolvedInputs): number[] {
  return Object.values(resolved.known).flatMap(x => x && x.source !== "default" && typeof x.value === "number" ? [x.value] : []);
}

/**
 * What the answer check may accept as the customer's own numbers: stated amounts, terms and payments (never rates or
 * percentages, never defaults), plus the short form the customer actually wrote ("50" in "50k", "1.5" in "1.5m").
 */
export function customerAllowedFigures(question: string, resolved: ResolvedInputs): string[] {
  const figures = Object.entries(resolved.known).flatMap(([key, x]) =>
    x && x.source !== "default" && typeof x.value === "number" && SLOTS[key as SlotKey].kind !== "percent" ? [x.value] : []);
  const short = [...fold(question).matchAll(/(\d+(?:[.,]\d+)?)\s*(k|mii|m|mil|milioane)\b/gi)].flatMap(([, n, unit]) => {
    const value = Number(n!.replace(",", ".")) * (/^k|^mii/i.test(unit!) ? 1_000 : 1_000_000);
    return figures.includes(value) ? [n!] : [];
  });
  return [...new Set([...figures.map(String), ...short])];
}

/** Inputs Jev or the fallback model may still settle: missing required choices that keywords did not catch. */
export function openChoiceSlots(resolved: ResolvedInputs): { key: SlotKey; options: Record<string, string> }[] {
  return resolved.missingRequired.flatMap(key => {
    const slot: Slot = SLOTS[key];
    return slot.kind === "choice" ? [{ key, options: Object.fromEntries(Object.entries(slot.options).map(([k, o]) => [k, o.label])) }] : [];
  });
}

import { type Persona, personaSchema, type Transaction } from "./schemas";

/*
 * Deterministic sample statements for a synthetic persona: the same persona and month always give the same
 * transactions, so answers and tests are reproducible. Months are counted back from today's month (0 = this month).
 */

/** A small seeded generator (mulberry32), so splits look natural but never change between runs. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return t / 4294967296;
  };
}

/** The first day of the month `monthsAgo` before `today`'s month, as YYYY-MM. */
export function monthOf(today: string, monthsAgo: number): string {
  const [y = 0, m = 1] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsAgo, 1));
  return d.toISOString().slice(0, 7);
}
const day = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;

/** Splits a monthly amount into n payments that add up to it exactly. */
function split(total: number, n: number, rand: () => number): number[] {
  const weights = Array.from({ length: n }, () => 0.5 + rand());
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  parts[0]! += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

const SPENDING_LABELS: Partial<Record<string, string>> = {
  groceries: "Supermarket", dining: "Restaurant", transport: "Fuel and transport", shopping: "Shop", health: "Pharmacy",
  entertainment: "Cinema and events", travel: "Travel", housing: "Home", utilities: "Utilities",
};

/** One complete month of transactions. Months not yet complete are not generated past today. */
export function monthTransactions(raw: Persona, today: string, monthsAgo: number): Transaction[] {
  const p = personaSchema.parse(raw);
  const month = monthOf(today, monthsAgo);
  const rand = rng(`${p.id}:${month}`);
  const out: Transaction[] = [];
  const add = (t: Omit<Transaction, "id">) => out.push({ ...t, id: `${p.id}:${month}:${out.length}` });

  if (p.monthlyIncome) add({ date: day(month, 10), amount: p.monthlyIncome, kind: "transfer_in", category: "salary", label: "Salary" });
  for (const loan of p.loans) add({ date: day(month, 15), amount: -loan.monthly, kind: "loan_payment", category: "debt", label: loan.label });
  for (const r of p.recurring) {
    if (r.startedMonthsAgo !== undefined && monthsAgo > r.startedMonthsAgo) continue;
    const amount = r.priceChange && monthsAgo > r.priceChange.monthsAgo ? r.priceChange.from : r.amount;
    add({ date: day(month, r.day), amount: -amount, kind: r.kind, category: r.category, label: r.label, recurringKey: r.key });
  }
  for (const [category, total] of Object.entries(p.monthlySpending)) {
    if (!total) continue;
    const parts = split(total, 2 + Math.floor(rand() * 4), rand);
    parts.forEach((amount, i) => add({ date: day(month, 1 + Math.floor(((i + rand()) / parts.length) * 27)), amount: -amount, kind: "card_payment",
      category: category as Transaction["category"], label: SPENDING_LABELS[category] ?? "Card payment" }));
  }
  for (let i = 0; i < p.atm.ownPerMonth + p.atm.otherPerMonth; i++) {
    const own = i < p.atm.ownPerMonth;
    const date = day(month, 3 + Math.floor(rand() * 24));
    add({ date, amount: -p.atm.amount, kind: "atm_withdrawal", category: "cash", label: own ? "Raiffeisen ATM" : "Another bank's ATM", ownAtm: own });
    if (!own && p.atm.otherFee) add({ date, amount: -p.atm.otherFee, kind: "fee", category: "fees", label: "ATM withdrawal fee" });
  }
  for (const f of p.foreignSpending.filter((x) => x.monthsAgo === monthsAgo)) {
    split(f.amount, f.payments, rand).forEach((amount) => add({ date: day(month, 14 + Math.floor(rand() * 4)), amount: -amount, kind: "card_payment",
      category: "travel", label: "Card payment in euros", fxFee: Math.round((amount * f.fxFeeBps) / 10_000) }));
  }
  const fxFees = out.reduce((s, t) => s + (t.fxFee ?? 0), 0);
  if (fxFees) add({ date: day(month, 20), amount: -fxFees, kind: "fee", category: "fees", label: "Currency conversion" });
  if (p.overdraft?.used) add({ date: day(month, 28), amount: -Math.round((p.overdraft.used * p.overdraft.rateBps) / 10_000 / 12), kind: "interest", category: "fees", label: "Overdraft interest" });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The last `months` complete months, oldest first. */
export function history(persona: Persona, today: string, months: number): Transaction[] {
  return Array.from({ length: months }, (_, i) => monthTransactions(persona, today, months - i)).flat();
}

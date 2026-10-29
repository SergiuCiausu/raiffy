import { type Persona, personaSchema } from "../expenses/schemas";
import { type HoldingsInput, holdingsSchema } from "./schemas";

/**
 * A sample customer whose balances, overdraft and Raiffeisen loan payments come from their holdings, so the generated
 * statements (lib/expenses/synthetic.ts) and get_holdings can never disagree. `loans` in the base lists only debts at
 * other banks or card repayments; Raiffeisen loans are added from the holdings.
 */
export function withHoldings(base: Omit<Persona, "balances" | "overdraft" | "holdings">, input: HoldingsInput): Persona {
  const h = holdingsSchema.parse(input);
  const total = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  const od = h.currentAccounts.find((a) => a.overdraft)?.overdraft;
  return personaSchema.parse({
    ...base,
    balances: { current: total(h.currentAccounts, (a) => a.balance), savings: total(h.savingsAccounts, (s) => s.balance), deposits: total(h.deposits, (d) => d.amount) },
    ...(od ? { overdraft: { limit: od.limit, used: od.used, rateBps: od.rateBps } } : {}),
    loans: [...h.loans.map((l) => ({ label: l.name, monthly: l.monthly })), ...base.loans],
    holdings: h,
  });
}

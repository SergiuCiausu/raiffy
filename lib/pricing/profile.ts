import type { AccessSwitches, Persona } from "../expenses/schemas";
import { type ClientProfile, clientProfileSchema } from "./schemas";

/*
 * The client profile pricing reads, built only from what "What Raiffy can see" allows: the account switch gives the
 * relationship (salary, products, risk view, income, debts), the savings switch gives deposits. Without the account
 * switch there is no profile: list prices only, and the answer says the price could be better.
 */
export function profileFrom(persona: Persona | null, switches: AccessSwitches, productId?: string): ClientProfile | null {
  if (!persona?.relationship || !switches.account) return null;
  const unknown = switches.savings ? [] : (["savings"] as const);
  return clientProfileSchema.parse({
    salaryDomiciled: persona.relationship.salaryDomiciled,
    monthlyIncome: persona.monthlyIncome,
    deposits: switches.savings ? persona.balances.savings + persona.balances.deposits : 0,
    products: persona.relationship.products,
    ...(persona.relationship.riskBand ? { riskBand: persona.relationship.riskBand } : {}),
    // A loan this product would refinance is replaced, not added to
    obligations: persona.loans.filter((l) => !productId || l.replacedBy !== productId).reduce((s, l) => s + l.monthly, 0),
    unknown,
  });
}

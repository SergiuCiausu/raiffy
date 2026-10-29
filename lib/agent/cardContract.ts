import type { Inquiry } from "./confidence";

/*
 * The card each answer pattern is expected to show (raiffy-spec/docs/individuals/answer-patterns.md), in one place for
 * the backend, the seeded chats and the tests. Any one of the listed kinds meets the contract. The answer scope adds the
 * shape it calls for (CLAUDE.md, answer scope): compare → a comparison table, solution → routes, detail → key facts or a
 * checklist. A pattern with no kinds answers in text (a listing renders as a list; a complaint offers a specialist).
 *
 *   compare                      → comparison table (the catalog's compare_table, or Claude's comparison card)
 *   negotiation                  → the price card
 *   solution patterns            → routes, or a repayment simulation when amount and term are known
 *   affordability                → the affordability check, or a simulation
 *   detail (explanation, fees)   → key facts, or a checklist for documents and steps
 *   spending                     → the spending card
 */

export type CardKind = "comparison" | "compare_table" | "routes" | "simulation" | "keyFacts" | "checklist" | "handoff"
  | "offer" | "spending" | "affordability";

export const EXPECTED_CARDS: Record<Inquiry, readonly CardKind[]> = {
  product_comparison: ["compare_table", "comparison"],
  negotiation: ["offer"],
  purchase_goal: ["routes", "simulation"],
  cash_shortfall: ["routes", "simulation"],
  debt_refinancing: ["routes", "simulation"],
  life_event: ["routes", "checklist", "keyFacts"],
  saving_goal: ["routes", "keyFacts", "checklist"],
  affordability: ["affordability", "simulation"],
  product_explanation: ["keyFacts", "checklist"],
  fees_statements: ["keyFacts", "checklist"],
  expense_insights: ["spending"],
  listing: [],
  security_complaint: [],
  professional_advice: [],
  human_contact: [],
  other: [],
};

export type Scope = "compare" | "solution" | "detail" | "list" | null;
const BY_SCOPE: Record<NonNullable<Scope>, readonly CardKind[]> = {
  compare: ["compare_table", "comparison"], solution: ["routes"], detail: ["keyFacts", "checklist"], list: [],
};

/** The card kinds an answer of this pattern and scope should show; empty when text is enough. */
export function expectedCards(inquiry: Inquiry | null, scope: Scope = null): readonly CardKind[] {
  const own = inquiry ? EXPECTED_CARDS[inquiry] : [];
  if (!own.length) return own;
  return [...new Set([...own, ...(scope ? BY_SCOPE[scope] : [])])];
}

/** Whether the shown blocks meet the contract. Blocks without a card type (callouts, memory) don't count. */
export function meetsCardContract(inquiry: Inquiry | null, shown: readonly unknown[], scope: Scope = null): boolean {
  const kinds = expectedCards(inquiry, scope);
  if (!kinds.length) return true;
  return shown.some((b) => kinds.includes((b as { type?: unknown })?.type as CardKind));
}

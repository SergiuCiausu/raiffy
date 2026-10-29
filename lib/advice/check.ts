import type { RecommendationResult, Route } from "./schemas";

/*
 * Checks on the model's final text for a solution answer, next to the number check (lib/rag/numbers.ts): the text
 * frames the rule's recommendation and must not overrule it. A sentence that recommends counts only when it is
 * unconditional, so "saving first is the better pick if it can wait" is fine and "I'd go with the 48-month loan" is
 * not. Pattern-based, like the privacy screen: it catches the plain cases, not every phrasing.
 */

export const ANSWER_ISSUES = ["other_route_recommended", "recommends_without_pick", "claims_eligibility", "claims_offer"] as const;
export type AnswerIssue = (typeof ANSWER_ISSUES)[number];

const RECOMMENDS = /\b(?:i(?:'d| would)? (?:recommend|suggest|go (?:with|for))|my (?:recommendation|pick)|(?:the )?best (?:option|choice|route|fit) (?:is|for you)|you should (?:take|choose|pick|go (?:with|for))|raiffy recommends|i recommend)\b/i;
const CONDITIONAL = /\b(?:if|unless|when|once|in case)\b/i;
const NEGATED = /\b(?:not|n't|cannot|can't|whether|never|no)\b/i;
const ELIGIBLE = /\byou(?:'re|'ll| are| will| would)?(?: be)? (?:eligible|approved|pre-approved|qualif(?:y|ied))\b|\bguaranteed (?:approval|to be approved)\b/i;
const OFFER = /\b(?:this is (?:an|your) offer|(?:a |your )?binding offer|offer (?:made )?for you)\b/i;

/** Words that point at one route in the text: its term in months, or its kind. */
function mentions(r: Route): RegExp {
  switch (r.kind) {
    case "loan": return new RegExp(`\\b${r.repaymentMonths}[- ]?months?\\b`, "i");
    case "overdraft": return /\boverdraft\b/i;
    case "save_then_borrow": return /\bsav(?:e|ing)(?: up)?(?: [a-z]+){0,3} first\b|\bsave first\b/i;
    case "save_only": return /\bsav(?:e|ing) the whole\b|\bwithout borrowing\b|\bjust sav(?:e|ing)\b/i;
  }
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

export function checkAdviceAnswer(text: string, routes: readonly Route[], rec: RecommendationResult): AnswerIssue[] {
  const issues = new Set<AnswerIssue>();
  const pick = routes.find((r) => r.key === rec.pick);
  for (const s of sentences(text)) {
    if (ELIGIBLE.test(s) && !NEGATED.test(s)) issues.add("claims_eligibility");
    if (OFFER.test(s) && !NEGATED.test(s)) issues.add("claims_offer");
    if (!RECOMMENDS.test(s) || CONDITIONAL.test(s) || NEGATED.test(s)) continue;
    if (rec.status !== "ok" || !pick) { issues.add("recommends_without_pick"); continue; }
    const named = routes.filter((r) => r.status === "ok" && mentions(r).test(s));
    if (named.length && !named.includes(pick)) issues.add("other_route_recommended");
  }
  return ANSWER_ISSUES.filter((i) => issues.has(i));
}

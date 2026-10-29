import { z } from "zod";
import type { AgentPolicy } from "./config";
import { INQUIRIES } from "./jev";

export type Inquiry = keyof typeof INQUIRIES;
const inquiryKeys = Object.keys(INQUIRIES) as [Inquiry, ...Inquiry[]];
export const inquirySchema = z.enum(inquiryKeys);

/** Labels that describe the same kind of need. A split inside a family gets a targeted question, not the generic one. */
export const INQUIRY_FAMILIES = {
  borrowing: ["purchase_goal", "affordability", "cash_shortfall", "debt_refinancing"],
  planning: ["saving_goal", "life_event", "expense_insights"],
  pricing: ["product_comparison", "negotiation"],
  explaining: ["product_explanation", "fees_statements", "listing"],
  support: ["security_complaint"],
  referral: ["professional_advice"],
  other: ["other"],
} as const satisfies Record<string, readonly Inquiry[]>;
export type InquiryFamily = keyof typeof INQUIRY_FAMILIES;

export function familyOf(inquiry: Inquiry): InquiryFamily {
  return (Object.keys(INQUIRY_FAMILIES) as InquiryFamily[]).find(f => (INQUIRY_FAMILIES[f] as readonly Inquiry[]).includes(inquiry))!;
}

/** The answer scope a pattern implies when Jev is unsure about scope. Named options still mean compare. */
export function defaultScope(inquiry: Inquiry, namesOptions = false): "compare" | "solution" | "detail" | "list" {
  if (namesOptions || inquiry === "product_comparison" || inquiry === "negotiation") return "compare";
  if (inquiry === "listing") return "list";
  if (inquiry === "product_explanation" || inquiry === "fees_statements" || inquiry === "expense_insights") return "detail";
  return "solution";
}

const inquiryAnswerSchema = z.object({ choice: inquirySchema, confidence: z.number(), probabilities: z.record(z.string(), z.number()) });

export const inquiryDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("route"), inquiry: inquirySchema, basis: z.enum(["confidence", "margin", "shared_inputs"]) }),
  /** Two labels are close: ask which one the customer meant, after the Haiku fallback has had a chance to decide. */
  z.object({ kind: z.literal("candidates"), candidates: z.array(inquirySchema).min(2).max(3) }),
  z.object({ kind: z.literal("unclear"), candidates: z.array(inquirySchema).max(3) }),
]);
export type InquiryDecision = z.infer<typeof inquiryDecisionSchema>;

/**
 * Decides whether Jev's inquiry distribution is good enough to pick an answer pattern.
 * `sharedInputs` reports whether two labels need the same required inputs, so asking for those inputs settles the pattern.
 */
export function decideInquiry(raw: z.input<typeof inquiryAnswerSchema>, policy: AgentPolicy, sharedInputs: (a: Inquiry, b: Inquiry) => boolean = () => false): InquiryDecision {
  const answer = inquiryAnswerSchema.parse(raw);
  const ranked = inquiryKeys.map(label => ({ label, p: answer.probabilities[label] ?? 0 })).sort((a, b) => b.p - a.p);
  const [first, second, third] = ranked as [typeof ranked[0], typeof ranked[0], typeof ranked[0]];
  const t = policy.thresholds;
  const floor = t.perInquiry[first.label] ?? t.routingConfidence;
  if (answer.confidence >= floor) return { kind: "route", inquiry: first.label, basis: "confidence" };
  if (first.p - second.p >= t.routingMargin) return { kind: "route", inquiry: first.label, basis: "margin" };
  // "other" is never one of two candidates: a customer can't pick "none of these" from a chip.
  const real = ranked.filter(r => r.label !== "other");
  const [a, b] = real as [typeof ranked[0], typeof ranked[0]];
  if (a.p + b.p >= t.candidatePair) {
    if (sharedInputs(a.label, b.label)) return { kind: "route", inquiry: a.label, basis: "shared_inputs" };
    const close = third && third.label !== "other" && third.p >= b.p / 2 && familyOf(third.label) === familyOf(a.label);
    return { kind: "candidates", candidates: close ? [a.label, b.label, third.label] : [a.label, b.label] };
  }
  return { kind: "unclear", candidates: real.slice(0, 3).filter(r => r.p > 0.1).map(r => r.label) };
}

/*
 * Clear banking requests, EN and RO (diacritics folded). Used only when Jev calls a message "other": the request then
 * gets candidate patterns (Haiku fallback, then chips) instead of the generic question. More specific needs come first.
 */
const INTENT_HINTS: [RegExp, Inquiry[]][] = [
  // Asking for a person, in English or Romanian: a verb of meeting or talking next to a person or an appointment
  [/\b(book|schedule|arrange)\b.{0,30}\b(meeting|appointment|call)\b|\b(talk|speak|meet|chat)\b.{0,20}\b(to|with)\b.{0,20}\b(a person|a human|someone|somebody|an? advis[eo]r|an? specialist|an? consultant|an? agent|a real person|staff)\b|\b(programare|programez)\b|\b(vorbesc|vorbi|discut|intalnire)\b.{0,25}\b(cu|un|o)\b.{0,20}\b(cineva|consilier\w*|consultant\w*|specialist\w*|om|persoana|angajat\w*)\b/,
    ["human_contact"]],
  [/\b(refinanc\w*|refinant\w*|consolid\w*)/, ["debt_refinancing"]],
  [/\b(fees?|charged?|comision\w*|taxa|taxe)\b/, ["fees_statements"]],
  [/\b(credit\w*|loans?|borrow\w*|imprumut\w*|finantare|financing|finance|mortgage|ipotec\w*|leasing|overdraft|descoperit)\b/,
    ["purchase_goal", "affordability", "cash_shortfall"]],
  [/\b(sav(e|es|ing|ings)|econom\w*|depozit\w*|deposits?)\b/, ["saving_goal", "product_explanation"]],
  [/\b(list\w*|what (types|kinds)|which (products|accounts|cards|documents|options)|ce (tipuri|acte|documente|produse|conturi|carduri))\b/,
    ["listing", "product_explanation"]],
];

/** Patterns a message clearly asks about, in order, or none. Pure keyword reading; Jev still decides first. */
export function bankingIntent(raw: string): Inquiry[] {
  const text = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return [...new Set(INTENT_HINTS.filter(([re]) => re.test(text)).flatMap(([, labels]) => labels))];
}

/** Jev's top candidate labels, for the Haiku fallback and the clarify chips. */
export function topInquiries(probabilities: Record<string, number>, n = 3): Inquiry[] {
  return inquiryKeys.filter(l => l !== "other").sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0)).slice(0, n);
}

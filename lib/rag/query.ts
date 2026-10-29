import { foldDiacritics, MAX_SEARCH_TERMS, queryTerms, tokenize } from "./normalize";
import type { DocType, SearchFocus, SectionType } from "./schemas";
import type { Bank } from "./schemas";

export function namedBanks(question: string): Bank[] {
  const tokens = tokenize(question);
  return (["raiffeisen", "ing", "bcr"] as const).filter(bank => tokens.includes(bank));
}

/**
 * English banking terms -> the folded Romanian words the website uses, for the keyword leg of hybrid search.
 * The POC answers in English, so most questions arrive in English while the indexed pages are Romanian.
 * Longer phrases come first so "credit card" wins over "card".
 */
const EN_TO_RO: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["annual percentage rate", ["dae"]],
  ["representative example", ["exemplu", "reprezentativ"]],
  ["monthly installment", ["rata", "lunara"]],
  ["monthly instalment", ["rata", "lunara"]],
  ["monthly payment", ["rata", "lunara"]],
  ["total payable", ["total", "plata"]],
  ["total amount payable", ["total", "plata"]],
  ["term deposit", ["depozit", "termen"]],
  ["savings account", ["cont", "economii"]],
  ["current account", ["cont", "curent"]],
  ["credit card", ["card", "credit"]],
  ["debit card", ["card", "debit"]],
  ["shopping card", ["card", "cumparaturi"]],
  ["personal loan", ["credit", "nevoi", "personale"]],
  ["home loan", ["credit", "imobiliar", "ipotecar"]],
  ["mortgage", ["credit", "imobiliar", "ipotecar"]],
  ["refinancing", ["refinantare"]],
  ["refinance", ["refinantare"]],
  ["early repayment", ["rambursare", "anticipata"]],
  ["repay early", ["rambursare", "anticipata"]],
  ["required documents", ["documente", "necesare"]],
  ["cash withdrawal", ["retragere", "numerar"]],
  ["withdraw cash", ["retragere", "numerar"]],
  ["exchange rate", ["curs", "schimb"]],
  ["government bonds", ["titluri", "stat"]],
  ["state bonds", ["titluri", "stat"]],
  ["life insurance", ["asigurare", "viata"]],
  ["travel insurance", ["asigurare", "calatorie"]],
  ["home insurance", ["asigurare", "locuinta"]],
  ["line of credit", ["linie", "credit"]],
  ["credit line", ["linie", "credit"]],
  ["working capital", ["capital", "lucru"]],
  ["investment loan", ["credit", "investitii"]],
  ["liberal professions", ["profesii", "liberale"]],
  ["fee schedule", ["tarife", "comisioane"]],
  ["administration", ["administrare"]],
  ["analysis", ["analiza"]],
  ["opening", ["deschidere"]],
  ["maximum", ["maxim", "maxima"]],
  // Words the English retrieval misses showed the pages put another way (2026-10-29 local eval)
  ["interest-free", ["fara", "dobanda"]],
  ["grace period", ["perioada", "gratie"]],
  ["how much can i borrow", ["suma", "maxima", "credit"]],
  ["borrow", ["imprumut", "suma", "credit"]],
  ["repay", ["rambursare"]],
  ["issue", ["emitere"]],
  ["issuing", ["emitere"]],
  ["minimum", ["minim", "minima"]],
  ["without", ["fara"]],
  ["fixed", ["fixa", "fix"]],
  ["variable", ["variabila"]],
  ["interest", ["dobanda", "dobanzi"]],
  ["rate", ["dobanda"]],
  ["apr", ["dae"]],
  ["fee", ["comision", "comisioane"]],
  ["fees", ["comision", "comisioane"]],
  ["commission", ["comision"]],
  ["commissions", ["comisioane"]],
  ["charge", ["comision", "taxa"]],
  ["charges", ["comisioane", "taxe"]],
  ["cost", ["cost", "costuri"]],
  ["costs", ["costuri"]],
  ["price", ["pret", "tarif"]],
  ["account", ["cont"]],
  ["accounts", ["conturi"]],
  ["deposit", ["depozit"]],
  ["deposits", ["depozite"]],
  ["savings", ["economii"]],
  ["loan", ["credit"]],
  ["loans", ["credite"]],
  ["card", ["card"]],
  ["cards", ["carduri"]],
  ["insurance", ["asigurare"]],
  ["documents", ["documente", "acte"]],
  ["papers", ["documente", "acte"]],
  ["age", ["varsta"]],
  ["income", ["venit"]],
  ["salary", ["salariu"]],
  ["eligibility", ["eligibilitate", "conditii"]],
  ["eligible", ["eligibilitate", "conditii"]],
  ["conditions", ["conditii"]],
  ["requirements", ["conditii"]],
  ["withdrawal", ["retragere"]],
  ["transfer", ["transfer"]],
  ["payment", ["plata"]],
  ["payments", ["plati"]],
  ["installments", ["rate"]],
  ["instalments", ["rate"]],
  ["months", ["luni"]],
  ["month", ["luna"]],
  ["years", ["ani"]],
  ["business", ["firma", "imm"]],
  ["company", ["firma", "companie"]],
  ["package", ["pachet"]],
  ["abroad", ["strainatate"]],
  ["child", ["copii", "junior"]],
  ["children", ["copii", "junior"]],
  ["teenager", ["adolescenti"]],
  ["student", ["student"]],
  ["pension", ["pensie"]],
  ["guarantee", ["garantie", "garantat"]],
  ["guaranteed", ["garantat"]],
  ["investment", ["investitii"]],
  ["investments", ["investitii"]],
  ["fund", ["fond"]],
  ["funds", ["fonduri"]],
  ["overdraft", ["overdraft", "descoperit"]],
  ["leasing", ["leasing"]],
  ["factoring", ["factoring"]],
];

type Intent = "cost" | "interest" | "documents" | "eligibility" | "example";

const INTENT_TERMS: Record<Intent, readonly string[]> = {
  cost: ["fee", "fees", "commission", "commissions", "charge", "charged", "charges", "cost", "costs", "price",
    "comision", "comisioane", "comisionul", "taxa", "taxe", "tarif", "tarife", "costa", "costuri", "pret"],
  interest: ["interest", "rate", "apr", "dae", "dobanda", "dobanzi", "dobanzii", "dobanzile", "randament"],
  documents: ["documents", "document", "papers", "acte", "actele", "documente", "documentele"],
  eligibility: ["eligible", "eligibility", "age", "income", "conditions", "requirements", "qualify", "varsta",
    "venit", "conditii", "conditiile", "eligibilitate", "eligibil"],
  example: ["example", "representative", "exemplu", "reprezentativ", "installment", "instalment", "rata"],
};

const INTENT_SECTIONS: Record<Intent, readonly SectionType[]> = {
  cost: ["fees", "fee_table", "interest_rates", "pdf"],
  interest: ["interest_rates", "rate_table", "representative_example", "fee_table", "table"],
  documents: ["required_documents"],
  eligibility: ["eligibility"],
  example: ["representative_example"],
};

export type QueryPlan = {
  banks?: Bank[];
  /** Folded terms for the keyword leg: the question's own words, then English->Romanian expansions. */
  lexicalTerms: string[];
  intents: Intent[];
  /** Soft ranking preference, never a filter: a wrong guess must not hide the right chunk. */
  preferredSections: SectionType[];
  preferredDocType?: DocType;
};

function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

export function planQuery(question: string, maxTerms: number = MAX_SEARCH_TERMS): QueryPlan {
  const tokens = tokenize(question);
  const own = queryTerms(question, maxTerms);
  const expansions: string[] = [];
  const consumed = new Set<string>();
  for (const [phrase, romanian] of EN_TO_RO) {
    const words = foldDiacritics(phrase).split(" ");
    if (words.some((w) => consumed.has(w)) && words.length === 1) continue;
    if (!containsPhrase(tokens, words)) continue;
    words.forEach((w) => consumed.add(w));
    for (const term of romanian) if (!own.includes(term) && !expansions.includes(term)) expansions.push(term);
  }
  const english = tokens.some(t => ["what", "how", "which", "does", "is", "are"].includes(t));
  const banks = namedBanks(question);
  // Keep untranslated names and numbers before expansion; long English queries must not lose the product.
  const specific = own.filter(term => !consumed.has(term));
  const lexicalTerms = [...new Set(english ? [...specific, ...expansions, ...own] : [...own, ...expansions])].slice(0, maxTerms);

  const intents = (Object.keys(INTENT_TERMS) as Intent[]).filter((intent) =>
    INTENT_TERMS[intent].some((term) => tokens.includes(term)),
  );
  const preferredSections = [...new Set(intents.flatMap((intent) => INTENT_SECTIONS[intent]))];
  return {
    ...(banks.length ? { banks } : {}),
    lexicalTerms,
    intents,
    preferredSections,
    ...(intents.includes("cost") ? { preferredDocType: "tarife" as const } : {}),
  };
}

const FOCUS_INTENT: Record<Exclude<SearchFocus, "any">, Intent> = {
  costs: "cost",
  interest_rates: "interest",
  eligibility: "eligibility",
  documents: "documents",
  representative_example: "example",
};

/** Add the focus the agent asked for to the intents detected from the query text. */
export function withFocus(plan: QueryPlan, focus: SearchFocus): QueryPlan {
  if (focus === "any") return plan;
  const intent = FOCUS_INTENT[focus];
  if (plan.intents.includes(intent)) return plan;
  const preferredSections = [...new Set([...plan.preferredSections, ...INTENT_SECTIONS[intent]])];
  return {
    ...plan,
    intents: [...plan.intents, intent],
    preferredSections,
    ...(intent === "cost" ? { preferredDocType: "tarife" as const } : {}),
  };
}

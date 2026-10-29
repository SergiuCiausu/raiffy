// Grouped thousands ("50.000", "1,000,000", "6.152,52") first, then plain numbers ("4.70", "961,21", "15").
const NUMBER = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
// A list marker at the start of a line ("1. ", "2) ") is structure, not a fact.
const LIST_MARKER = /^\s*\d+[.)]\s/gm;

/** Numeric tokens in the order they appear, list markers excluded. */
export function numberTokens(text: string): string[] {
  return text.replace(LIST_MARKER, " ").match(NUMBER) ?? [];
}

function canonical(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * Every value a token can stand for. Romanian pages write "50.000" and "961,21", English answers write
 * "50,000" and "961.21", so a single separator followed by exactly three digits is read both ways.
 */
export function numericValues(token: string): string[] {
  const separators = token.match(/[.,]/g) ?? [];
  if (separators.length === 0) return [canonical(Number(token))];
  const unique = new Set(separators);
  if (unique.size > 1) {
    const decimal = token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    return [canonical(Number(token.split(thousands).join("").replace(decimal, ".")))];
  }
  const separator = separators[0]!;
  if (separators.length > 1) return [canonical(Number(token.split(separator).join("")))];
  const [whole, fraction = ""] = token.split(separator);
  const asDecimal = canonical(Number(`${whole}.${fraction}`));
  if (fraction.length !== 3) return [asDecimal];
  return [...new Set([canonical(Number(`${whole}${fraction}`)), asDecimal])];
}

/** Values allowed in an answer: every reading of every number in the given texts. */
export function allowedValues(texts: readonly string[]): Set<string> {
  const values = new Set<string>();
  for (const text of texts) for (const token of numberTokens(text)) for (const v of numericValues(token)) values.add(v);
  return values;
}

/** Numbers in `answer` that no allowed text contains under any reading. */
export function findUngroundedNumbers(answer: string, allowedTexts: readonly string[]): string[] {
  const allowed = allowedValues(allowedTexts);
  return numberTokens(answer).filter((token) => !numericValues(token).some((v) => allowed.has(v)));
}

const PRICE_FIGURES = [
  /\d[\d.,\s]*(?:%|RON\b|EUR\b|lei\b|leu\b|euros?\b|basis points?\b)/gi,
  /\b(?:APR|DAE|interest rate|fee|commission|comision|dobanda)\b[^.!?\n]{0,40}\d[\d.,]*/gi,
];
const WORDED_PRICE = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\s+(?:percent|lei|euros?)\b/i;

/**
 * Financial figures (rates, fees, amounts) that no trusted text backs. Exact prices require the reviewed catalog,
 * even when a number occurs in a RAG passage; the trusted texts are calculator results, which echo the customer's
 * validated inputs and the computed figures. Worded amounts can't be checked, so they are always reported.
 */
export function unsupportedFinancialFigures(text: string, trustedTexts: readonly string[] = []): string[] {
  const normalized = text.normalize("NFKC");
  const allowed = allowedValues(trustedTexts);
  const figures = PRICE_FIGURES.flatMap((pattern) => normalized.match(pattern) ?? [])
    .filter((figure) => numberTokens(figure).some((token) => !numericValues(token).some((v) => allowed.has(v))));
  const worded = normalized.match(WORDED_PRICE);
  return worded ? [...figures, worded[0]] : figures;
}

export function containsFinancialFigure(text: string, trustedTexts: readonly string[] = []): boolean {
  return unsupportedFinancialFigures(text, trustedTexts).length > 0;
}

/** Lowercase and strip diacritics: "Dobândă și ȚARĂ" -> "dobanda si tara" (both ș/ş and ț/ţ forms). */
export function foldDiacritics(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Text stored in the search index: folded, with every run of whitespace collapsed. */
export function toSearchText(text: string): string {
  return foldDiacritics(text).replace(/\s+/g, " ").trim();
}

/** Lowercase word and number tokens of folded text. */
export function tokenize(text: string): string[] {
  return foldDiacritics(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Function words in Romanian (folded) and English that carry no search signal.
const STOPWORDS = new Set([
  // Romanian
  "a", "ai", "al", "ale", "am", "ar", "are", "as", "asa", "au", "ca", "cat", "cata", "cate", "cati", "ce", "cei",
  "cel", "cea", "cele", "cine", "cu", "cum", "da", "dar", "daca", "de", "despre", "din", "dintre", "e", "este",
  "eu", "fi", "fie", "fost", "iar", "il", "im", "imi", "in", "intr", "intre", "intro", "isi", "la", "le", "li",
  "lor", "lui", "ma", "mai", "mea", "mei", "meu", "mi", "mie", "mine", "mult", "multe", "nu", "o", "ori", "pe",
  "pentru", "poate", "pot", "prin", "sa", "sau", "se", "si", "sunt", "suntem", "ta", "tau", "te", "ti", "tu",
  "un", "una", "unde", "unei", "unor", "unui", "va", "vreau", "vrea", "voi", "acest", "aceasta", "acesta",
  "care", "trebuie",
  // English
  "about", "an", "and", "any", "are", "as", "at", "be", "can", "could", "do", "does", "for", "from", "get", "have",
  "how", "i", "if", "is", "it", "its", "me", "much", "my", "need", "of", "on", "or", "the", "there", "this", "to",
  "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your", "should", "many",
  "want", "tell",
]);

/** Convex full-text search accepts at most 16 terms per query. */
export const MAX_SEARCH_TERMS = 16;

/** Distinct content tokens of a query, in order, capped at `max`. */
export function queryTerms(text: string, max: number = MAX_SEARCH_TERMS): string[] {
  const out: string[] = [];
  for (const token of tokenize(text)) {
    if (STOPWORDS.has(token) || out.includes(token)) continue;
    out.push(token);
    if (out.length === max) break;
  }
  return out;
}

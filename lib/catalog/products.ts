import { z } from "zod";
import { foldDiacritics } from "../rag/normalize";
import { bankSchema, type RawChunk, scopeFlagsSchema, type ScopeFlags } from "../rag/schemas";
import { buildProductSegments, deriveScopeFlags } from "../rag/visibility";

/*
 * The product list: one row per product page, built from the metadata the chunks already carry. It answers "which
 * products are there" from a table instead of from passages. It holds names, kinds, links and a short description,
 * never a rate or a fee: those stay in productTerms with their quotes.
 */

/** The same product kinds the chat's inputs use (lib/agent/inputs.ts SLOTS.productKind), plus "other". */
export const PRODUCT_KINDS = ["mortgage", "car_loan", "credit_card", "overdraft", "personal_loan", "term_deposit", "savings_account", "current_account", "other"] as const;
export const productKindSchema = z.enum(PRODUCT_KINDS);
export type ProductKind = z.infer<typeof productKindSchema>;

export const SUMMARY_MAX = 280;

export const productRecordSchema = z.object({
  productId: z.string().min(1),
  bank: bankSchema,
  product: z.string().min(1),
  kind: productKindSchema,
  /** The site's own category and segment, as scraped ("Credite", "persoane fizice"). */
  category: z.string().optional(),
  segment: z.string().optional(),
  url: z.string().min(1),
  collectedAt: z.string().min(1),
  /** The page's opening description, shortened at a sentence. Empty when the page has none. */
  summary: z.string().max(SUMMARY_MAX),
  /** A guide, FAQ or article page about a kind of product rather than a product: left out of product lists. */
  guide: z.boolean(),
  ...scopeFlagsSchema.shape,
});
export type ProductRecord = z.infer<typeof productRecordSchema>;

// Order matters: a mortgage's page also says "credit", a credit card's also says "card".
const KIND_PATTERNS: [ProductKind, RegExp][] = [
  // Insurance, investments and pensions mention loans, cars and savings but are none of them.
  ["other", /\b(asigur\w*|insurance|protect|fonduri|investit\w*|titluri de stat|bursa|broker|pensi\w*|actiun\w*|actionari)\b/],
  ["mortgage", /\b(ipotec\w*|imobiliar\w*|casa ta|casa mea|noua casa|mortgage)\b/],
  ["car_loan", /\b(credit auto|leasing|auto)\b/],
  ["credit_card", /\b(card(ul|uri)? de credit|carduri de credit|credit card|card credit)\b/],
  ["overdraft", /\b(overdraft|descoperit de cont|linie de credit)\b/],
  ["personal_loan", /\b(nevoi personale|flexicredit|credit personal|ing personal|credit(ul)? george|refinantare)\b/],
  ["term_deposit", /\b(depozit\w*)\b/],
  ["savings_account", /\b(economi\w*|super acces|cont de economii)\b/],
  ["current_account", /\b(cont curent|conturi curente|pachet\w*|cont\b)/],
];

/** What kind of product a page is, from its URL path, category and name. "other" when nothing says. */
export function productKindOf(input: { url: string; category?: string | null; product?: string | null }): ProductKind {
  const path = (() => { try { return new URL(input.url).pathname; } catch { return input.url; } })();
  const text = foldDiacritics(`${path.replace(/[/_.-]+/g, " ")} ${input.category ?? ""} ${input.product ?? ""}`).toLowerCase()
    // "fără ipotecă" (unsecured) names a personal loan or refinancing, never a mortgage
    .replace(/\bfara ipotec\w*/g, " ");
  return KIND_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? "other";
}

const GUIDE_PATH = /(ghid|intrebari-frecvente|faq|sfaturi|-vs-|ce-inseamna|cum-alegi|biroul-de-credit|conditii-credit|localitati-cu)/i;

/** Whether a page explains a kind of product (a guide, FAQ or tips article) rather than offering one. */
export function isGuidePage(url: string): boolean {
  try { return GUIDE_PATH.test(new URL(url).pathname); } catch { return GUIDE_PATH.test(url); }
}

/** The first sentences of a description, without the "Bank: Product — Category (segment)" title line the chunks start with. */
export function summaryOf(text: string): string {
  const body = text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
  if (body.length <= SUMMARY_MAX) return body;
  const cut = body.slice(0, SUMMARY_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const SUMMARY_SECTIONS = ["overview", "description", "features"];

/**
 * One product row per product page. Hub pages (lists of products), withdrawn products and pages outside every track
 * and collection are left out. A product is visible where any of its chunks is, as the chunk flags say.
 */
export function buildProducts(chunks: readonly RawChunk[]): ProductRecord[] {
  const segments = buildProductSegments(chunks);
  const pages = new Map<string, RawChunk[]>();
  for (const c of chunks) {
    const m = c.metadata;
    if (m.source_type !== "product_page" || !m.product_id || !m.product || m.status === "withdrawn" || m.page_type === "hub") continue;
    pages.set(m.product_id, [...(pages.get(m.product_id) ?? []), c]);
  }
  const out: ProductRecord[] = [];
  for (const [productId, list] of pages) {
    const flags = Object.fromEntries(Object.keys(scopeFlagsSchema.shape).map((k) => [k, false])) as ScopeFlags;
    for (const c of list) for (const [k, on] of Object.entries(deriveScopeFlags(c.metadata, segments))) if (on) flags[k as keyof ScopeFlags] = true;
    if (!Object.values(flags).some(Boolean)) continue;
    const m = list[0]!.metadata;
    const lead = SUMMARY_SECTIONS.map((s) => list.find((c) => c.metadata.section_type === s)).find(Boolean);
    out.push(productRecordSchema.parse({
      productId, bank: m.bank, product: m.product!, kind: productKindOf({ url: m.url, category: m.category, product: m.product }),
      ...(m.category ? { category: m.category } : {}), ...(m.segment ? { segment: m.segment } : {}),
      url: m.url, collectedAt: list.map((c) => c.metadata.scraped_at).sort().at(-1)!, summary: lead ? summaryOf(lead.text) : "", guide: isGuidePage(m.url), ...flags,
    }));
  }
  return out.sort((a, b) => a.bank.localeCompare(b.bank) || a.product.localeCompare(b.product));
}

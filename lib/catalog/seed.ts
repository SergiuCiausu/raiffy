import { buildProvenance, type Volatility } from "../rag/provenance";
import { type Bank, bankSchema } from "../rag/schemas";
import { findQuote, type QuoteChunk } from "./quote";
import {
  type Comparability, type TermFrequency, type TermKind, type TermRecord, termRecordSchema, type TermUnit, type TermValue,
} from "./schemas";

/*
 * Turns banks-data-package/data/comparison/comparatie.csv (hand-checked values for three banks) into term records.
 * Pure: the CSV text, the source chunks and the clock come in as arguments. Records start unreviewed;
 * get_product_terms treats them as unavailable until a reviewer signs them off.
 */

export type SeedRow = {
  categorie: string; indicator: string; banca: string; valoare: string;
  valoare_numerica: string; conditii: string; url_sursa: string; data_colectarii: string;
};

/** A source chunk as the seed needs it: enough to locate quotes and name the product. */
export type SeedChunk = QuoteChunk & { url: string; scrapedAt: string; productId?: string; product?: string };

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. A leading BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export function parseSeedRows(text: string): SeedRow[] {
  const [header, ...rows] = parseCsv(text);
  return rows.map((cells) => Object.fromEntries(header!.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])) as SeedRow);
}

/** Romanian number formatting: dots group thousands, a comma marks decimals ("50.000", "5,55"). */
export function parseRoNumber(text: string): number {
  return Number(text.replace(/\.(?=\d{3}(?!\d))/g, "").replace(",", "."));
}

const toBps = (n: string) => Math.round(parseRoNumber(n) * 100);
const toMinor = (n: string) => Math.round(parseRoNumber(n) * 100);
const NUM = String.raw`(\d+(?:[.,]\d+)*)`;
const DASH = String.raw`\s*[–-]\s*`;

type Parsed = { value: TermValue; unit: TermUnit; frequency?: TermFrequency };

/** Reads one catalog value. Anything that isn't a plain number, range or bound stays text; nothing is guessed. */
export function parseSeedValue(raw: string): Parsed {
  const s = raw.trim();
  const text: Parsed = { value: { type: "text", text: s }, unit: "none" };
  if (/indisponibil|nu apar|nespecificat/i.test(s)) return { value: { type: "unavailable", reason: s }, unit: "none" };

  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^${NUM}%$`)))) return { value: { type: "exact", amount: toBps(m[1]!) }, unit: "bps" };
  if ((m = s.match(new RegExp(`^de la ${NUM}%$`, "i")))) return { value: { type: "from", min: toBps(m[1]!) }, unit: "bps" };
  if ((m = s.match(new RegExp(`^până la ${NUM}%$`, "i")))) return { value: { type: "up_to", max: toBps(m[1]!) }, unit: "bps" };
  if ((m = s.match(new RegExp(`^${NUM}%${DASH}${NUM}%$`)))) return { value: { type: "range", min: toBps(m[1]!), max: toBps(m[2]!) }, unit: "bps" };

  if ((m = s.match(new RegExp(`^${NUM} lei(?:\\s*/\\s*(lună|an))?$`, "i")))) {
    const frequency = m[2] ? (m[2].toLowerCase() === "lună" ? "monthly" : "yearly") : undefined;
    return { value: { type: "exact", amount: toMinor(m[1]!) }, unit: "minor_ron", ...(frequency ? { frequency } : {}) };
  }
  if ((m = s.match(new RegExp(`^${NUM}${DASH}${NUM} lei$`, "i")))) return { value: { type: "range", min: toMinor(m[1]!), max: toMinor(m[2]!) }, unit: "minor_ron" };
  if ((m = s.match(new RegExp(`^până la ${NUM} lei$`, "i")))) return { value: { type: "up_to", max: toMinor(m[1]!) }, unit: "minor_ron" };
  if ((m = s.match(new RegExp(`^până la echivalentul a ${NUM} euro$`, "i")))) return { value: { type: "up_to", max: toMinor(m[1]!) }, unit: "minor_eur" };

  // Durations: the months a source states in brackets win over its years
  if ((m = s.match(new RegExp(`^până la .*\\(${NUM} de luni\\)$`, "i")))) return { value: { type: "up_to", max: parseRoNumber(m[1]!) }, unit: "months" };
  if ((m = s.match(new RegExp(`^până la ${NUM} (?:de )?ani$`, "i")))) return { value: { type: "up_to", max: parseRoNumber(m[1]!) * 12 }, unit: "months" };
  if ((m = s.match(new RegExp(`^${NUM}${DASH}${NUM} (?:de )?ani$`, "i")))) {
    return { value: { type: "range", min: parseRoNumber(m[1]!) * 12, max: parseRoNumber(m[2]!) * 12 }, unit: "months" };
  }
  if ((m = s.match(new RegExp(`^până la ${NUM} de zile$`, "i")))) return { value: { type: "up_to", max: parseRoNumber(m[1]!) }, unit: "days" };
  return text;
}

type IndicatorRule = { kind: TermKind; frequency?: TermFrequency; comparability?: Partial<Comparability> };
type CategoryRule = {
  category: string;
  /** Cards and mortgages use the conditions column for the product name, not for conditions. */
  conditionsNameProduct: boolean;
  indicator: (indicator: string, conditions: string) => IndicatorRule | null;
};

const fixedMonths = (ind: string) => Number(ind.match(/(\d+) luni/)?.[1]);

const CATEGORIES: Record<string, CategoryRule> = {
  "Depozit la termen (lei)": {
    category: "term_deposit", conditionsNameProduct: false,
    indicator: (ind, cond) => {
      if (/standard$/.test(ind)) return { kind: "interest_rate", comparability: { termMonths: fixedMonths(ind), rateType: "fixed" } };
      if (/cu bonus$/.test(ind)) return { kind: "interest_rate", comparability: { termMonths: fixedMonths(ind), rateType: "promo" } };
      if (ind === "Promoție principală") {
        const months = Number(cond.match(/(\d+) luni/)?.[1]);
        return { kind: "interest_rate", comparability: { ...(months ? { termMonths: months } : {}), rateType: "campaign" } };
      }
      return null;
    },
  },
  "Credit de nevoi personale": {
    category: "personal_loan", conditionsNameProduct: false,
    indicator: (ind, cond) => ({
      "Interval dobândă": { kind: "interest_rate" },
      "Sumă maximă": { kind: "limit" },
      "Perioadă": { kind: "term" },
      "Comision de analiză": { kind: "fee", frequency: "once" },
      "Comision de administrare": { kind: "fee", frequency: "monthly" },
      "DAE în exemplu": { kind: "dae", comparability: { insuranceIncluded: /inclusiv .*asigurare/i.test(cond) } },
    } as Record<string, IndicatorRule>)[ind] ?? null,
  },
  "Card de credit": {
    category: "credit_card", conditionsNameProduct: true,
    indicator: (ind) => ({
      "DAE în exemplu": { kind: "dae" },
      "Ipotezele exemplului": { kind: "dae" },
      "Comisioane": { kind: "fee" },
      "Perioadă de grație": { kind: "term" },
      "Rate fără dobândă": { kind: "benefit" },
    } as Record<string, IndicatorRule>)[ind] ?? null,
  },
  "Credit ipotecar": {
    category: "mortgage", conditionsNameProduct: true,
    indicator: (ind) => {
      const fixed = ind.match(/^Fixă (\d+) ani$/);
      if (fixed) return { kind: "interest_rate", comparability: { category: `mortgage_fixed_${fixed[1]}y`, rateType: "fixed" } };
      return ({
        "După perioada fixă": { kind: "interest_rate", comparability: { rateType: "variable" } },
        "Avans minim": { kind: "limit" },
        "Perioadă": { kind: "term" },
        "Observații": { kind: "interest_rate" },
      } as Record<string, IndicatorRule>)[ind] ?? null;
    },
  },
};

const STABLE_KINDS: TermKind[] = ["eligibility", "document"];
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The last dd.mm.yyyy in the conditions: the end of a campaign the source states. */
export function statedEndIn(conditions: string): string | undefined {
  const dates = [...conditions.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)];
  const last = dates.at(-1);
  return last ? `${last[3]}-${last[2]}-${last[1]}` : undefined;
}

function mostCommon<T>(items: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export type SeedReport = { records: TermRecord[]; quoteFound: number; quoteMissing: string[]; unavailable: number; skipped: string[] };

export function buildSeedRecords(rows: SeedRow[], chunks: SeedChunk[], now: number): SeedReport {
  const byUrl = new Map<string, SeedChunk[]>();
  for (const chunk of chunks) byUrl.set(chunk.url, [...(byUrl.get(chunk.url) ?? []), chunk]);

  const records: TermRecord[] = [];
  const quoteMissing: string[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const rule = CATEGORIES[row.categorie];
    const indicator = rule?.indicator(row.indicator, row.conditii);
    const bank = bankSchema.safeParse(row.banca.toLowerCase());
    if (!rule || !indicator || !bank.success) { skipped.push(`${row.banca} · ${row.categorie} · ${row.indicator}`); continue; }

    const source = byUrl.get(row.url_sursa) ?? [];
    const productId = mostCommon(source.flatMap((c) => (c.productId ? [c.productId] : [])))
      ?? `${bank.data}:${slug(new URL(row.url_sursa).pathname)}`;
    // Some pages title the product with a slogan ("Ai planuri? ..."); the category name is clearer then
    const pageName = mostCommon(source.flatMap((c) => (c.product && !c.product.includes("?") ? [c.product] : [])));
    const product = (rule.conditionsNameProduct && row.conditii) || pageName || row.categorie;

    const parsed = parseSeedValue(row.valoare);
    const match = parsed.value.type === "unavailable" ? null : findQuote(row.valoare, source);
    const id = `${bank.data} · ${row.categorie} · ${row.indicator}`;
    if (parsed.value.type !== "unavailable" && !match) quoteMissing.push(id);

    const collectedAt = source.find((c) => c.chunkId === match?.chunkId)?.scrapedAt ?? source[0]?.scrapedAt
      ?? `${row.data_colectarii || "2026-10-28"}T00:00:00+00:00`;
    const volatility: Volatility = STABLE_KINDS.includes(indicator.kind) ? "stable" : "volatile";
    const conditions = !rule.conditionsNameProduct && row.conditii ? [row.conditii] : [];

    records.push(termRecordSchema.parse({
      termId: `${productId}#${slug(row.indicator)}`,
      productId,
      product,
      bank: bank.data as Bank,
      track: "personal",
      kind: indicator.kind,
      label: row.indicator,
      value: parsed.value,
      unit: parsed.unit,
      ...((parsed.frequency ?? indicator.frequency) && parsed.unit.startsWith("minor") ? { frequency: parsed.frequency ?? indicator.frequency } : {}),
      conditions,
      comparability: { category: rule.category, currency: "RON", ...indicator.comparability },
      quote: match?.quote ?? "",
      provenance: buildProvenance({
        bank: bank.data as Bank, url: row.url_sursa, chunkId: match?.chunkId, collectedAt, volatility,
        statedEnd: statedEndIn(row.conditii), now,
      }),
      verification: { quoteFound: Boolean(match) },
    }));
  }

  const ids = new Set<string>();
  for (const r of records) {
    if (ids.has(r.termId)) throw new Error(`duplicate termId ${r.termId}`);
    ids.add(r.termId);
  }
  return {
    records, quoteMissing, skipped,
    quoteFound: records.filter((r) => r.verification.quoteFound).length,
    unavailable: records.filter((r) => r.value.type === "unavailable").length,
  };
}

import { z } from "zod";
import { findUngroundedNumbers } from "../rag/numbers";

/*
 * Answer cards that Claude fills as JSON through the show_cards tool, and the chat renders with the card components
 * (comparison table, routes, key facts, checklist, adviser handoff).
 *
 * Claude chooses the card and writes its words; it never calculates. Every number on a card must be copied from the
 * search result named in its `source` (that result's URL), or be one of the customer's own stated figures. Code checks
 * this the same way it checks the answer text: an unsupported figure is dropped from the card, never shown.
 */

const short = (max: number) => z.string().trim().min(1).max(max);
const url = z.string().trim().min(1).max(500);

/**
 * One figure per fact, card-sized: the value is the figure with its unit in English ("9.52%", "2,906.42 lei a month",
 * "up to 200,000 euro"), and its context goes in the label ("Monthly payment, 50,000 lei over 18 months").
 */
export const FACT_LABEL_MAX = 60;
export const FACT_VALUE_MAX = 48;
export const cardFactSchema = z.object({
  label: short(FACT_LABEL_MAX),
  value: short(FACT_VALUE_MAX),
  /** URL of the search result the value is copied from. Required whenever the value contains a number. */
  source: url.optional(),
});
const recommendationSchema = z.object({
  /** Name of the recommended option or route, exactly as written on the card. */
  option: short(80),
  reasons: z.array(short(200)).min(1).max(3),
  /** When another option fits better. */
  whenOther: short(240),
});

export const comparisonCardSchema = z.object({
  type: z.literal("comparison"),
  title: short(80),
  options: z.array(z.object({
    name: short(60),
    provider: short(40).optional(),
    isRaiffeisen: z.boolean(),
    facts: z.array(cardFactSchema).max(6),
  })).min(2).max(4),
  recommendation: recommendationSchema.optional(),
});
export const routesCardSchema = z.object({
  type: z.literal("routes"),
  title: short(80),
  routes: z.array(z.object({
    name: short(60),
    summary: short(200),
    /** How this route fits the customer's stated purpose, amount and term. */
    fit: short(200),
    facts: z.array(cardFactSchema).max(4),
    /** The customer's own choice, which can differ from the recommendation. Set by the host on compare_routes cards; leave it out. */
    chosen: z.boolean().optional(),
  })).min(2).max(4),
  recommendation: recommendationSchema,
});
export const keyFactsCardSchema = z.object({ type: z.literal("keyFacts"), title: short(80), facts: z.array(cardFactSchema).min(1).max(8) });
export const checklistCardSchema = z.object({
  type: z.literal("checklist"),
  title: short(80),
  items: z.array(z.object({ text: short(120), detail: short(200).optional(), source: url.optional() })).min(1).max(8),
});
export const handoffCardSchema = z.object({ type: z.literal("handoff"), title: short(80), reason: short(240) });
/**
 * A repayment simulation over one cited loan rate. Claude supplies the product, the rate and its source, never a
 * payment or a total: the chat computes those with the annuity formula (lib/calc/loan.ts) as the customer moves
 * the amount and term. The starting amount and term are kept only when they are the customer's own figures.
 */
export const simulationCardSchema = z.object({
  type: z.literal("simulation"),
  title: short(80),
  product: short(60),
  /** Annual interest rate in percent, exactly as the source prints it (7.95 for "7,95%"); the lowest when it's a range. Not the APR/DAE. */
  ratePercent: z.number().min(0).max(40),
  /** The highest rate when the source gives a range ("5.55%–17.95%"): the card then shows payments at both ends. */
  rateMaxPercent: z.number().min(0).max(40).optional(),
  /** URL of the search result the rate (and the longest term) is copied from. */
  source: url,
  /** When the rates belong to another product than the one asked about, saying so ("No personal-loan rate in the sources"). */
  rateFor: short(160).optional(),
  /** The longest term the source allows, in months; the term buttons stop there. */
  termMaxMonths: z.number().int().min(1).max(360).optional(),
  /** Fees from the same or another cited result, shown next to the simulation and not added to its totals. */
  fees: z.array(cardFactSchema).max(3).optional(),
  /** The customer's own figures: the starting amount and term, and the income and other monthly payments for the share of income. */
  amount: z.number().positive().max(10_000_000).optional(),
  months: z.number().int().min(1).max(360).optional(),
  income: z.number().positive().max(10_000_000).optional(),
  obligations: z.number().min(0).max(10_000_000).optional(),
  /** A maximum debt-to-income ratio in percent, only as a cited source states it, with that source. */
  maxDebtRatio: z.object({ percent: z.number().min(1).max(100), source: url }).optional(),
});

export const answerCardSchema = z.discriminatedUnion("type", [comparisonCardSchema, routesCardSchema, keyFactsCardSchema, checklistCardSchema, handoffCardSchema, simulationCardSchema]);
export type AnswerCard = z.infer<typeof answerCardSchema>;
export const showCardsInputSchema = z.object({ cards: z.array(answerCardSchema).min(1).max(3) });

export const SHOW_CARDS_TOOL_NAME = "show_cards";

/** The tool Claude calls once, after searching and before its final text. JSON Schema generated from the Zod schema. */
export function showCardsTool() {
  const { $schema: _s, ...input_schema } = z.toJSONSchema(showCardsInputSchema) as Record<string, unknown>;
  return {
    name: SHOW_CARDS_TOOL_NAME,
    description: "Show the customer cards that summarise this answer: a comparison table for named options, routes with one recommendation for a goal, key facts for one product, a checklist of documents or steps, an adviser handoff, or a repayment simulation over one cited loan interest rate (give the rate and its source only; the chat calculates payments). Call it at most once, after searching and before the final text. Each fact holds one figure with its unit, in English, at most 48 characters; its context goes in the label. Copy every number exactly from a search result (writing it in English number format is fine) and put that result's URL in `source`; use the customer's own figures as given. Never calculate, estimate or convert a number.",
    input_schema: input_schema as { type: "object"; [key: string]: unknown },
  };
}

/** A search result as the check needs it: where it came from and its text. */
export type CardEvidence = { url: string; text: string; collectedAt: string };

export type CardsCheck = { cards: AnswerCard[]; dropped: string[]; urls: string[] };

/**
 * Keeps only what is supported. A fact, checklist item or sentence with a number that is neither in its cited result
 * nor one of the customer's figures is dropped; a card left without its content is dropped. Returns null when the input
 * does not match the schema at all, so the model can be told to fix it.
 */
export function checkCards(raw: unknown, evidence: readonly CardEvidence[], customerFigures: readonly string[] = []):
  CardsCheck | { error: string } {
  const parsed = showCardsInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.slice(0, 5).map(i => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const known = new Set(evidence.map(e => e.url));
  const textOf = (source?: string) => source ? evidence.filter(e => e.url === source).flatMap(e => [e.text, e.collectedAt.slice(0, 10)]) : [];
  const dropped: string[] = [];
  const urls = new Set<string>();
  const supported = (text: string, source: string | undefined, where: string) => {
    if (source && !known.has(source)) { dropped.push(`${where}: unknown source`); return false; }
    const bad = findUngroundedNumbers(text, [...textOf(source), ...customerFigures]);
    if (bad.length) { dropped.push(`${where}: ${bad.join(", ")} not in ${source ? "its source" : "a cited source"}`); return false; }
    if (source) urls.add(source);
    return true;
  };
  const facts = (list: z.infer<typeof cardFactSchema>[], where: string) =>
    list.filter((f, i) => supported(`${f.label} ${f.value}`, f.source, `${where} fact ${i + 1}`));
  const prose = (text: string, where: string) => supported(text, undefined, where);
  const recommendation = (r: z.infer<typeof recommendationSchema>, names: string[], where: string) => {
    if (!names.includes(r.option)) { dropped.push(`${where}: recommends "${r.option}", which is not on the card`); return undefined; }
    const reasons = r.reasons.filter((t, i) => prose(t, `${where} reason ${i + 1}`));
    return reasons.length && prose(r.whenOther, `${where} alternative`) ? { ...r, reasons } : undefined;
  };

  const cards = parsed.data.cards.flatMap((card, c): AnswerCard[] => {
    const where = `card ${c + 1} (${card.type})`;
    if (!prose(card.title, `${where} title`)) return [];
    switch (card.type) {
      case "comparison": {
        const options = card.options.map((o, i) => ({ ...o, facts: facts(o.facts, `${where} option ${i + 1}`) }));
        if (options.every(o => !o.facts.length)) { dropped.push(`${where}: no supported facts`); return []; }
        const rec = card.recommendation && recommendation(card.recommendation, options.map(o => o.name), where);
        return [{ ...card, options, ...(rec ? { recommendation: rec } : { recommendation: undefined }) }];
      }
      case "routes": {
        const routes = card.routes.filter((r, i) => prose(`${r.name} ${r.summary} ${r.fit}`, `${where} route ${i + 1}`))
          .map((r, i) => ({ ...r, facts: facts(r.facts, `${where} route ${i + 1}`) }));
        const rec = recommendation(card.recommendation, routes.map(r => r.name), where);
        if (routes.length < 2 || !rec) { dropped.push(`${where}: needs two supported routes and a recommendation among them`); return []; }
        return [{ ...card, routes, recommendation: rec }];
      }
      case "keyFacts": {
        const kept = facts(card.facts, where);
        return kept.length ? [{ ...card, facts: kept }] : [];
      }
      case "checklist": {
        const items = card.items.filter((it, i) => supported(`${it.text} ${it.detail ?? ""}`, it.source, `${where} item ${i + 1}`));
        return items.length ? [{ ...card, items }] : [];
      }
      case "handoff":
        return prose(card.reason, `${where} reason`) ? [card] : [];
      case "simulation": {
        if (!prose(card.product, `${where} product`)) return [];
        if (!supported(`${card.ratePercent}%`, card.source, `${where} rate`)) return [];
        // The top of a range must be printed by the same source and lie above the bottom; otherwise the card shows one rate.
        const rateMaxPercent = card.rateMaxPercent !== undefined && card.rateMaxPercent > card.ratePercent
          && supported(`${card.rateMaxPercent}%`, card.source, `${where} highest rate`) ? card.rateMaxPercent : undefined;
        const rateFor = card.rateFor && prose(card.rateFor, `${where} rate note`) ? card.rateFor : undefined;
        const termMaxMonths = card.termMaxMonths !== undefined && supported(String(card.termMaxMonths), card.source, `${where} longest term`) ? card.termMaxMonths : undefined;
        const maxDebtRatio = card.maxDebtRatio && supported(`${card.maxDebtRatio.percent}%`, card.maxDebtRatio.source, `${where} debt ratio`) ? card.maxDebtRatio : undefined;
        const fees = card.fees && facts(card.fees, `${where} fees`);
        // A figure the customer didn't give is dropped; the chat then starts from an example, or leaves the row out.
        const own = (n: number | undefined, what: string) => {
          if (n === undefined || !findUngroundedNumbers(String(n), customerFigures).length) return n;
          dropped.push(`${where}: the ${what} is not the customer's figure`); // no value: income stays out of traces
          return undefined;
        };
        return [{ ...card, rateMaxPercent, rateFor, termMaxMonths, maxDebtRatio, fees: fees?.length ? fees : undefined,
          amount: own(card.amount, "amount"), months: own(card.months, "term"), income: own(card.income, "income"), obligations: own(card.obligations, "monthly payments") }];
      }
    }
  });
  return { cards: cards.map(c => answerCardSchema.parse(c)), dropped, urls: [...urls] };
}

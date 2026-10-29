import { z } from "zod";
import { SENTIMENT_ABOUT, SENTIMENTS } from "../agent/jev";
import { analyticsFilterSchema, entrySchema, trackSchema, type AnalyticsFilter } from "./schemas";
import { datesBetween } from "./summarize";

/**
 * Chat sentiment for the Console's Sentiment page (docs/shared/console.md → Sentiment). Labels only: Jev's sentiment
 * and topic for each customer message, the thumbs on answers, and what Raiffy's previous answer was. Never message
 * text. Pseudonymous keys, aggregated here, and any group with fewer distinct customers than `minCount` is hidden.
 */

export const SENTIMENT_LABELS = Object.keys(SENTIMENTS) as [keyof typeof SENTIMENTS, ...(keyof typeof SENTIMENTS)[]];
export const ABOUT_LABELS = Object.keys(SENTIMENT_ABOUT) as [keyof typeof SENTIMENT_ABOUT, ...(keyof typeof SENTIMENT_ABOUT)[]];
export const sentimentSchema = z.enum(SENTIMENT_LABELS);
export const aboutSchema = z.enum(ABOUT_LABELS);
export type Sentiment = z.infer<typeof sentimentSchema>;
/** Confused, frustrated and angry count as negative. */
export const NEGATIVE: readonly Sentiment[] = ["confused", "frustrated", "angry"];

/** What Raiffy's previous answer in the conversation was when the customer wrote, worked out in code from stored messages. */
export const AFTER = ["first", "answered", "unavailable", "failed", "stopped", "menu", "repeat"] as const;
export const afterSchema = z.enum(AFTER);

export const FEEDBACK_REASONS = ["wrong", "unclear", "missing", "other"] as const;
export const feedbackReasonSchema = z.enum(FEEDBACK_REASONS);

const base = {
  at: z.iso.datetime({ offset: true }),
  conversationKey: z.string().min(1),
  customerKey: z.string().min(1),
  track: trackSchema,
  entry: entrySchema,
};

/** One customer message, labelled by Jev. `inquiry` is Jev's answer pattern for the message. */
export const sentimentEventSchema = z.object({
  ...base,
  inquiry: z.string().min(1),
  sentiment: sentimentSchema,
  about: aboutSchema,
  confidence: z.number().min(0).max(1),
  after: afterSchema,
});
export type SentimentEvent = z.infer<typeof sentimentEventSchema>;

/** A thumbs up or down on one answer. The latest vote per answer counts. */
export const answerFeedbackSchema = z.object({
  ...base,
  answerKey: z.string().min(1),
  vote: z.enum(["up", "down"]),
  reason: feedbackReasonSchema.optional(),
});
export type AnswerFeedback = z.infer<typeof answerFeedbackSchema>;

const count = z.number().int().nullable();
const rate = z.number().min(0).max(1).nullable();
const row = <K extends z.ZodType>(key: K) => z.object({ key, turns: count, negativeShare: rate });

export const sentimentSummarySchema = z.object({
  kpis: z.object({
    conversations: count,
    turns: count,
    /** Conversations with at least one confused, frustrated or angry message. */
    negativeConversationShare: rate,
    /** Of answers with a vote, the share voted down. */
    thumbsDownShare: rate,
    votes: count,
  }),
  /** One entry per date; each share is null when that day has too few customers. */
  daily: z.array(z.object({ date: z.iso.date(), turns: count, positive: rate, neutral: rate, negative: rate })),
  mix: z.array(z.object({ sentiment: sentimentSchema, turns: count, share: rate })),
  byInquiry: z.array(row(z.string())),
  /** What negative messages were about. */
  about: z.array(z.object({ about: aboutSchema, turns: count, share: rate })),
  /** What Raiffy's previous answer was before a negative message, against how often that happens before any message. */
  after: z.array(z.object({ after: afterSchema, negative: count, negativeShare: rate })),
  reasons: z.array(z.object({ reason: feedbackReasonSchema, votes: count })),
});
export type SentimentSummary = z.infer<typeof sentimentSummarySchema>;

const day = (iso: string) => iso.slice(0, 10);
function inFilter(r: { at: string; track: string; entry: string }, f: AnalyticsFilter): boolean {
  const d = day(r.at);
  return d >= f.from && d <= f.to && (!f.track || r.track === f.track) && (!f.entry || r.entry === f.entry);
}
const isNegative = (e: SentimentEvent) => NEGATIVE.includes(e.sentiment);

export function summarizeSentiment(events: SentimentEvent[], feedback: AnswerFeedback[], filterInput: AnalyticsFilter): SentimentSummary {
  const f = analyticsFilterSchema.parse(filterInput);
  const k = f.minCount;
  const people = (xs: { customerKey: string }[]) => new Set(xs.map((x) => x.customerKey)).size;
  /** A group is shown only when enough distinct customers are in it; its count and any share built on it are hidden otherwise. */
  const shown = (xs: { customerKey: string }[]) => people(xs) >= k;
  const n = (xs: { customerKey: string }[]) => (shown(xs) ? xs.length : null);
  const share = <T extends { customerKey: string }>(part: T[], whole: T[]) => (shown(whole) && shown(part) ? part.length / whole.length : null);
  const groupBy = <T, K extends string>(xs: T[], key: (x: T) => K) => {
    const m = new Map<K, T[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return m;
  };

  const E = events.filter((e) => inFilter(e, f));
  const negative = E.filter(isNegative);

  const byConversation = groupBy(E, (e) => e.conversationKey);
  const conversations = [...byConversation.values()].map((xs) => ({ customerKey: xs[0]!.customerKey, negative: xs.some(isNegative) }));

  // The latest vote per answer counts: a customer who changes their mind is one vote.
  const latest = new Map<string, AnswerFeedback>();
  for (const v of feedback.filter((v) => inFilter(v, f)).sort((a, b) => a.at.localeCompare(b.at))) latest.set(v.answerKey, v);
  const votes = [...latest.values()];
  const down = votes.filter((v) => v.vote === "down");

  const byDay = groupBy(E, (e) => day(e.at));
  const byInquiry = groupBy(E, (e) => e.inquiry);
  const negByAbout = groupBy(negative, (e) => e.about);
  const byAfter = groupBy(E, (e) => e.after);

  return sentimentSummarySchema.parse({
    kpis: {
      conversations: shown(conversations) ? conversations.length : null,
      turns: n(E),
      negativeConversationShare: share(conversations.filter((c) => c.negative), conversations),
      thumbsDownShare: share(down, votes),
      votes: n(votes),
    },
    daily: datesBetween(f.from, f.to).map((date) => {
      const xs = byDay.get(date) ?? [];
      return { date, turns: n(xs), positive: share(xs.filter((e) => e.sentiment === "positive"), xs), neutral: share(xs.filter((e) => e.sentiment === "neutral"), xs), negative: share(xs.filter(isNegative), xs) };
    }),
    mix: SENTIMENT_LABELS.map((sentiment) => {
      const xs = E.filter((e) => e.sentiment === sentiment);
      return { sentiment, turns: n(xs), share: share(xs, E) };
    }),
    byInquiry: [...byInquiry].map(([key, xs]) => ({ key, turns: n(xs), negativeShare: share(xs.filter(isNegative), xs) }))
      .sort((a, b) => (b.negativeShare ?? -1) - (a.negativeShare ?? -1) || (b.turns ?? 0) - (a.turns ?? 0)),
    about: ABOUT_LABELS.filter((a) => a !== "none").map((about) => {
      const xs = negByAbout.get(about) ?? [];
      return { about, turns: n(xs), share: share(xs, negative) };
    }),
    after: AFTER.map((after) => {
      const xs = byAfter.get(after) ?? [];
      const neg = xs.filter(isNegative);
      return { after, negative: n(neg), negativeShare: share(neg, xs) };
    }),
    reasons: FEEDBACK_REASONS.map((reason) => ({ reason, votes: n(down.filter((v) => v.reason === reason)) })),
  });
}

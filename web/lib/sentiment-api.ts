import { makeFunctionReference } from "convex/server";

/* Typed reference to ../convex/sentiment.ts summary, mirroring lib/analytics/sentiment.ts SentimentSummary. Keep them in step. */
export type Sentiment = "positive" | "neutral" | "confused" | "frustrated" | "angry";
export type About = "answer" | "price" | "service" | "app" | "none";
export type After = "first" | "answered" | "unavailable" | "failed" | "stopped" | "menu" | "repeat";
export type Reason = "wrong" | "unclear" | "missing" | "other";

/** A hidden count (fewer customers than the minimum group) is null, and so is any share built on it. */
export type SentimentSummary = {
  /** The minimum group size this deployment applies (ANALYTICS_MIN_GROUP, 1 on dev), when the backend reports it */
  minCount?: number;
  kpis: { conversations: number | null; turns: number | null; negativeConversationShare: number | null; thumbsDownShare: number | null; votes: number | null };
  daily: { date: string; turns: number | null; positive: number | null; neutral: number | null; negative: number | null }[];
  mix: { sentiment: Sentiment; turns: number | null; share: number | null }[];
  byInquiry: { key: string; turns: number | null; negativeShare: number | null }[];
  about: { about: Exclude<About, "none">; turns: number | null; share: number | null }[];
  after: { after: After; negative: number | null; negativeShare: number | null }[];
  reasons: { reason: Reason; votes: number | null }[];
};

export type SentimentFilter = { from: string; to: string; track?: "personal" | "business"; entry?: "web" | "smartMobile" };

export const sentimentApi = {
  summary: makeFunctionReference<"query", SentimentFilter, SentimentSummary>("sentiment:summary"),
};

/** The default minimum group size (convex/analyticsConfig.ts), for the "<10" labels when the summary doesn't say. */
export const MIN_GROUP = 10;

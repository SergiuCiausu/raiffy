import { describe, expect, it } from "vitest";
import { summarizeSentiment, type AnswerFeedback, type SentimentEvent } from "./sentiment";

const filter = { from: "2026-10-27", to: "2026-10-28", minCount: 3 };

const ev = (i: number, over: Partial<SentimentEvent> = {}): SentimentEvent => ({
  at: "2026-10-28T09:00:00Z", conversationKey: `c${i}`, customerKey: `u${i}`, track: "personal", entry: "web",
  inquiry: "affordability", sentiment: "neutral", about: "none", confidence: 0.8, after: "answered", ...over,
});
const vote = (i: number, over: Partial<AnswerFeedback> = {}): AnswerFeedback => ({
  at: "2026-10-28T09:01:00Z", conversationKey: `c${i}`, customerKey: `u${i}`, track: "personal", entry: "web", answerKey: `a${i}`, vote: "up", ...over,
});

// Six customers: three neutral, three frustrated about a price after an unavailable answer.
const events = [
  ...[1, 2, 3].map((i) => ev(i)),
  ...[4, 5, 6].map((i) => ev(i, { sentiment: "frustrated", about: "price", after: "unavailable", inquiry: "fees_statements" })),
];

describe("summarizeSentiment", () => {
  it("counts conversations with a negative message and shares by sentiment, pattern, topic and previous answer", () => {
    const s = summarizeSentiment(events, [], filter);
    expect(s.kpis).toMatchObject({ conversations: 6, turns: 6, negativeConversationShare: 0.5 });
    expect(s.mix.find((m) => m.sentiment === "frustrated")).toEqual({ sentiment: "frustrated", turns: 3, share: 0.5 });
    expect(s.byInquiry[0]).toEqual({ key: "fees_statements", turns: 3, negativeShare: 1 });
    expect(s.about.find((a) => a.about === "price")).toEqual({ about: "price", turns: 3, share: 1 });
    expect(s.after.find((a) => a.after === "unavailable")).toEqual({ after: "unavailable", negative: 3, negativeShare: 1 });
  });

  it("hides any group with fewer distinct customers than the minimum, and every share built on it, never showing 0", () => {
    const s = summarizeSentiment([...events, ev(7, { sentiment: "angry", about: "service" })], [], filter);
    expect(s.mix.find((m) => m.sentiment === "angry")).toEqual({ sentiment: "angry", turns: null, share: null });
    expect(s.mix.find((m) => m.sentiment === "positive")).toEqual({ sentiment: "positive", turns: null, share: null });
    // One customer writing many messages is still one person.
    const one = summarizeSentiment([1, 2, 3, 4].map((m) => ev(1, { conversationKey: `c${m}` })), [], filter);
    expect(one.kpis).toMatchObject({ conversations: null, turns: null, negativeConversationShare: null });
  });

  it("suppresses each day on its own, and leaves days outside the filter or track out", () => {
    const s = summarizeSentiment([...events, ev(9, { at: "2026-10-27T10:00:00Z" }), ev(10, { at: "2026-10-26T10:00:00Z" })], [], { ...filter, track: "personal" });
    expect(s.daily).toEqual([
      { date: "2026-10-27", turns: null, positive: null, neutral: null, negative: null },
      { date: "2026-10-28", turns: 6, positive: null, neutral: 0.5, negative: 0.5 },
    ]);
    expect(summarizeSentiment(events, [], { ...filter, track: "business" }).kpis.turns).toBeNull();
  });

  it("counts the latest vote per answer, and why answers were voted down", () => {
    const feedback = [
      ...[1, 2, 3].map((i) => vote(i, { vote: "down", reason: "unclear" })),
      ...[4, 5, 6].map((i) => vote(i)),
      vote(1, { at: "2026-10-28T09:05:00Z", vote: "up" }),
    ];
    const s = summarizeSentiment(events, feedback, filter);
    expect(s.kpis.votes).toBe(6);
    expect(s.kpis.thumbsDownShare).toBeNull(); // two customers voted down in the end, under the minimum
    expect(summarizeSentiment(events, feedback.slice(0, 6), filter).kpis.thumbsDownShare).toBe(0.5);
    expect(summarizeSentiment(events, feedback.slice(0, 6), filter).reasons.find((r) => r.reason === "unclear")!.votes).toBe(3);
  });
});

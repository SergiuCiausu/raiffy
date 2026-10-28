import { z } from "zod";

/*
 * Parses swipe-cards/raiffy-150-did-you-know-finance-posts.md: each "## " heading is a topic,
 * each "| # | text | Tag |" row a fact. Pure: the markdown comes in as a string.
 */

export const FactSchema = z.object({
  id: z.number().int(),
  topic: z.number().int().nonnegative(),
  tag: z.string(),
  headline: z.string(),
  support: z.string(),
});
export type Fact = z.infer<typeof FactSchema>;

export const TopicFactsSchema = z.object({ name: z.string(), facts: z.array(FactSchema) });
export type TopicFacts = z.infer<typeof TopicFactsSchema>;

export function parseFacts(md: string): TopicFacts[] {
  const topics: TopicFacts[] = [];
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s+(.+)/);
    if (h?.[1]) { topics.push({ name: h[1].trim(), facts: [] }); continue; }
    const row = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*([A-Za-z]+)\s*\|\s*$/);
    const topic = topics.at(-1);
    if (!row || !topic) continue;
    const [, num = "", text = "", tag = ""] = row;
    const q = text.indexOf("? "); // "…that X? Supporting sentence." → headline + support
    topic.facts.push({
      id: Number(num),
      topic: topics.length - 1,
      tag: tag.toUpperCase(),
      headline: q > -1 ? text.slice(0, q + 1) : text,
      support: q > -1 ? text.slice(q + 2) : "",
    });
  }
  return topics;
}

/** "All topics" interleaves the topics so consecutive cards vary. */
export function interleave(topics: TopicFacts[]): Fact[] {
  const out: Fact[] = [];
  for (let i = 0; topics.some((t) => t.facts[i]); i++) {
    for (const t of topics) { const f = t.facts[i]; if (f) out.push(f); }
  }
  return out;
}

import type { RoutePlan } from "./route";

/*
 * Answer-shape instructions per pattern, sent to the answer model as a trusted system block after the route.
 * They follow raiffy-spec/docs/individuals/answer-patterns.md; patterns without an entry use the core prompt only.
 */

/** The most items a list answer shows before it groups them or says how many more there are. */
export const LIST_MAX_ITEMS = 8;

const LISTING = [
  "Answer pattern 12, list and overview.",
  "Start with one sentence saying what the list covers, for example Raiffeisen's savings products for individuals.",
  `Then a bullet list, one item per line starting with "- ": a short **bold** name, then one sentence on what it is or its key condition, with its citation. Put the items most relevant to what the customer said first.`,
  `List every matching item the search results contain, up to ${LIST_MAX_ITEMS}. If there are more, group them or end the list with how many more there are. Never pad the list with items the results don't support, and if the results may not cover the whole category, say so.`,
  "End with one short question inviting the customer to pick an item to look at more closely.",
].join(" ");

export function answerGuide(plan: Pick<RoutePlan, "inquiry" | "scope">): string | null {
  return plan.inquiry === "listing" || plan.scope === "list" ? LISTING : null;
}

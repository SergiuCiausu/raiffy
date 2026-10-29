import { z } from "zod";
import { ANALYTICS_MIN_GROUP } from "../analytics/schemas";
import { REVIEW_DAYS } from "../rag/provenance";
import { AGENT_POLICY } from "./config";
import { MEMORY_POLICY } from "./memory";

/*
 * What the console's Rules page lists (raiffy-spec/docs/shared/console.md → Rules), read-only:
 * - hard limits: behavior rules in code, each with the file that enforces it and the eval cases that protect it;
 * - parameters: the policy values the code uses today, read from where they live, so the page can't drift from them.
 * Editable, dated parameters arrive with versioning; until then changing one is a code change.
 */

export const evalRefSchema = z.object({ file: z.string().regex(/^evals\/[\w-]+\.json$/), ids: z.array(z.string().min(1)) });

export const hardLimitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.string().min(1),
  enforcedIn: z.array(z.string().min(1)).min(1),
  /** Eval cases that protect it; an empty list means none yet. */
  evals: z.array(evalRefSchema),
});
export type HardLimit = z.infer<typeof hardLimitSchema>;

export const HARD_LIMITS: HardLimit[] = z.array(hardLimitSchema).parse([
  {
    id: "privacy-screen", name: "Personal details are screened out",
    text: "Every message passes a pattern-based screen before it is stored or sent to Jev or Claude. It removes IBANs, emails, CNPs, phone and card numbers, stated names and codes. It is not a full privacy classifier.",
    enforcedIn: ["lib/agent/privacy.ts"],
    evals: [{ file: "evals/jev-transport.json", ids: ["JEV-T02"] }],
  },
  {
    id: "owner-scope", name: "Data stays with its owner and track",
    text: "Chats, memories and catalog values are read only for the signed-in customer and their track. Another person’s IDs never widen it.",
    enforcedIn: ["convex/agentAuth.ts", "convex/memoryAuth.ts"],
    evals: [
      { file: "evals/memory-store.json", ids: ["MEM-04", "MEM-05"] },
      { file: "evals/catalog-terms.json", ids: ["CAT-05"] },
      { file: "evals/retrieval-isolation.json", ids: ["iso-p-factoring", "iso-p-cosme"] },
    ],
  },
  {
    id: "no-credit-decisions", name: "No credit decisions or offers",
    text: "Affordability is an indicative check. Raiffy never says a customer will be approved, never calls a simulation an offer, and asks instead of guessing income.",
    enforcedIn: ["lib/advice/check.ts", "lib/advice/recommend.ts"],
    evals: [{ file: "evals/advice-answers.json", ids: ["ANS-07", "ANS-09", "ANS-10"] }, { file: "evals/advice-recommend.json", ids: ["ADV-05"] }],
  },
  {
    id: "cited-numbers", name: "Every figure comes from a cited source",
    text: "The number check blocks an answer with a figure that isn’t in a passage cited that turn, a tool result or the customer’s own message.",
    enforcedIn: ["lib/rag/answer.ts", "lib/rag/agent.ts"],
    evals: [],
  },
  {
    id: "stale-values", name: "Stale or unreviewed values aren’t used",
    text: "A catalog value past its review date, without a located quote, or not yet signed off by a reviewer is listed as unavailable, never quoted.",
    enforcedIn: ["lib/catalog/terms.ts", "lib/calc/scenario.ts"],
    evals: [{ file: "evals/catalog-terms.json", ids: ["CAT-01", "CAT-02"] }, { file: "evals/calc-scenarios.json", ids: ["CALC-03"] }],
  },
  {
    id: "counter-offer-band", name: "Counter-offers stay inside the approved band",
    text: "Raiffy makes a counter-offer on its own only inside a pre-approved band. Anything beyond it goes to a person at the right approval level.",
    enforcedIn: ["lib/pricing/price.ts"],
    evals: [{ file: "evals/pricing-negotiation.json", ids: ["PRICE-05", "PRICE-06"] }],
  },
  {
    id: "hardship-fraud", name: "No offers in hardship or a possible fraud",
    text: "When a message reads as financial hardship or a scam in progress, offers are held back and the answer turns to help.",
    enforcedIn: ["lib/agent/route.ts"],
    evals: [{ file: "evals/agent-routing.json", ids: [] }],
  },
]);

export const PARAMETER_UNITS = ["lei", "percentagePoints", "days", "people"] as const;

export const policyParameterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  value: z.number(),
  unit: z.enum(PARAMETER_UNITS),
  usedBy: z.string().min(1),
  definedIn: z.string().min(1),
});
export type PolicyParameter = z.infer<typeof policyParameterSchema>;

export const POLICY_PARAMETERS: PolicyParameter[] = z.array(policyParameterSchema).parse([
  { id: "near-tie", name: "Recommendation near-tie margin", value: AGENT_POLICY.calculator.nearTieMarginBani / 100, unit: "lei",
    usedBy: "Recommendation rule: below this total-cost gap, the fixed schedule wins", definedIn: "lib/agent/config.ts" },
  { id: "variable-stress", name: "Variable-rate stress test", value: AGENT_POLICY.calculator.variableStressBps / 100, unit: "percentagePoints",
    usedBy: "The stressed payment shown next to a variable rate", definedIn: "lib/agent/config.ts" },
  { id: "review-volatile", name: "Review window for prices and limits", value: REVIEW_DAYS.volatile, unit: "days",
    usedBy: "Catalog import: review date of rates, fees, limits, terms and benefits", definedIn: "lib/rag/provenance.ts" },
  { id: "review-stable", name: "Review window for eligibility and documents", value: REVIEW_DAYS.stable, unit: "days",
    usedBy: "Catalog import: review date of eligibility rules and required documents", definedIn: "lib/rag/provenance.ts" },
  { id: "message-retention", name: "Chat message retention", value: MEMORY_POLICY.sourceRetentionDays, unit: "days",
    usedBy: "Chats, and the sentiment labels made from them, are deleted after this", definedIn: "lib/agent/memory.ts" },
  { id: "analytics-min", name: "Analytics minimum group size", value: ANALYTICS_MIN_GROUP, unit: "people",
    usedBy: "Analytics and Sentiment hide any smaller group", definedIn: "lib/analytics/schemas.ts" },
]);

import { z } from "zod";

/*
 * Thresholds of the insight rules, from the "From Raiffy" card definitions
 * (raiffy-spec/docs/shared/raiffy-recommendations/). Versioned policy data, passed into the summary as an argument;
 * the console will edit them later like the catalog. Money in bani.
 */

export const insightRulesSchema = z.object({
  version: z.string(),
  /** 01: overdraft interest of at least this much in each of the last 2 months. */
  overdraftInterestMin: z.number().int().min(0),
  /** 02: at least this many withdrawals at other banks' ATMs in the last month. */
  atmOtherMin: z.number().int().min(1),
  /** 03: at least this much in currency conversion costs in the last month. */
  fxFeesMin: z.number().int().min(0),
  /** 04: the current balance at least this much above the usual monthly spending, with no overdraft in use. */
  idleCashMin: z.number().int().min(0),
});
export type InsightRules = z.infer<typeof insightRulesSchema>;

export const INSIGHT_RULES: InsightRules = insightRulesSchema.parse({
  version: "insights@1",
  overdraftInterestMin: 3_000,
  atmOtherMin: 2,
  fxFeesMin: 2_500,
  idleCashMin: 500_000,
});

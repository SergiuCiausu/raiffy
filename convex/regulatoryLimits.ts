import { internalQuery } from "./_generated/server";
import { affordabilityLimitsSchema, type AffordabilityLimits } from "../lib/calc/affordability";

const KEYS = { maxDebtShareRon: "dti_max_share_ron", maxDebtShareFx: "dti_max_share_fx", maxConsumerTermMonths: "consumer_loan_max_months" } as const;

/**
 * The debt-service limits for the affordability calculator, or null when any is missing: the calculator then
 * reports itself unavailable instead of running on assumed values. The weakest review status wins.
 */
export const affordabilityLimits = internalQuery({
  args: {},
  handler: async (ctx): Promise<AffordabilityLimits | null> => {
    const rows = await Promise.all(Object.values(KEYS).map((key) => ctx.db.query("regulatoryLimits").withIndex("by_key", (q) => q.eq("key", key)).unique()));
    if (rows.some((row) => !row)) return null;
    const [ron, fx, term] = rows as NonNullable<(typeof rows)[number]>[];
    const parsed = affordabilityLimitsSchema.safeParse({
      maxDebtShareRon: ron!.value, maxDebtShareFx: fx!.value, maxConsumerTermMonths: term!.value,
      source: { label: ron!.sourceLabel, url: ron!.sourceUrl, validFrom: ron!.validFrom,
        status: rows.every((row) => row!.status === "approved") ? "approved" : "pending_review" },
    });
    return parsed.success ? parsed.data : null;
  },
});

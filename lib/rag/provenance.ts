import { z } from "zod";
import { bankSchema } from "./schemas";

const DAY_MS = 86_400_000;

/**
 * Days a collected value stays usable before it must be checked again (plan: raiffy-spec/docs/plans/retrieval.md).
 * Rates, fees, limits and campaigns change often; eligibility rules and document lists less so.
 */
export const REVIEW_DAYS = { volatile: 30, stable: 90 } as const;
export type Volatility = keyof typeof REVIEW_DAYS;

export const provenanceSchema = z.object({
  bank: bankSchema,
  /** Shown as the citation. */
  url: z.url(),
  chunkId: z.string().min(1).optional(),
  collectedAt: z.iso.datetime({ offset: true }),
  /** When the source states one ("valabil din ..."). */
  effectiveFrom: z.iso.date().optional(),
  reviewBy: z.iso.date(),
  status: z.enum(["fresh", "stale"]),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Collection date plus the review window, or the source's own end date when that comes first (YYYY-MM-DD). */
export function reviewByFor(collectedAt: string, volatility: Volatility, statedEnd?: string): string {
  const window = new Date(Date.parse(collectedAt) + REVIEW_DAYS[volatility] * DAY_MS).toISOString().slice(0, 10);
  return statedEnd && statedEnd < window ? statedEnd : window;
}

/** A value is stale from the day after its review date. `now` comes from the caller, never a hidden clock. */
export function freshness(reviewBy: string, now: number): Provenance["status"] {
  return new Date(now).toISOString().slice(0, 10) > reviewBy ? "stale" : "fresh";
}

export function buildProvenance(input: {
  bank: Provenance["bank"];
  url: string;
  chunkId?: string;
  collectedAt: string;
  effectiveFrom?: string;
  volatility: Volatility;
  statedEnd?: string;
  now: number;
}): Provenance {
  const reviewBy = reviewByFor(input.collectedAt, input.volatility, input.statedEnd);
  return provenanceSchema.parse({
    bank: input.bank,
    url: input.url,
    ...(input.chunkId ? { chunkId: input.chunkId } : {}),
    collectedAt: input.collectedAt,
    ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
    reviewBy,
    status: freshness(reviewBy, input.now),
  });
}

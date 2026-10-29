import { z } from "zod";
import type { TermRecord } from "../catalog/schemas";
import { gapReason } from "../catalog/terms";
import { exactAmount } from "../plan/build";
import { recommendationResultSchema, routeSchema, type RecommendationResult, type Route } from "./schemas";

/*
 * Which route Raiffy recommends, as a fixed rule (agreed 2026-10-28):
 *   1. hard limits: a route must be available, keep the debt share under the ceiling and leave money each month;
 *   2. the customer's timing: a route must have the money there by when they need it;
 *   3. the lowest interest and fees; a near tie goes to a fixed rate, then the lower payment, then the earlier start.
 * The customer's own loan term stands for that loan: other terms of it are trade-offs, picked only when the chosen
 * term breaks a hard limit. A missing input that would change the pick returns a question instead of a guess.
 * Every reason is checked against the routes shown, so a "lowest payment" is never claimed when another is lower.
 */

export const recommendInputSchema = z.object({
  routes: z.array(routeSchema).min(1),
  /** Months until the customer needs the money: 0 for now, null when they haven't said. */
  needByMonths: z.number().int().min(0).nullable(),
  policy: z.object({
    nearTieMarginBani: z.number().int().min(0),
    /** The bank's stated maximum debt share, from a reviewed catalog term. Null when none is stated: no "room" claim then. */
    debtShareCeiling: z.object({ bps: z.number().int().min(1).max(10_000), termId: z.string().min(1) }).nullable(),
  }),
});
export type RecommendInput = z.input<typeof recommendInputSchema>;

/**
 * The bank's stated maximum debt share from the catalog: a fresh, quoted, reviewed eligibility term of the product,
 * an exact value in basis points. Anything else is null, and the recommendation then makes no "room" claim.
 */
export function debtShareCeiling(records: readonly TermRecord[], termId: string | undefined, productId: string, now: number): { bps: number; termId: string } | null {
  if (!termId) return null;
  const r = records.find((x) => x.termId === termId);
  if (!r || r.productId !== productId || r.kind !== "eligibility" || r.unit !== "bps" || gapReason(r, now)) return null;
  const bps = exactAmount(r);
  return typeof bps === "number" && bps > 0 && bps <= 10_000 ? { bps, termId } : null;
}

type Excluded = RecommendationResult["excluded"][number];

const borrows = (r: Route) => r.borrowed > 0;
/** A save-only route carries no rate risk, so it counts as fixed. */
const isFixed = (r: Route) => r.rateType === "fixed" || r.kind === "save_only";
const outlay = (r: Route) => r.monthly ?? r.saving?.monthly ?? 0;

function best(routes: Route[], margin: number): { route: Route; nearTie: number | null } {
  const byCost = [...routes].sort((a, b) => a.cost! - b.cost!);
  const cheapest = byCost[0]!;
  const tied = byCost.filter((r) => r.cost! - cheapest.cost! < margin);
  if (tied.length === 1) return { route: cheapest, nearTie: null };
  const route = [...tied].sort((a, b) =>
    Number(isFixed(b)) - Number(isFixed(a)) || outlay(a) - outlay(b) || a.startsInMonths - b.startsInMonths || a.cost! - b.cost!)[0]!;
  return { route, nearTie: route === cheapest ? null : route.cost! - cheapest.cost! };
}

const result = (r: Partial<RecommendationResult> & Pick<RecommendationResult, "status">): RecommendationResult =>
  recommendationResultSchema.parse({ reasons: [], tradeOffs: [], excluded: [], needs: [], ...r });

export function recommendRoute(raw: RecommendInput): RecommendationResult {
  const { routes, needByMonths, policy } = recommendInputSchema.parse(raw);
  const shown = routes.filter((r) => r.status === "ok");
  const excluded: Excluded[] = routes.filter((r) => r.status !== "ok").map((r) => ({ route: r.key, reason: "not_available" as const }));
  if (!shown.length) return result({ status: "unavailable", excluded });

  // Affordability decides the hard limits, so it is never guessed
  if (shown.some(borrows) && shown.some((r) => r.debtShareBps === null)) {
    return result({ status: "needs_input", needs: needByMonths === null ? ["income_obligations", "need_by"] : ["income_obligations"], excluded });
  }

  const withinLimits = shown.filter((r) => {
    if (policy.debtShareCeiling && borrows(r) && r.debtShareBps! > policy.debtShareCeiling.bps) { excluded.push({ route: r.key, reason: "debt_share_over_ceiling" }); return false; }
    if (r.leftEachMonth! < 0) { excluded.push({ route: r.key, reason: "no_room_left" }); return false; }
    return true;
  });
  const onTime = withinLimits.filter((r) => {
    if (needByMonths !== null && r.startsInMonths > needByMonths) { excluded.push({ route: r.key, reason: "starts_too_late" }); return false; }
    return true;
  });

  // The customer's term stands for its loan while it fits
  const chosen = onTime.find((r) => r.chosen);
  const pickable = chosen ? onTime.filter((r) => r.variantOf !== chosen.key) : onTime;
  if (!pickable.length) return result({ status: "none_fits", excluded });

  const { route: pick, nearTie } = best(pickable, policy.nearTieMarginBani);
  if (needByMonths === null) {
    const nowRoutes = pickable.filter((r) => r.startsInMonths === 0);
    if (pick.startsInMonths > 0 && nowRoutes.length) return result({ status: "needs_input", needs: ["need_by"], excluded });
  }

  // Reasons, each true of every route shown
  const reasons: RecommendationResult["reasons"] = [];
  const startsNow = (r: Route) => r.startsInMonths === 0;
  if (startsNow(pick) && shown.some((r) => !startsNow(r))) reasons.push({ key: "starts_now" });
  if (pick.debtShareBps !== null && borrows(pick)) {
    reasons.push(policy.debtShareCeiling
      ? { key: "debt_share_room", params: { debtShareBps: pick.debtShareBps, ceilingBps: policy.debtShareCeiling.bps, ceilingTermId: policy.debtShareCeiling.termId } }
      : { key: "debt_share", params: { debtShareBps: pick.debtShareBps } });
  }
  if (pick.rateType === "fixed" && pick.repaymentMonths) reasons.push({ key: "fixed_rate", params: { months: pick.repaymentMonths } });
  const payments = (rs: Route[]) => rs.filter((r) => r.monthly !== null).map((r) => r.monthly!);
  if (pick.monthly !== null) {
    if (pick.monthly <= Math.min(...payments(shown))) reasons.push({ key: "lowest_payment" });
    else if (startsNow(pick) && shown.some((r) => !startsNow(r)) && pick.monthly <= Math.min(...payments(shown.filter(startsNow)))) reasons.push({ key: "lowest_payment_now" });
  }
  if (pick.cost! <= Math.min(...shown.map((r) => r.cost!))) reasons.push({ key: "cheapest" });
  if (pick.chosen) reasons.push({ key: "your_term" });
  if (!chosen && pick.variantOf) reasons.push({ key: "chosen_term_too_high", params: { chosenKey: pick.variantOf } });
  if (nearTie !== null) reasons.push({ key: "near_tie", params: { gap: nearTie } });

  const tradeOffs = shown.filter((r) => r !== pick).map((r) => {
    const monthlyDiff = r.monthly !== null && pick.monthly !== null ? r.monthly - pick.monthly : null;
    const costDiff = r.cost! - pick.cost!;
    const startsLaterMonths = r.startsInMonths - pick.startsInMonths;
    const key = costDiff < 0 && startsLaterMonths > 0 ? "cheaper_starts_later"
      : costDiff < 0 && (monthlyDiff ?? 0) > 0 ? "higher_payment_lower_cost"
      : costDiff > 0 && (monthlyDiff ?? 0) < 0 ? "lower_payment_higher_cost"
      : costDiff > 0 ? "costs_more" : "same_cost";
    return { route: r.key, key, monthlyDiff, costDiff, startsLaterMonths } as const;
  });

  // When another route would be the pick if the customer could wait
  const tooLate = new Set(excluded.filter((e) => e.reason === "starts_too_late").map((e) => e.route));
  const waitFor = withinLimits.filter((r) => tooLate.has(r.key) && r.cost! < pick.cost!).sort((a, b) => a.cost! - b.cost!)[0];
  const betterIf = waitFor ? { route: waitFor.key, condition: "can_wait" as const, startDate: waitFor.startDate, saves: pick.cost! - waitFor.cost! } : undefined;

  return result({ status: "ok", pick: pick.key, reasons, tradeOffs, ...(betterIf ? { betterIf } : {}), excluded });
}

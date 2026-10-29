import { z } from "zod";
import { scenarioGapSchema } from "../calc/scenario";

/*
 * Solution answers (CLAUDE.md "Answer scope"): at least three routes to the customer's goal, one recommended, with
 * the reason and when another route fits better. Routes and the recommendation are worked out here in code; the
 * model only frames them. Money is integer bani, rates and shares are integer basis points. Reasons and notes are
 * keys with values, written as English sentences by the UI.
 */

export const ROUTE_KINDS = ["loan", "overdraft", "save_then_borrow", "save_only"] as const;

export const routeSchema = z.object({
  /** "loan_60", "loan_48", "overdraft", "save_then_borrow", "save_only". */
  key: z.string().min(1),
  kind: z.enum(ROUTE_KINDS),
  productId: z.string().min(1).optional(),
  product: z.string().min(1).optional(),
  status: z.enum(["ok", "unavailable"]),
  /** Why an unavailable route can't be worked out, from the scenario calculator. */
  gaps: z.array(scenarioGapSchema),
  /** The customer's own term for the loan they asked about. */
  chosen: z.boolean(),
  /** Set on another term of the chosen loan: shown as a trade-off, picked only when the chosen term doesn't fit. */
  variantOf: z.string().min(1).optional(),
  /** Bani borrowed; 0 when nothing is borrowed. */
  borrowed: z.number().int().min(0),
  /** The saving phase before borrowing, or the whole route for save_only. */
  saving: z.object({ monthly: z.number().int().positive(), months: z.number().int().positive(), saved: z.number().int().positive() }).nullable(),
  /** Months from today until the money is there. */
  startsInMonths: z.number().int().min(0),
  startDate: z.iso.date(),
  repaymentMonths: z.number().int().positive().nullable(),
  /** What the customer repays each month, fees included; null when nothing is borrowed or the route is unavailable. */
  monthly: z.number().int().nullable(),
  /** The monthly payment with the stress added, for a variable rate. Affordability uses it. */
  stressedMonthly: z.number().int().nullable(),
  /** Interest and fees over the whole route, in bani; 0 for save_only. Null when unavailable. */
  cost: z.number().int().min(0).nullable(),
  rateBps: z.number().int().nullable(),
  rateType: z.enum(["fixed", "variable"]).nullable(),
  /** (repayment + other loan payments) / income. Null without the customer's income and obligations. */
  debtShareBps: z.number().int().min(0).nullable(),
  /** Income − obligations − the largest monthly outlay of the route (saving or repaying). Can be negative. */
  leftEachMonth: z.number().int().nullable(),
  /** The catalog records behind the figures. */
  termIds: z.array(z.string().min(1)),
});
export type Route = z.infer<typeof routeSchema>;

export const ROUTE_ASSUMPTIONS = ["savings_interest_not_counted", "savings_buffer_kept", "same_term_after_saving"] as const;

export const routesResultSchema = z.object({
  routes: z.array(routeSchema),
  assumptions: z.array(z.string().min(1)),
});
export type RoutesResult = z.infer<typeof routesResultSchema>;

/** Why a route can't be the recommendation. */
export const EXCLUSION_REASONS = ["not_available", "debt_share_over_ceiling", "no_room_left", "starts_too_late"] as const;

/** Why the pick is recommended. Each one is true of the routes shown, never only of some of them. */
export const REASON_KEYS = [
  "starts_now",            // the money is there now, while another route starts later
  "debt_share_room",       // debt share under the stated ceiling { debtShareBps, ceilingBps }
  "debt_share",            // debt share, with no ceiling to judge it against { debtShareBps }
  "fixed_rate",            // the payment stays the same { months }
  "lowest_payment",        // the lowest monthly payment of every route shown
  "lowest_payment_now",    // the lowest monthly payment of the routes that start now
  "cheapest",              // the lowest interest and fees of every route shown
  "your_term",             // the term the customer chose
  "near_tie",              // a near tie on cost, settled by a fixed rate or a lower payment { gap }
  "chosen_term_too_high",  // the customer's term breaks a limit, so another term of the same loan { chosenKey }
] as const;

/** How another route compares with the pick. */
export const TRADE_OFF_KEYS = [
  "higher_payment_lower_cost", "lower_payment_higher_cost", "cheaper_starts_later", "costs_more", "same_cost",
] as const;

export const NEEDED_INPUTS = ["income_obligations", "need_by"] as const;

const paramsSchema = z.record(z.string(), z.union([z.string(), z.number()]));

export const recommendationResultSchema = z.object({
  /**
   * ok: one route recommended. needs_input: an input that would change the pick is missing, so ask. none_fits: every
   * route breaks a hard limit. unavailable: no route could be worked out from the catalog.
   */
  status: z.enum(["ok", "needs_input", "none_fits", "unavailable"]),
  pick: z.string().min(1).optional(),
  reasons: z.array(z.object({ key: z.enum(REASON_KEYS), params: paramsSchema.optional() })),
  tradeOffs: z.array(z.object({
    route: z.string().min(1),
    key: z.enum(TRADE_OFF_KEYS),
    /** Route minus pick, in bani; months later it starts. */
    monthlyDiff: z.number().int().nullable(),
    costDiff: z.number().int(),
    startsLaterMonths: z.number().int(),
  })),
  /** The cheaper route the customer could take if their timing allowed it ("if it can wait until July 2027"). */
  betterIf: z.object({ route: z.string().min(1), condition: z.literal("can_wait"), startDate: z.iso.date(), saves: z.number().int().positive() }).optional(),
  excluded: z.array(z.object({ route: z.string().min(1), reason: z.enum(EXCLUSION_REASONS) })),
  needs: z.array(z.enum(NEEDED_INPUTS)),
});
export type RecommendationResult = z.infer<typeof recommendationResultSchema>;

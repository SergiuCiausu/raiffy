import { ANALYTICS_MIN_GROUP } from "../lib/analytics/schemas";

/**
 * The smallest group of distinct customers the Analytics and Sentiment pages show (the Console's `analytics-min`).
 * ANALYTICS_MIN_GROUP in a deployment's Convex environment overrides the spec's default: it's set to 1 on dev only,
 * so seeded test chats show; production leaves it unset and keeps the default. A request may raise it, never lower it.
 */
export function analyticsMinGroup(value = process.env.ANALYTICS_MIN_GROUP): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : ANALYTICS_MIN_GROUP;
}

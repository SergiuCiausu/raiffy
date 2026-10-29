import { z } from "zod";
import { AGENT_POLICY, type AgentPolicy } from "./config";
import { bankingIntent, familyOf, inquirySchema } from "./confidence";
import { jevResponseSchema } from "./jev";
import { planAgentRoute, type RouteContext } from "./route";

/** One labeled routing case. `accept` lists other patterns that are also a correct reading of an ambiguous message. */
export const routingCaseSchema = z.object({
  message: z.string().min(1),
  recentContext: z.string().optional(),
  inquiry: inquirySchema.optional(),
  accept: z.array(inquirySchema).optional(),
  risk: z.string().nullable().optional(),
}).passthrough();
export type RoutingCase = z.infer<typeof routingCaseSchema>;

const PASSED = ["answer", "orchestrator"];

export type RoutingScore = {
  cases: number; routed: number; correct: number;
  /** The error that matters most: a confident wrong pattern sent to the answer model. */
  wrongRouted: number;
  clarified: number; top1: number; family: number;
  riskCases: number; riskCaught: number;
  calibration: { bucket: string; n: number; accuracy: number | null }[];
  misses: { message: string; expected: string[]; got: string; handler: string; confidence: number | null }[];
};

/** Scores recorded Jev responses through the current route policy, so thresholds can be replayed without new Jev calls. */
export function scoreRouting(pairs: { case: RoutingCase; response: unknown }[], policy: AgentPolicy = AGENT_POLICY,
  context: RouteContext = { track: "personal", availableTools: ["search_knowledge"], availableCollections: ["bank_product_docs", "competitor_docs", "banking_help"] }): RoutingScore {
  const s: RoutingScore = { cases: 0, routed: 0, correct: 0, wrongRouted: 0, clarified: 0, top1: 0, family: 0, riskCases: 0, riskCaught: 0, calibration: [], misses: [] };
  const buckets = Array.from({ length: 5 }, () => ({ n: 0, right: 0 }));
  for (const { case: c, response } of pairs) {
    const parsed = jevResponseSchema.safeParse(response);
    if (!parsed.success) continue;
    const plan = planAgentRoute(parsed.data, { ...context, intentHints: bankingIntent(c.message) }, policy);
    if (c.risk) {
      s.riskCases++;
      if (plan.handler === c.risk || (plan.handler === "safe_boundary" && ["aml_evasion", "prompt_injection"].includes(c.risk))) s.riskCaught++;
      continue;
    }
    if (!c.inquiry) continue;
    const expected = [c.inquiry, ...(c.accept ?? [])];
    const a = parsed.data.answers.inquiry;
    s.cases++;
    if (expected.includes(a.choice)) s.top1++;
    if (expected.some(e => familyOf(e) === familyOf(a.choice))) s.family++;
    const bucket = buckets[Math.min(4, Math.floor(a.confidence * 5))]!;
    bucket.n++; if (expected.includes(a.choice)) bucket.right++;
    if (plan.handler === "clarify") s.clarified++;
    if (PASSED.includes(plan.handler)) {
      s.routed++;
      if (plan.inquiry && expected.includes(plan.inquiry)) s.correct++; else s.wrongRouted++;
    }
    if (!PASSED.includes(plan.handler) || !plan.inquiry || !expected.includes(plan.inquiry)) {
      s.misses.push({ message: c.message, expected, got: plan.inquiry ?? "-", handler: plan.handler, confidence: a.confidence });
    }
  }
  s.calibration = buckets.map((b, i) => ({ bucket: `${i * 20}-${i * 20 + 20}%`, n: b.n, accuracy: b.n ? b.right / b.n : null }));
  return s;
}

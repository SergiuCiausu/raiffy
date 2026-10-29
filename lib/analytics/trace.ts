import { z } from "zod";
import { answerTraceSchema, type AnswerTrace, type DataSource } from "./schemas";

/*
 * The analytics fields of one delivered answer (docs/shared/console.md → Analytics), worked out from its route and
 * the account-data tools the model actually called. Pure: the pipeline passes what happened in, nothing is read here.
 */

export const traceInputSchema = z.object({
  /** Jev's inquiry label, or null when routing didn't decide one. */
  inquiry: z.string().nullable(),
  handler: z.string(),
  /** The answer's status before a failed draft is replaced with "unavailable". */
  status: z.enum(["answered", "no_results", "refused", "failed_checks"]),
  attempts: z.number().int().min(0),
  /** Account-data tools that ran, with the holding kinds read for get_holdings. */
  tools: z.array(z.object({ name: z.string(), kinds: z.array(z.string()).optional() })),
});
export type TraceInput = z.infer<typeof traceInputSchema>;

export const traceFieldsSchema = answerTraceSchema.pick({ intent: true, dataUsed: true, evaluatorLoops: true, fallback: true, escalated: true, staleBlocked: true });
export type TraceFields = Pick<AnswerTrace, "intent" | "dataUsed" | "evaluatorLoops" | "fallback" | "escalated" | "staleBlocked">;

const INTENT: Record<string, AnswerTrace["intent"]> = {
  purchase_goal: "newLoan", affordability: "newLoan", debt_refinancing: "refinancing", cash_shortfall: "cashNeed",
  saving_goal: "savings", fees_statements: "feeQuestion",
};

/** Holding kinds (lib/bank/schemas.ts) as the account-data rows of the Analytics page. */
const HOLDING_SOURCES: Record<string, DataSource[]> = {
  accounts: ["productsHeld"], savings: ["deposits"], loans: ["loans"], cards: ["limits"], offers: ["preApproved"], profile: ["ageResidency", "idStatus"],
};
const TOOL_SOURCES: Record<string, DataSource[]> = {
  get_expense_summary: ["transactions"],
  // Relationship pricing reads the products a customer holds (sample pricing in the POC)
  get_approved_offers: ["productsHeld"], negotiate_offer: ["productsHeld"],
};

const MODEL_HANDLERS = new Set(["answer", "orchestrator"]);

export function traceFields(raw: TraceInput): TraceFields {
  const input = traceInputSchema.parse(raw);
  const sources = new Set<DataSource>();
  for (const tool of input.tools) {
    const from = tool.name === "get_holdings" ? (tool.kinds ?? Object.keys(HOLDING_SOURCES)).flatMap((k) => HOLDING_SOURCES[k] ?? []) : TOOL_SOURCES[tool.name] ?? [];
    for (const s of from) sources.add(s);
  }
  return traceFieldsSchema.parse({
    intent: INTENT[input.inquiry ?? ""] ?? "other",
    dataUsed: [...sources].sort(),
    evaluatorLoops: Math.min(2, Math.max(0, input.attempts - 1)),
    // A model answer that didn't pass its checks, or a route with nothing to answer with
    fallback: input.handler === "unavailable" || (MODEL_HANDLERS.has(input.handler) && input.status !== "answered"),
    escalated: input.handler === "human_contact",
    // Not tracked yet: catalog gaps aren't reported back from the tools per answer
    staleBlocked: false,
  });
}

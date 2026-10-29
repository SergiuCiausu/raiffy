import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AGENT_POLICY } from "../lib/agent/config";
import { FALLBACK_SYSTEM, fallbackPrompt, fallbackSchema, readFallback, type FallbackRequest, type FallbackResult } from "../lib/agent/fallback";

/**
 * The small-model fallback for when Jev cannot decide. Called only from a Convex action with screened text.
 * Any failure returns null and the caller asks the customer instead; it never blocks or replaces the risk checks.
 */
export async function askFallbackModel(req: FallbackRequest, apiKey: string | undefined): Promise<FallbackResult | null> {
  if (!apiKey || (!req.candidates.length && !req.slots.length)) return null;
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 4_000 });
  try {
    const response = await client.messages.parse({
      model: AGENT_POLICY.fallbackModel, max_tokens: 256,
      // A labelling task: no thinking, lowest effort.
      thinking: { type: "disabled" }, output_config: { effort: "low", format: zodOutputFormat(fallbackSchema(req)) },
      system: FALLBACK_SYSTEM, messages: [{ role: "user", content: fallbackPrompt(req) }],
    });
    if (response.stop_reason !== "end_turn" || !response.parsed_output) return null;
    return readFallback(response.parsed_output, req);
  } catch { return null; }
}

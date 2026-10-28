import { z } from "zod";
import { AGENT_POLICY } from "./config";
import { jevResponseSchema } from "./jev";

export const JEV_TIMEOUT_MS = 2500;
export const JEV_MAX_RESPONSE_BYTES = 65_536;
export const jevUnavailableReasonSchema = z.enum([
  "disabled", "missing_api_key", "timeout", "provider_error", "invalid_response", "unexpected_classifier_version",
  "privacy_screening_required", "source_unavailable",
]);
export const jevTransportResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("classified"), classification: jevResponseSchema }).strict(),
  z.object({ status: z.literal("unavailable"), reason: jevUnavailableReasonSchema }).strict(),
]);
export type JevTransportResult = z.infer<typeof jevTransportResultSchema>;

export function validateJevTransportResponse(raw: unknown): JevTransportResult {
  const response = jevResponseSchema.safeParse(raw);
  if (!response.success) return jevTransportResultSchema.parse({ status: "unavailable", reason: "invalid_response" });
  if (response.data.model !== AGENT_POLICY.classifierModel) return jevTransportResultSchema.parse({ status: "unavailable", reason: "unexpected_classifier_version" });
  return jevTransportResultSchema.parse({ status: "classified", classification: response.data });
}

import { z } from "zod";
import { trackSchema } from "../rag/schemas";

export const memoryProposalSchema = z.object({
  operation: z.enum(["remember", "update", "forget"]),
  kind: z.enum(["goal", "preference", "constraint"]),
  text: z.string().trim().min(1).max(500),
  sourceMessageId: z.string().min(1),
  /** Verbatim customer evidence. The host must check it against its stored, redacted message. */
  customerQuote: z.string().trim().min(1).max(1000),
  replacesMemoryId: z.string().min(1).optional(),
}).strict();
export type MemoryProposal = z.infer<typeof memoryProposalSchema>;

export const memoryRecordSchema = z.object({
  id: z.string().min(1),
  ownerKey: z.string().min(1),
  track: trackSchema,
  /** Business records require an authorized organization scope; personal records have null. */
  organizationKey: z.string().min(1).nullable(),
  kind: z.enum(["goal", "preference", "constraint"]),
  text: z.string().trim().min(1).max(500),
  sourceMessageId: z.string().min(1),
  consentEventId: z.string().min(1),
  status: z.enum(["active", "superseded", "deleted"]),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict().refine((m) => m.expiresAt > m.updatedAt, "Expiry must follow the update")
  .refine((m) => (m.track === "business") === (m.organizationKey !== null), "Organization scope must match the track");
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export const memoryScopeSchema = z.object({
  /** All scope fields come from the trusted auth adapter, not tool arguments. */
  ownerKey: z.string().min(1),
  track: trackSchema,
  organizationKey: z.string().min(1).nullable(),
}).strict().refine((s) => (s.track === "business") === (s.organizationKey !== null), "Invalid organization scope");

/** Defense after owner-filtered retrieval; preserves relevance order and returns minimal model context. */
export function selectUserMemories(input: {
  scope: z.infer<typeof memoryScopeSchema>;
  records: unknown[];
  now: number;
  limit?: number;
}) {
  const scope = memoryScopeSchema.parse(input.scope);
  const now = z.number().int().nonnegative().parse(input.now);
  const limit = z.number().int().min(1).max(10).parse(input.limit ?? 3);
  return input.records.flatMap((raw) => {
    const result = memoryRecordSchema.safeParse(raw);
    if (!result.success) return [];
    const m = result.data;
    if (m.ownerKey !== scope.ownerKey || m.track !== scope.track || m.organizationKey !== scope.organizationKey
      || m.status !== "active" || m.expiresAt <= now || m.updatedAt > now) return [];
    return [{ id: m.id, kind: m.kind, text: m.text, updatedAt: m.updatedAt, expiresAt: m.expiresAt }];
  }).slice(0, limit);
}

/** Write gate stays disabled until auth, PII screening, consent and deletion are implemented together. */
export const MEMORY_POLICY = {
  persistenceEnabled: false,
  consent: "explicit_user_request",
  toolWrites: "proposals_only",
  retain: ["user_stated_goals", "user_stated_preferences", "user_stated_constraints"],
  exclude: ["credentials", "CNP", "card_numbers", "IBAN", "sensitive_merchant_details", "inferred_traits", "other_people_data"],
  ownerScope: "server_derived_user_and_authorized_organization",
  retention: "must_be_configured_before_enabling_persistence",
  corrections: "supersede_and_remove_old_embedding",
  deletion: "delete_record_embedding_and_user_caches",
} as const;

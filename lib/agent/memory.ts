import { z } from "zod";
import { trackSchema } from "../rag/schemas";
import { AGENT_POLICY, type AgentPolicy } from "./config";
import { RISKS, type JevResponse } from "./jev";

/** A stated figure is the customer's own claim with a date, never evidence for a bank rate or account balance. */
export const MEMORY_KINDS = ["goal", "preference", "constraint", "stated_financial"] as const;

export const memoryProposalSchema = z.object({
  operation: z.enum(["remember", "update", "forget"]),
  kind: z.enum(MEMORY_KINDS),
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
  kind: z.enum(MEMORY_KINDS),
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

export const memoryCandidateSchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  /** P(kind) × P(durable). It ranks proposals; it is never consent. */
  score: z.number().min(0).max(1),
}).strict();
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;

/**
 * Whether a message states something worth proposing for memory without the customer asking.
 * A candidate only lets Claude propose a change; nothing persists until the customer confirms it.
 */
export function scoreMemoryCandidate(answers: JevResponse["answers"], policy: AgentPolicy = AGENT_POLICY): MemoryCandidate | null {
  // Explicit requests have their own path; distress, fraud and sensitive messages are never mined for memory.
  if (answers.memory_operation.choice !== "none") return null;
  if (RISKS.some((risk) => answers[risk].noul >= policy.thresholds.riskReviewProbability)) return null;
  if (answers.special_category.noul >= policy.thresholds.specialCategoryProbability) return null;
  const kind = answers.memory_candidate.choice;
  if (kind === "none") return null;
  const score = (answers.memory_candidate.probabilities[kind] ?? 0) * answers.memory_durable.noul;
  return score >= policy.thresholds.memoryCandidate ? { kind, score } : null;
}

/**
 * Defaults for production: writes stay off. Signed-in customers can save memories only on a deployment where the owner
 * set RAIFFY_MEMORY_WRITES_ENABLED and pinned its URL (lib/agent/memory-store.ts), with consent per memory, screening,
 * expiry and deletion in force.
 */
export const MEMORY_POLICY = {
  persistenceEnabled: false,
  candidates: "explicit_request_or_jev_classifier",
  consent: "customer_confirms_each_memory",
  toolWrites: "proposals_only",
  retain: ["user_stated_goals", "user_stated_preferences", "user_stated_constraints", "user_stated_financials"],
  exclude: ["credentials", "CNP", "card_numbers", "IBAN", "sensitive_merchant_details", "special_category_data", "inferred_traits", "other_people_data"],
  ownerScope: "server_derived_user_and_authorized_organization",
  retention: "configured_for_dev_synthetic_demo_only",
  retentionDays: { goal: 365, preference: 365, constraint: 180, stated_financial: 90 },
  proposalRetentionDays: 7,
  sourceRetentionDays: 30,
  devDemo: "explicit_identity_and_persistence_flags_plus_verified_dev_deployment_url_pin",
  corrections: "supersede_and_remove_old_embedding",
  deletion: "delete_record_embedding_and_user_caches",
} as const;

export const contextMemorySchema = z.object({ kind: z.enum(MEMORY_KINDS), text: z.string().min(1).max(500), statedAt: z.number().int().nonnegative() }).strict();
export type ContextMemory = z.infer<typeof contextMemorySchema>;

/**
 * The system note that tells Claude what this customer confirmed for memory. Stated figures stay the customer's
 * dated claims: they reach answers only as calculator inputs, never as facts Claude repeats on its own.
 */
export function memoryContextNote(raw: readonly ContextMemory[]): string | undefined {
  const memories = z.array(contextMemorySchema).parse(raw);
  if (!memories.length) return undefined;
  const lines = memories.map((m) => `- ${m.kind}, stated ${new Date(m.statedAt).toISOString().slice(0, 10)}: ${m.text}`);
  return [
    "What this customer asked Raiffy to remember in earlier chats (their own statements, with the date they made them; not verified):",
    ...lines,
    "Use them to tailor routes, questions and next steps to this customer, and say so when you rely on one (\"as you told me\"). A stated figure is only a calculator input: pass it to check_affordability instead of repeating it. If the current message contradicts a memory, follow the message. Leave out memories that don't help with this question, and never use them to judge creditworthiness.",
  ].join("\n");
}

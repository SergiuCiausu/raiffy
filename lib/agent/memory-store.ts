import { z } from "zod";
import { trackSchema } from "../rag/schemas";
import { MEMORY_KINDS, MEMORY_POLICY, memoryProposalSchema, memoryScopeSchema } from "./memory";

export const DEMO_MEMORY_OWNER = "demo:raiffy-synthetic";
export const MEMORY_RETENTION_DAYS = MEMORY_POLICY.retentionDays;
export const PROPOSAL_RETENTION_DAYS = MEMORY_POLICY.proposalRetentionDays;
export const MESSAGE_RETENTION_DAYS = MEMORY_POLICY.sourceRetentionDays;
const DAY = 86_400_000;

export const memoryEnvironmentSchema = z.object({
  cloudUrl: z.string().optional(), siteUrl: z.string().optional(), demoDeploymentUrl: z.string().optional(),
  demoIdentityEnabled: z.boolean(), demoPersistenceEnabled: z.boolean(),
}).strict();
export type MemoryEnvironment = z.infer<typeof memoryEnvironmentSchema>;
export const memoryIdentitySchema = z.object({ tokenIdentifier: z.string().min(1), organizationKey: z.string().min(1).nullable() }).strict();
export type MemoryIdentity = z.infer<typeof memoryIdentitySchema>;
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

/** The pin is configured only after MCP selects dev; copied flags cannot enable another deployment. */
export function isDemoMemoryEnvironment(raw: MemoryEnvironment): boolean {
  const env = memoryEnvironmentSchema.parse(raw);
  if (!env.cloudUrl || !env.siteUrl || env.demoDeploymentUrl !== env.cloudUrl) return false;
  try {
    const cloud = new URL(env.cloudUrl); const site = new URL(env.siteUrl);
    const clean = (url: URL) => url.protocol === "https:" && !url.username && !url.password && !url.port
      && url.pathname === "/" && !url.search && !url.hash;
    return clean(cloud) && clean(site) && env.cloudUrl === cloud.origin && env.siteUrl === site.origin
      && cloud.hostname.endsWith(".convex.cloud")
      && site.hostname === cloud.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  } catch { return false; }
}

export function resolveMemoryScope(input: { identity: MemoryIdentity | null; track: z.infer<typeof trackSchema>; environment: MemoryEnvironment }): MemoryScope {
  const track = trackSchema.parse(input.track);
  const env = memoryEnvironmentSchema.parse(input.environment);
  const identity = input.identity === null ? null : memoryIdentitySchema.parse(input.identity);
  if (identity) {
    if (track === "business" && !identity.organizationKey) throw new Error("organization_required");
    return memoryScopeSchema.parse({ ownerKey: identity.tokenIdentifier, track, organizationKey: track === "business" ? identity.organizationKey : null });
  }
  if (!env.demoIdentityEnabled || !isDemoMemoryEnvironment(env)) throw new Error("authentication_required");
  if (track !== "personal") throw new Error("organization_required");
  return memoryScopeSchema.parse({ ownerKey: DEMO_MEMORY_OWNER, track, organizationKey: null });
}

/** Production/private persistence stays off until the real auth and privacy pipeline is accepted. */
export function requireMemoryPersistence(scope: MemoryScope, environment: MemoryEnvironment): void {
  const parsed = memoryScopeSchema.parse(scope);
  const env = memoryEnvironmentSchema.parse(environment);
  const persistenceEnabled = MEMORY_POLICY.persistenceEnabled || (env.demoPersistenceEnabled && isDemoMemoryEnvironment(env));
  if (!persistenceEnabled || parsed.ownerKey !== DEMO_MEMORY_OWNER || parsed.track !== "personal" || !env.demoIdentityEnabled
    || !isDemoMemoryEnvironment(env)) throw new Error("memory_persistence_disabled");
}

export function sameMemoryScope(a: MemoryScope, b: MemoryScope): boolean {
  const pick = (s: MemoryScope) => ({ ownerKey: s.ownerKey, track: s.track, organizationKey: s.organizationKey });
  const first = memoryScopeSchema.parse(pick(a)); const second = memoryScopeSchema.parse(pick(b));
  return first.ownerKey === second.ownerKey && first.track === second.track && first.organizationKey === second.organizationKey;
}

const screeningSchema = z.object({ maskedText: z.string().min(1).max(4000), memoryEligible: z.boolean() }).strict();
// Conservative demo guard, not a semantic privacy classifier. Real-customer writes remain disabled.
const excludedDetails = /\b(password|passcode|secret|api[ _-]?key|token|pin|cvv|cnp|iban|card number|account balance|parol\w*|sold\w*|my (?:wife|husband|partner|friend|mother|father|brother|sister|child|son|daughter)|(?:sotia|soția|sotul|soțul|mama|tata|fratele|sora|copilul) me\w*|health|medical|diagnos\w*|cancer|diabet\w*|pregnan\w*|depress\w*|suicid\w*|religio\w*|christian|muslim|jewish|politic\w*|party member|trade union|ethnic\w*|racial|sexual\w*|gay|lesbian|biometric\w*|genetic\w*|sanatat\w*|sănătat\w*|boal\w*|bolnav\w*|religie|sindicat\w*)\b/i;
const identifiers = /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b|\b\d(?:[\s-]?\d){12,18}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+\d[\d ()-]{7,}\d)/i;

export function screenMemorySource(raw: string): z.infer<typeof screeningSchema> {
  const text = z.string().trim().min(1).max(4000).parse(raw);
  const blocked = excludedDetails.test(text) || identifiers.test(text) || /\[REDACTED/i.test(text);
  return screeningSchema.parse({ maskedText: blocked ? "[REDACTED: excluded personal details]" : text, memoryEligible: !blocked });
}

export function memoryExpiry(kind: typeof MEMORY_KINDS[number], statedAt: number): number {
  return z.number().int().positive().parse(z.number().int().nonnegative().parse(statedAt)
    + MEMORY_RETENTION_DAYS[z.enum(MEMORY_KINDS).parse(kind)] * DAY);
}
export function retentionExpiry(now: number, days: number): number {
  return z.number().int().positive().parse(z.number().int().nonnegative().parse(now) + z.number().int().positive().parse(days) * DAY);
}

export function verifyMemoryEvidence(input: {
  proposal: unknown; source: { maskedText: string; memoryEligible: boolean; createdAt: number; expiresAt: number }; now: number;
}) {
  const proposal = memoryProposalSchema.parse(input.proposal);
  const source = z.object({ maskedText: z.string().min(1).max(4000), memoryEligible: z.boolean(), createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive() }).strict().parse(input.source);
  const now = z.number().int().nonnegative().parse(input.now);
  if (proposal.operation === "forget") throw new Error("use_customer_deletion_endpoint");
  if ((proposal.operation === "update") !== Boolean(proposal.replacesMemoryId)) throw new Error("invalid_memory_replacement");
  if (!source.memoryEligible || source.createdAt > now || source.expiresAt <= now
    || !screenMemorySource(source.maskedText).memoryEligible || !screenMemorySource(proposal.text).memoryEligible
    || !screenMemorySource(proposal.customerQuote).memoryEligible) throw new Error("memory_source_ineligible");
  if (!source.maskedText.includes(proposal.customerQuote) || !proposal.customerQuote.includes(proposal.text)) throw new Error("memory_quote_mismatch");
  const expiresAt = memoryExpiry(proposal.kind, source.createdAt);
  if (expiresAt <= now) throw new Error("memory_source_expired");
  return z.object({ proposal: memoryProposalSchema, expiresAt: z.number().int().positive(), proposalExpiresAt: z.number().int().positive() }).strict()
    .parse({ proposal, expiresAt, proposalExpiresAt: Math.min(expiresAt, source.expiresAt, retentionExpiry(now, PROPOSAL_RETENTION_DAYS)) });
}

export const memoryViewSchema = z.object({
  id: z.string(), kind: z.enum(MEMORY_KINDS), text: z.string().min(1).max(500), statedAt: z.number(), updatedAt: z.number(), expiresAt: z.number(),
}).strict();
export const proposalViewSchema = z.object({
  id: z.string(), operation: z.enum(["remember", "update"]), kind: z.enum(MEMORY_KINDS), text: z.string().min(1).max(500),
  customerQuote: z.string(), createdAt: z.number(), expiresAt: z.number(),
}).strict();
export const memoryListSchema = z.object({ memories: z.array(memoryViewSchema), proposals: z.array(proposalViewSchema) }).strict();
export const memoryChangeResultSchema = z.object({ status: z.enum(["proposed", "saved", "rejected", "forgotten"]), id: z.string() }).strict();
export const memoryDeleteResultSchema = z.object({ memoriesDeleted: z.number().int().nonnegative(), proposalsDeleted: z.number().int().nonnegative() }).strict();
export const recordedMemorySourceSchema = z.object({ conversationId: z.string().min(1), messageId: z.string().min(1), memoryEligible: z.boolean() }).strict();

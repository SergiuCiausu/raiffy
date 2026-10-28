import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { BANKS, type ScopeField, scopeFlagsSchema, SECTION_TYPES } from "../lib/rag/schemas";
import { memoryKind, memoryScopeFields } from "./memoryValidators";


/** Vector size of OpenAI text-embedding-3-small, the model the chunks and questions are embedded with. */
export const EMBEDDING_DIMENSIONS = 1536;

const track = v.union(v.literal("personal"), v.literal("business"));

const sectionType = v.union(...SECTION_TYPES.map((type) => v.literal(type)));
const bank = v.union(...BANKS.map((name) => v.literal(name)));
/** One boolean per (track, public collection): see `scopeField` in lib/rag/schemas.ts. */
const SCOPE_FIELDS = Object.keys(scopeFlagsSchema.shape) as ScopeField[];
const scopeFlags = Object.fromEntries(SCOPE_FIELDS.map((field) => [field, v.boolean()])) as Record<ScopeField, ReturnType<typeof v.boolean>>;

export default defineSchema({
  conversations: defineTable({ ...memoryScopeFields, createdAt: v.number(), expiresAt: v.number() })
    .index("by_scope", ["ownerKey", "track", "organizationKey"])
    .index("by_expiry", ["expiresAt"]),
  messages: defineTable({
    ...memoryScopeFields, conversationId: v.id("conversations"), role: v.literal("customer"),
    maskedText: v.string(), memoryEligible: v.boolean(), createdAt: v.number(), expiresAt: v.number(),
  }).index("by_conversation", ["conversationId"]).index("by_expiry", ["expiresAt"]),
  memoryProposals: defineTable({
    ...memoryScopeFields, status: v.union(v.literal("pending"), v.literal("confirmed")),
    operation: v.union(v.literal("remember"), v.literal("update")), kind: memoryKind, text: v.string(),
    customerQuote: v.string(), sourceMessageId: v.id("messages"), replacesMemoryId: v.optional(v.id("userMemories")),
    replacesUpdatedAt: v.optional(v.number()), memoryId: v.optional(v.id("userMemories")),
    createdAt: v.number(), expiresAt: v.number(), confirmedAt: v.optional(v.number()),
  }).index("by_scope_status", ["ownerKey", "track", "organizationKey", "status"])
    .index("by_source", ["sourceMessageId"]).index("by_memory", ["memoryId"]).index("by_replacement", ["replacesMemoryId"])
    .index("by_expiry", ["expiresAt"]),
  userMemories: defineTable({
    ...memoryScopeFields, kind: memoryKind, text: v.string(), sourceMessageId: v.id("messages"),
    consentEventId: v.id("memoryProposals"), status: v.literal("active"),
    statedAt: v.number(), updatedAt: v.number(), expiresAt: v.number(),
  }).index("by_scope_status", ["ownerKey", "track", "organizationKey", "status"])
    .index("by_expiry", ["expiresAt"]),
  ragChunks: defineTable({
    chunkId: v.string(),
    bank,
    text: v.string(),
    searchText: v.string(),
    /** Filled by `embeddings:embedPending` after import; chunks without it are not in the vector index yet. */
    embedding: v.optional(v.array(v.float64())),
    embeddingModel: v.optional(v.string()),
    embedded: v.boolean(),
    ...scopeFlags,
    sourceType: v.union(v.literal("product_page"), v.literal("pdf")),
    sectionType,
    url: v.string(),
    scrapedAt: v.string(),
    pageType: v.optional(v.string()),
    segment: v.optional(v.string()),
    product: v.optional(v.string()),
    productId: v.optional(v.string()),
    category: v.optional(v.string()),
    heading: v.optional(v.string()),
    docType: v.optional(v.string()),
    title: v.optional(v.string()),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    linkedProducts: v.optional(v.array(v.string())),
    currencies: v.optional(v.array(v.string())),
  })
    .index("by_chunkId", ["chunkId"])
    .index("by_embedded", ["embedded"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: SCOPE_FIELDS,
    })
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: SCOPE_FIELDS,
    }),

  /** A conversation is bound to one track for its whole life, so personal and business data never mix. */
  ragThreads: defineTable({
    track,
    title: v.string(),
    /** Optional only for legacy schema migration; authorization rejects unowned records. */
    ownerKey: v.optional(v.string()),
    organizationKey: v.optional(v.union(v.null(), v.string())),
  }).index("by_owner_scope", ["ownerKey", "track", "organizationKey"]),

  ragMessages: defineTable({
    threadId: v.id("ragThreads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    /** The validated RagAnswer (sources, checks, searches) for assistant messages. */
    answer: v.optional(v.any()),
    status: v.optional(v.union(v.literal("streaming"), v.literal("done"), v.literal("stopped"), v.literal("failed"))),
    requestMessageId: v.optional(v.id("ragMessages")),
    startedAt: v.optional(v.number()),
    steps: v.optional(v.array(v.object({ query: v.string(), focus: v.string(), results: v.optional(v.number()) }))),
    error: v.optional(v.string()),
  }).index("by_thread", ["threadId"]),
  agentRateLimits: defineTable({ ownerKey: v.string(), windowStart: v.number(), requests: v.number() })
    .index("by_owner", ["ownerKey"]),
  /** Regulatory parameters for indicative checks, each with its source; imported from catalog/regulatory-limits.jsonl. */
  regulatoryLimits: defineTable({
    key: v.string(),
    value: v.number(),
    sourceLabel: v.string(),
    sourceUrl: v.string(),
    validFrom: v.string(),
    status: v.union(v.literal("pending_review"), v.literal("approved")),
  }).index("by_key", ["key"]),
});

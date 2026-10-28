import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { memoryKind, memoryScopeFields } from "./memoryValidators";

/** Vector size of the embedding model the chunks were indexed with (multilingual-e5-base). */
export const EMBEDDING_DIMENSIONS = 768;

const sectionType = v.union(
  v.literal("overview"),
  v.literal("features"),
  v.literal("description"),
  v.literal("fees"),
  v.literal("fee_table"),
  v.literal("interest_rates"),
  v.literal("eligibility"),
  v.literal("required_documents"),
  v.literal("faq"),
  v.literal("representative_example"),
  v.literal("pdf"),
);

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
    text: v.string(),
    searchText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    visiblePersonal: v.boolean(),
    visibleBusiness: v.boolean(),
    sourceType: v.union(v.literal("product_page"), v.literal("pdf")),
    sectionType,
    url: v.string(),
    scrapedAt: v.string(),
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
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["visiblePersonal", "visibleBusiness"],
    })
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["visiblePersonal", "visibleBusiness"],
    }),
});

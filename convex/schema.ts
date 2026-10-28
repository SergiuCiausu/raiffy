import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { BANKS, type ScopeField, scopeFlagsSchema, SECTION_TYPES } from "../lib/rag/schemas";

/** Vector size of OpenAI text-embedding-3-small, the model the chunks and questions are embedded with. */
export const EMBEDDING_DIMENSIONS = 1536;

const track = v.union(v.literal("personal"), v.literal("business"));

const sectionType = v.union(...SECTION_TYPES.map((type) => v.literal(type)));
const bank = v.union(...BANKS.map((name) => v.literal(name)));
/** One boolean per (track, public collection): see `scopeField` in lib/rag/schemas.ts. */
const SCOPE_FIELDS = Object.keys(scopeFlagsSchema.shape) as ScopeField[];
const scopeFlags = Object.fromEntries(SCOPE_FIELDS.map((field) => [field, v.boolean()])) as Record<ScopeField, ReturnType<typeof v.boolean>>;

export default defineSchema({
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
  }),

  ragMessages: defineTable({
    threadId: v.id("ragThreads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    /** The validated RagAnswer (sources, checks, searches) for assistant messages. */
    answer: v.optional(v.any()),
  }).index("by_thread", ["threadId"]),
});

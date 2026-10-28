import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

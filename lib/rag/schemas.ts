import { z } from "zod";

export const SEGMENTS = [
  "persoane fizice",
  "premium banking",
  "private banking",
  "IMM",
  "corporate",
] as const;

export const SECTION_TYPES = [
  "overview",
  "features",
  "description",
  "fees",
  "fee_table",
  "interest_rates",
  "eligibility",
  "required_documents",
  "faq",
  "representative_example",
  "pdf",
] as const;

export const DOC_TYPES = ["tarife", "contract", "fisa", "regulament", "ghid", "termeni", "altele"] as const;

export const TRACKS = ["personal", "business"] as const;

export const segmentSchema = z.enum(SEGMENTS);
export const sectionTypeSchema = z.enum(SECTION_TYPES);
export const docTypeSchema = z.enum(DOC_TYPES);
export const trackSchema = z.enum(TRACKS);

export type Segment = z.infer<typeof segmentSchema>;
export type SectionType = z.infer<typeof sectionTypeSchema>;
export type DocType = z.infer<typeof docTypeSchema>;
export type Track = z.infer<typeof trackSchema>;

/** One line of raiffeisen-rag-package/data/chunks.jsonl (see its SCHEMA.md). */
export const rawChunkSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  metadata: z.object({
    source_type: z.enum(["product_page", "pdf"]),
    section_type: sectionTypeSchema,
    url: z.url(),
    scraped_at: z.iso.datetime({ offset: true }),
    product_id: z.string().optional(),
    product: z.string().optional(),
    segment: segmentSchema.optional(),
    category: z.string().nullish(),
    subcategory: z.string().nullish(),
    currencies: z.array(z.string()).optional(),
    heading: z.string().nullish(),
    part: z.number().int().optional(),
    doc_type: docTypeSchema.optional(),
    title: z.string().optional(),
    page_start: z.number().int().optional(),
    page_end: z.number().int().optional(),
    linked_products: z.array(z.string()).optional(),
    n_products_linking: z.number().int().optional(),
  }),
});
export type RawChunk = z.infer<typeof rawChunkSchema>;

/** A chunk as stored in the Convex `ragChunks` table. Optional fields are omitted, never null. */
export const ragChunkDocSchema = z.object({
  chunkId: z.string().min(1),
  text: z.string().min(1),
  searchText: z.string().min(1),
  embedding: z.array(z.number()).min(1),
  embeddingModel: z.string().min(1),
  visiblePersonal: z.boolean(),
  visibleBusiness: z.boolean(),
  sourceType: z.enum(["product_page", "pdf"]),
  sectionType: sectionTypeSchema,
  url: z.url(),
  scrapedAt: z.iso.datetime({ offset: true }),
  segment: segmentSchema.optional(),
  product: z.string().optional(),
  productId: z.string().optional(),
  category: z.string().optional(),
  heading: z.string().optional(),
  docType: docTypeSchema.optional(),
  title: z.string().optional(),
  pageStart: z.number().int().optional(),
  pageEnd: z.number().int().optional(),
  linkedProducts: z.array(z.string()).optional(),
  currencies: z.array(z.string()).optional(),
});
export type RagChunkDoc = z.infer<typeof ragChunkDocSchema>;

/** What a search returns to the caller: the stored chunk minus its vector, plus how it was ranked. */
export const searchHitSchema = ragChunkDocSchema.omit({ embedding: true, searchText: true }).extend({
  score: z.number(),
  denseRank: z.number().int().positive().optional(),
  lexicalRank: z.number().int().positive().optional(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchArgsSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  track: trackSchema,
  k: z.number().int().min(1).max(20).default(5),
  sectionTypes: z.array(sectionTypeSchema).optional(),
  docType: docTypeSchema.optional(),
});
export type SearchArgs = z.input<typeof searchArgsSchema>;

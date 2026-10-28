/**
 * Build the Convex import file for the `ragChunks` table. Chunks go in without vectors;
 * `embeddings:embedPending` then embeds them inside Convex with OpenAI.
 *
 *   pnpm rag:build-import [chunks.jsonl] [out.jsonl]
 *   pnpm exec convex import --table ragChunks --replace -y ragChunks.import.jsonl
 *   pnpm exec convex run embeddings:embedPending
 */
import { readFileSync, writeFileSync } from "node:fs";
import { toSearchText } from "../lib/rag/normalize";
import { ragChunkDocSchema, rawChunkSchema, type RagChunkDoc } from "../lib/rag/schemas";
import { buildProductSegments, deriveVisibility } from "../lib/rag/visibility";

const [chunksPath = "raiffeisen-rag-package/data/chunks.jsonl", outPath = "ragChunks.import.jsonl"] =
  process.argv.slice(2);

const chunks = readFileSync(chunksPath, "utf-8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => rawChunkSchema.parse(JSON.parse(line)));

const productSegments = buildProductSegments(chunks);
const docs: RagChunkDoc[] = chunks.map(({ id, text, metadata: m }) =>
  ragChunkDocSchema.parse({
    chunkId: id,
    text,
    searchText: toSearchText(text),
    embedded: false,
    ...deriveVisibility(m, productSegments),
    sourceType: m.source_type,
    sectionType: m.section_type,
    url: m.url,
    scrapedAt: m.scraped_at,
    segment: m.segment,
    product: m.product,
    productId: m.product_id,
    category: m.category ?? undefined,
    heading: m.heading ?? undefined,
    docType: m.doc_type,
    title: m.title,
    pageStart: m.page_start,
    pageEnd: m.page_end,
    linkedProducts: m.linked_products,
    currencies: m.currencies,
  }),
);

writeFileSync(outPath, docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
const personal = docs.filter((d) => d.visiblePersonal).length;
const business = docs.filter((d) => d.visibleBusiness).length;
const hidden = docs.filter((d) => !d.visiblePersonal && !d.visibleBusiness).length;
console.log(`${docs.length} docs -> ${outPath}; personal ${personal}, business ${business}, hidden ${hidden}`);

/**
 * Build the Convex import file for the `ragChunks` table from banks-data-package (Raiffeisen, ING, BCR).
 * Chunks go in without vectors; `embeddings:embedPending` then embeds them inside Convex with OpenAI.
 * Withdrawn products and chunks outside every track and collection (corporate) are left out.
 *
 *   pnpm rag:build-import [chunks.jsonl] [out.jsonl]
 *   pnpm exec convex import --table ragChunks --replace -y ragChunks.import.jsonl
 *   pnpm exec convex run embeddings:embedPending
 */
import { readFileSync, writeFileSync } from "node:fs";
import { toSearchText } from "../lib/rag/normalize";
import { PUBLIC_COLLECTIONS, ragChunkDocSchema, rawChunkSchema, type RagChunkDoc, scopeField, TRACKS } from "../lib/rag/schemas";
import { buildProductSegments, deriveScopeFlags } from "../lib/rag/visibility";

const [chunksPath = "banks-data-package/data/chunks.jsonl", outPath = "ragChunks.import.jsonl"] = process.argv.slice(2);

const chunks = readFileSync(chunksPath, "utf-8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => rawChunkSchema.parse(JSON.parse(line)));

const productSegments = buildProductSegments(chunks);
let withdrawn = 0;
let outOfScope = 0;
const docs: RagChunkDoc[] = [];
for (const { id, text, metadata: m } of chunks) {
  if (m.status === "withdrawn") {
    withdrawn++;
    continue;
  }
  const flags = deriveScopeFlags(m, productSegments);
  if (!Object.values(flags).some(Boolean)) {
    outOfScope++;
    continue;
  }
  docs.push(ragChunkDocSchema.parse({
    chunkId: id,
    bank: m.bank,
    text,
    searchText: toSearchText(text),
    embedded: false,
    ...flags,
    sourceType: m.source_type,
    sectionType: m.section_type,
    url: m.url,
    scrapedAt: m.scraped_at,
    pageType: m.page_type,
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
  }));
}

writeFileSync(outPath, docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
console.log(`${docs.length} docs -> ${outPath} (left out: ${withdrawn} withdrawn, ${outOfScope} outside every track)`);
for (const track of TRACKS) {
  const counts = PUBLIC_COLLECTIONS.map((c) => `${c} ${docs.filter((d) => d[scopeField(track, c)]).length}`);
  console.log(`  ${track}: ${counts.join(", ")}`);
}

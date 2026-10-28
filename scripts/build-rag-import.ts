/**
 * Build the Convex import file for the `ragChunks` table.
 *
 *   pnpm rag:build-import [chunks.jsonl] [embeddings.jsonl] [out.jsonl]
 *   pnpm exec convex import --table ragChunks --replace -y ragChunks.import.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { toSearchText } from "../lib/rag/normalize";
import { ragChunkDocSchema, rawChunkSchema, type RagChunkDoc } from "../lib/rag/schemas";
import { buildProductSegments, deriveVisibility } from "../lib/rag/visibility";

const [chunksPath = "raiffeisen-rag-package/data/chunks.jsonl",
  embeddingsPath = "tools/rag/.cache/embeddings.jsonl",
  outPath = "ragChunks.import.jsonl"] = process.argv.slice(2);

const readJsonl = (path: string): unknown[] =>
  readFileSync(path, "utf-8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));

const chunks = readJsonl(chunksPath).map((row) => rawChunkSchema.parse(row));
const embeddings = new Map<string, { model: string; embedding: number[] }>();
for (const row of readJsonl(embeddingsPath) as { id: string; model: string; embedding: number[] }[]) {
  embeddings.set(row.id, row);
}

const productSegments = buildProductSegments(chunks);
const docs: RagChunkDoc[] = chunks.map(({ id, text, metadata: m }) => {
  const vector = embeddings.get(id);
  if (!vector) throw new Error(`No embedding for chunk ${id}`);
  return ragChunkDocSchema.parse({
    chunkId: id,
    text,
    searchText: toSearchText(text),
    embedding: vector.embedding,
    embeddingModel: vector.model,
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
  });
});

const dims = new Set(docs.map((d) => d.embedding.length));
if (dims.size !== 1) throw new Error(`Mixed embedding sizes: ${[...dims].join(", ")}`);
writeFileSync(outPath, docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
const personal = docs.filter((d) => d.visiblePersonal).length;
const business = docs.filter((d) => d.visibleBusiness).length;
const hidden = docs.filter((d) => !d.visiblePersonal && !d.visibleBusiness).length;
console.log(`${docs.length} docs (dim ${[...dims][0]}) -> ${outPath}; personal ${personal}, business ${business}, hidden ${hidden}`);

/**
 * Build the Convex import file for the `productTerms` catalog from comparatie.csv, locating each value's exact
 * quote in the source chunks. Records start unreviewed; get_product_terms returns them as unavailable until
 * `catalog:markReviewed` signs them off.
 *
 *   pnpm catalog:build-import [comparatie.csv] [chunks.jsonl] [out.jsonl]
 *   pnpm exec convex import --table productTerms --replace -y productTerms.import.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildSeedRecords, parseSeedRows, type SeedChunk } from "../lib/catalog/seed";
import { rawChunkSchema } from "../lib/rag/schemas";

const [
  csvPath = "banks-data-package/data/comparison/comparatie.csv",
  chunksPath = "banks-data-package/data/chunks.jsonl",
  outPath = "productTerms.import.jsonl",
] = process.argv.slice(2);

const chunks: SeedChunk[] = readFileSync(chunksPath, "utf-8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => rawChunkSchema.parse(JSON.parse(line)))
  .filter(({ metadata: m }) => m.status !== "withdrawn")
  .map(({ id, text, metadata: m }) => ({ chunkId: id, text, url: m.url, scrapedAt: m.scraped_at, productId: m.product_id, product: m.product }));

const report = buildSeedRecords(parseSeedRows(readFileSync(csvPath, "utf-8")), chunks, Date.now());
writeFileSync(outPath, report.records.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(`${report.records.length} terms -> ${outPath}`);
console.log(`  quote found ${report.quoteFound}, stated missing ${report.unavailable}, not found ${report.quoteMissing.length}`);
for (const id of report.quoteMissing) console.log(`    no quote: ${id}`);
for (const id of report.skipped) console.log(`  skipped (no mapping): ${id}`);

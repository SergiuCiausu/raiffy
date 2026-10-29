/**
 * Build the Convex import file for the `products` table (lib/catalog/products.ts) from banks-data-package.
 * One row per product page, from the metadata the chunks already carry: no scraping, no model, no embeddings.
 *
 *   pnpm catalog:build-products [chunks.jsonl] [out.jsonl]
 *   pnpm exec convex import --table products --replace -y products.import.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildProducts } from "../lib/catalog/products";
import { rawChunkSchema } from "../lib/rag/schemas";

const [chunksPath = "banks-data-package/data/chunks.jsonl", outPath = "products.import.jsonl"] = process.argv.slice(2);

const chunks = readFileSync(chunksPath, "utf-8").split("\n").filter((line) => line.trim()).map((line) => rawChunkSchema.parse(JSON.parse(line)));
const products = buildProducts(chunks);
writeFileSync(outPath, products.map((p) => JSON.stringify(p)).join("\n") + "\n");

const counts = new Map<string, number>();
for (const p of products) if (!p.guide) counts.set(`${p.bank} ${p.kind}`, (counts.get(`${p.bank} ${p.kind}`) ?? 0) + 1);
console.log(`Wrote ${products.length} products (${products.filter((p) => p.guide).length} guide pages) to ${outPath}`);
console.log([...counts].sort().map(([k, n]) => `  ${k}: ${n}`).join("\n"));

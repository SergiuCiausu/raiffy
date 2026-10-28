/**
 * Retrieval evals for search_knowledge (cases and scoring: lib/rag/evaluation.ts).
 *
 *   pnpm rag:eval --offline        check every expected passage exists in banks-data-package and is in scope
 *   pnpm rag:eval [set ...]        run the sets on the cloud dev deployment through retrievalEval:run
 *   pnpm rag:eval --audit          data-level isolation audit over every stored chunk
 *
 * Sets: competitors, isolation, legacy (raiffeisen-rag-package/starter/eval_questions*.json). Default: all three.
 * The live run uses the deploy key from your Convex login (retrievalEval:run is internal). Each case is one
 * OpenAI embedding call.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { type RetrievalCase, retrievalCaseSchema, type RetrievalScore } from "../lib/rag/evaluation";
import { rawChunkSchema, scopeField, trackSchema } from "../lib/rag/schemas";
import { buildProductSegments, deriveScopeFlags } from "../lib/rag/visibility";

const CONVEX_BIN = "node_modules/convex/bin/main.js";
const BATCH = 20;
const LEGACY_FILES = ["eval_questions.json", "eval_questions_en.json", "eval_questions_extended.json"]
  .map((name) => `raiffeisen-rag-package/starter/${name}`);

const legacyCaseSchema = z.object({
  question: z.string().min(1),
  expected_url_contains: z.string().min(1),
  expected_text_contains: z.string().min(1),
  track: trackSchema.default("personal"),
  tags: z.array(z.string()).default([]),
});

function fileCases(path: string): RetrievalCase[] {
  const { cases } = z.object({ cases: z.array(z.unknown()) }).parse(JSON.parse(readFileSync(path, "utf8")));
  return cases.map((c) => retrievalCaseSchema.parse(c));
}

/** The Raiffeisen-only starter sets become bank_product_docs hit cases. */
function legacyCases(path: string): RetrievalCase[] {
  const stem = path.split("/").pop()!.replace(/\.json$/, "");
  return z.array(legacyCaseSchema).parse(JSON.parse(readFileSync(path, "utf8"))).map((q, i) => retrievalCaseSchema.parse({
    id: `${stem}-${String(i + 1).padStart(2, "0")}`,
    kind: "hit",
    question: q.question,
    track: q.track,
    collection: "bank_product_docs",
    lang: q.tags.includes("english") ? "en" : "ro",
    expectedUrlContains: q.expected_url_contains,
    expectedTextContains: q.expected_text_contains,
    tags: ["legacy", ...q.tags],
  }));
}

const SETS: Record<string, () => RetrievalCase[]> = {
  competitors: () => fileCases("evals/retrieval-competitors.json"),
  isolation: () => fileCases("evals/retrieval-isolation.json"),
  legacy: () => LEGACY_FILES.flatMap(legacyCases),
};

/** Expected passages must exist in the source data, not be withdrawn, and be visible in the case's track and collection. */
function checkOffline(sets: Record<string, RetrievalCase[]>): string[] {
  const chunks = readFileSync("banks-data-package/data/chunks.jsonl", "utf8").split("\n").filter((line) => line.trim())
    .map((line) => rawChunkSchema.parse(JSON.parse(line)));
  const productSegments = buildProductSegments(chunks);
  const active = chunks.filter((c) => c.metadata.status !== "withdrawn")
    .map((c) => ({ chunk: c, flags: deriveScopeFlags(c.metadata, productSegments) }));
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of Object.values(sets).flat()) {
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    if (c.kind !== "hit") continue;
    const matches = active.filter(({ chunk }) =>
      chunk.metadata.url.includes(c.expectedUrlContains!) && chunk.text.includes(c.expectedTextContains!));
    if (matches.length === 0) problems.push(`${c.id}: no chunk from ${c.expectedUrlContains} contains "${c.expectedTextContains}"`);
    else if (!matches.some(({ flags }) => flags[scopeField(c.track, c.collection as Parameters<typeof scopeField>[1])])) {
      problems.push(`${c.id}: ${matches[0]!.chunk.id} isn't visible in ${c.track}/${c.collection}`);
    }
  }
  return problems;
}

function deploymentName(): string {
  const configuration = readFileSync(".env.local", "utf8");
  const name = configuration.match(/^CONVEX_DEPLOYMENT\s*=\s*["']?dev:([\w-]+)/m)?.[1];
  assert.ok(name, "Configure the team's cloud dev deployment in .env.local first");
  return name;
}

function convexRun(deployment: string, fn: string, args: unknown): unknown {
  let out: string;
  try {
    out = execFileSync(process.execPath, [CONVEX_BIN, "run", "--deployment", deployment, fn, JSON.stringify(args)], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
    });
  } catch {
    // The CLI has already printed the function's error.
    console.error(`convex run ${fn} failed`);
    process.exit(1);
  }
  return JSON.parse(out);
}

const percent = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(0)}%` : "-");

function report(name: string, cases: RetrievalCase[], scores: RetrievalScore[], limit: number): number {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const hits = scores.filter((s) => s.kind === "hit");
  const line = (label: string, group: RetrievalScore[]) => {
    const found = group.filter((s) => s.hitRank !== null);
    const pages = group.filter((s) => s.pageRank !== null);
    const mrr = group.reduce((sum, s) => sum + (s.hitRank ? 1 / s.hitRank : 0), 0) / (group.length || 1);
    console.log(`  ${label.padEnd(6)} ${String(group.length).padStart(3)} cases  hit@1 ${percent(group.filter((s) => s.hitRank === 1).length, group.length)}`
      + `  hit@${limit} ${percent(found.length, group.length)}  MRR ${mrr.toFixed(2)}  page@${limit} ${percent(pages.length, group.length)}`);
  };
  console.log(`\n${name}`);
  if (hits.length) {
    line("hit", hits);
    for (const lang of ["en", "ro"] as const) {
      const group = hits.filter((s) => byId.get(s.id)?.lang === lang);
      if (group.length && group.length < hits.length) line(lang, group);
    }
  }
  for (const kind of ["coverage", "isolation"] as const) {
    const group = scores.filter((s) => s.kind === kind);
    if (group.length) console.log(`  ${kind.padEnd(9)} ${group.filter((s) => s.pass).length}/${group.length} pass`);
  }
  const violations = scores.reduce((n, s) => n + s.violations.length, 0);
  console.log(`  isolation violations: ${violations}`);
  for (const s of scores.filter((x) => !x.pass)) {
    const c = byId.get(s.id)!;
    const why = s.violations.length ? s.violations.join("; ")
      : c.kind === "coverage" ? `gaps [${s.gaps.join(", ")}], expected [${c.expectGaps!.join(", ")}]`
      : `"${c.expectedTextContains}" from ${c.expectedUrlContains} not in top ${limit}`
        + (s.pageRank ? ` (page at rank ${s.pageRank}, another chunk)` : "");
    console.log(`  FAIL ${s.id} (${s.status}): ${why}`);
    for (const t of s.top.slice(0, 3)) console.log(`       ${t.bank} ${t.sectionType} ${t.url}`);
  }
  return violations;
}

const { values, positionals } = parseArgs({
  options: { offline: { type: "boolean" }, audit: { type: "boolean" }, limit: { type: "string", default: "5" } },
  allowPositionals: true,
});
const names = positionals.length ? positionals : Object.keys(SETS);
for (const name of names) assert.ok(SETS[name], `Unknown set ${name}; choose from ${Object.keys(SETS).join(", ")}`);

if (values.offline) {
  const sets = Object.fromEntries(names.map((name) => [name, SETS[name]!()]));
  const problems = checkOffline(sets);
  for (const [name, cases] of Object.entries(sets)) console.log(`${name}: ${cases.length} cases`);
  for (const p of problems) console.log(`  ${p}`);
  console.log(problems.length ? `${problems.length} problems` : "Every expected passage exists and is in scope.");
  process.exitCode = problems.length ? 1 : 0;
} else if (values.audit) {
  const result = z.object({ checked: z.number(), counts: z.record(z.string(), z.number()), violations: z.array(z.string()) })
    .parse(convexRun(deploymentName(), "retrievalEval:audit", {}));
  console.log(`${result.checked} chunks checked`);
  for (const [key, n] of Object.entries(result.counts).sort()) console.log(`  ${key} ${n}`);
  for (const v of result.violations) console.log(`  ${v}`);
  console.log(`${result.violations.length} violations`);
  process.exitCode = result.violations.length ? 1 : 0;
} else {
  const deployment = deploymentName();
  const limit = Number(values.limit);
  let violations = 0;
  for (const name of names) {
    const cases = SETS[name]!();
    const scores: RetrievalScore[] = [];
    for (let i = 0; i < cases.length; i += BATCH) {
      scores.push(...(convexRun(deployment, "retrievalEval:run", { cases: cases.slice(i, i + BATCH), limit }) as RetrievalScore[]));
    }
    violations += report(name, cases, scores, limit);
  }
  process.exitCode = violations ? 1 : 0;
}

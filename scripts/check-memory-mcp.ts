import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { memoryChangeResultSchema, memoryListSchema } from "../lib/agent/memory-store";

// Uses the team's configured cloud dev deployment through the authenticated MCP. Synthetic data only.
const configuration = readFileSync(".env.local", "utf8");
assert.match(configuration, /^CONVEX_DEPLOYMENT\s*=\s*["']?dev:/m, "Configure a cloud dev deployment in .env.local first");
const expectedUrl = configuration.match(/^CONVEX_URL\s*=\s*["']?([^\s"'#]+)/m)?.[1];
assert.ok(expectedUrl && new URL(expectedUrl).protocol === "https:", "Expected a configured cloud Convex URL");
const child = spawn("pnpm", ["exec", "convex", "mcp", "start", "--project-dir", process.cwd(), "--deployment", "dev",
  "--disable-tools", "data,envList,insights,logs,runOneoffQuery,functionSpec"], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.resume();
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let sequence = 0;
createInterface({ input: child.stdout }).on("line", (line) => {
  let message: { id?: number; result?: unknown; error?: unknown };
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  const waiter = pending.get(message.id); if (!waiter) return;
  clearTimeout(waiter.timer); pending.delete(message.id);
  if (message.error) waiter.reject(new Error("Convex MCP protocol error")); else waiter.resolve(message.result);
});
child.on("exit", () => {
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("Convex MCP exited")); }
  pending.clear();
});
function request(method: string, params: unknown): Promise<unknown> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Convex MCP timeout: ${method}`)); }, 30_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) }).passthrough()
    .parse(await request("tools/call", { name, arguments: args }));
  if (result.isError) {
    // These tools only receive synthetic fixture data or non-secret boolean flag names.
    const details = result.content.filter((c) => c.type === "text").map((c) => c.text).join(" ");
    throw new Error(`Convex MCP tool failed: ${name}: ${details}`);
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const block = result.content.find((c) => c.type === "text" && c.text);
  if (!block?.text) throw new Error(`Convex MCP missing result: ${name}`);
  return JSON.parse(block.text) as unknown;
}

let deploymentSelector: string | undefined;
const previous = new Map<string, string | null>();
let proposalId: string | undefined; let memoryId: string | undefined;
try {
  await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raiffy-memory-smoke", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const status = z.object({ availableDeployments: z.array(z.object({ deploymentSelector: z.string(), url: z.string(), kind: z.string() }).passthrough()) }).parse(await call("status", { projectDir: process.cwd() }));
  assert.equal(status.availableDeployments.length, 1, "Expected one explicitly selected dev deployment");
  const deployment = status.availableDeployments[0]!;
  const url = new URL(deployment.url);
  assert.equal(url.protocol, "https:"); assert.ok(url.hostname.endsWith(".convex.cloud"));
  assert.equal(deployment.url, expectedUrl, "MCP dev selection must match the team's configured cloud deployment");
  assert.notEqual(deployment.kind, "prod");
  deploymentSelector = deployment.deploymentSelector;
  const tables = z.object({ tables: z.record(z.string(), z.unknown()) }).parse(await call("tables", { deploymentSelector }));
  for (const name of ["ragChunks", "conversations", "messages", "memoryProposals", "userMemories"]) assert.ok(name in tables.tables, `Missing table ${name}`);
  for (const name of ["RAIFFY_DEMO_DEPLOYMENT_URL", "RAIFFY_DEMO_IDENTITY_ENABLED", "RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED"]) {
    previous.set(name, z.object({ value: z.string().nullable() }).parse(await call("envGet", { deploymentSelector, name })).value);
    await call("envSet", { deploymentSelector, name, value: name === "RAIFFY_DEMO_DEPLOYMENT_URL" ? deployment.url : "true" });
  }
  async function run(functionName: string, args: Record<string, unknown>) {
    return z.object({ result: z.unknown() }).parse(await call("run", { deploymentSelector, functionName, args: JSON.stringify(args) })).result;
  }
  const before = memoryListSchema.parse(await run("memory:listMine", { track: "personal" }));
  const fixture = z.object({ proposalId: z.string(), messageId: z.string(), conversationId: z.string() }).parse(await run("memoryDemo:proposeFixture", {}));
  proposalId = fixture.proposalId;
  const proposed = memoryListSchema.parse(await run("memory:listMine", { track: "personal" }));
  assert.ok(proposed.proposals.some((p) => p.id === proposalId));
  assert.equal(proposed.memories.length, before.memories.length);
  const saved = memoryChangeResultSchema.parse(await run("memory:confirm", { track: "personal", proposalId }));
  assert.equal(saved.status, "saved"); memoryId = saved.id;
  assert.deepEqual(await run("memory:confirm", { track: "personal", proposalId }), saved);
  const after = memoryListSchema.parse(await run("memory:listMine", { track: "personal" }));
  assert.ok(after.memories.some((m) => m.id === memoryId));
  await run("memory:forgetOne", { track: "personal", memoryId }); memoryId = undefined; proposalId = undefined;
  assert.deepEqual(memoryListSchema.parse(await run("memory:listMine", { track: "personal" })), before);
  console.log(`Convex MCP: cloud dev ${url.hostname}, tables, proposal, confirmation, repeat confirmation, and deletion verified.`);
} finally {
  if (deploymentSelector) {
    // Clean only this run's fixture; never delete any existing demo memories.
    if (memoryId || proposalId) {
      await call("run", { deploymentSelector, functionName: memoryId ? "memory:forgetOne" : "memory:reject",
        args: JSON.stringify({ track: "personal", ...(memoryId ? { memoryId } : { proposalId }) }) }).catch(() => {
        console.error("Fixture cleanup failed; inspect the synthetic demo scope."); process.exitCode = 1;
      });
    }
    for (const [name, value] of [...previous].reverse()) {
      await call(value === null ? "envRemove" : "envSet", { deploymentSelector, name, ...(value === null ? {} : { value }) }).catch(() => {
        console.error(`Restore ${name} manually on cloud dev.`); process.exitCode = 1;
      });
    }
  }
  child.stdin.end(); child.kill();
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
}

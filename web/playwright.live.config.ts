import { defineConfig } from "@playwright/test";

/*
 * Live chat tests: the real Convex backend, with the Anthropic API replaced by e2e/live/mock-anthropic.mjs.
 * Needs three things running first (see web/README.md → "Testing the live chat"):
 *   node e2e/live/mock-anthropic.mjs
 *   npx convex dev            (repo root; ANTHROPIC_API_KEY=mock, ANTHROPIC_BASE_URL=http://127.0.0.1:4010)
 *   pnpm dev --port 3001      (web/, with NEXT_PUBLIC_CONVEX_URL in web/.env.local)
 * Run: pnpm test:live
 */
export default defineConfig({
  testDir: "e2e/live",
  testMatch: "**/*.live.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? "http://localhost:3001",
    channel: "chrome",
    viewport: { width: 1360, height: 900 },
    trace: "retain-on-failure",
  },
});

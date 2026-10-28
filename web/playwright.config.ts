import { defineConfig, devices } from "@playwright/test";

/*
 * End-to-end checks of the ported pages in a real browser. Run: pnpm test:e2e
 * Next allows one dev server per folder, so if one already runs on another port, pass it: E2E_PORT=3001 pnpm test:e2e
 */
const PORT = process.env.E2E_PORT ?? "3000";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the installed Google Chrome, so no browser download is needed
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1360, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome" } },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

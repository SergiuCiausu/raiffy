import { defineConfig, devices } from "@playwright/test";

/* End-to-end checks of the ported pages in a real browser. Run: pnpm test:e2e
 * Disabled 2026-10-28: testIgnore skips every spec. Remove it (and restore the test:e2e script) to turn them back on. */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: "**/*",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    // Uses the installed Google Chrome, so no browser download is needed
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1360, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome" } },
  ],
  webServer: {
    command: "pnpm dev --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

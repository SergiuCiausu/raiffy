import { test as base, expect, type Page } from "@playwright/test";

/**
 * Every test fails on a console error or an uncaught exception, which is how React reports
 * hydration mismatches and runtime errors.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await use(errors);
    expect(errors, "console errors / page errors").toEqual([]);
  }, { auto: true }],
});

export { expect };

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 600;

/** DESIGN.md: no horizontal scroll at phone width. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

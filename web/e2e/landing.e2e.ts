import { expect, expectNoHorizontalScroll, isMobile, test } from "./fixtures";

test.describe("landing /", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/"); });

  test("renders the hero and has no horizontal scroll", async ({ page }) => {
    await expect(page).toHaveTitle("Raiffy · AI Assistant");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Understand every financial decision before you make it");
    await expectNoHorizontalScroll(page);
  });

  test("nav turns to light glass after the hero", async ({ page }) => {
    const nav = page.locator("#nav");
    await expect(nav).not.toHaveClass(/is-light/);
    await page.locator("#features").scrollIntoViewIfNeeded();
    await expect(nav).toHaveClass(/is-light/);
  });

  test("feature cards reveal on scroll", async ({ page }) => {
    const card = page.locator("#features .card").first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveClass(/\bin\b/);
    await expect(card).toHaveCSS("opacity", "1");
  });

  test("simulator recommends, explains and reacts to the sliders", async ({ page }) => {
    const sim = page.locator(".simulator");
    await sim.scrollIntoViewIfNeeded();
    const explain = page.locator("#explain");
    await expect(explain).toContainText("I recommend the overdraft. Over 12 months it costs about 88 lei less");
    await expect(page.locator("#opt-od")).toHaveClass(/\brec\b/);
    await expect(page.locator("#loan-m")).toContainText("696");

    // Over the overdraft limit: the loan is the only fit
    await page.locator("#amt").fill("20000");
    await expect(page.locator("#amt-out")).toHaveText("20,000 lei");
    await expect(page.locator("#opt-od")).toHaveClass(/\bna\b/);
    await expect(page.locator("#od-m")).toContainText("—");
    await expect(page.locator("#opt-loan")).toHaveClass(/\brec\b/);
    await expect(explain).toContainText("20,000 lei is over the usual overdraft limit");

    // Longer term: the loan is cheaper (236 lei, the same figure the prototype shows)
    await page.locator("#amt").fill("8000");
    await page.locator("#term").fill("36");
    await expect(page.locator("#term-out")).toHaveText("36 months");
    await expect(explain).toContainText("Over 36 months it costs about 236 lei less");
    await expect(page.locator("#od-note")).toHaveText("Renews every 12 months; the rate can change.");
  });

  test("'What if I repay early?' swaps the answer and back", async ({ page }) => {
    await page.locator(".simulator").scrollIntoViewIfNeeded();
    const q = page.locator("#q-early");
    await q.click();
    await expect(q).toHaveText("Back to the comparison");
    await expect(page.locator("#explain")).toContainText("Say you pay it all off after 6 months");
    await expect(page.locator("#explain")).toContainText("about 20 lei");
    await q.click();
    await expect(page.locator("#explain")).toContainText("I recommend the overdraft");
  });

  test("links to sign-up and to Did you know", async ({ page }) => {
    await page.getByRole("link", { name: "Did you know" }).click();
    await expect(page).toHaveURL(/\/did-you-know$/);
    await page.goto("/");
    // The nav's Ask Raiffy button is visible at every width
    await page.locator("#nav").getByRole("link", { name: "Ask Raiffy" }).click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(page.getByRole("heading", { name: "Create your Raiffy account" })).toBeVisible();
  });

  test("nav links hide on phones", async ({ page }) => {
    test.skip(!isMobile(page), "phone only");
    await expect(page.locator(".nav-links")).toBeHidden();
  });
});

import { expect, expectNoHorizontalScroll, test } from "./fixtures";
import type { Page } from "@playwright/test";

const count = (page: Page) => page.locator(".deck-meta .mono");
const topCard = (page: Page) => page.locator(".swipe-card.is-top");

/** Drags the top card by a fraction of its width, staying inside the viewport so the pointer-up lands. */
async function drag(page: Page, fraction: number) {
  await topCard(page).scrollIntoViewIfNeeded(); // on phones the deck starts below the fold
  const box = (await topCard(page).boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const dx = fraction * box.width;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (dx * i) / 12, y + 4, { steps: 2 });
  await page.mouse.up();
}

test.describe("did you know", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/did-you-know"); });

  test("shows a stack of three cards from the markdown", async ({ page }) => {
    await expect(page).toHaveTitle("Did you know · Raiffy");
    await expect(page.locator(".swipe-card")).toHaveCount(3);
    await expect(topCard(page)).toHaveCount(1);
    await expect(count(page)).toHaveText("1 / 150");
    await expect(page.locator(".guide-empty")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("buttons and keys save, skip and undo", async ({ page }) => {
    const first = await topCard(page).locator("h4").innerText();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(count(page)).toHaveText("2 / 150");
    await expect(page.locator(".guide-h .mono")).toHaveText("1 saved");
    await expect(page.locator(".guide-list li")).toHaveCount(1);
    await expect(page.locator(".guide-list li.new b")).toHaveText(first.replace(/^Did you know\s*/, ""));
    await expect(page.locator(".swipe-card")).toHaveCount(3);

    await page.locator("#deck").press("ArrowLeft");
    await expect(count(page)).toHaveText("3 / 150");
    await expect(page.locator(".guide-h .mono")).toHaveText("1 saved");

    await page.getByRole("button", { name: "Undo last swipe" }).click();
    await expect(count(page)).toHaveText("2 / 150");
    await page.waitForTimeout(400); // the deck ignores input while a card flies back in, like the prototype
    await page.getByRole("button", { name: "Undo last swipe" }).click();
    await expect(count(page)).toHaveText("1 / 150");
    await expect(page.locator(".guide-h .mono")).toHaveText("0 saved");
    await expect(topCard(page).locator("h4")).toHaveText(first);
    await expect(page.getByRole("button", { name: "Undo last swipe" })).toBeDisabled();
  });

  test("dragging past the threshold saves; a short drag snaps back", async ({ page }) => {
    await drag(page, 0.1); // under the 30% threshold
    await page.waitForTimeout(500);
    await expect(count(page)).toHaveText("1 / 150");
    await expect(topCard(page)).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await drag(page, 0.45);
    await expect(count(page)).toHaveText("2 / 150");
    await expect(page.locator(".guide-h .mono")).toHaveText("1 saved");
    await page.waitForTimeout(400);
    await drag(page, -0.45);
    await expect(count(page)).toHaveText("3 / 150");
    await expect(page.locator(".guide-h .mono")).toHaveText("1 saved");
  });

  test("a topic filter narrows the deck, and finishing it shows the empty state", async ({ page }) => {
    const chip = page.getByRole("button", { name: "Fraud" });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const text = await count(page).innerText();
    const n = Number(text.split("/")[1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(150);
    await expect(topCard(page).locator(".eyebrow")).toHaveText("Fraud");
    for (let i = 0; i < n; i++) {
      await expect(count(page)).toHaveText(`${i + 1} / ${n}`);
      await page.locator("#deck").press("ArrowRight");
    }
    await expect(page.locator(".deck-empty")).toBeVisible();
    await expect(page.locator(".deck-empty h2")).toHaveText(`You’ve seen all ${n} Fraud facts`);
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(count(page)).toHaveText(`1 / ${n}`);
    await expect(page.locator(".swipe-card")).toHaveCount(3);
  });
});

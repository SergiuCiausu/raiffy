import { expect, expectNoHorizontalScroll, isMobile, test } from "./fixtures";
import type { Page } from "@playwright/test";

const thread = (page: Page) => page.locator("#thread");
const lastRaiffy = (page: Page) => thread(page).locator(".msg-raiffy").last();

async function openSidebar(page: Page) {
  if (isMobile(page)) await page.locator("#open-side").click();
}

test.describe("chat", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/chat/demo"); });

  test("opens on the seeded comparison with its cards and follow-ups", async ({ page }) => {
    await expect(page.locator("#title")).toHaveText("Loan or overdraft for 8,000 lei");
    await expect(page).toHaveTitle("Loan or overdraft for 8,000 lei · Raiffy");
    await expect(thread(page).locator(".msg-user")).toHaveCount(2);
    await expect(thread(page).getByText("Why I recommend the overdraft")).toBeVisible();
    await expect(thread(page).locator(".gcard.sim")).toBeVisible();
    await expect(page.locator("#chips .chip")).toHaveText([/Can I repay the loan early\?/, /Which documents do I need\?/, /Book an advisor/]);
    await expect(page.locator("#chips .chip").first().locator(".tab-kbd")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
  });

  test("the simulation card updates the recommendation", async ({ page }) => {
    const sim = thread(page).locator(".gcard.sim");
    await expect(sim.locator(".say")).toContainText("I recommend the personal loan.");
    await expect(sim.locator('[data-k="od"]')).toHaveClass(/\bna\b/);
    await sim.getByRole("button", { name: "12 mo" }).click();
    await expect(sim.getByRole("button", { name: "12 mo" })).toHaveAttribute("aria-pressed", "true");
    await expect(sim.locator('[data-k="od"]')).not.toHaveClass(/\bna\b/);
    await expect(sim.locator(".say")).toContainText("I recommend the overdraft.");
    await sim.locator(".sim-amt").fill("20000");
    await expect(sim.locator(".o-amt")).toHaveText("20,000 lei");
    await expect(sim.locator('[data-k="od"] .opt-note')).toHaveText("Overdraft limits go up to 15,000 lei.");
  });

  test("Tab fills a suggestion; sending thinks, streams and attaches a card", async ({ page }) => {
    const input = page.locator("#input");
    await input.focus();
    await input.press("Tab");
    await expect(input).toHaveValue("Can I repay the loan early?");
    await input.press("Tab");
    await expect(input).toHaveValue("Which documents do I need?");

    await input.fill("Why was I charged 5 lei on 22 October?");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(thread(page).locator(".msg-user").last()).toHaveText("Why was I charged 5 lei on 22 October?");
    await expect(page.locator(".think-live")).toBeVisible();
    await expect(page.locator("#send")).toHaveAttribute("aria-label", "Stop reply");
    await expect(lastRaiffy(page).locator(".caret")).toBeVisible({ timeout: 10_000 });
    await expect(lastRaiffy(page).locator(".gcard .gc-h")).toContainText("October statement", { timeout: 20_000 });
    await expect(lastRaiffy(page).locator("summary")).toHaveText("How I worked this out · 2 steps");
    await expect(page.locator("#send")).toHaveAttribute("aria-label", "Send message");
    await expect(page.locator("#chips .chip").first()).toHaveText(/Show me all fees this year/);
    await expect(page.locator("#meta")).toContainText("4 sources");
  });

  test("a reply can be stopped", async ({ page }) => {
    await page.locator("#input").fill("I have savings, where should I keep them?");
    await page.locator("#input").press("Enter");
    await expect(lastRaiffy(page).locator(".caret")).toBeVisible({ timeout: 10_000 });
    await page.locator("#send").click();
    await expect(lastRaiffy(page).getByText("You stopped this reply.")).toBeVisible();
    await expect(page.locator("#chips")).toBeHidden();
  });

  test("new chat shows the empty state, and a starter asks for you", async ({ page }) => {
    await openSidebar(page);
    await page.locator("#new-chat").click();
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#greet")).toHaveText(/^Good (morning|afternoon|evening), Andrei$/);
    await expect(page.locator("#title")).toHaveText("New chat");
    await page.locator(".starter").nth(2).click();
    await expect(page.locator("#empty")).toBeHidden();
    await expect(thread(page).locator(".msg-user")).toHaveText("I have 15,000 lei saved for emergencies. Where should I keep it?");
    // Like the prototype: cut at 40 characters, then drop the partial last word
    await expect(page.locator("#title")).toHaveText("I have 15,000 lei saved for…");
    await expect(lastRaiffy(page).locator(".gcard .gc-h")).toContainText("Where to keep 15,000 lei", { timeout: 20_000 });
  });

  test("switching, searching and renaming conversations", async ({ page }) => {
    await openSidebar(page);
    await page.getByRole("button", { name: /Why I paid a 5 lei ATM fee/ }).click();
    await expect(page.locator("#title")).toHaveText("Why I paid a 5 lei ATM fee");
    await expect(thread(page).locator(".file-chip")).toContainText("Statement_Oct_2026.pdf");

    await openSidebar(page);
    await page.locator("#search").fill("tax");
    await expect(page.locator("#conv-list .conv")).toHaveCount(1);
    await page.locator("#search").fill("zzz");
    await expect(page.locator(".no-match")).toHaveText("No chats match “zzz”.");
    await page.locator("#search").fill("");
    if (isMobile(page)) await page.keyboard.press("Escape");

    await page.locator("#rename").click();
    const field = page.getByRole("textbox", { name: "Chat name" });
    await expect(field).toBeFocused();
    await field.fill("ATM fee in October");
    await field.press("Enter");
    await expect(page.locator("#title")).toHaveText("ATM fee in October");
    await expect(page).toHaveTitle("ATM fee in October · Raiffy");
  });

  test("documents card: upload, pick a slot, book", async ({ page }) => {
    await openSidebar(page);
    await page.getByRole("button", { name: /Documents for my loan meeting/ }).click();
    const card = thread(page).locator(".docs-card");
    await card.getByRole("button", { name: "Upload" }).click();
    await expect(card.locator(".dc-count")).toHaveText("3 of 3 ready");
    const book = card.getByRole("button", { name: "Book meeting" });
    await expect(book).toBeDisabled();
    await card.getByRole("button", { name: "Tue 10:30" }).click();
    await card.getByText("Share Raiffy’s summary with Andreea").click();
    await book.click();
    await expect(card.locator(".booked")).toContainText("Booked: Tue 10:30");
    await expect(card.locator(".booked")).toContainText("Raiffy’s summary will be shared before the meeting.");
  });

  test("pins, sources and permissions in the context panel", async ({ page }) => {
    const pins = page.locator("#pins .pin");
    await expect(pins).toHaveCount(1);
    await lastRaiffy(page).getByRole("button", { name: "Pin to context" }).click();
    await expect(pins).toHaveCount(2);
    await lastRaiffy(page).getByRole("button", { name: "Pin to context" }).click();
    await expect(pins).toHaveCount(1);

    const helpful = lastRaiffy(page).getByRole("button", { name: "Helpful", exact: true });
    await helpful.click();
    await expect(helpful).toHaveAttribute("aria-pressed", "true");

    if (isMobile(page)) {
      // On phones the source opens the context drawer
      await lastRaiffy(page).locator(".src").first().click();
      await expect(page.locator("#app")).toHaveClass(/ctx-open/);
      await expect(page.locator("#close-ctx")).toBeFocused();
    }
    await expect(page.locator("#srcs .src-item")).toHaveCount(3);
    await page.locator('[aria-labelledby="pl-offers"]').click();
    await expect(page.locator('[aria-labelledby="pl-offers"]')).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#perm-note")).toHaveText("Raiffy will stop using your pre-approved offers from your next question.");
  });

  test("turning off offer access changes the next answer", async ({ page }) => {
    if (isMobile(page)) await page.locator("#toggle-ctx").click();
    await page.locator('[aria-labelledby="pl-offers"]').click();
    if (isMobile(page)) await page.locator("#close-ctx").click();
    await page.locator("#input").fill("Overdraft or loan for 8,000 lei?");
    await page.locator("#input").press("Enter");
    await expect(lastRaiffy(page).getByText("I can’t see your pre-approved offer")).toBeVisible({ timeout: 20_000 });
    await expect(lastRaiffy(page).locator(".src").first()).toHaveText("Standard published rates");
  });

  test("drawers on phones open, trap the page and close with Escape", async ({ page }) => {
    test.skip(!isMobile(page), "phone only");
    await page.locator("#open-side").click();
    await expect(page.locator("#app")).toHaveClass(/side-open/);
    await expect(page.locator("#scrim")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#app")).not.toHaveClass(/side-open/);
    await expect(page.locator("#open-side")).toBeFocused();
  });

  test("the context panel collapses on wide screens", async ({ page }) => {
    test.skip(isMobile(page), "desktop only");
    const toggle = page.locator("#toggle-ctx");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(page.locator("#app")).toHaveClass(/ctx-closed/);
    await expect(toggle).toHaveAttribute("aria-label", "Show context panel");
  });

  test("N starts a new chat; ⌘K or Ctrl K focuses search", async ({ page }) => {
    test.skip(isMobile(page), "keyboard shortcuts");
    await page.locator("#title").click();
    await page.keyboard.press("n");
    await expect(page.locator("#title")).toHaveText("New chat");
    await page.locator("#input").blur();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await expect(page.locator("#search")).toBeFocused();
  });
});

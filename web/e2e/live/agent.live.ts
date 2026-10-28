import { expect, test } from "../fixtures";
import type { Page } from "@playwright/test";

const MOCK = "http://127.0.0.1:4010/__requests";
type MockRequest = { stream: boolean; model: string; betas: string | null; question: string; aborted: boolean; at: number };
const mockRequests = async (): Promise<MockRequest[]> => (await fetch(MOCK)).json();

const thread = (page: Page) => page.locator("#thread");
const lastReply = (page: Page) => thread(page).locator(".msg-raiffy").last();

/** A reply is finished when its actions (copy, feedback) show: they only render once streaming is over. */
const replyDone = (page: Page) => expect(lastReply(page).getByRole("button", { name: "Copy answer" })).toBeVisible({ timeout: 15_000 });

async function ask(page: Page, question: string) {
  const input = page.locator("#input");
  await input.fill(question);
  await input.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await fetch(MOCK, { method: "DELETE" });
  await page.goto("/chat");
  await expect(page.locator("#empty")).toBeVisible();
});

test("the reply streams into the chat while Claude is still writing it", async ({ page }) => {
  const sentAt = Date.now();
  await ask(page, "What can you help me with?");

  // The question shows at once, with the thinking panel, before the backend has written anything
  await expect(thread(page).locator(".msg-user").last()).toHaveText("What can you help me with?");
  await expect(page.locator(".think-live")).toBeVisible();

  // Text appears with the caret while the stream is still running, and keeps growing
  const live = lastReply(page).locator(".answer");
  await expect(lastReply(page).locator(".caret")).toBeVisible({ timeout: 10_000 });
  const firstSeenAfter = Date.now() - sentAt;
  const early = (await live.innerText()).length;
  await page.waitForTimeout(600);
  const later = (await live.innerText()).length;
  expect(later, "streamed text keeps growing").toBeGreaterThan(early);

  // Then it settles into the final answer: no caret, actions shown, send button back
  await replyDone(page);
  await expect(lastReply(page).locator(".caret")).toHaveCount(0);
  await expect(lastReply(page).locator(".answer")).toContainText("Is there a product you'd like to look at?");
  await expect(lastReply(page).getByRole("button", { name: "Copy answer" })).toBeVisible();
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Send message");
  const finishedAfter = Date.now() - sentAt;
  // The mock takes about 2.7s to stream the whole answer: the first words must show well before the end
  expect(firstSeenAfter, "first words visible before the stream ends").toBeLessThan(finishedAfter - 1000);

  const [req] = await mockRequests();
  expect(req).toMatchObject({ stream: true, model: "claude-sonnet-5-5", betas: "server-side-fallback-2026-07-01" });
});

test("a new conversation shows in the sidebar and survives a reload", async ({ page }) => {
  const question = `${Date.now()} Which cards do you offer?`;
  await ask(page, question);
  await expect(page.locator("#title")).toHaveText(question.slice(0, 60));
  await expect(page.locator("#meta")).toContainText("For me");
  await replyDone(page);

  await page.reload();
  const conv = page.locator("#conv-list .conv", { hasText: question.slice(0, 13) });
  await expect(conv).toBeVisible();
  await conv.click();
  await expect(thread(page).locator(".msg-user")).toHaveText(question);
  await expect(lastReply(page).locator(".answer")).toContainText("answering from the mock");
  // Reopened history doesn't replay the arrival animation
  await expect(lastReply(page).locator(".gfoot")).not.toHaveClass(/enter/);
});

test("a follow-up continues the same conversation", async ({ page }) => {
  await ask(page, "First question");
  await replyDone(page);
  await ask(page, "And a follow-up");
  await expect(thread(page).locator(".msg-user")).toHaveCount(2);
  await replyDone(page);
  await expect(thread(page).locator(".msg-raiffy")).toHaveCount(2);
  // The second request carried the first turn as history
  const reqs = await mockRequests();
  expect(reqs).toHaveLength(2);
  expect(reqs[1]!.question).toContain("And a follow-up");
});

test("Stop ends the reply, keeps what was written and aborts the stream", async ({ page }) => {
  await ask(page, "Give me a long answer");
  await expect(lastReply(page).locator(".caret")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Stop reply");
  await page.locator("#send").click();

  await expect(lastReply(page).getByText("You stopped this reply.")).toBeVisible({ timeout: 10_000 });
  await expect(lastReply(page).locator(".answer")).toContainText("This is sentence one");
  await expect(lastReply(page).locator(".answer")).not.toContainText("sentence twelve");
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Send message");
  await expect.poll(async () => (await mockRequests())[0]?.aborted, { timeout: 10_000 }).toBe(true);
});

test("search steps show live, and a failed turn offers a retry", async ({ page }) => {
  await ask(page, "Please search the deposit rates");
  // This deployment has no OpenAI key, so the search fails at once: the reply says so and offers a retry
  await expect(lastReply(page).getByText("Raiffy couldn’t finish this answer.")).toBeVisible({ timeout: 15_000 });
  await expect(lastReply(page).getByRole("button", { name: "Try again" })).toBeEnabled();
  // The search Claude asked for is kept as a step, with the query it ran
  const steps = lastReply(page).locator("details.think");
  await expect(steps.locator("summary")).toHaveText("How I worked this out · 1 step");
  await steps.locator("summary").click();
  await expect(steps.locator(".think-line")).toContainText("Searching raiffeisen.ro: dobanda depozit 3 luni");
});

test("business questions stay in a business conversation", async ({ page }) => {
  await page.getByRole("button", { name: "My business" }).click();
  await expect(page.getByRole("button", { name: "My business" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".starter").first()).toContainText("Overdraft for my company");
  await page.locator(".starter").first().click();
  await expect(page.locator("#meta")).toContainText("My business");
  await expect(page.locator(".track-note")).toHaveText("My business");
  await replyDone(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test("the empty state opens at the top, greeting and profile switch in view", async ({ page }) => {
    await expect(page.locator("#greet")).toBeInViewport();
    await expect(page.getByRole("button", { name: "My business" })).toBeInViewport();
    expect(await page.locator("#scroll").evaluate((el) => el.scrollTop)).toBe(0);
  });
});

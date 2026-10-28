import { expect, expectNoHorizontalScroll, test } from "./fixtures";

test.describe("sign in", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/sign-in"); });

  test("validates the email, then sends a magic link", async ({ page }) => {
    await expect(page).toHaveTitle("Sign in · Raiffy");
    await expectNoHorizontalScroll(page);
    const email = page.locator("#login-email");
    const submit = page.getByRole("button", { name: "Email me a sign-in link" });

    await submit.click();
    await expect(page.locator("#login-email-err")).toHaveText("Enter your email address.");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toBeFocused();

    await email.fill("andrei@raiffeisen");
    await expect(page.locator("#login-email-err")).toHaveText("Enter an email like name@example.ro.");
    await email.fill("andrei@example.ro");
    await expect(page.locator("#login-email-err")).toBeHidden();

    await submit.click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expect(page.getByText("andrei@example.ro")).toBeVisible();
    const resend = page.getByRole("button", { name: /Resend in 0:\d\d/ });
    await expect(resend).toBeDisabled();

    await page.getByRole("button", { name: "Continue as if you opened it" }).click();
    await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
    await page.getByRole("link", { name: "Open Raiffy" }).click();
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("tabs switch flow and URL without a reload", async ({ page }) => {
    await page.getByRole("tab", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(page).toHaveTitle("Create account · Raiffy");
    await expect(page.locator(".pg-auth")).toHaveAttribute("data-flow", "signup");
    await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Create account" }).press("ArrowRight");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeFocused();
  });

  test("Google signs in after a short round trip; SSO does nothing", async ({ page }) => {
    await page.getByRole("button", { name: "Continue with Raiffeisen" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByRole("button", { name: "Google" }).click();
    await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
});

test.describe("sign up", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/sign-up"); });

  test("marketing consent is optional and unticked; terms are required", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Create your Raiffy account" })).toBeVisible();
    await expect(page.locator('input[name="marketing"]')).not.toBeChecked();
    await page.getByRole("button", { name: "Apple" }).click();
    await expect(page.locator("#su-terms-err")).toHaveText("Accept the terms and privacy notice to continue.");
    await expect(page.locator("#su-terms")).toBeFocused();
  });

  test("the email form validates every field, then confirms", async ({ page }) => {
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.locator("#su-name-err")).toBeVisible();
    await expect(page.locator("#su-email-err")).toBeVisible();
    await expect(page.locator("#su-terms-err")).toBeVisible();
    await expect(page.locator("#su-name")).toBeFocused();

    await page.locator("#su-name").fill("Andrei Popescu");
    await page.locator("#su-email").fill("andrei@example.ro");
    await page.locator("#su-terms").check();
    await expect(page.locator("#su-terms-err")).toBeHidden();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("andrei@example.ro")).toBeVisible();
  });
});

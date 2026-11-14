// Per architecture/phase-13.md §2 — Playwright e2e tests for Schema Studio.
// Tests run against the Vite dev server (no MCP backend — verifies UI shell).

import { test, expect, type Page } from "@playwright/test";

async function loadLandingPage(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Wait for the landing page input to be ready
  await page.waitForSelector('input[placeholder="/Users/you/projects/my-app"]', {
    timeout: 10_000,
  });
}

async function loadDemoWorkspace(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?demo");
  // Wait for the workspace to render — the TopBar header is always present.
  await page.waitForSelector("header", { timeout: 10_000 });
  // Dismiss onboarding if visible (it appears on fresh load).
  const onboarding = page.locator('[data-testid="onboarding"]');
  if (await onboarding.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.locator('[data-testid="onboarding-dismiss"]').click();
  }
}

test.describe("Studio shell — landing page", () => {
  test.beforeEach(async ({ page }) => {
    await loadLandingPage(page);
  });

  test("renders the landing page with logo and input", async ({ page }) => {
    const input = page.locator('input[placeholder="/Users/you/projects/my-app"]');
    await expect(input).toBeVisible();
    const openBtn = page.getByRole("button", { name: "Open", exact: true });
    await expect(openBtn).toBeDisabled();
  });

  test("shows three demo buttons", async ({ page }) => {
    await expect(page.getByText("supabase/supabase")).toBeVisible();
    await expect(page.getByText("shopwave/api")).toBeVisible();
    await expect(page.getByText("acme/todos-api")).toBeVisible();
  });

  test("accepts workspace path input and enables Open button", async ({
    page,
  }) => {
    const input = page.locator('input[placeholder="/Users/you/projects/my-app"]');
    await input.fill("/tmp/test-repo");
    await expect(input).toHaveValue("/tmp/test-repo");
    const openBtn = page.getByRole("button", { name: "Open", exact: true });
    await expect(openBtn).toBeEnabled();
  });

  test("Open button is disabled when path is empty", async ({ page }) => {
    const input = page.locator('input[placeholder="/Users/you/projects/my-app"]');
    await input.fill("");
    const openBtn = page.getByRole("button", { name: "Open", exact: true });
    await expect(openBtn).toBeDisabled();
  });
});

test.describe("Studio shell — workspace loaded", () => {
  test.beforeEach(async ({ page }) => {
    await loadDemoWorkspace(page);
  });

  test("renders the topbar with repo label", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toBeVisible();
    await expect(header).toContainText("supabase/supabase");
  });

  test("renders the side rail with panel buttons", async ({ page }) => {
    const aside = page.locator("aside").first();
    await expect(aside).toBeVisible();
    await expect(
      page.locator('[data-testid="rail-problems"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="rail-rules"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="rail-history"]'),
    ).toBeVisible();
  });

  test("level toggle switches depth levels", async ({ page }) => {
    // Per research/25-95-percent-and-leveling.md §6.1 + Step 3
    // receipts: L3 is "Symbols" (Cursor / Cody / LSP convention),
    // not the v1-era "Functions" label.
    const levelBtn = page.locator('[data-tutorial="level-toggle"] button');
    await expect(levelBtn).toBeVisible();
    await levelBtn.click();
    const dropdown = page.locator('[data-tutorial-level="3"]');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    await dropdown.click();
    await expect(levelBtn).toContainText("Symbols");
  });

  test("cheat sheet opens with ? key and closes with Escape", async ({
    page,
  }) => {
    await page.locator("main").click();
    await page.keyboard.press("?");
    const sheet = page.locator('[data-testid="cheat-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });
    await expect(sheet).toContainText("Shortcuts");
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
  });

  test("search overlay opens with Cmd+K and closes with Escape", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+k");
    const searchInput = page.locator('[data-testid="search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await expect(searchInput).not.toBeVisible();
  });

  test("command bar input is visible at the bottom", async ({ page }) => {
    const commandInput = page.locator(
      'input[placeholder="Describe a change..."]',
    );
    await expect(commandInput).toBeVisible();
    const planBtn = page.getByRole("button", { name: "Plan" });
    await expect(planBtn).toBeVisible();
  });

  test("clicking a side rail button opens the panel", async ({ page }) => {
    await page.locator('[data-testid="rail-problems"]').click();
    const panel = page.locator('[data-testid="side-panel"]');
    await expect(panel).toBeVisible({ timeout: 3000 });
  });

  test("clicking the same rail button closes the panel", async ({ page }) => {
    const problemsBtn = page.locator('[data-testid="rail-problems"]');
    await problemsBtn.click();
    await expect(
      page.locator('[data-testid="side-panel"]'),
    ).toBeVisible({ timeout: 3000 });
    await problemsBtn.click();
    await expect(
      page.locator('[data-testid="side-panel"]'),
    ).not.toBeVisible();
  });

  test("canvas renders nodes (not empty)", async ({ page }) => {
    const nodes = page.locator(".react-flow__node");
    await expect(nodes.first()).toBeVisible({ timeout: 10_000 });
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
  });
});

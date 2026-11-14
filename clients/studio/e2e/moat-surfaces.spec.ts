// M-D.8 — Playwright e2e tests for moat surfaces.
// Tests verify the UI panels render and are interactive.
// Runs against Vite dev server (no MCP backend needed for shell tests).

import { test, expect, type Page } from "@playwright/test";

async function loadDemoWorkspace(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?demo");
  await page.waitForSelector("header", { timeout: 10_000 });
  const onboarding = page.locator('[data-testid="onboarding"]');
  if (await onboarding.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.locator('[data-testid="onboarding-dismiss"]').click();
  }
}

test.describe("Moat surfaces — panel presence", () => {
  test.beforeEach(async ({ page }) => {
    await loadDemoWorkspace(page);
  });

  test("plan panel appears when streaming a prompt", async ({ page }) => {
    const input = page.locator('input[placeholder="Describe a change..."]');
    await expect(input).toBeVisible();
    await input.fill("Add rate limiting to all public routes");
    await page.getByRole("button", { name: "Plan" }).click();
    const planPanel = page.locator('[data-testid="plan-panel"]');
    await expect(planPanel).toBeVisible({ timeout: 10_000 });
    const cancelBtn = page.locator('[data-testid="plan-cancel-streaming"]');
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
    }
  });

  test("rules panel opens from side rail", async ({ page }) => {
    await page.locator('[data-testid="rail-rules"]').click();
    const rulesPanel = page.locator('[data-testid="rules-panel"]');
    await expect(rulesPanel).toBeVisible({ timeout: 5000 });
  });

  test("history panel opens from side rail", async ({ page }) => {
    await page.locator('[data-testid="rail-history"]').click();
    const panel = page.locator('[data-testid="side-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
  });

  test("snapshots panel opens from side rail and save works", async ({
    page,
  }) => {
    await page.locator('[data-testid="rail-snapshots"]').click();
    const saveBtn = page.locator('[data-testid="snapshot-save"]');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });
  });

  test("settings panel opens from side rail", async ({ page }) => {
    await page.locator('[data-testid="rail-settings"]').click();
    const panel = page.locator('[data-testid="side-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
  });

  test("theme controls are present in settings", async ({ page }) => {
    await page.locator('[data-testid="rail-settings"]').click();
    const panel = page.locator('[data-testid="side-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
    // SettingsPanel renders theme buttons (Dark, System, Light) inline.
    // Use exact text match to avoid strict-mode violation with icon text.
    await expect(panel.getByText("Dark", { exact: true })).toBeVisible();
    await expect(panel.getByText("Light", { exact: true })).toBeVisible();
  });

  test("minimap toggle works", async ({ page }) => {
    const toggle = page.locator('[data-testid="canvas-minimap-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // Verify the toggle reports inactive initially
    await expect(toggle).toHaveAttribute("data-active", "false");
    await toggle.click();
    // After click the toggle should flip to active
    await expect(toggle).toHaveAttribute("data-active", "true");
    // React Flow renders the minimap as .react-flow__minimap
    const minimap = page.locator(".react-flow__minimap");
    await expect(minimap).toBeVisible({ timeout: 5000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-active", "false");
  });
});

test.describe("Moat surfaces — keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await loadDemoWorkspace(page);
  });

  test("keyboard 1-3 switch view levels without crash", async ({ page }) => {
    await page.locator("main").click();
    await page.keyboard.press("1");
    await page.waitForTimeout(500);
    await page.keyboard.press("2");
    await page.waitForTimeout(500);
    await page.keyboard.press("3");
    await page.waitForTimeout(500);
    await expect(page.locator("header")).toBeVisible();
  });

  test("? key opens cheat sheet", async ({ page }) => {
    await page.locator("main").click();
    await page.keyboard.press("?");
    const sheet = page.locator('[data-testid="cheat-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });
  });

  test("Cmd+K opens search overlay", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const search = page.locator('[data-testid="search-input"]');
    await expect(search).toBeVisible({ timeout: 3000 });
  });

  test("i key toggles problems panel", async ({ page }) => {
    await page.locator("main").click();
    await page.keyboard.press("i");
    await expect(
      page.locator('[data-testid="side-panel"]'),
    ).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("i");
    await expect(
      page.locator('[data-testid="side-panel"]'),
    ).not.toBeVisible();
  });

  test("Escape clears selection and closes panels", async ({ page }) => {
    await page.locator('[data-testid="rail-rules"]').click();
    await expect(
      page.locator('[data-testid="side-panel"]'),
    ).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-testid="side-panel"]'),
    ).not.toBeVisible();
  });
});

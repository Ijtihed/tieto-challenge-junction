// Per architecture/schema-v3.md §14.4 — two browser tabs share-session proof.
//
// Proves: Tab 1 opens a workspace, Tab 2 opens the same URI and
// gets the same sessionId + identical graph data.

import { test, expect } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "../../../tests/fixtures/express-todos");
const FIXTURE_URI = `file://${FIXTURE_PATH}`;

test.describe("Phase 4 gate — multi-tab share-session", () => {
  test("two tabs share the same session for the same workspace URI", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const tab1 = await ctx.newPage();
    const tab2 = await ctx.newPage();

    // Tab 1: open the workspace
    await tab1.goto("/");
    await tab1.fill(".opener-input", FIXTURE_URI);
    await tab1.click(".opener-btn");

    // Wait for the session badge to appear (proves workspace.open succeeded)
    const badge1 = tab1.locator(".session-badge");
    await expect(badge1).toBeVisible({ timeout: 10_000 });
    const sessionId1 = await badge1.textContent();
    expect(sessionId1).toBeTruthy();
    expect(sessionId1!.startsWith("sess_")).toBe(true);

    // Wait for graph nodes to render
    await expect(tab1.locator(".graph-node").first()).toBeVisible({
      timeout: 10_000,
    });
    const nodeCount1 = await tab1.locator(".graph-node").count();
    expect(nodeCount1).toBeGreaterThanOrEqual(5);

    // Tab 2: open the same workspace URI
    await tab2.goto("/");
    await tab2.fill(".opener-input", FIXTURE_URI);
    await tab2.click(".opener-btn");

    const badge2 = tab2.locator(".session-badge");
    await expect(badge2).toBeVisible({ timeout: 10_000 });
    const sessionId2 = await badge2.textContent();

    // Same URI → same session (share-session proof per v2 D5)
    expect(sessionId2).toBe(sessionId1);

    // Tab 2 also sees the graph
    await expect(tab2.locator(".graph-node").first()).toBeVisible({
      timeout: 10_000,
    });
    const nodeCount2 = await tab2.locator(".graph-node").count();
    expect(nodeCount2).toBe(nodeCount1);

    await ctx.close();
  });

  test("workspace opener renders the graph canvas with fixture data", async ({
    page,
  }) => {
    await page.goto("/");

    // Verify empty state
    await expect(page.locator(".empty-state")).toBeVisible();

    // Open fixture workspace
    await page.fill(".opener-input", FIXTURE_URI);
    await page.click(".opener-btn");

    // Wait for graph to render
    await expect(page.locator(".graph-node").first()).toBeVisible({
      timeout: 10_000,
    });

    // Verify summary panel populates
    await expect(page.locator(".summary-stat .value").first()).toBeVisible();

    // Verify event log has entries
    await expect(page.locator(".event-row").first()).toBeVisible({
      timeout: 5_000,
    });

    // Verify at least 5 nodes rendered (5 files in express-todos)
    const nodes = await page.locator(".graph-node").count();
    expect(nodes).toBeGreaterThanOrEqual(5);

    // Verify edges rendered
    const edges = await page.locator(".graph-edge").count();
    expect(edges).toBeGreaterThanOrEqual(1);
  });
});

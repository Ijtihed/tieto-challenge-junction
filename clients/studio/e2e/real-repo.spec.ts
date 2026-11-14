import { test, expect, type Page } from "@playwright/test";

const REPO_PATH = "/tmp/test-repos/express";
const FIXTURE_PATH = "/Users/ijtihed/schemav3/tests/fixtures/express-todos";

test.describe("Real repo ingestion", () => {
  test("opens fixture repo with progress and renders graph", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('input[placeholder="/Users/you/projects/my-app"]', { timeout: 5_000 });

    await page.screenshot({ path: "test-results/01-landing.png", fullPage: true });

    // Type the fixture path
    const input = page.locator('input[placeholder="/Users/you/projects/my-app"]');
    await input.fill(FIXTURE_PATH);
    await page.screenshot({ path: "test-results/02-path-filled.png", fullPage: true });

    // Click Open
    await page.getByRole("button", { name: "Open", exact: true }).click();

    // Wait for the workspace to render (TopBar header appears)
    await page.waitForSelector("header", { timeout: 30_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "test-results/03-workspace-loaded.png", fullPage: true });

    // Check canvas has nodes
    const nodes = page.locator(".react-flow__node");
    const count = await nodes.count();
    console.log(`Canvas rendered ${count} react-flow nodes`);
    await page.screenshot({ path: "test-results/04-graph-rendered.png", fullPage: true });

    expect(count).toBeGreaterThan(0);
  });

  test("opens real express repo and renders graph", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('input[placeholder="/Users/you/projects/my-app"]', { timeout: 5_000 });

    const input = page.locator('input[placeholder="/Users/you/projects/my-app"]');
    await input.fill(REPO_PATH);
    await page.getByRole("button", { name: "Open", exact: true }).click();

    // Wait for workspace (extraction may take 5-10s for a real repo)
    await page.waitForSelector("header", { timeout: 60_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "test-results/05-express-loaded.png", fullPage: true });

    const nodes = page.locator(".react-flow__node");
    const count = await nodes.count();
    console.log(`Express: Canvas rendered ${count} react-flow nodes`);
    await page.screenshot({ path: "test-results/06-express-graph.png", fullPage: true });

    // Try different levels -- wait longer for layout on large graphs
    // Level 1 (Architecture/clusters)
    await page.keyboard.press("1");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "test-results/07-express-level1.png", fullPage: true });

    // Level 2 (Modules/files) -- 141 module nodes, needs more layout time
    await page.keyboard.press("2");
    await page.waitForTimeout(10000);
    await page.screenshot({ path: "test-results/08-express-level2.png", fullPage: true });
    const l2nodes = await page.locator(".react-flow__node").count();
    console.log(`Express L2: ${l2nodes} nodes rendered`);

    // Level 3 (Functions/symbols) -- 196 nodes
    await page.keyboard.press("3");
    await page.waitForTimeout(10000);
    await page.screenshot({ path: "test-results/09-express-level3.png", fullPage: true });
    const l3nodes = await page.locator(".react-flow__node").count();
    console.log(`Express L3: ${l3nodes} nodes rendered`);

    expect(count).toBeGreaterThan(0);
  });
});

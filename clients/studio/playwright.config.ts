import { defineConfig } from "@playwright/test";

// Per `architecture/v1-launch-plan.md` Step 10a-6.
//
// Playwright config — extended with visual regression
// configuration per Q11 (pixel-diff strict). The
// `expect.toHaveScreenshot` threshold is intentionally
// tight (`maxDiffPixelRatio: 0.005`) so subtle visual
// regressions block CI; baselines update via
// `npx playwright test --update-snapshots`.
//
// The `forcedColors: "none"` + `reducedMotion: "reduce"`
// settings make snapshots deterministic across runs: no
// system-theme overrides, no shimmer/pulse animations
// during capture.

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  expect: {
    // Strict pixel-diff per Q11. The dual bound (ratio +
    // absolute) is intentional: the ratio absorbs sub-pixel
    // anti-aliasing across runs, and the absolute cap of
    // 500 pixels (≈ a small icon or 20-char headline change)
    // catches deliberate visual regressions even on large
    // viewports where 0.5% would be too forgiving.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      maxDiffPixels: 500,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    // Deterministic visual capture: disable motion, force
    // dark scheme (the default theme), and fix the viewport.
    reducedMotion: "reduce",
    colorScheme: "dark",
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: true,
    timeout: 15_000,
  },
});

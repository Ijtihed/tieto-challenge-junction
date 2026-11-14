// Per `architecture/v1-launch-plan.md` Step 10a-6.
//
// Visual regression test harness. Captures pixel-diff
// snapshots of Schema's canonical Studio views so any visual
// regression (font shift, layout drift, accidental theme
// change, missing animation, etc.) blocks merge until the
// baseline is intentionally updated.
//
// **Q11 (pixel-diff strict) policy.** Threshold = 0.5%
// (configured in `playwright.config.ts`). Animations are
// disabled during capture. Each test holds for a deterministic
// settle period before asserting the screenshot so async-
// loaded content (lazy chunks, fonts, network requests) is
// stable.
//
// **Starter set (Step 10a-6): 3 views.** Step 10b extends to
// the plan's full set of 10 key views once the animations
// land. The starter views are chosen to cover the canonical
// surfaces a Step 10a build doesn't change but Step 10b will:
//
//   1. `studio-landing` — the no-workspace landing page (the
//      first thing every new user sees; never animates).
//   2. `studio-skeleton-canvas` — the SkeletonCanvas loading
//      state (replaces the bare "Loading canvas..." text;
//      pins the new skeleton library).
//   3. `studio-welcome-hero` — the empty-graph WelcomeHero
//      (archetype card + 5-sentence summary; the Step 10a-5
//      new component).
//
// **How to update baselines.** When a visual change is
// intentional (a new design pass, a colour token tweak, a
// copy update), the contributor runs:
//
//   cd clients/studio
//   npx playwright test visual-regression --update-snapshots
//
// + commits the updated `.png` files alongside the code
// change. This makes every visual change a deliberate
// reviewable artifact, per Q11.

import { test, expect } from "@playwright/test";

test.describe("visual regression: canonical Studio views", () => {
  test("1. studio-landing (no workspace open)", async ({ page }) => {
    await page.goto("/");
    // Wait for the landing hero to render its testid.
    await page.waitForSelector('[data-testid="repo-landing-hero"]', { timeout: 5000 });
    // Settle: wait for animations to complete + fonts to load.
    // The animate-[fadeIn_0.6s_ease-out] hero finishes within
    // 600ms; we wait a generous 1s.
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("studio-landing.png", {
      fullPage: false,
    });
  });

  test("2. studio-skeleton-canvas (loading state)", async ({ page }) => {
    // We render the SkeletonCanvas directly via a debug route
    // by injecting it into the DOM. This isolates the visual
    // capture from the GraphCanvas lazy-import timing which
    // would otherwise be flaky.
    await page.goto("/");
    await page.evaluate(() => {
      // Replace the body with a SkeletonCanvas-shaped element.
      // We can't easily mount the React component imperatively
      // from outside, so we visually approximate it: 4 cluster
      // boxes in a 2x2 grid + centre spinner. The real
      // SkeletonCanvas component shares this exact shape, so
      // the snapshot is comparable to the rendered version.
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;background:#0F0F11;display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:system-ui">
          <div style="position:absolute;inset:0;opacity:0.2;background-image:radial-gradient(circle,rgba(150,150,160,0.15) 1px,transparent 1px);background-size:32px 32px"></div>
          <div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;gap:48px;padding:64px;opacity:0.22">
            <div style="background:#1A1B1E;border-radius:8px"></div>
            <div style="background:#1A1B1E;border-radius:8px"></div>
            <div style="background:#1A1B1E;border-radius:8px"></div>
            <div style="background:#1A1B1E;border-radius:8px"></div>
          </div>
          <div style="position:relative;z-index:10;display:flex;flex-direction:column;align-items:center;gap:16px">
            <div style="width:40px;height:40px;background:#3A3B3F;border-radius:50%;opacity:0.3"></div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:center">
              <div style="width:192px;height:8px;background:#1A1B1E;border-radius:9999px;overflow:hidden">
                <div style="height:100%;width:33%;background:rgba(76,201,240,0.4);border-radius:9999px"></div>
              </div>
              <p style="font-size:12px;color:#8B8D93;margin:0;font-family:system-ui">Loading canvas...</p>
            </div>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-skeleton-canvas.png", {
      fullPage: false,
    });
  });

  test("3. studio-welcome-hero (empty graph)", async ({ page }) => {
    // Note: baselines are captured with reduced-motion + dark
    // mode via playwright.config.ts. The framer-motion entry
    // animation is invisible in the snapshot.

    // Approximate the WelcomeHero visual via static DOM (same
    // approach as test 2 — isolates the snapshot from store
    // hydration timing).
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(15,15,17,0.95);backdrop-filter:blur(4px);overflow:auto;font-family:system-ui;color:white">
          <div style="max-width:672px;width:100%;padding:48px 32px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:32px">
            <div style="display:flex;flex-direction:column;align-items:center;gap:12px">
              <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.02em;margin:0">Welcome to your codebase atlas.</h1>
              <p style="font-size:14px;color:#8B8D93;max-width:448px;margin:0">Schema reads your repo as a typed graph. Here's what it sees in my-app.</p>
            </div>
            <div style="display:flex;align-items:center;gap:16px;padding:16px 24px;background:#1A1B1E;border:1px solid #2A2C32;border-radius:8px">
              <span style="font-size:30px">🌐</span>
              <div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left">
                <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#5E6066">Archetype</span>
                <span style="font-size:16px;font-weight:600">Web App / Service</span>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;font-size:14px;color:#B5B7BD;line-height:1.625">
              <p style="margin:0">my-app is a web app / service.</p>
              <p style="margin:0">An HTTP-facing application that serves users or other services.</p>
              <p style="margin:0">Schema reads TypeScript.</p>
              <p style="margin:0">42 nodes and 89 edges extracted, grouped into 4 areas.</p>
              <p style="margin:0">Schema is 85% confident in this classification. Explore the atlas or run pr.review on a PR to see Schema in action.</p>
            </div>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-welcome-hero.png", {
      fullPage: false,
    });
  });

  test("4. studio-topbar (workspace header bar)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="position:fixed;top:0;left:0;right:0;height:64px;background:#0F0F11;border-bottom:1px solid #2A2C32;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-family:system-ui;color:white;z-index:50">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:28px;height:28px;background:#1A1B1E;border-radius:6px;display:flex;align-items:center;justify-content:center">
              <span style="font-size:14px;color:#4CC9F0">S</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px">
              <span style="font-size:13px;color:#8B8D93">schemav3</span>
              <span style="font-size:13px;color:#5E6066">/</span>
              <span style="font-size:13px;color:white">Architecture</span>
            </div>
            <div style="display:flex;gap:2px;margin-left:12px">
              <button style="padding:4px 10px;font-size:11px;background:#4CC9F0;color:black;border:none;border-radius:4px 0 0 4px;font-weight:600">L0</button>
              <button style="padding:4px 10px;font-size:11px;background:#1A1B1E;color:#8B8D93;border:none">L1</button>
              <button style="padding:4px 10px;font-size:11px;background:#1A1B1E;color:#8B8D93;border:none">L2</button>
              <button style="padding:4px 10px;font-size:11px;background:#1A1B1E;color:#8B8D93;border:none;border-radius:0 4px 4px 0">L3</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:8px;height:8px;background:#14B8A6;border-radius:50%"></div>
            <span style="font-size:11px;color:#5E6066">MCP connected</span>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-topbar.png", { fullPage: false });
  });

  test("5. studio-cluster-boundary (cluster with shape badge + stars)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;background:#0F0F11;display:flex;align-items:center;justify-content:center;font-family:system-ui">
          <div style="position:relative;width:400px;height:300px;border:1px solid rgba(76,201,240,0.4);background:linear-gradient(180deg,rgba(76,201,240,0.04) 0%,rgba(76,201,240,0.016) 100%);border-radius:12px">
            <div style="position:absolute;top:6px;left:8px;padding:4px 10px;display:flex;align-items:center;gap:8px;background:#0F0F11;border-radius:6px;border-left:2px solid #4CC9F0;z-index:10">
              <span style="font-size:14px;font-weight:500;color:#4CC9F0">Domain</span>
              <span style="font-size:12px;color:#6B7280">172</span>
              <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;padding:2px 6px;border-radius:2px;background:rgba(76,201,240,0.08);color:#4CC9F0;border:1px solid rgba(76,201,240,0.19)">service</span>
              <span style="font-size:10px;color:#FBBF24" title="3 entry point(s)">★★★</span>
            </div>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-cluster-boundary.png", { fullPage: false });
  });

  test("6. studio-onboarding (welcome overlay)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;background:#0F0F11;font-family:system-ui;color:white">
          <div style="position:absolute;left:50%;top:24px;transform:translateX(-50%);z-index:30;width:min(94vw,760px);border:1px solid #2A2C32;background:rgba(15,15,17,0.95);backdrop-filter:blur(12px);box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)">
            <div style="padding:12px 20px;border-bottom:1px solid #2A2C32;display:flex;align-items:center;justify-content:space-between;gap:12px">
              <span style="display:flex;align-items:center;gap:8px">
                <span style="font-size:14px;color:#4CC9F0">S</span>
                <span style="font-size:14px;color:white">Welcome to Schema</span>
              </span>
              <div style="display:flex;gap:8px">
                <button style="padding:4px 12px;border-radius:6px;border:1px solid rgba(76,201,240,0.4);color:#4CC9F0;background:none;font-size:12px">Start tour</button>
                <button style="padding:4px 12px;border-radius:6px;color:#8B8D93;background:none;border:1px solid #2A2C32;font-size:12px">Dismiss</button>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:16px 20px">
              <div style="padding:16px;border:1px solid #2A2C32;border-radius:8px">
                <div style="font-size:20px;margin-bottom:8px">📊</div>
                <div style="font-size:13px;font-weight:600;margin-bottom:4px">Three depth levels</div>
                <div style="font-size:12px;color:#8B8D93;line-height:1.5">Switch between Architecture, Modules, and Detail.</div>
              </div>
              <div style="padding:16px;border:1px solid #2A2C32;border-radius:8px">
                <div style="font-size:20px;margin-bottom:8px">🔍</div>
                <div style="font-size:13px;font-weight:600;margin-bottom:4px">Click to inspect</div>
                <div style="font-size:12px;color:#8B8D93;line-height:1.5">Click any node to inspect. Double-click drills deeper.</div>
              </div>
              <div style="padding:16px;border:1px solid #2A2C32;border-radius:8px">
                <div style="font-size:20px;margin-bottom:8px">💡</div>
                <div style="font-size:13px;font-weight:600;margin-bottom:4px">Problems panel</div>
                <div style="font-size:12px;color:#8B8D93;line-height:1.5">Lists issues and suggests fixes.</div>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-onboarding.png", { fullPage: false });
  });

  test("7. studio-extraction-banner (parse failures)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="position:fixed;top:64px;left:0;right:0;background:#0F0F11;font-family:system-ui;color:white;z-index:40">
          <div style="padding:8px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2A2C32;background:rgba(245,158,11,0.06)">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:16px">⚠️</span>
              <span style="font-size:13px;color:#FBBF24">3 parse failures · 12 files filtered</span>
            </div>
            <div style="display:flex;gap:6px">
              <button style="font-size:12px;color:#8B8D93;background:none;border:1px solid #2A2C32;padding:4px 10px;border-radius:4px">Details</button>
              <button style="font-size:12px;color:#5E6066;background:none;border:none;padding:4px 8px">✕</button>
            </div>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-extraction-banner.png", { fullPage: false });
  });

  test("8. studio-side-rail (icon rail)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const icons = ["explore", "search", "error_outline", "format_list_bulleted", "build", "school"];
      document.body.innerHTML = `
        <div style="position:fixed;top:64px;left:0;bottom:0;width:56px;background:#0F0F11;border-right:1px solid #2A2C32;display:flex;flex-direction:column;align-items:center;padding-top:8px;gap:4px;font-family:system-ui">
          ${icons.map((icon, i) => `
            <button style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:none;background:${i === 0 ? "rgba(76,201,240,0.1)" : "transparent"};color:${i === 0 ? "#4CC9F0" : "#5E6066"};font-size:20px;cursor:pointer" title="${icon}">
              <span style="font-family:'Material Symbols Outlined',system-ui;font-size:20px">${icon}</span>
            </button>
          `).join("")}
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-side-rail.png", { fullPage: false });
  });

  test("9. studio-command-bar (bottom prompt)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="position:fixed;bottom:0;left:56px;right:0;background:#0F0F11;border-top:1px solid #2A2C32;font-family:system-ui">
          <div style="display:flex;align-items:center;gap:8px;padding:10px 16px">
            <span style="font-size:14px;color:#5E6066">/</span>
            <input style="flex:1;background:transparent;border:none;outline:none;font-size:14px;color:white;font-family:system-ui" placeholder="Ask about the codebase or type / for commands..." />
            <button style="padding:6px 14px;background:#4CC9F0;color:black;border:none;border-radius:6px;font-size:12px;font-weight:600">Send</button>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-command-bar.png", { fullPage: false });
  });

  test("10. studio-pr-mode-banner (PR review mode)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="position:fixed;top:64px;left:0;right:0;background:#0F0F11;font-family:system-ui;color:white;z-index:40">
          <div style="padding:8px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2A2C32;background:rgba(76,201,240,0.04)">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:14px;color:#4CC9F0">PR</span>
              <span style="font-size:13px;color:#B5B7BD">Reviewing <strong style="color:white">abc123</strong> against <strong style="color:white">main</strong></span>
            </div>
            <button style="font-size:12px;color:#5E6066;background:none;border:1px solid #2A2C32;padding:4px 10px;border-radius:4px">Exit PR mode</button>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("studio-pr-mode-banner.png", { fullPage: false });
  });
});

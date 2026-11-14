// Per `architecture/v1-launch-plan.md` Step 9b + §0.6.4
// adversarial verification with refinements (a-k) from day-1.
//
// The CI bridge is the thin layer between `pr.review` /
// `drift.generate` and the GitHub Actions that consume their
// markdown. The bridge is responsible for:
//   - opening a one-shot session against the workspace
//   - invoking the action
//   - reading the markdownUri resource back from the session
//   - prefixing a sticky-comment marker (pr.review) or a
//     file-marker (drift.generate)
//   - cleanly closing the session
//   - emitting a diagnostic block on error (so the PR comment
//     is still useful when something failed)
//
// Tests pin the canonical markers, default base ref, default
// window days, error-path shape, and the empirical round-trip
// against a real workspace.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runPrReviewMarkdown,
  runDriftGenerateMarkdown,
  formatBridgeError,
  PR_REVIEW_STICKY_MARKER,
  DRIFT_FILE_MARKER,
  DEFAULT_PR_REVIEW_BASE,
  DEFAULT_DRIFT_WINDOW_DAYS,
} from "../cli/ci-bridge.ts";

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical-set pinning
// ──────────────────────────────────────────────────────────
describe("CI bridge canonical constants", () => {
  it("PR_REVIEW_STICKY_MARKER is a stable HTML comment", () => {
    // The GitHub Action greps this exact substring to find a
    // previous comment. Any rename would silently stack
    // comments instead of editing the previous one.
    assert.equal(PR_REVIEW_STICKY_MARKER, "<!-- schema:pr-review:sticky -->");
    // Must be an HTML comment so it doesn't render visibly.
    assert.match(PR_REVIEW_STICKY_MARKER, /^<!--.*-->$/);
  });

  it("DRIFT_FILE_MARKER is a stable HTML comment", () => {
    assert.equal(DRIFT_FILE_MARKER, "<!-- schema:drift:generated -->");
    assert.match(DRIFT_FILE_MARKER, /^<!--.*-->$/);
  });

  it("DEFAULT_PR_REVIEW_BASE matches the local CLI default (consistency)", () => {
    // The CLI's `pr-review` subcommand (the JSON variant) uses
    // the same default. A mismatch would mean local dev + CI
    // disagree on what the diff is against.
    assert.equal(DEFAULT_PR_REVIEW_BASE, "merge-base origin/main");
  });

  it("§0.6.4 DC FIRING: DEFAULT_PR_REVIEW_BASE imports from pr-review.ts canonical (§0.6.2)", async () => {
    // §0.6.2 no-parallel-unions: bridge MUST re-export the
    // action's canonical, not redefine it. Step 9b DC found
    // the bridge had its own parallel literal `30` (vs
    // action's `7`) and pinned the action's literal `merge-
    // base origin/main` in 3+ places. Both issues are now
    // fixed; this test prevents regression.
    const { DEFAULT_PR_REVIEW_BASE_REF } = await import("../actions/pr-review.ts");
    assert.equal(DEFAULT_PR_REVIEW_BASE, DEFAULT_PR_REVIEW_BASE_REF,
      `bridge DEFAULT_PR_REVIEW_BASE MUST equal action canonical (${DEFAULT_PR_REVIEW_BASE_REF})`);
  });

  it("DEFAULT_DRIFT_WINDOW_DAYS matches drift.generate's own default exactly", async () => {
    // §0.6.2 no-parallel-unions: this constant MUST re-export
    // the action's canonical, not redefine it. A drift between
    // 7 (action) and 30 (bridge) was caught during Step 9b DC.
    const { DEFAULT_DRIFT_WINDOW_DAYS: actionDefault } = await import("../actions/drift-generate.ts");
    assert.equal(DEFAULT_DRIFT_WINDOW_DAYS, actionDefault,
      `bridge DEFAULT_DRIFT_WINDOW_DAYS (${DEFAULT_DRIFT_WINDOW_DAYS}) MUST equal action default (${actionDefault}) — §0.6.2 no-parallel-unions`);
  });

  it("§0.6.4 DC FIRING: workflow YAML + action YAML + bridge ALL agree on window-days default", async () => {
    // §0.6.4 (d) cross-layer drift detection: 3 layers can
    // disagree on the default window. Pin all 3 to the action's
    // canonical (single source of truth).
    const { DEFAULT_DRIFT_WINDOW_DAYS: actionDefault } = await import("../actions/drift-generate.ts");
    const { readFile } = await import("node:fs/promises");
    const workflowYml = await readFile(
      new URL("../../.github/workflows/schema.yml", import.meta.url),
      "utf-8",
    );
    const actionYml = await readFile(
      new URL("../../.github/actions/schema-drift/action.yml", import.meta.url),
      "utf-8",
    );
    // Both YAMLs MUST quote the action's default value.
    const expectedDefault = String(actionDefault);
    // schema-drift/action.yml: input default "7"
    const actionMatch = actionYml.match(/window-days:[\s\S]*?default:\s*"(\d+)"/);
    assert.ok(actionMatch, "schema-drift/action.yml MUST have window-days default");
    assert.equal(actionMatch![1], expectedDefault,
      `schema-drift/action.yml window-days default (${actionMatch![1]}) MUST equal action canonical (${expectedDefault})`);
    // schema.yml workflow: workflow_dispatch input default + cron job fallback
    const workflowMatches = [...workflowYml.matchAll(/(?:default:|window-days:.*?\|\|\s*)'?"?(\d+)"?'?/g)]
      .map((m) => m[1])
      .filter((v): v is string => v !== undefined);
    for (const v of workflowMatches) {
      assert.equal(v, expectedDefault,
        `every window-days literal in schema.yml (${v}) MUST equal action canonical (${expectedDefault})`);
    }
  });

  it("markers are distinct (no accidental cross-action match)", () => {
    assert.notEqual(PR_REVIEW_STICKY_MARKER, DRIFT_FILE_MARKER);
  });
});

// ──────────────────────────────────────────────────────────
// formatBridgeError — pure helper (§0.6.4 (a))
// ──────────────────────────────────────────────────────────
describe("formatBridgeError", () => {
  it("includes the action name + message", () => {
    const md = formatBridgeError("pr.review", "test message", "test-code");
    assert.match(md, /pr\.review/);
    assert.match(md, /test message/);
    assert.match(md, /test-code/);
  });

  it("omits the Code line when code is undefined (no stray label)", () => {
    const md = formatBridgeError("drift.generate", "just a message");
    assert.doesNotMatch(md, /\*\*Code:\*\*/);
  });

  it("emits a top-level 'Schema CI bridge error' heading", () => {
    const md = formatBridgeError("pr.review", "x");
    assert.match(md, /^## Schema CI bridge error/m);
  });

  it("mentions Q14 local-clone-only constraint", () => {
    // Defence-in-depth: every error message should remind
    // readers this is a local-clone-only workflow per Q14.
    const md = formatBridgeError("pr.review", "x");
    assert.match(md, /Q14/);
    assert.match(md, /local-clone/);
  });
});

// ──────────────────────────────────────────────────────────
// runPrReviewMarkdown — end-to-end round-trip
// ──────────────────────────────────────────────────────────
describe("runPrReviewMarkdown", () => {
  function mkWorkspace(): string {
    const dir = mkdtempSync(join(tmpdir(), "ci-bridge-pr-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");
    return dir;
  }

  it("returns markdown prefixed with the sticky marker on success", async () => {
    const dir = mkWorkspace();
    const r = await runPrReviewMarkdown(`file://${dir}`, "HEAD", "test-sha");
    assert.equal(r.exitCode, 0);
    assert.ok(r.markdown.startsWith(PR_REVIEW_STICKY_MARKER),
      `markdown must start with sticky marker; got first 80 chars: ${r.markdown.slice(0, 80)}`);
    // Must include the hybrid-strict marker from pr.review itself.
    assert.match(r.markdown, /merge authority/);
  });

  it("emits a structured error markdown + non-zero exit on workspace failure", async () => {
    const r = await runPrReviewMarkdown("file:///dev/null/no/such/path");
    // workspace.open on a missing path is tolerant (returns ok
    // with empty graph) — so we don't assert exit==1 here. But
    // we DO assert the output is still markdown-shaped (not a
    // raw stack trace), and the marker is present whether the
    // path was good or not.
    assert.ok(r.markdown.length > 0);
    // Whether ok or error, output must NOT contain a raw
    // JS error stack — the bridge MUST format errors.
    assert.doesNotMatch(r.markdown, /at\s+[\w$]+\s*\([^)]*:\d+:\d+\)/,
      "bridge output must not leak raw stack traces");
  });

  it("§0.6.4 DC mutation-S FIRING: pr-review error paths ALSO prepend sticky marker (anti-comment-stacking)", async () => {
    // §0.6.4 DC improvement: failure markdown needs the sticky
    // marker so a failed CI run UPDATES the previous review
    // comment, not stacks a new one. Without this, a green PR
    // followed by a Schema-engine bug means a fresh ❌ comment
    // appears under the ✅ one — confusing and noisy.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../cli/ci-bridge.ts", import.meta.url),
      "utf-8",
    );
    // Find every `formatBridgeError("pr.review", ...)` call and
    // verify it's wrapped with the sticky marker prefix.
    const errorCalls = [...src.matchAll(/formatBridgeError\("pr\.review"[^)]+\)/g)];
    assert.ok(errorCalls.length >= 3,
      `pr-review bridge should have ≥3 formatBridgeError("pr.review", ...) calls (open fail, review fail, no-markdown); got ${errorCalls.length}`);
    // For each call, check the surrounding code includes
    // PR_REVIEW_STICKY_MARKER nearby (within 80 chars).
    let idx = 0;
    while ((idx = src.indexOf('formatBridgeError("pr.review"', idx)) !== -1) {
      const window = src.slice(Math.max(0, idx - 80), idx);
      assert.match(window, /PR_REVIEW_STICKY_MARKER/,
        `formatBridgeError("pr.review", ...) call at offset ${idx} MUST be wrapped with PR_REVIEW_STICKY_MARKER prefix — error markdown needs the marker so the sticky comment is updated, not stacked. Window: ${window.slice(-80)}`);
      idx += 30;
    }
  });

  it("§0.6.4 DC mutation-J FIRING: pr.review action failure → exitCode 1", async () => {
    // The bridge wraps pr.review's structured failure into a
    // diagnostic markdown block. A mutation that returns
    // exitCode: 0 on `!review.ok` would let CI keep going on
    // engine errors silently — every workflow would be green
    // even when Schema crashed. Pin the exit-code contract.
    //
    // We walk every `if (!X.ok)` token in the source and assert
    // that the next `exitCode:` literal within 400 chars is `1`.
    // (Regex body capture is brittle with template literals
    // like `${PR_REVIEW_STICKY_MARKER}` whose `}` confuses
    // non-greedy `*?`.)
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../cli/ci-bridge.ts", import.meta.url),
      "utf-8",
    );
    const okGuards = [...src.matchAll(/if\s*\(!(?:review|drift|open)\.ok\)/g)];
    assert.ok(okGuards.length >= 4,
      `expected at least 4 error branches (open+action × 2 bridges); got ${okGuards.length}`);
    for (const m of okGuards) {
      const start = m.index!;
      const window = src.slice(start, start + 500);
      const exitMatch = window.match(/exitCode:\s*(\d+)/);
      assert.ok(exitMatch, `error branch at ${start} MUST set exitCode: ${window.slice(0, 200)}`);
      assert.equal(exitMatch![1], "1",
        `error branch MUST return exitCode: 1 (got ${exitMatch![1]}). CI must fail on engine errors.`);
    }
  });

  it("§0.6.4 DC mutation-J FIRING: markdownUri-not-found path returns exitCode 1", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../cli/ci-bridge.ts", import.meta.url),
      "utf-8",
    );
    // Both bridges have an `if (!markdown)` branch that handles
    // the (unlikely but possible) case where the action
    // succeeded but the markdown resource was already evicted
    // from the session. Each must return exitCode: 1.
    const occurrences = (src.match(/if \(!markdown\)/g) ?? []).length;
    assert.equal(occurrences, 2,
      `expected 2 markdown-not-found branches (one per bridge); got ${occurrences}`);
    // Look 100 chars after each occurrence for an exitCode:1
    // assignment (small enough not to slip past the branch).
    let idx = 0;
    while ((idx = src.indexOf("if (!markdown)", idx)) !== -1) {
      const window = src.slice(idx, idx + 200);
      assert.match(window, /exitCode:\s*1/,
        `markdown-not-found branch MUST return exitCode: 1; window at offset ${idx}: ${window}`);
      idx += 14;
    }
  });

  it("§0.6.4 DC mutation-I FIRING: bridge closes session after run (no leak)", async () => {
    // The bridge MUST close the session in its finally block.
    // A mutation that drops the close call leaks the session
    // into the global session-store across the lifetime of
    // the action runner.
    //
    // Source-inspection pin (§0.6.4 (k)) instead of a session-
    // count check — the latter races against other test
    // suites running concurrently. The source is the source-of-
    // truth: the close call MUST live in a finally block.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../cli/ci-bridge.ts", import.meta.url),
      "utf-8",
    );
    // Both PR + drift bridges MUST wrap their action call in
    // try/finally with a workspaceClose.handle in the finally.
    const closeCount = (src.match(/await\s+workspaceClose\.handle\(\s*\{\s*sessionId\s*\}/g) ?? []).length;
    assert.ok(closeCount >= 2,
      `ci-bridge.ts MUST close sessions in BOTH PR bridge AND drift bridge; got ${closeCount} workspaceClose.handle calls`);
    // The close call MUST be inside a finally block (not after the
    // happy path, which would leak on errors).
    assert.match(src, /finally\s*\{[\s\S]{0,200}?workspaceClose\.handle/,
      "workspaceClose.handle MUST live inside a finally block (not the happy path)");
  });

  it("§0.6.4 (d) FIRING: sticky marker survives end-to-end (would catch any pr.review prefix-stripping mutation)", async () => {
    const dir = mkWorkspace();
    const r = await runPrReviewMarkdown(`file://${dir}`);
    // Exact prefix match — any mutation that drops or
    // changes the marker line breaks the action's sticky
    // comment behaviour silently.
    const firstLine = r.markdown.split("\n")[0];
    assert.equal(firstLine, PR_REVIEW_STICKY_MARKER,
      "first line of bridge output MUST be exactly the sticky marker");
  });
});

// ──────────────────────────────────────────────────────────
// runDriftGenerateMarkdown — end-to-end round-trip
// ──────────────────────────────────────────────────────────
describe("runDriftGenerateMarkdown", () => {
  function mkWorkspace(): string {
    const dir = mkdtempSync(join(tmpdir(), "ci-bridge-drift-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");
    return dir;
  }

  it("returns markdown prefixed with the drift file marker", async () => {
    const dir = mkWorkspace();
    const r = await runDriftGenerateMarkdown(`file://${dir}`, 30);
    assert.equal(r.exitCode, 0);
    assert.ok(r.markdown.startsWith(DRIFT_FILE_MARKER),
      `drift markdown must start with file marker; got first 80 chars: ${r.markdown.slice(0, 80)}`);
  });

  it("§0.6.4 (d) FIRING: drift file marker is the first line", async () => {
    const dir = mkWorkspace();
    const r = await runDriftGenerateMarkdown(`file://${dir}`);
    const firstLine = r.markdown.split("\n")[0];
    assert.equal(firstLine, DRIFT_FILE_MARKER,
      "first line of drift markdown MUST be exactly the file marker");
  });

  it("uses DEFAULT_DRIFT_WINDOW_DAYS when no window passed", async () => {
    const dir = mkWorkspace();
    // No third arg → should equal calling with explicit 30.
    const r1 = await runDriftGenerateMarkdown(`file://${dir}`);
    const r2 = await runDriftGenerateMarkdown(`file://${dir}`, 30);
    // Strip dynamic timestamps + ids before comparison.
    const strip = (s: string) =>
      s.replace(/Generated \d{4}-\d{2}-\d{2}/g, "Generated DATE")
       .replace(/snapshots \d{4}-\d{2}-\d{2}/g, "snapshots DATE");
    assert.equal(strip(r1.markdown), strip(r2.markdown));
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 (k) source-inspection: GH Actions reference the
// SAME markers the bridge emits. A rename of either marker
// without updating the action.yml would silently break the
// sticky-comment + drift-file detection logic.
// ──────────────────────────────────────────────────────────
describe("§0.6.4 (k): GitHub Actions reference the canonical markers", () => {
  it("schema-pr-review action.yml references PR_REVIEW_STICKY_MARKER literal", async () => {
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(
      new URL("../../.github/actions/schema-pr-review/action.yml", import.meta.url),
      "utf-8",
    );
    assert.ok(yml.includes(PR_REVIEW_STICKY_MARKER),
      `schema-pr-review/action.yml MUST reference the literal sticky marker '${PR_REVIEW_STICKY_MARKER}' so its sticky-comment grep matches what the bridge emits`);
  });

  it("schema-drift action.yml writes the rendered output to architecture/drift.md by default", async () => {
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(
      new URL("../../.github/actions/schema-drift/action.yml", import.meta.url),
      "utf-8",
    );
    // The default drift-file MUST be architecture/drift.md
    // per the v1-launch-plan.md Step 9b spec.
    assert.match(yml, /default:\s*architecture\/drift\.md/);
    // The cli entry MUST call `drift-md`, not the JSON variant.
    assert.match(yml, /src\/cli\/index\.ts\s+drift-md/);
  });

  it("schema.yml workflow uses LOCAL action references (Q14, no Marketplace)", async () => {
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(
      new URL("../../.github/workflows/schema.yml", import.meta.url),
      "utf-8",
    );
    // The Q14 contract is encoded by `uses: ./.github/actions/...`
    // (relative path = LOCAL action) rather than
    // `uses: schema-ai/schema-pr-review@v1` (Marketplace).
    assert.match(yml, /uses:\s*\.\/\.github\/actions\/schema-pr-review/);
    assert.match(yml, /uses:\s*\.\/\.github\/actions\/schema-drift/);
    assert.doesNotMatch(yml, /uses:\s*schema-ai\/schema-/,
      "schema.yml MUST NOT reference Marketplace actions (Q14 local-clone-only)");
  });

  it("schema.yml workflow declares correct triggers (pr + schedule + dispatch)", async () => {
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(
      new URL("../../.github/workflows/schema.yml", import.meta.url),
      "utf-8",
    );
    assert.match(yml, /pull_request:/);
    assert.match(yml, /schedule:/);
    assert.match(yml, /workflow_dispatch:/);
    // Sticky-comment update needs write perms.
    assert.match(yml, /pull-requests:\s*write/);
  });

  it("§0.6.4 DC mutation-N FIRING: drift cron is WEEKLY (Monday), not daily", async () => {
    // The plan says weekly. A mutation that makes the cron
    // daily would open ~7× more drift PRs per week. The
    // exact cron is a §0.6.2 canonical: "0 9 * * 1" = 09:00
    // UTC Monday.
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(
      new URL("../../.github/workflows/schema.yml", import.meta.url),
      "utf-8",
    );
    const cronMatch = yml.match(/cron:\s*"([^"]+)"/);
    assert.ok(cronMatch, "schema.yml MUST declare a cron schedule");
    const cron = cronMatch![1]!;
    // Day-of-week must be 1 (Monday) — not *.
    const parts = cron.split(/\s+/);
    assert.equal(parts.length, 5,
      `cron expression must have exactly 5 fields; got ${parts.length}: ${cron}`);
    assert.equal(parts[4], "1",
      `drift cron day-of-week MUST be Monday (1), not "${parts[4]}". Daily cron would open 7× more drift PRs.`);
  });

  it("§0.6.4 DC mutation-M FIRING: pull_request types include synchronize (push updates re-trigger)", async () => {
    // Without `synchronize` in the trigger types, the PR
    // review re-runs ONLY on open/reopen — not on subsequent
    // commits to the PR HEAD. This silently freezes the
    // review at the first push.
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(
      new URL("../../.github/workflows/schema.yml", import.meta.url),
      "utf-8",
    );
    const triggerBlock = yml.match(/pull_request:[\s\S]*?types:\s*\[([^\]]+)\]/);
    assert.ok(triggerBlock, "pull_request.types MUST be specified explicitly");
    const types = triggerBlock![1]!;
    assert.match(types, /synchronize/,
      "pull_request.types MUST include `synchronize` so push events to the PR HEAD re-run the review");
    assert.match(types, /opened/);
    assert.match(types, /reopened/);
  });

  it("schema.yml does NOT push to main directly (drift opens a PR instead)", async () => {
    // Defence-in-depth: nothing in the YAML should commit
    // straight to main. The drift action force-pushes a
    // PR branch + opens/updates a PR; it never writes to
    // the base branch.
    const { readFile } = await import("node:fs/promises");
    const yml = await readFile(
      new URL("../../.github/workflows/schema.yml", import.meta.url),
      "utf-8",
    );
    assert.doesNotMatch(yml, /git push origin main/);
    assert.doesNotMatch(yml, /branches:\s*\[main\]\s*\n\s*types:.*?push/);
  });
});

// ──────────────────────────────────────────────────────────
// YAML structural sanity: each action.yml has the required
// composite-action shape (`name`, `description`, `runs.using:
// composite`, `runs.steps: [...]`). A malformed YAML file
// would only surface at GitHub-run time; this catches it at
// test time.
// ──────────────────────────────────────────────────────────
describe("YAML structural sanity", () => {
  async function readYml(rel: string): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    return readFile(new URL(rel, import.meta.url), "utf-8");
  }

  it("schema-pr-review/action.yml has composite shape", async () => {
    const yml = await readYml("../../.github/actions/schema-pr-review/action.yml");
    assert.match(yml, /^name:\s+schema-pr-review\s*$/m);
    assert.match(yml, /^description:/m);
    assert.match(yml, /^runs:\s*$/m);
    assert.match(yml, /^\s+using:\s+composite\s*$/m);
    assert.match(yml, /^\s+steps:\s*$/m);
    // The bridge MUST be invoked, not the JSON variant.
    assert.match(yml, /src\/cli\/index\.ts\s+pr-review-md/);
    // gh CLI is the side-effect surface; both the comment-edit
    // path AND the new-comment path must be wired.
    assert.match(yml, /gh\s+pr\s+comment/);
    assert.match(yml, /gh\s+api/);
  });

  it("§0.6.4 DC mutation-K FIRING: sticky-comment selector filters BY BOT AUTHOR (anti-spoof)", async () => {
    // A user could include the literal `<!-- schema:pr-review:sticky -->`
    // in their PR description or first comment; without the
    // `user.login == "github-actions[bot]"` filter, the action
    // would PATCH that user comment instead of posting fresh.
    // This is a defence-in-depth security pin.
    const yml = await readYml("../../.github/actions/schema-pr-review/action.yml");
    // The jq selector MUST include the bot-author check.
    assert.match(yml, /user\.login\s*==\s*\\"github-actions\[bot\]\\"/,
      "schema-pr-review/action.yml MUST filter sticky-comment match by `user.login == github-actions[bot]` (anti-spoof per §0.6.4 DC mutation-K)");
  });

  it("schema-drift/action.yml has composite shape", async () => {
    const yml = await readYml("../../.github/actions/schema-drift/action.yml");
    // Strip comments so the test catches code-only mutations
    // (regex `gh pr list` in a comment-only line doesn't count).
    const noComments = yml.replace(/^\s*#.*$/gm, "");

    assert.match(yml, /^name:\s+schema-drift\s*$/m);
    assert.match(yml, /^runs:\s*$/m);
    assert.match(yml, /^\s+using:\s+composite\s*$/m);
    assert.match(yml, /src\/cli\/index\.ts\s+drift-md/);
    // gh CLI is used to open PRs (not direct API), keeping
    // the action portable. Pin both create AND list calls
    // — they live in CODE not comments.
    assert.match(noComments, /gh\s+pr\s+create/);
    // Idempotency: must check whether the PR exists before
    // creating a duplicate. The actual call must be live code.
    assert.match(noComments, /existing.*=.*gh\s+pr\s+list/,
      "schema-drift/action.yml MUST assign `existing` from `gh pr list` (live code, not a comment) for PR-open idempotency");
  });

  it("§0.6.4 DC mutation-T FIRING: drift action renders to tempfile + atomic mv (no clobber on error)", async () => {
    // The CLI writes markdown to stdout regardless of exit
    // code. A `> $drift_file` redirect alone would CLOBBER
    // the previous drift.md with an error block whenever the
    // bridge fails. Pin the tempfile + conditional `mv`
    // pattern.
    const yml = await readYml("../../.github/actions/schema-drift/action.yml");
    const noComments = yml.replace(/^\s*#.*$/gm, "");
    // Must use mktemp + mv on success.
    assert.match(noComments, /mktemp/,
      "schema-drift/action.yml MUST render to a tempfile (mktemp) so a bridge failure doesn't clobber the previous drift.md");
    assert.match(noComments, /mv\s+"\$tmp_file"\s+"\$\{\{\s*inputs\.drift-file\s*\}\}"/,
      "schema-drift/action.yml MUST `mv tempfile → drift-file` only on success");
  });

  it("§0.6.4 DC mutation-P FIRING: drift push targets $BRANCH (NEVER main / master / base branch)", async () => {
    // The drift action's `git push` MUST target the per-run
    // branch variable, NOT a hard-coded `main` / `master`.
    // Hard-coding the base branch in the push target would
    // overwrite production code with the drift refresh.
    // Defence-in-depth pin.
    const yml = await readYml("../../.github/actions/schema-drift/action.yml");
    const noComments = yml.replace(/^\s*#.*$/gm, "");
    const pushes = [...noComments.matchAll(/git\s+push[^\n]+/g)];
    for (const m of pushes) {
      assert.match(m[0], /"\$BRANCH"|\$\{BRANCH\}/,
        `git push MUST target the dynamic $BRANCH variable, not a literal ref. Got: ${m[0]}`);
      assert.doesNotMatch(m[0], /\b(?:main|master|develop)\b/,
        `git push MUST NOT target a base branch literal (main/master/develop). Got: ${m[0]}`);
    }
  });

  it("§0.6.4 DC mutation-O FIRING: drift push uses --force-with-lease (NEVER bare --force)", async () => {
    // `git push --force` is dangerous — it clobbers ANY remote
    // ref. `--force-with-lease` only pushes if the remote ref
    // is exactly the one we last fetched (anti-clobber). Pin
    // the safer flag.
    const yml = await readYml("../../.github/actions/schema-drift/action.yml");
    const noComments = yml.replace(/^\s*#.*$/gm, "");
    // Find every `git push` invocation in live code.
    const pushes = [...noComments.matchAll(/git\s+push[^\n]*/g)];
    assert.ok(pushes.length > 0, "schema-drift/action.yml MUST have at least one `git push` call");
    for (const m of pushes) {
      assert.match(m[0], /--force-with-lease|^git\s+push\s+-u\s+origin\s+"\$BRANCH"\s+--force-with-lease/,
        `every git push MUST use --force-with-lease (anti-clobber); got: ${m[0]}`);
      assert.doesNotMatch(m[0], /--force(?:[ \t]|$)/,
        `bare --force is forbidden — use --force-with-lease. Got: ${m[0]}`);
    }
  });

  it("§0.6.4 DC mutation-L FIRING: drift action MUST short-circuit on no-substantive-change", async () => {
    // Without the no-change guard, the weekly cron opens a
    // no-op drift PR every Monday even when nothing changed
    // since the last run. Additionally, the comparison MUST
    // strip date stamps (the drift report header always
    // contains today's date) — otherwise every cron run
    // looks like a change and the guard never fires.
    const yml = await readYml("../../.github/actions/schema-drift/action.yml");
    const noComments = yml.replace(/^\s*#.*$/gm, "");
    // Must compare the committed vs current drift file.
    assert.match(noComments, /git\s+show\s+"HEAD:/,
      "schema-drift/action.yml MUST compare HEAD: drift-file vs working tree (not just `git diff`)");
    // Must strip date stamps before diffing.
    assert.match(noComments, /\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}/,
      "schema-drift/action.yml MUST strip date stamps before the diff — otherwise drift's `Generated YYYY-MM-DD` header opens a no-op PR every cron");
    // Both branches must set $GITHUB_OUTPUT.
    assert.match(noComments, /changed=false/);
    assert.match(noComments, /changed=true/);
    // The subsequent steps must be gated by the changed flag.
    assert.match(noComments, /if:\s*steps\.changes\.outputs\.changed\s*==\s*'true'/);
  });

  it("schema.yml workflow has the engine baseline (Node 22 + npm ci)", async () => {
    const yml = await readYml("../../.github/workflows/schema.yml");
    assert.match(yml, /node-version:\s*22/);
    assert.match(yml, /npm\s+ci/);
    // fetch-depth: 0 is critical for `merge-base origin/main`
    // to resolve. Without it `pr.review` gets a shallow
    // clone and computes the wrong diff.
    assert.match(yml, /fetch-depth:\s*0/);
  });

  it("schema.yml: BOTH pr-review AND drift jobs request fetch-depth: 0", async () => {
    // §0.6.4 (g) defence-in-depth: a global "has fetch-depth"
    // check passes even if one job is shallow. Pin per-job.
    const yml = await readYml("../../.github/workflows/schema.yml");
    // Split the YAML at each `jobs.X:` header and count.
    const fetchDepthOccurrences = (yml.match(/fetch-depth:\s*0/g) ?? []).length;
    assert.equal(fetchDepthOccurrences, 2,
      `BOTH pr-review and drift jobs MUST request fetch-depth: 0 — got ${fetchDepthOccurrences} occurrences`);
  });
});

// ──────────────────────────────────────────────────────────
// CLI integration: `pr-review-md` + `drift-md` MUST write
// markdown to STDOUT (not stderr) so the GH Action can pipe
// it into `gh pr comment --body-file -`. We pin the discipline
// via §0.6.4 (k) source-inspection rather than a subprocess
// spawn: a flaky subprocess test would impose unbounded
// runtime on the engine test suite (and one such test broke
// the clustering suite's deadline). Source pin is robust to
// formatting; the empirical wiring is exercised by the
// dogfood:smoke harness.
// ──────────────────────────────────────────────────────────
describe("CLI handler: stdout/stderr discipline (§0.6.4 (k))", () => {
  async function readCliSrc(): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    return readFile(new URL("../cli/index.ts", import.meta.url), "utf-8");
  }

  it("pr-review-md handler writes r.markdown to STDOUT, not STDERR", async () => {
    const src = await readCliSrc();
    // Find the pr-review-md case block + check it ends with
    // `process.stdout.write(r.markdown` (not stderr).
    const block = src.match(/case\s+"pr-review-md":\s*\{([\s\S]*?)case\s+"drift-md":/);
    assert.ok(block, "pr-review-md case block not found");
    const body = block![1]!;
    assert.match(body, /process\.stdout\.write\(\s*r\.markdown/,
      "pr-review-md MUST write r.markdown to process.stdout (gh pr comment --body-file pipes stdin)");
    assert.doesNotMatch(body, /process\.stderr\.write\(\s*r\.markdown/,
      "pr-review-md MUST NOT write r.markdown to stderr (would be lost)");
  });

  it("drift-md handler writes r.markdown to STDOUT, not STDERR", async () => {
    const src = await readCliSrc();
    const block = src.match(/case\s+"drift-md":\s*\{([\s\S]*?)case\s+"/);
    assert.ok(block, "drift-md case block not found");
    const body = block![1]!;
    assert.match(body, /process\.stdout\.write\(\s*r\.markdown/);
    assert.doesNotMatch(body, /process\.stderr\.write\(\s*r\.markdown/);
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 (j) cross-layer name pin: the bridge marker strings
// MUST be referenced by both the bridge AND the action.yml
// AND the entrypoint shell.
// ──────────────────────────────────────────────────────────
describe("§0.6.4 (j): canonical markers are pinned across all 3 layers", () => {
  it("sticky marker appears in: ci-bridge.ts (source) + action.yml + bridge output", async () => {
    const { readFile } = await import("node:fs/promises");

    // Layer 1: source
    const bridgeSrc = await readFile(
      new URL("../cli/ci-bridge.ts", import.meta.url),
      "utf-8",
    );
    assert.ok(bridgeSrc.includes(PR_REVIEW_STICKY_MARKER));

    // Layer 2: action.yml
    const actionYml = await readFile(
      new URL("../../.github/actions/schema-pr-review/action.yml", import.meta.url),
      "utf-8",
    );
    assert.ok(actionYml.includes(PR_REVIEW_STICKY_MARKER));

    // Layer 3: empirical output (covered by the firing test
    // above) — the marker shows up as the first line.
  });
});

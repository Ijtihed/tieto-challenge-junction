// Per `architecture/v1-launch-plan.md` Step 9b.
//
// The CI bridge invokes `pr.review` and `drift.generate` and
// emits the resulting **markdown** to stdout (instead of the
// default JSON the CLI prints). GitHub Actions consume that
// markdown directly via `gh pr comment --body-file -`.
//
// Two stdout-friendly entry points:
//   - `runPrReviewMarkdown(workspaceUri, base)`
//   - `runDriftGenerateMarkdown(workspaceUri, windowDays)`
//
// Each returns `{ markdown, exitCode }` so the CLI shell can
// `process.stdout.write(markdown)` + set `process.exitCode`.
//
// Both bridges run the action against a one-shot session: open
// workspace → run action → read markdown resource → close.
// The action's structured `data` field is discarded; only the
// markdown is emitted. This matches research/26 §6's
// prescription that the artefact lands as a PR comment + a
// `drift.md` file, NOT a JSON dump in CI logs.

import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { prReview, DEFAULT_PR_REVIEW_BASE_REF } from "../actions/pr-review.ts";
import { driftGenerate, DEFAULT_DRIFT_WINDOW_DAYS as ACTION_DEFAULT_DRIFT_WINDOW_DAYS } from "../actions/drift-generate.ts";
import { getSession } from "../session/index.ts";

/** Default base ref for `pr.review` when none is supplied.
 *  **Re-exports the action's canonical** (§0.6.2 no-parallel-
 *  unions). Step 9b DC fix: previously a parallel literal lived
 *  in this file, in CLI's `pr-review` case, and in the action
 *  — three places that could silently diverge. */
export const DEFAULT_PR_REVIEW_BASE = DEFAULT_PR_REVIEW_BASE_REF;

/** Default lookback window for `drift.generate`. **Re-exports
 *  the action's own canonical** (§0.6.2 no-parallel-unions) so
 *  the bridge cannot silently disagree with `drift.generate`'s
 *  inputSchema. Step 9b DC fix: previously this was a separate
 *  literal `30` that shadowed the action's `7`. */
export const DEFAULT_DRIFT_WINDOW_DAYS = ACTION_DEFAULT_DRIFT_WINDOW_DAYS;

/** Marker the PR action uses for sticky-comment matching.
 *  `gh pr comment --edit-last` matches by comment author + a
 *  unique substring; a stable marker makes the match
 *  deterministic. The string is also asserted in tests so a
 *  rename surfaces both layers. */
export const PR_REVIEW_STICKY_MARKER =
  "<!-- schema:pr-review:sticky -->";

/** Marker that prefixes the drift.md file's head. Used so the
 *  drift action can detect a previously-generated file vs a
 *  hand-edited one and either replace or skip cleanly. */
export const DRIFT_FILE_MARKER =
  "<!-- schema:drift:generated -->";

export interface BridgeResult {
  readonly markdown: string;
  readonly exitCode: number;
}

/** Format a non-OK action result as an error markdown block.
 *  Useful so even a failed run produces a comment-worthy
 *  artefact rather than the action silently exiting non-zero
 *  with no diagnostic in the PR. */
export function formatBridgeError(
  source: "pr.review" | "drift.generate",
  message: string,
  code?: string,
): string {
  const lines = [
    "## Schema CI bridge error",
    "",
    `**Action:** \`${source}\``,
    code ? `**Code:** \`${code}\`` : "",
    `**Message:** ${message}`,
    "",
    "> The Schema engine returned an error. The CI workflow",
    "> is local-clone-only per `architecture/v1-launch-plan.md`",
    "> Q14 — no Marketplace listing. If this is a real bug",
    "> open an issue against the local clone.",
  ].filter((l) => l !== "");
  return lines.join("\n");
}

/** Run pr.review on `workspaceUri` against `base` and return
 *  the rendered markdown ready for `gh pr comment`. */
export async function runPrReviewMarkdown(
  workspaceUri: string,
  base: string = DEFAULT_PR_REVIEW_BASE,
  prSha?: string,
  studioBaseUrl?: string,
): Promise<BridgeResult> {
  const open = await workspaceOpen.handle({ uris: [workspaceUri] });
  // §0.6.4 DC fix: error markdown also gets the sticky marker
  // prefix so a workspace.open / pr.review failure UPDATES the
  // previous sticky comment instead of stacking a fresh one.
  // Without this, every failed CI run would post a brand new
  // comment under a green ✅ review from the prior PR push.
  if (!open.ok) {
    return {
      markdown: `${PR_REVIEW_STICKY_MARKER}\n${formatBridgeError("pr.review", open.message ?? "workspace.open failed", open.code)}`,
      exitCode: 1,
    };
  }
  const sessionId = (open.data as { sessionId: string }).sessionId;
  try {
    const review = await prReview.handle({
      sessionId,
      base,
      ...(prSha ? { prSha } : {}),
      ...(studioBaseUrl ? { studioBaseUrl } : {}),
    });
    if (!review.ok) {
      return {
        markdown: `${PR_REVIEW_STICKY_MARKER}\n${formatBridgeError("pr.review", review.message ?? "pr.review failed", review.code)}`,
        exitCode: 1,
      };
    }
    const data = review.data as { markdownUri: string };
    const session = getSession(sessionId);
    const markdown = session?.markdownResources.get(data.markdownUri);
    if (!markdown) {
      return {
        markdown: `${PR_REVIEW_STICKY_MARKER}\n${formatBridgeError("pr.review", `markdown resource ${data.markdownUri} not found`)}`,
        exitCode: 1,
      };
    }
    // Prepend the sticky marker so `gh pr comment --edit-last`
    // can match a previous comment. The marker is invisible
    // in rendered markdown (HTML comment).
    return { markdown: `${PR_REVIEW_STICKY_MARKER}\n${markdown}`, exitCode: 0 };
  } finally {
    await workspaceClose.handle({ sessionId });
  }
}

/** Run drift.generate on `workspaceUri` and return the
 *  rendered markdown for the drift.md file. */
export async function runDriftGenerateMarkdown(
  workspaceUri: string,
  windowDays: number = DEFAULT_DRIFT_WINDOW_DAYS,
): Promise<BridgeResult> {
  const open = await workspaceOpen.handle({ uris: [workspaceUri] });
  if (!open.ok) {
    return {
      markdown: formatBridgeError("drift.generate", open.message ?? "workspace.open failed", open.code),
      exitCode: 1,
    };
  }
  const sessionId = (open.data as { sessionId: string }).sessionId;
  try {
    const drift = await driftGenerate.handle({ sessionId, windowDays });
    if (!drift.ok) {
      return {
        markdown: formatBridgeError("drift.generate", drift.message ?? "drift.generate failed", drift.code),
        exitCode: 1,
      };
    }
    const data = drift.data as { markdownUri: string };
    const session = getSession(sessionId);
    const markdown = session?.markdownResources.get(data.markdownUri);
    if (!markdown) {
      return {
        markdown: formatBridgeError("drift.generate", `markdown resource ${data.markdownUri} not found`),
        exitCode: 1,
      };
    }
    return { markdown: `${DRIFT_FILE_MARKER}\n${markdown}`, exitCode: 0 };
  } finally {
    await workspaceClose.handle({ sessionId });
  }
}

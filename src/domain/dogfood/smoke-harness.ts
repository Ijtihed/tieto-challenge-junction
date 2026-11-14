// Per `architecture/v1-launch-plan.md` Step 11a-4.
//
// Pre-flight smoke harness for the Step 11 dogfood.
//
// Runs the canonical daily-driver flow end-to-end on a real
// repo + reports a `SmokeReport`. Used **before** the human
// 2-week session starts so blocking bugs surface early.
//
// **The daily-driver flow** (per Step 11 plan):
//   1. workspace.open       — extract the repo
//   2. graph.summary        — atlas-level overview
//   3. caching.stats        — confirm extraction stats are sane
//   4. graph.list_snapshots — confirm persistence is wired
//   5. graph.search         — basic retrieval (graph.ask comes
//      in Step 8b; until then graph.search is the closest
//      analog)
//   6. pr.review            — the headline artifact
//   7. drift.generate       — the L6+ promotion-evidence artifact
//   8. agents_md.write_facts — the round-trip artifact
//
// **Pure domain.** Takes an action map + a session id; runs
// each action; collects outcomes. No IO assumed beyond what
// the actions themselves do (which is fine — the actions are
// real engine calls).

import type { MultiRepoGraph } from "../multi-repo.ts";

/** A single step's outcome in the smoke harness. */
export interface SmokeStepResult {
  readonly step: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly summary: string;
  readonly /** Error message if !ok. */ error?: string;
}

/** Top-level smoke harness output. */
export interface SmokeReport {
  readonly repoPath: string;
  readonly totalMs: number;
  readonly steps: readonly SmokeStepResult[];
  readonly passedCount: number;
  readonly failedCount: number;
  readonly meetsGate: boolean;
  readonly gateExplanation: string;
}

/** Canonical list of daily-driver actions the smoke harness
 *  must exercise. Exported as a §0.6.2 canonical set so a
 *  future agent who adds or removes an action surface gets
 *  caught.
 *
 *  Step 8b update: `graph.search` (fuzzy substring) replaced
 *  with `graph.ask` (the headline hybrid-RAG action). Per the
 *  Step 11 plan: "Use `graph.ask` from Cursor / Claude Code
 *  for every codebase question". */
export const SMOKE_STEPS = [
  "workspace.open",
  "graph.summary",
  "caching.stats",
  "graph.list_snapshots",
  "graph.ask",
  "pr.review",
  "drift.generate",
  "agents_md.write_facts",
] as const;

export type SmokeStepName = (typeof SMOKE_STEPS)[number];

/** Action handler shape that the smoke harness calls. Matches
 *  the MCP action contract (every action exports a `handle`
 *  fn returning `{ok: boolean, data?, code?, message?}`). */
export interface ActionHandler {
  handle: (args: Record<string, unknown>) => Promise<{
    ok: boolean;
    data?: unknown;
    code?: string;
    message?: string;
  }>;
}

export interface SmokeOptions {
  /** Map from canonical step name to action handler. The
   *  caller supplies handlers — keeps this module pure
   *  domain. */
  readonly actions: Record<SmokeStepName, ActionHandler>;
  /** Workspace URI. */
  readonly workspaceUri: string;
  /** Optional clock override for deterministic timing in
   *  tests. */
  readonly now?: () => number;
}

/** Run the smoke harness. */
export async function runSmoke(options: SmokeOptions): Promise<SmokeReport> {
  const now = options.now ?? Date.now;
  const overallStart = now();
  const repoPath = options.workspaceUri.replace(/^file:\/\//, "");

  // Step 1: workspace.open. Required for every subsequent
  // step (they all take sessionId).
  const t0 = now();
  const open = await options.actions["workspace.open"].handle({
    uris: [options.workspaceUri],
  });
  const openMs = now() - t0;
  const openStep: SmokeStepResult = {
    step: "workspace.open",
    ok: open.ok,
    latencyMs: openMs,
    summary: open.ok
      ? `opened ${repoPath} in ${openMs}ms`
      : `FAILED: ${open.code ?? "?"} — ${open.message ?? "no message"}`,
    ...(!open.ok && open.message ? { error: open.message } : {}),
  };
  const steps: SmokeStepResult[] = [openStep];

  if (!open.ok) {
    // Can't run subsequent steps without a session.
    return finalize(repoPath, steps, now() - overallStart);
  }
  const sessionId = (open.data as { sessionId: string }).sessionId;

  // Step 2-8: the remaining canonical steps. We pass
  // sessionId; for actions that need extra args we supply
  // sensible defaults the daily-driver flow uses.
  const restSteps: { name: SmokeStepName; args: Record<string, unknown>; summarize: (data: unknown) => string }[] = [
    {
      name: "graph.summary",
      args: { sessionId },
      summarize: (d) => {
        // §0.6.4 DC fix: graph.summary returns totalNodes /
        // totalEdges (+ a clusters array) — NOT nodeCount /
        // edgeCount / clusterCount. The harness's pre-DC
        // shape mismatch caused the smoke report to always
        // show "0 nodes, 0 edges" no matter how big the
        // graph. Cross-layer-name pinning (§0.6.4 (j)).
        const s = d as { totalNodes?: number; totalEdges?: number; clusters?: readonly unknown[] };
        return `${s.totalNodes ?? 0} nodes, ${s.totalEdges ?? 0} edges, ${s.clusters?.length ?? 0} clusters`;
      },
    },
    {
      name: "caching.stats",
      args: { sessionId },
      summarize: (d) => {
        const s = d as { filesAttempted?: number; filesParsed?: number };
        return `${s.filesParsed ?? 0}/${s.filesAttempted ?? 0} files parsed`;
      },
    },
    {
      name: "graph.list_snapshots",
      args: { sessionId },
      summarize: (d) => {
        const s = d as { snapshots?: unknown[] };
        return `${s.snapshots?.length ?? 0} cached snapshots`;
      },
    },
    {
      name: "graph.ask",
      // A neutral natural-language query that exercises both
      // BM25 (lexical) + traversal (architectural) halves of
      // the hybrid pipeline. "main" is broad enough to hit
      // any non-trivial repo without triggering the
      // vocabulary linter (Rule 6).
      args: { sessionId, query: "main entry point" },
      summarize: (d) => {
        const s = d as { hits?: unknown[]; markdownUri?: string };
        return `${s.hits?.length ?? 0} hits via hybrid-RAG`;
      },
    },
    {
      name: "pr.review",
      args: { sessionId, base: "HEAD", prSha: "smoke-test-sha" },
      summarize: (d) => {
        const s = d as { hybridStrict?: boolean; atlasDeepLink?: string };
        return `hybridStrict=${s.hybridStrict ?? false}, atlas=${s.atlasDeepLink ?? "—"}`;
      },
    },
    {
      name: "drift.generate",
      args: { sessionId, windowDays: 30 },
      summarize: (d) => {
        const s = d as { snapshotsAnalyzed?: number; report?: { windowDays?: number } };
        return `${s.snapshotsAnalyzed ?? 0} snapshots over ${s.report?.windowDays ?? 0} day(s)`;
      },
    },
    {
      name: "agents_md.write_facts",
      args: { sessionId },
      summarize: (d) => {
        const s = d as { writtenPath?: string; charsAdded?: number };
        return `wrote ${s.writtenPath ?? "—"} (+${s.charsAdded ?? 0} chars)`;
      },
    },
  ];

  for (const stepDef of restSteps) {
    const stepStart = now();
    let result;
    try {
      result = await options.actions[stepDef.name].handle(stepDef.args);
    } catch (err) {
      const ms = now() - stepStart;
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({
        step: stepDef.name,
        ok: false,
        latencyMs: ms,
        summary: `THREW: ${msg}`,
        error: msg,
      });
      continue;
    }
    const ms = now() - stepStart;
    steps.push({
      step: stepDef.name,
      ok: result.ok,
      latencyMs: ms,
      summary: result.ok
        ? `${stepDef.summarize(result.data)} in ${ms}ms`
        : `FAILED: ${result.code ?? "?"} — ${result.message ?? "no message"}`,
      ...(!result.ok && result.message ? { error: result.message } : {}),
    });
  }

  return finalize(repoPath, steps, now() - overallStart);
}

function finalize(
  repoPath: string,
  steps: SmokeStepResult[],
  totalMs: number,
): SmokeReport {
  const passedCount = steps.filter((s) => s.ok).length;
  const failedCount = steps.length - passedCount;
  const meetsGate = failedCount === 0;
  const gateExplanation = meetsGate
    ? `Smoke gate PASS: all ${passedCount} steps succeeded in ${totalMs}ms.`
    : `Smoke gate FAIL: ${failedCount} of ${steps.length} steps failed. Fix before starting the 2-week dogfood.`;
  return {
    repoPath,
    totalMs,
    steps,
    passedCount,
    failedCount,
    meetsGate,
    gateExplanation,
  };
}

/** Render the smoke report as markdown for the CLI / commit. */
export function renderSmokeMarkdown(report: SmokeReport): string {
  const lines: string[] = [];
  lines.push(`# Step 11 pre-flight smoke report`);
  lines.push("");
  lines.push(`> ${report.gateExplanation}`);
  lines.push("");
  lines.push(`**Workspace:** \`${report.repoPath}\``);
  lines.push(`**Total time:** ${report.totalMs}ms`);
  lines.push("");
  lines.push(`| Step | Status | Latency | Summary |`);
  lines.push(`|---|---|---:|---|`);
  for (const step of report.steps) {
    const icon = step.ok ? "✓" : "✗";
    lines.push(`| \`${step.step}\` | ${icon} | ${step.latencyMs}ms | ${step.summary} |`);
  }
  return lines.join("\n");
}

/** Build a no-op graph + handler set for tests. The
 *  `MultiRepoGraph` import keeps the type surface visible
 *  to consumers. */
export type _MultiRepoGraphReexport = MultiRepoGraph;

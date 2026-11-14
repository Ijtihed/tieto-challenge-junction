// Per `architecture/v1-launch-plan.md` Step 9a work item 2.
//
// `drift.generate` — produce the weekly architectural drift
// report (research/26 §7 promotion-evidence artifact).
//
// **Store-driven** (decision §0.6: drive from Step 6's
// snapshot persistence, not from git log). Every workspace
// open already persists a snapshot; the chain is durable
// across cache cycles after the Step 8a DC v2→v3 migration
// restored Step 7a cluster fields. drift.generate just
// loads + compares.
//
// Output: a `DriftReport` (structured data) + a markdown
// resource stored as `markdown://drift.generate/<uuid>` so
// the caller can render or post it.

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSession } from "../session/index.ts";
import { openStore } from "../domain/persistence/store.ts";
import {
  computeDriftReport,
  renderDriftMarkdown,
  type DriftSnapshot,
} from "../domain/drift.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import type { Violation } from "../domain/types.ts";

const DB_PATH = join(homedir(), ".schema", "graph-cache.db");

/** Default number of days back to look. The plan says
 *  "weekly drift report" — 7 days. Exposed as an input so
 *  callers (e.g. ad-hoc audits) can widen the window. */
export const DEFAULT_DRIFT_WINDOW_DAYS = 7;

/** Max snapshots to consider, regardless of windowDays. Caps
 *  the report cost on workspaces with hundreds of snapshots
 *  per day. */
export const MAX_SNAPSHOTS_PER_REPORT = 30;

export const driftGenerate = {
  name: "drift.generate" as const,
  description:
    "Generate an architectural drift report by comparing snapshots over a time window. Returns a structured report + a markdown resource URI suitable for posting to a PR or writing to `architecture/drift.md`. Per research/26 §7, this is the L6+ promotion-evidence artifact.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      windowDays: {
        type: "number",
        description: `How many days back to look (default ${DEFAULT_DRIFT_WINDOW_DAYS}, capped at ${MAX_SNAPSHOTS_PER_REPORT} snapshots regardless)`,
      },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }
    session.lastActivityAt = Date.now();

    const windowDays =
      (args["windowDays"] as number | undefined) ?? DEFAULT_DRIFT_WINDOW_DAYS;
    if (windowDays <= 0 || !Number.isFinite(windowDays)) {
      return { ok: false as const, code: "invalid-args", message: "windowDays must be > 0" };
    }

    const workspacePath = session.workspaceUris[0]?.replace("file://", "");
    if (!workspacePath) {
      return { ok: false as const, code: "invalid-args", message: "No file:// workspace URI in session" };
    }

    let store;
    try {
      store = openStore(DB_PATH);

      // 1. Load snapshot metadata ordered by created_at (we
      // get last_accessed-ordered from listSnapshots; sort
      // chronologically by created_at via the meta itself).
      const allSnaps = store.listSnapshots(workspacePath);
      const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
      const inWindow = allSnaps
        .filter((s) => s.createdAt >= sinceMs)
        .sort((a, b) => a.createdAt - b.createdAt);

      // Cap at MAX_SNAPSHOTS_PER_REPORT — keep oldest + newest
      // + evenly-spaced sample.
      const sampled = sampleSnapshots(inWindow, MAX_SNAPSHOTS_PER_REPORT);

      // 2. Load each sampled snapshot's graph + compute its
      // violations. Live graph for the head session is reused
      // (saves an extra load).
      const driftSnaps: DriftSnapshot[] = [];
      for (const meta of sampled) {
        const graph = store.loadSnapshotBySha(workspacePath, meta.gitSha);
        if (!graph) continue;
        const violations: Violation[] = [];
        for (const rule of BUILTIN_RULES) {
          violations.push(...rule.evaluate(graph));
        }
        driftSnaps.push({
          id: meta.id,
          gitSha: meta.gitSha,
          at: meta.createdAt,
          graph,
          violations,
        });
      }

      // 3. Compute the report.
      const report = computeDriftReport(driftSnaps);
      const workspaceName = workspacePath.split("/").pop() ?? workspacePath;
      const markdown = renderDriftMarkdown(report, { workspaceName });

      const resultId = randomUUID();
      const markdownUri = `markdown://drift.generate/${resultId}`;
      session.markdownResources.set(markdownUri, markdown);

      return {
        ok: true as const,
        data: {
          report,
          markdownUri,
          snapshotsAnalyzed: driftSnaps.length,
        },
      };
    } catch (err) {
      return {
        ok: false as const,
        code: "STORE_ERROR",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      store?.close();
    }
  },
};

/** Sample a sequence to at most `maxN` entries, preserving
 *  the first + last and selecting roughly evenly-spaced
 *  intermediates. Pure function (§0.6.4 (a)). Exported for
 *  testing. */
export function sampleSnapshots<T>(
  snapshots: readonly T[],
  maxN: number,
): readonly T[] {
  if (snapshots.length <= maxN) return snapshots;
  if (maxN <= 0) return [];
  if (maxN === 1) return [snapshots[0]!];
  const out: T[] = [];
  const step = (snapshots.length - 1) / (maxN - 1);
  for (let i = 0; i < maxN; i++) {
    const idx = Math.round(i * step);
    out.push(snapshots[idx]!);
  }
  return out;
}

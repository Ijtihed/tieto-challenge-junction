// Per `architecture/v1-launch-plan.md` Step 9a work item 2 +
// research/26 §7 (Schema artifacts as L6+ promotion evidence).
//
// `drift.generate` computes a weekly architectural drift
// report. Inputs: an ordered sequence of `MultiRepoGraph`
// snapshots (oldest → newest, typically loaded from Step 6's
// persistence store). Output: a structured `DriftReport`
// that the action handler renders to markdown.
//
// **Why store-driven (per Step 9 plan + Step 8a DC §0.6.4 (f)
// refinement on cross-step persistence):** Step 6's snapshot
// store already keeps every workspace open's graph. Step 8a
// DC restored the Step 7a cluster fields (`labelTier`,
// `importance`, `entryPointIds`) to the persisted schema, so
// drift can use cluster-level signals — areas grown/shrunk,
// new cross-cluster deps, deprecation candidates —
// **without** re-running extraction. This makes the action
// pure-load-then-compute, no extractor IO.
//
// **The 4 sections** (per the plan):
//   1. Areas grown/shrunk — cluster node-count deltas
//   2. New cross-cluster dependencies — edges whose endpoints
//      changed clusters between snapshots, plus brand-new
//      cross-cluster edges
//   3. Deprecation candidates — nodes with declining inbound
//      edge counts (i.e. fewer callers over time)
//   4. Rule-violation trends — violation counts per snapshot,
//      with delta direction
//
// **Pure domain module.** No IO. Caller passes the loaded
// graphs + the violation lists; this module computes the
// report. Tests can synthesise snapshot sequences without
// any persistence.

import type { MultiRepoGraph, GraphNode, Cluster } from "./multi-repo.ts";
import type { Violation } from "./types.ts";

/** A single snapshot to feed into the drift computation. The
 *  `at` timestamp is preserved so the report can render
 *  "Tuesday 2026-05-13 → Tuesday 2026-05-20" style trends. */
export interface DriftSnapshot {
  readonly id: number;
  readonly gitSha: string;
  readonly at: number;
  readonly graph: MultiRepoGraph;
  readonly violations: readonly Violation[];
}

/** The structured report. Markdown rendering is done in the
 *  action handler; this is the data layer the handler
 *  consumes. */
export interface DriftReport {
  readonly windowDays: number;
  readonly snapshotCount: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly areasGrownOrShrunk: readonly AreaDelta[];
  readonly newCrossClusterDeps: readonly CrossClusterDep[];
  readonly deprecationCandidates: readonly DeprecationCandidate[];
  readonly violationTrend: readonly ViolationDataPoint[];
}

export interface AreaDelta {
  readonly clusterId: string;
  readonly clusterName: string;
  readonly nodesAtStart: number;
  readonly nodesAtEnd: number;
  /** Positive = grew, negative = shrunk. */
  readonly delta: number;
  /** Relative change, e.g. 0.25 = grew by 25%. Floor at -1
   *  for clusters that disappeared. */
  readonly relativeChange: number;
}

export interface CrossClusterDep {
  readonly sourceClusterName: string;
  readonly targetClusterName: string;
  /** Edge count between the two clusters at start. */
  readonly edgesAtStart: number;
  /** Edge count between the two clusters at end. */
  readonly edgesAtEnd: number;
  readonly relation: string;
}

export interface DeprecationCandidate {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly filePath: string | undefined;
  readonly inboundAtStart: number;
  readonly inboundAtEnd: number;
  /** Negative — these are nodes losing callers. */
  readonly delta: number;
}

export interface ViolationDataPoint {
  readonly snapshotId: number;
  readonly gitSha: string;
  readonly at: number;
  readonly errorCount: number;
  readonly warnCount: number;
  readonly infoCount: number;
}

/** Drift thresholds. Exported as a canonical set per §0.6.2.
 *  Each threshold is justified by the plan or research; do
 *  not change without updating the test that pins them. */
export const DRIFT_THRESHOLDS = {
  /** Min node-count delta to report a cluster as
   *  grown/shrunk. Tightens the noise floor; small clusters
   *  with ±1 node aren't interesting. */
  minAreaDelta: 3,
  /** Min relative change to report a cluster as
   *  grown/shrunk (in addition to minAreaDelta). 10% prevents
   *  large clusters with insignificant relative changes from
   *  dominating. */
  minRelativeChange: 0.1,
  /** Min inbound-edge loss to flag a node as a deprecation
   *  candidate. Avoids one-off churn. */
  minInboundLoss: 2,
  /** Max items to include in each section. Prevents the
   *  drift report from becoming unreadable for large
   *  workspaces. */
  maxItemsPerSection: 20,
} as const;

// ──────────────────────────────────────────────────────────
// Helpers — pure functions, individually testable per §0.6.4.
// ──────────────────────────────────────────────────────────

/** Build a map from clusterId to cluster across all repos of
 *  a single snapshot. */
export function clustersByIdForSnapshot(
  graph: MultiRepoGraph,
): ReadonlyMap<string, Cluster> {
  const out = new Map<string, Cluster>();
  for (const repo of graph.repos) {
    for (const c of repo.clusters) out.set(c.id, c);
  }
  return out;
}

/** Build a map from nodeId → its containing cluster id for a
 *  snapshot. A node may exist without a cluster (singleton);
 *  callers should handle the undefined case. */
export function nodeToClusterMap(
  graph: MultiRepoGraph,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const repo of graph.repos) {
    for (const c of repo.clusters) {
      for (const nid of c.nodeIds) out.set(nid, c.id);
    }
  }
  return out;
}

/** Compute inbound edge counts per node id. Used by the
 *  deprecation-candidate detector. */
export function inboundEdgeCounts(
  graph: MultiRepoGraph,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const repo of graph.repos) {
    for (const e of repo.edges) {
      counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
    }
  }
  return counts;
}

/** Compute cross-cluster edge counts as a triple-key map
 *  (sourceClusterId, targetClusterId, relation) → count. */
export function crossClusterEdgeCounts(
  graph: MultiRepoGraph,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const nodeToCluster = nodeToClusterMap(graph);
  for (const repo of graph.repos) {
    for (const e of repo.edges) {
      const srcCluster = nodeToCluster.get(e.source);
      const tgtCluster = nodeToCluster.get(e.target);
      if (!srcCluster || !tgtCluster || srcCluster === tgtCluster) continue;
      const key = `${srcCluster}|${tgtCluster}|${e.relation}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

/** Compute areas (clusters) that grew or shrunk between two
 *  snapshots. */
export function computeAreaDeltas(
  start: DriftSnapshot,
  end: DriftSnapshot,
  thresholds = DRIFT_THRESHOLDS,
): AreaDelta[] {
  const startClusters = clustersByIdForSnapshot(start.graph);
  const endClusters = clustersByIdForSnapshot(end.graph);
  const allIds = new Set<string>([...startClusters.keys(), ...endClusters.keys()]);

  const deltas: AreaDelta[] = [];
  for (const cid of allIds) {
    const startCluster = startClusters.get(cid);
    const endCluster = endClusters.get(cid);
    const startCount = startCluster?.nodeIds.length ?? 0;
    const endCount = endCluster?.nodeIds.length ?? 0;
    const delta = endCount - startCount;
    if (Math.abs(delta) < thresholds.minAreaDelta) continue;
    const baseForRelative = Math.max(startCount, 1);
    const relativeChange = (delta / baseForRelative);
    if (Math.abs(relativeChange) < thresholds.minRelativeChange) continue;
    deltas.push({
      clusterId: cid,
      clusterName: endCluster?.name ?? startCluster?.name ?? cid,
      nodesAtStart: startCount,
      nodesAtEnd: endCount,
      delta,
      relativeChange,
    });
  }
  // Sort by absolute delta descending — most-changed first.
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return deltas.slice(0, thresholds.maxItemsPerSection);
}

/** Compute cross-cluster dependencies that newly appeared or
 *  measurably grew between two snapshots. */
export function computeNewCrossClusterDeps(
  start: DriftSnapshot,
  end: DriftSnapshot,
  thresholds = DRIFT_THRESHOLDS,
): CrossClusterDep[] {
  const startCounts = crossClusterEdgeCounts(start.graph);
  const endCounts = crossClusterEdgeCounts(end.graph);
  const startClusters = clustersByIdForSnapshot(start.graph);
  const endClusters = clustersByIdForSnapshot(end.graph);

  const newDeps: CrossClusterDep[] = [];
  for (const [key, endCount] of endCounts) {
    const startCount = startCounts.get(key) ?? 0;
    // Only report deps that newly appeared (startCount = 0)
    // or grew by at least minAreaDelta. Shrinkage isn't a
    // useful "new dep" signal.
    if (startCount > 0 && endCount - startCount < thresholds.minAreaDelta) continue;
    if (startCount === 0 && endCount < 1) continue;
    const [srcId, tgtId, relation] = key.split("|");
    if (!srcId || !tgtId || !relation) continue;
    const srcName = endClusters.get(srcId)?.name ?? startClusters.get(srcId)?.name ?? srcId;
    const tgtName = endClusters.get(tgtId)?.name ?? startClusters.get(tgtId)?.name ?? tgtId;
    newDeps.push({
      sourceClusterName: srcName,
      targetClusterName: tgtName,
      edgesAtStart: startCount,
      edgesAtEnd: endCount,
      relation,
    });
  }
  newDeps.sort((a, b) => (b.edgesAtEnd - b.edgesAtStart) - (a.edgesAtEnd - a.edgesAtStart));
  return newDeps.slice(0, thresholds.maxItemsPerSection);
}

/** Compute deprecation candidates: nodes whose inbound edge
 *  count fell by at least `minInboundLoss` between start and
 *  end. These are nodes losing callers — strong "delete me"
 *  signal. */
export function computeDeprecationCandidates(
  start: DriftSnapshot,
  end: DriftSnapshot,
  thresholds = DRIFT_THRESHOLDS,
): DeprecationCandidate[] {
  const startCounts = inboundEdgeCounts(start.graph);
  const endCounts = inboundEdgeCounts(end.graph);
  const nodeById = new Map<string, GraphNode>();
  for (const repo of end.graph.repos) {
    for (const n of repo.nodes) nodeById.set(n.id, n);
  }
  // Also include nodes that disappeared (definitely
  // deprecation candidates in the strongest sense).
  for (const repo of start.graph.repos) {
    for (const n of repo.nodes) {
      if (!nodeById.has(n.id)) nodeById.set(n.id, n);
    }
  }

  const candidates: DeprecationCandidate[] = [];
  for (const [nodeId, startCount] of startCounts) {
    const endCount = endCounts.get(nodeId) ?? 0;
    const delta = endCount - startCount;
    if (delta >= -thresholds.minInboundLoss + 1) continue;
    const node = nodeById.get(nodeId);
    if (!node) continue;
    candidates.push({
      nodeId,
      nodeName: node.name,
      filePath: node.filePath,
      inboundAtStart: startCount,
      inboundAtEnd: endCount,
      delta,
    });
  }
  candidates.sort((a, b) => a.delta - b.delta);
  return candidates.slice(0, thresholds.maxItemsPerSection);
}

/** Compute violation trend across an arbitrary number of
 *  snapshots (not just two). The output array is in time
 *  order so a renderer can produce a sparkline. */
export function computeViolationTrend(
  snapshots: readonly DriftSnapshot[],
): ViolationDataPoint[] {
  return snapshots.map((s) => {
    let errorCount = 0;
    let warnCount = 0;
    let infoCount = 0;
    for (const v of s.violations) {
      if (v.severity === "error") errorCount++;
      else if (v.severity === "warn") warnCount++;
      else infoCount++;
    }
    return {
      snapshotId: s.id,
      gitSha: s.gitSha,
      at: s.at,
      errorCount,
      warnCount,
      infoCount,
    };
  });
}

/** Top-level: compute the full drift report. */
export function computeDriftReport(
  snapshots: readonly DriftSnapshot[],
  thresholds = DRIFT_THRESHOLDS,
): DriftReport {
  if (snapshots.length === 0) {
    return {
      windowDays: 0,
      snapshotCount: 0,
      windowStart: 0,
      windowEnd: 0,
      areasGrownOrShrunk: [],
      newCrossClusterDeps: [],
      deprecationCandidates: [],
      violationTrend: [],
    };
  }
  if (snapshots.length === 1) {
    // Single-snapshot edge case: no comparison possible;
    // emit a baseline report with only the violation
    // trend (which is just one point).
    const only = snapshots[0]!;
    return {
      windowDays: 0,
      snapshotCount: 1,
      windowStart: only.at,
      windowEnd: only.at,
      areasGrownOrShrunk: [],
      newCrossClusterDeps: [],
      deprecationCandidates: [],
      violationTrend: computeViolationTrend(snapshots),
    };
  }

  const start = snapshots[0]!;
  const end = snapshots[snapshots.length - 1]!;
  const windowMs = end.at - start.at;
  const windowDays = Math.max(0, Math.round(windowMs / (1000 * 60 * 60 * 24)));

  return {
    windowDays,
    snapshotCount: snapshots.length,
    windowStart: start.at,
    windowEnd: end.at,
    areasGrownOrShrunk: computeAreaDeltas(start, end, thresholds),
    newCrossClusterDeps: computeNewCrossClusterDeps(start, end, thresholds),
    deprecationCandidates: computeDeprecationCandidates(start, end, thresholds),
    violationTrend: computeViolationTrend(snapshots),
  };
}

/** Render a DriftReport to markdown. Pure, isolated from the
 *  action handler so the rendering is unit-testable. */
export function renderDriftMarkdown(
  report: DriftReport,
  opts: { workspaceName?: string } = {},
): string {
  const workspaceName = opts.workspaceName ?? "this workspace";
  const lines: string[] = [];
  lines.push("# Architectural drift report");
  lines.push("");
  lines.push(`> ${workspaceName} · ${report.snapshotCount} snapshots over ${report.windowDays} day${report.windowDays === 1 ? "" : "s"}`);
  lines.push(`> Generated ${new Date(report.windowEnd).toISOString().slice(0, 10)} from snapshots ${formatDate(report.windowStart)} → ${formatDate(report.windowEnd)}`);
  lines.push("");

  // ── 1. Areas grown / shrunk ──
  lines.push("## Areas grown / shrunk", "");
  if (report.areasGrownOrShrunk.length === 0) {
    lines.push("_No cluster crossed the size-change threshold this window._", "");
  } else {
    lines.push("| Area | Start | End | Δ | Δ% |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const a of report.areasGrownOrShrunk) {
      const sign = a.delta > 0 ? "+" : "";
      const pct = (a.relativeChange * 100).toFixed(0);
      lines.push(`| ${a.clusterName} | ${a.nodesAtStart} | ${a.nodesAtEnd} | ${sign}${a.delta} | ${sign}${pct}% |`);
    }
    lines.push("");
  }

  // ── 2. New cross-cluster dependencies ──
  lines.push("## New cross-cluster dependencies", "");
  if (report.newCrossClusterDeps.length === 0) {
    lines.push("_No new cross-cluster dependencies crossed the threshold._", "");
  } else {
    lines.push("| From | To | Relation | Start | End |");
    lines.push("|---|---|---|---:|---:|");
    for (const d of report.newCrossClusterDeps) {
      lines.push(`| ${d.sourceClusterName} | ${d.targetClusterName} | \`${d.relation}\` | ${d.edgesAtStart} | ${d.edgesAtEnd} |`);
    }
    lines.push("");
  }

  // ── 3. Deprecation candidates ──
  lines.push("## Deprecation candidates", "");
  if (report.deprecationCandidates.length === 0) {
    lines.push("_No nodes lost a meaningful number of callers this window._", "");
  } else {
    lines.push("Nodes whose inbound edge count fell by ≥ 2 this window. Strong signal for review + potential removal.", "");
    lines.push("| Node | File | Callers (start → end) | Δ |");
    lines.push("|---|---|---:|---:|");
    for (const d of report.deprecationCandidates) {
      const file = d.filePath ?? "_(unknown file)_";
      lines.push(`| \`${d.nodeName}\` | \`${file}\` | ${d.inboundAtStart} → ${d.inboundAtEnd} | ${d.delta} |`);
    }
    lines.push("");
  }

  // ── 4. Violation trend ──
  lines.push("## Rule violation trend", "");
  if (report.violationTrend.length === 0) {
    lines.push("_No snapshots in this window._", "");
  } else {
    lines.push("| Snapshot | Errors | Warnings | Info |");
    lines.push("|---|---:|---:|---:|");
    for (const v of report.violationTrend) {
      lines.push(`| \`${v.gitSha.slice(0, 7)}\` (${formatDate(v.at)}) | ${v.errorCount} | ${v.warnCount} | ${v.infoCount} |`);
    }
    const first = report.violationTrend[0]!;
    const last = report.violationTrend[report.violationTrend.length - 1]!;
    const errorDelta = last.errorCount - first.errorCount;
    const warnDelta = last.warnCount - first.warnCount;
    lines.push("");
    lines.push(`**Trend:** errors ${signed(errorDelta)}, warnings ${signed(warnDelta)} over the window.`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function signed(n: number): string {
  if (n === 0) return "no change";
  return n > 0 ? `+${n}` : `${n}`;
}

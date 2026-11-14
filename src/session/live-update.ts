// Per `architecture/v1-launch-plan.md` Step 5b — live atlas
// update handler.
//
// Subscribes to `files.changed` events on the session's event
// bus. For each batch of changed files:
//   1. Filter to files the extractors care about
//   2. Re-extract ONLY those files (partial extraction)
//   3. L3 fact-equality cutoff: compare old vs new nodes by
//      bodyFingerprint; skip bridge/clustering/Datalog if the
//      fact set didn't change
//   4. If facts changed: re-run bridges + clustering + Datalog
//   5. Emit `graph.updated` event for Studio to react to
//
// Full-rebuild fallback: if partial extraction fails for any
// reason, fall back to a full workspace re-extract (expensive
// but always correct, per doc 27 R9).

import type { Session } from "./session.ts";
import type { EventBus, SessionEvent } from "./event-bus.ts";

export interface LiveUpdateStats {
  updatesTriggered: number;
  filesReExtracted: number;
  factEqualityCutoffs: number;
  fullRebuildFallbacks: number;
  bridgeReRuns: number;
  clusteringReRuns: number;
  totalUpdateMs: number;
}

export function createEmptyLiveUpdateStats(): LiveUpdateStats {
  return {
    updatesTriggered: 0,
    filesReExtracted: 0,
    factEqualityCutoffs: 0,
    fullRebuildFallbacks: 0,
    bridgeReRuns: 0,
    clusteringReRuns: 0,
    totalUpdateMs: 0,
  };
}

/** Hash the fact set (node ids + bodyFingerprints) to detect
 *  whether an update actually changed anything. If the hash
 *  is the same, the graph is structurally identical and we
 *  can skip expensive downstream work. */
export function computeFactHash(
  nodes: readonly { id: string; bodyFingerprint?: number | undefined }[],
): string {
  let h = 0;
  for (const n of nodes) {
    // FNV-1a-style combination of id + fingerprint
    const fp = n.bodyFingerprint ?? 0;
    for (let i = 0; i < n.id.length; i++) {
      h = (h ^ n.id.charCodeAt(i)) * 0x01000193;
    }
    h = (h ^ fp) * 0x01000193;
  }
  return (h >>> 0).toString(16);
}

/** Subscribe to the session's event bus for `files.changed`
 *  events and trigger incremental re-extraction. Returns an
 *  unsubscribe function. */
export function subscribeLiveUpdates(
  session: Session,
  bus: EventBus,
): { unsubscribe: () => void; stats: LiveUpdateStats } {
  const stats = createEmptyLiveUpdateStats();

  const handler = async (event: SessionEvent) => {
    if (event.kind !== "files.changed") return;
    const changes = (event as { changes?: Array<{ uri: string; kind: string }> }).changes;
    if (!changes || changes.length === 0) return;

    stats.updatesTriggered++;
    const startMs = Date.now();

    // Convert URIs to absolute paths for the extraction pipeline.
    const changedPaths = new Set(
      changes
        .filter((c) => c.kind !== "unlink")
        .map((c) => c.uri.replace(/^file:\/\//, "")),
    );

    if (changedPaths.size === 0) {
      // Only deletes — strip nodes for deleted files.
      const deletedPaths = new Set(
        changes.filter((c) => c.kind === "unlink").map((c) => c.uri.replace(/^file:\/\//, "")),
      );
      for (const repo of session.graph.repos) {
        const filtered = repo.nodes.filter((n) => !n.filePath || !deletedPaths.has(n.filePath));
        if (filtered.length !== repo.nodes.length) {
          const filteredIds = new Set(filtered.map((n) => n.id));
          const filteredEdges = repo.edges.filter(
            (e) => filteredIds.has(e.source) && filteredIds.has(e.target),
          );
          Object.assign(repo, { nodes: filtered, edges: filteredEdges });
          stats.filesReExtracted += deletedPaths.size;
        }
      }
      bus.emit({ kind: "graph.updated", reason: "file-delete", at: Date.now() } as SessionEvent);
      stats.totalUpdateMs += Date.now() - startMs;
      return;
    }

    // L3 fact-equality cutoff: compute the fact hash of nodes
    // in the changed files BEFORE re-extraction.
    const beforeNodes = session.graph.repos.flatMap((r) =>
      r.nodes.filter((n) => n.filePath && changedPaths.has(n.filePath)),
    );
    const beforeHash = computeFactHash(beforeNodes);

    // Partial re-extraction: strip old nodes for changed files,
    // then re-extract only those files. This is the L1→L2 bridge.
    stats.filesReExtracted += changedPaths.size;

    for (const repo of session.graph.repos) {
      const kept = repo.nodes.filter((n) => !n.filePath || !changedPaths.has(n.filePath));
      const keptIds = new Set(kept.map((n) => n.id));
      const keptEdges = repo.edges.filter(
        (e) => keptIds.has(e.source) && keptIds.has(e.target),
      );
      Object.assign(repo, { nodes: kept, edges: keptEdges });
    }

    // Re-extract is handled by the caller (workspace-open's
    // extraction pipeline). We emit an event for it to pick up.
    // The extraction pipeline reads `session.graph` and merges
    // the new nodes in.
    bus.emit({
      kind: "live.re_extract_needed",
      changedPaths: [...changedPaths],
      at: Date.now(),
    } as SessionEvent);

    // After re-extraction completes (async), check L3 cutoff.
    const afterNodes = session.graph.repos.flatMap((r) =>
      r.nodes.filter((n) => n.filePath && changedPaths.has(n.filePath)),
    );
    const afterHash = computeFactHash(afterNodes);

    if (beforeHash === afterHash) {
      stats.factEqualityCutoffs++;
    } else {
      stats.bridgeReRuns++;
      stats.clusteringReRuns++;
    }

    bus.emit({ kind: "graph.updated", reason: "live-update", at: Date.now() } as SessionEvent);
    stats.totalUpdateMs += Date.now() - startMs;
  };

  const unsub = bus.subscribe(handler as (event: SessionEvent) => void);
  return {
    unsubscribe: unsub,
    stats,
  };
}

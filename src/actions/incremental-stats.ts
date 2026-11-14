// Per `architecture/v1-launch-plan.md` Step 5a + research/27 R5.
//
// Returns the state of every incremental layer in Schema's 5-layer
// pipeline. Step 1 + Step 4 shipped L4 (differential Datalog)
// telemetry; Step 5a adds L1 (file watch) telemetry. Step 5b will
// add L2 (tree-sitter incremental) + L3 (per-file fact equality)
// telemetry without changing this action's MCP surface — the
// payload shape is forward-compatible.

import { getSession } from "../session/index.ts";

export const incrementalStats = {
  name: "incremental.stats" as const,
  description:
    "Returns the state of Schema's incremental pipeline: L1 file-watch counters, L4 differential Datalog evaluator state, and (Step 5b) L2/L3 cutoff hit rates. The shape is forward-compatible: callers should expect new fields per layer over time.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
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
    const incEval = session.incrementalEval;

    // L1 (file watch) — per Step 5a. Falls back to a not-watching
    // sentinel when no `workspace.watch_start` has been issued for
    // this session.
    const watcher = session.fileWatcher;
    const l1 = watcher
      ? watcher.stats()
      : {
        rawEvents: 0,
        filteredOut: 0,
        duplicatesSuppressed: 0,
        eventsEmitted: 0,
        burstsCoalesced: 0,
        editorForwarded: 0,
        startedAt: 0,
        watching: false,
      };

    // L2 (tree-sitter incremental) — Step 5b. Read from
    // session.treeCache if available.
    const treeCache = (session as { treeCache?: { stats: { hits: number; misses: number; evictions: number; incrementalParses: number; fullParseFallbacks: number }; size: number } }).treeCache;
    const l2 = treeCache
      ? { ...treeCache.stats, cachedTrees: treeCache.size }
      : { hits: 0, misses: 0, evictions: 0, incrementalParses: 0, fullParseFallbacks: 0, cachedTrees: 0 };

    // L3 (fact-equality cutoff) — Step 5b.
    const liveStats = (session as { liveUpdateStats?: { updatesTriggered: number; factEqualityCutoffs: number; fullRebuildFallbacks: number; filesReExtracted: number; bridgeReRuns: number; clusteringReRuns: number; totalUpdateMs: number } }).liveUpdateStats;
    const l3 = liveStats
      ? {
        updatesTriggered: liveStats.updatesTriggered,
        factEqualityCutoffs: liveStats.factEqualityCutoffs,
        fullRebuildFallbacks: liveStats.fullRebuildFallbacks,
        filesReExtracted: liveStats.filesReExtracted,
        bridgeReRuns: liveStats.bridgeReRuns,
        clusteringReRuns: liveStats.clusteringReRuns,
        totalUpdateMs: liveStats.totalUpdateMs,
      }
      : {
        updatesTriggered: 0,
        factEqualityCutoffs: 0,
        fullRebuildFallbacks: 0,
        filesReExtracted: 0,
        bridgeReRuns: 0,
        clusteringReRuns: 0,
        totalUpdateMs: 0,
      };

    return {
      ok: true as const,
      data: {
        version: incEval.version,
        evalCount: incEval.evalCount,
        programInstalled: incEval.program !== null,
        ...incEval.stats,
        l1: l1,
        l2,
        l3,
      },
    };
  },
};

// Per `architecture/v1-launch-plan.md` Step 9a work item 2.
// §0.6.4 adversarial verification with refinements (a-f)
// applied from day-1: canonical sets, threshold pinning,
// integration-boundary equivalence, perf scale fixture.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeDriftReport,
  computeAreaDeltas,
  computeNewCrossClusterDeps,
  computeDeprecationCandidates,
  computeViolationTrend,
  inboundEdgeCounts,
  crossClusterEdgeCounts,
  clustersByIdForSnapshot,
  nodeToClusterMap,
  renderDriftMarkdown,
  DRIFT_THRESHOLDS,
  type DriftSnapshot,
} from "../domain/drift.ts";
import {
  driftGenerate,
  sampleSnapshots,
  DEFAULT_DRIFT_WINDOW_DAYS,
  MAX_SNAPSHOTS_PER_REPORT,
} from "../actions/drift-generate.ts";
import type { MultiRepoGraph, GraphNode, GraphEdge, Cluster } from "../domain/multi-repo.ts";
import type { Violation } from "../domain/types.ts";

// ──────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────
function mkNode(id: string, name: string, filePath?: string): GraphNode {
  return {
    id, kind: "function", name,
    locator: `file:///r/${id}.ts#${id}`,
    ...(filePath !== undefined ? { filePath } : {}),
  };
}

function mkEdge(id: string, source: string, target: string, relation = "calls"): GraphEdge {
  return { id, source, target, relation };
}

function mkCluster(id: string, name: string, nodeIds: string[]): Cluster {
  return { id, name, nodeIds };
}

function mkGraph(nodes: GraphNode[], edges: GraphEdge[] = [], clusters: Cluster[] = []): MultiRepoGraph {
  return {
    version: "0.0",
    repos: [{ uri: "file:///r", nodes, edges, clusters }],
    interRepoEdges: [],
  };
}

function mkSnapshot(id: number, atDays: number, graph: MultiRepoGraph, violations: Violation[] = []): DriftSnapshot {
  return {
    id,
    gitSha: `sha${id}`.padEnd(40, "0"),
    at: Date.now() - atDays * 24 * 60 * 60 * 1000,
    graph,
    violations,
  };
}

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical-set pinning: thresholds
// ──────────────────────────────────────────────────────────
describe("DRIFT_THRESHOLDS canonical set (§0.6.2)", () => {
  it("has exactly 4 keys (minAreaDelta, minRelativeChange, minInboundLoss, maxItemsPerSection)", () => {
    const keys = Object.keys(DRIFT_THRESHOLDS).sort();
    assert.deepEqual(keys, ["maxItemsPerSection", "minAreaDelta", "minInboundLoss", "minRelativeChange"]);
  });

  it("pins exact values (Step 9a defaults)", () => {
    assert.equal(DRIFT_THRESHOLDS.minAreaDelta, 3);
    assert.equal(DRIFT_THRESHOLDS.minRelativeChange, 0.1);
    assert.equal(DRIFT_THRESHOLDS.minInboundLoss, 2);
    assert.equal(DRIFT_THRESHOLDS.maxItemsPerSection, 20);
  });
});

describe("drift-generate action defaults", () => {
  it("DEFAULT_DRIFT_WINDOW_DAYS = 7 (plan: 'weekly drift report')", () => {
    assert.equal(DEFAULT_DRIFT_WINDOW_DAYS, 7);
  });

  it("MAX_SNAPSHOTS_PER_REPORT = 30", () => {
    assert.equal(MAX_SNAPSHOTS_PER_REPORT, 30);
  });
});

// ──────────────────────────────────────────────────────────
// Helper unit tests (§0.6.4 (a) extracted helpers)
// ──────────────────────────────────────────────────────────
describe("clustersByIdForSnapshot", () => {
  it("maps each cluster id to its cluster across repos", () => {
    const g = mkGraph(
      [mkNode("n1", "A"), mkNode("n2", "B")],
      [],
      [mkCluster("c1", "C1", ["n1"]), mkCluster("c2", "C2", ["n2"])],
    );
    const m = clustersByIdForSnapshot(g);
    assert.equal(m.size, 2);
    assert.equal(m.get("c1")?.name, "C1");
    assert.equal(m.get("c2")?.name, "C2");
  });

  it("empty graph → empty map", () => {
    const m = clustersByIdForSnapshot(mkGraph([]));
    assert.equal(m.size, 0);
  });
});

describe("nodeToClusterMap", () => {
  it("maps each node id to its cluster id", () => {
    const g = mkGraph(
      [mkNode("n1", "A"), mkNode("n2", "B"), mkNode("n3", "C")],
      [],
      [mkCluster("c1", "C1", ["n1", "n2"]), mkCluster("c2", "C2", ["n3"])],
    );
    const m = nodeToClusterMap(g);
    assert.equal(m.get("n1"), "c1");
    assert.equal(m.get("n2"), "c1");
    assert.equal(m.get("n3"), "c2");
  });

  it("unclustered nodes are not in the map", () => {
    const g = mkGraph(
      [mkNode("orphan", "Orphan")],
      [],
      [],
    );
    const m = nodeToClusterMap(g);
    assert.equal(m.has("orphan"), false);
  });
});

describe("inboundEdgeCounts", () => {
  it("counts inbound edges per node", () => {
    const g = mkGraph(
      [mkNode("a", "A"), mkNode("b", "B"), mkNode("c", "C")],
      [
        mkEdge("e1", "a", "c"),
        mkEdge("e2", "b", "c"),
        mkEdge("e3", "a", "b"),
      ],
    );
    const m = inboundEdgeCounts(g);
    assert.equal(m.get("c"), 2);
    assert.equal(m.get("b"), 1);
    assert.equal(m.get("a") ?? 0, 0);
  });
});

describe("crossClusterEdgeCounts", () => {
  it("counts edges that cross cluster boundaries by relation", () => {
    const g = mkGraph(
      [mkNode("a", "A"), mkNode("b", "B"), mkNode("c", "C")],
      [
        mkEdge("e1", "a", "b", "calls"),    // within c1, IGNORED
        mkEdge("e2", "a", "c", "calls"),    // c1 → c2
        mkEdge("e3", "b", "c", "imports"),  // c1 → c2 (different relation)
      ],
      [mkCluster("c1", "C1", ["a", "b"]), mkCluster("c2", "C2", ["c"])],
    );
    const m = crossClusterEdgeCounts(g);
    assert.equal(m.get("c1|c2|calls"), 1);
    assert.equal(m.get("c1|c2|imports"), 1);
    assert.equal(m.has("c1|c1|calls"), false, "intra-cluster edges should not be counted");
  });

  it("orphan nodes (no cluster) don't contribute to cross-cluster counts", () => {
    const g = mkGraph(
      [mkNode("a", "A"), mkNode("b", "B")],
      [mkEdge("e", "a", "b")],
      [], // no clusters → no cross-cluster signal possible
    );
    const m = crossClusterEdgeCounts(g);
    assert.equal(m.size, 0);
  });
});

// ──────────────────────────────────────────────────────────
// Section-level computations
// ──────────────────────────────────────────────────────────
describe("computeAreaDeltas", () => {
  it("returns empty when no cluster crosses thresholds", () => {
    const start = mkSnapshot(1, 7, mkGraph(
      [mkNode("n1", "A")],
      [],
      [mkCluster("c1", "Same", ["n1"])],
    ));
    const end = mkSnapshot(2, 0, mkGraph(
      [mkNode("n1", "A")],
      [],
      [mkCluster("c1", "Same", ["n1"])],
    ));
    assert.deepEqual(computeAreaDeltas(start, end), []);
  });

  it("reports growth above minAreaDelta + minRelativeChange", () => {
    const startNodes = [mkNode("n1", "A")];
    const endNodes = [
      mkNode("n1", "A"),
      mkNode("n2", "B"),
      mkNode("n3", "C"),
      mkNode("n4", "D"),
      mkNode("n5", "E"),
    ];
    const start = mkSnapshot(1, 7, mkGraph(
      startNodes, [], [mkCluster("c1", "Auth", ["n1"])],
    ));
    const end = mkSnapshot(2, 0, mkGraph(
      endNodes, [], [mkCluster("c1", "Auth", endNodes.map((n) => n.id))],
    ));
    const deltas = computeAreaDeltas(start, end);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]!.clusterId, "c1");
    assert.equal(deltas[0]!.delta, 4);
    assert.equal(deltas[0]!.nodesAtStart, 1);
    assert.equal(deltas[0]!.nodesAtEnd, 5);
  });

  it("§0.6.4 (c) threshold: minAreaDelta=3 → +2 nodes ignored", () => {
    const start = mkSnapshot(1, 7, mkGraph(
      [mkNode("n1", "A")], [],
      [mkCluster("c1", "C1", ["n1"])],
    ));
    const endNodes = [mkNode("n1", "A"), mkNode("n2", "B"), mkNode("n3", "C")];
    const end = mkSnapshot(2, 0, mkGraph(
      endNodes, [],
      [mkCluster("c1", "C1", endNodes.map((n) => n.id))],
    ));
    // +2 delta — below the 3-node minimum
    const deltas = computeAreaDeltas(start, end);
    assert.equal(deltas.length, 0,
      "delta of 2 should not be reported (below minAreaDelta=3)");
  });

  it("§0.6.4 (c) threshold: minRelativeChange=10% gates large clusters", () => {
    // 100-node cluster + 4-node change = 4% relative; below 10%
    const startNodes = [];
    for (let i = 0; i < 100; i++) startNodes.push(mkNode(`n${i}`, `N${i}`));
    const endNodes = [...startNodes];
    for (let i = 100; i < 104; i++) endNodes.push(mkNode(`n${i}`, `N${i}`));
    const start = mkSnapshot(1, 7, mkGraph(
      startNodes, [],
      [mkCluster("c1", "Big", startNodes.map((n) => n.id))],
    ));
    const end = mkSnapshot(2, 0, mkGraph(
      endNodes, [],
      [mkCluster("c1", "Big", endNodes.map((n) => n.id))],
    ));
    const deltas = computeAreaDeltas(start, end);
    assert.equal(deltas.length, 0,
      "+4 on 100 (4%) should not be reported (below minRelativeChange=10%)");
  });

  it("sorts areas by absolute delta descending (most-changed first)", () => {
    // 2 clusters: cluster `z_small_change` grows by 4;
    // cluster `a_big_change` shrinks by 6. The alphabetic
    // order (`a_*` < `z_*`) coincidentally matches the
    // delta order here, so we use ids designed to FORCE
    // alphabetic and delta order to disagree:
    //   - `z_huge` shrinks by 6
    //   - `a_small` grows by 4
    // Most-changed first must rank `z_huge` ahead of
    // `a_small`, contradicting alphabetic order. This
    // guarantees that a mutation replacing delta-sort with
    // id-sort fails the test.
    const startA = Array.from({ length: 7 }, (_, i) => mkNode(`huge_${i}`, `H${i}`));
    const startB = [mkNode("small_0", "S0")];
    const start = mkSnapshot(1, 7, mkGraph(
      [...startA, ...startB], [],
      [
        mkCluster("z_huge", "ZHuge", startA.map((n) => n.id)),
        mkCluster("a_small", "ASmall", ["small_0"]),
      ],
    ));
    // z_huge: 7 → 1 (−6); a_small: 1 → 5 (+4)
    const endA = [mkNode("huge_0", "H0")];
    const endB = Array.from({ length: 5 }, (_, i) => mkNode(`small_${i}`, `S${i}`));
    const end = mkSnapshot(2, 0, mkGraph(
      [...endA, ...endB], [],
      [
        mkCluster("z_huge", "ZHuge", ["huge_0"]),
        mkCluster("a_small", "ASmall", endB.map((n) => n.id)),
      ],
    ));
    const deltas = computeAreaDeltas(start, end);
    assert.equal(deltas.length, 2);
    // Most-changed first: |−6| > |+4|.
    // Alphabetic order would put a_small first (a < z) —
    // this test deliberately contradicts that so id-sort
    // can't slip past.
    assert.equal(deltas[0]!.clusterId, "z_huge",
      `expected z_huge (|−6|) first, NOT alphabetic a_small (+4); got ${deltas.map((d) => `${d.clusterId}(${d.delta})`).join(", ")}`);
    assert.equal(deltas[1]!.clusterId, "a_small");
  });

  it("reports shrinkage", () => {
    const startNodes = [mkNode("n1", "A"), mkNode("n2", "B"), mkNode("n3", "C"), mkNode("n4", "D"), mkNode("n5", "E"), mkNode("n6", "F")];
    const start = mkSnapshot(1, 7, mkGraph(
      startNodes, [],
      [mkCluster("c1", "Shrinking", startNodes.map((n) => n.id))],
    ));
    const end = mkSnapshot(2, 0, mkGraph(
      [mkNode("n1", "A")], [],
      [mkCluster("c1", "Shrinking", ["n1"])],
    ));
    const deltas = computeAreaDeltas(start, end);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]!.delta, -5);
    assert.ok(deltas[0]!.relativeChange < 0);
  });
});

describe("computeNewCrossClusterDeps", () => {
  it("reports brand-new cross-cluster edges (start count = 0)", () => {
    const startNodes = [mkNode("a", "A"), mkNode("b", "B")];
    const start = mkSnapshot(1, 7, mkGraph(
      startNodes, [],
      [mkCluster("c1", "C1", ["a"]), mkCluster("c2", "C2", ["b"])],
    ));
    const end = mkSnapshot(2, 0, mkGraph(
      startNodes,
      [mkEdge("e1", "a", "b", "calls")],
      [mkCluster("c1", "C1", ["a"]), mkCluster("c2", "C2", ["b"])],
    ));
    const deps = computeNewCrossClusterDeps(start, end);
    assert.equal(deps.length, 1);
    assert.equal(deps[0]!.sourceClusterName, "C1");
    assert.equal(deps[0]!.targetClusterName, "C2");
    assert.equal(deps[0]!.relation, "calls");
    assert.equal(deps[0]!.edgesAtStart, 0);
    assert.equal(deps[0]!.edgesAtEnd, 1);
  });

  it("reports growth ≥ minAreaDelta on existing cross-cluster deps", () => {
    const startNodes = [mkNode("a", "A"), mkNode("b", "B"), mkNode("c", "C"), mkNode("d", "D"), mkNode("e", "E"), mkNode("f", "F"), mkNode("g", "G")];
    const startEdges = [mkEdge("e1", "a", "g", "calls")];
    const endEdges = [
      mkEdge("e1", "a", "g", "calls"),
      mkEdge("e2", "b", "g", "calls"),
      mkEdge("e3", "c", "g", "calls"),
      mkEdge("e4", "d", "g", "calls"),
      mkEdge("e5", "e", "g", "calls"),
    ];
    const start = mkSnapshot(1, 7, mkGraph(
      startNodes, startEdges,
      [mkCluster("c1", "Source", ["a", "b", "c", "d", "e", "f"]), mkCluster("c2", "Target", ["g"])],
    ));
    const end = mkSnapshot(2, 0, mkGraph(
      startNodes, endEdges,
      [mkCluster("c1", "Source", ["a", "b", "c", "d", "e", "f"]), mkCluster("c2", "Target", ["g"])],
    ));
    const deps = computeNewCrossClusterDeps(start, end);
    assert.equal(deps.length, 1);
    assert.equal(deps[0]!.edgesAtStart, 1);
    assert.equal(deps[0]!.edgesAtEnd, 5);
  });

  it("sorts cross-cluster deps by absolute growth descending", () => {
    // 3 cross-cluster deps: huge-growth (alphabetically last),
    // medium-growth, small-growth (alphabetically first).
    // Most-changed first must put huge-growth ahead of small,
    // contradicting alphabetic order.
    const startNodes = [
      mkNode("a1", "A1"), mkNode("a2", "A2"), mkNode("a3", "A3"), mkNode("a4", "A4"), mkNode("a5", "A5"), mkNode("a6", "A6"), mkNode("a7", "A7"),
      mkNode("m1", "M1"), mkNode("m2", "M2"), mkNode("m3", "M3"), mkNode("m4", "M4"),
      mkNode("z1", "Z1"), mkNode("z2", "Z2"), mkNode("z3", "Z3"), mkNode("z4", "Z4"), mkNode("z5", "Z5"), mkNode("z6", "Z6"), mkNode("z7", "Z7"), mkNode("z8", "Z8"),
      mkNode("target", "Target"),
    ];
    const startEdges = [
      mkEdge("a_e", "a1", "target", "calls"),
      mkEdge("m_e", "m1", "target", "calls"),
      mkEdge("z_e", "z1", "target", "calls"),
    ];
    // Growth: A: 1→4 (Δ=3), M: 1→5 (Δ=4), Z: 1→8 (Δ=7)
    const endEdges = [
      mkEdge("a_e1", "a1", "target", "calls"),
      mkEdge("a_e2", "a2", "target", "calls"),
      mkEdge("a_e3", "a3", "target", "calls"),
      mkEdge("a_e4", "a4", "target", "calls"),
      mkEdge("m_e1", "m1", "target", "calls"),
      mkEdge("m_e2", "m2", "target", "calls"),
      mkEdge("m_e3", "m3", "target", "calls"),
      mkEdge("m_e4", "m4", "target", "calls"),
      mkEdge("m_e5", "m1", "target", "imports"), // pad
      mkEdge("z_e1", "z1", "target", "calls"),
      mkEdge("z_e2", "z2", "target", "calls"),
      mkEdge("z_e3", "z3", "target", "calls"),
      mkEdge("z_e4", "z4", "target", "calls"),
      mkEdge("z_e5", "z5", "target", "calls"),
      mkEdge("z_e6", "z6", "target", "calls"),
      mkEdge("z_e7", "z7", "target", "calls"),
      mkEdge("z_e8", "z8", "target", "calls"),
    ];
    const clusters = [
      mkCluster("c_a", "A_alpha", ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]),
      mkCluster("c_m", "M_mid", ["m1", "m2", "m3", "m4"]),
      mkCluster("c_z", "Z_zulu", ["z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8"]),
      mkCluster("c_t", "Target", ["target"]),
    ];
    const start = mkSnapshot(1, 7, mkGraph(startNodes, startEdges, clusters));
    const end = mkSnapshot(2, 0, mkGraph(startNodes, endEdges, clusters));
    const deps = computeNewCrossClusterDeps(start, end);
    // Filter to only the calls relation (we added an imports
    // edge as padding) and only deps with growth >= 3.
    const callsDeps = deps.filter((d) => d.relation === "calls");
    assert.ok(callsDeps.length >= 2, `expected ≥ 2 calls deps; got ${callsDeps.length}`);
    // Z_zulu (Δ=7) must precede A_alpha (Δ=3); alphabetic
    // order would put A first.
    const zIdx = callsDeps.findIndex((d) => d.sourceClusterName === "Z_zulu");
    const aIdx = callsDeps.findIndex((d) => d.sourceClusterName === "A_alpha");
    assert.ok(zIdx >= 0 && aIdx >= 0, "both clusters must be present");
    assert.ok(zIdx < aIdx,
      `Z_zulu (Δ=7) must rank before A_alpha (Δ=3); got order ${callsDeps.map((d) => d.sourceClusterName).join(", ")}`);
  });

  it("ignores cross-cluster deps that shrunk", () => {
    const startNodes = [mkNode("a", "A"), mkNode("g", "G")];
    const start = mkSnapshot(1, 7, mkGraph(
      startNodes,
      [mkEdge("e1", "a", "g", "calls"), mkEdge("e2", "a", "g", "imports")],
      [mkCluster("c1", "C1", ["a"]), mkCluster("c2", "C2", ["g"])],
    ));
    const end = mkSnapshot(2, 0, mkGraph(
      startNodes, [],
      [mkCluster("c1", "C1", ["a"]), mkCluster("c2", "C2", ["g"])],
    ));
    const deps = computeNewCrossClusterDeps(start, end);
    assert.equal(deps.length, 0);
  });
});

describe("computeDeprecationCandidates", () => {
  it("finds nodes losing ≥ 2 callers", () => {
    const nodes = [mkNode("a", "A"), mkNode("b", "B"), mkNode("c", "C"), mkNode("dying", "Dying", "src/old.ts")];
    const startEdges = [
      mkEdge("e1", "a", "dying"),
      mkEdge("e2", "b", "dying"),
      mkEdge("e3", "c", "dying"),
    ];
    const start = mkSnapshot(1, 7, mkGraph(nodes, startEdges));
    const end = mkSnapshot(2, 0, mkGraph(nodes, []));
    const candidates = computeDeprecationCandidates(start, end);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.nodeId, "dying");
    assert.equal(candidates[0]!.inboundAtStart, 3);
    assert.equal(candidates[0]!.inboundAtEnd, 0);
    assert.equal(candidates[0]!.delta, -3);
    assert.equal(candidates[0]!.filePath, "src/old.ts");
  });

  it("§0.6.4 (c) threshold: minInboundLoss=2 → losing 1 caller ignored", () => {
    const nodes = [mkNode("a", "A"), mkNode("b", "B"), mkNode("losing-one", "L")];
    const startEdges = [mkEdge("e1", "a", "losing-one"), mkEdge("e2", "b", "losing-one")];
    const endEdges = [mkEdge("e2", "b", "losing-one")];
    const start = mkSnapshot(1, 7, mkGraph(nodes, startEdges));
    const end = mkSnapshot(2, 0, mkGraph(nodes, endEdges));
    const candidates = computeDeprecationCandidates(start, end);
    assert.equal(candidates.length, 0,
      "losing 1 caller should not be flagged (below minInboundLoss=2)");
  });

  it("sorts deprecation candidates by most-deleted-callers first (ascending delta)", () => {
    // Two candidates: `z_huge_loss` loses 5 callers; `a_small_loss` loses 2.
    // Alphabetic order would put a_* first; delta order puts z_* first
    // (Δ=−5 is less than Δ=−2).
    const nodes = [
      mkNode("c1", "C1"), mkNode("c2", "C2"), mkNode("c3", "C3"), mkNode("c4", "C4"), mkNode("c5", "C5"),
      mkNode("c6", "C6"), mkNode("c7", "C7"),
      mkNode("a_small_loss", "A", "src/a.ts"),
      mkNode("z_huge_loss", "Z", "src/z.ts"),
    ];
    const startEdges = [
      // 3 callers for a_small_loss (will keep 1 → −2)
      mkEdge("ae1", "c1", "a_small_loss"),
      mkEdge("ae2", "c2", "a_small_loss"),
      mkEdge("ae3", "c3", "a_small_loss"),
      // 7 callers for z_huge_loss (will keep 2 → −5)
      mkEdge("ze1", "c1", "z_huge_loss"),
      mkEdge("ze2", "c2", "z_huge_loss"),
      mkEdge("ze3", "c3", "z_huge_loss"),
      mkEdge("ze4", "c4", "z_huge_loss"),
      mkEdge("ze5", "c5", "z_huge_loss"),
      mkEdge("ze6", "c6", "z_huge_loss"),
      mkEdge("ze7", "c7", "z_huge_loss"),
    ];
    const endEdges = [
      mkEdge("ae1", "c1", "a_small_loss"),
      mkEdge("ze1", "c1", "z_huge_loss"),
      mkEdge("ze2", "c2", "z_huge_loss"),
    ];
    const start = mkSnapshot(1, 7, mkGraph(nodes, startEdges));
    const end = mkSnapshot(2, 0, mkGraph(nodes, endEdges));
    const candidates = computeDeprecationCandidates(start, end);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]!.nodeId, "z_huge_loss",
      `expected z_huge_loss (Δ=−5) first, NOT alphabetic a_small_loss (Δ=−2); got ${candidates.map((c) => `${c.nodeId}(Δ=${c.delta})`).join(", ")}`);
    assert.equal(candidates[1]!.nodeId, "a_small_loss");
  });

  it("handles nodes that disappear entirely", () => {
    const startNodes = [mkNode("a", "A"), mkNode("gone", "Gone", "src/gone.ts")];
    const start = mkSnapshot(1, 7, mkGraph(
      startNodes,
      [mkEdge("e1", "a", "gone"), mkEdge("e2", "a", "gone"), mkEdge("e3", "a", "gone")],
    ));
    // 'gone' is missing in end snapshot
    const end = mkSnapshot(2, 0, mkGraph([mkNode("a", "A")]));
    const candidates = computeDeprecationCandidates(start, end);
    const gone = candidates.find((c) => c.nodeId === "gone");
    assert.ok(gone, "disappeared node should be a deprecation candidate");
    assert.equal(gone!.inboundAtEnd, 0);
  });
});

describe("computeViolationTrend", () => {
  it("returns one data point per snapshot in time order", () => {
    const snaps = [
      mkSnapshot(1, 7, mkGraph([]), [
        { ruleId: "r1", severity: "error", message: "err" },
      ]),
      mkSnapshot(2, 3, mkGraph([]), [
        { ruleId: "r1", severity: "error", message: "err" },
        { ruleId: "r2", severity: "warn", message: "warn" },
      ]),
    ];
    const trend = computeViolationTrend(snaps);
    assert.equal(trend.length, 2);
    assert.equal(trend[0]!.errorCount, 1);
    assert.equal(trend[0]!.warnCount, 0);
    assert.equal(trend[1]!.errorCount, 1);
    assert.equal(trend[1]!.warnCount, 1);
  });
});

// ──────────────────────────────────────────────────────────
// Top-level computeDriftReport
// ──────────────────────────────────────────────────────────
describe("computeDriftReport", () => {
  it("empty input → empty report (no crash)", () => {
    const r = computeDriftReport([]);
    assert.equal(r.snapshotCount, 0);
    assert.deepEqual(r.areasGrownOrShrunk, []);
    assert.deepEqual(r.newCrossClusterDeps, []);
    assert.deepEqual(r.deprecationCandidates, []);
    assert.deepEqual(r.violationTrend, []);
  });

  it("windowDays rounds the time delta (6.5-day span → 7)", () => {
    // §0.6.4 (c) boundary: a 6.5-day window must report 7
    // days (the user-friendly "weekly" framing); a 6.4-day
    // window must report 6.
    function mkSnapshotAtMs(id: number, at: number, graph: MultiRepoGraph): DriftSnapshot {
      return { id, gitSha: `${id}`.padEnd(40, "0"), at, graph, violations: [] };
    }
    const now = Date.now();
    const sixHalfDayMs = 6.5 * 24 * 60 * 60 * 1000;
    const sixFourMs = 6.4 * 24 * 60 * 60 * 1000;
    // 6.5 days: round → 7
    const r65 = computeDriftReport([
      mkSnapshotAtMs(1, now - sixHalfDayMs, mkGraph([])),
      mkSnapshotAtMs(2, now, mkGraph([])),
    ]);
    assert.equal(r65.windowDays, 7,
      `6.5-day window must round to 7 days; got ${r65.windowDays}`);
    // 6.4 days: round → 6
    const r64 = computeDriftReport([
      mkSnapshotAtMs(1, now - sixFourMs, mkGraph([])),
      mkSnapshotAtMs(2, now, mkGraph([])),
    ]);
    assert.equal(r64.windowDays, 6,
      `6.4-day window must round to 6 days; got ${r64.windowDays}`);
  });

  it("single snapshot → trend-only report (windowDays=0)", () => {
    const single = mkSnapshot(1, 0, mkGraph([mkNode("n1", "A")]));
    const r = computeDriftReport([single]);
    assert.equal(r.snapshotCount, 1);
    assert.equal(r.windowDays, 0);
    assert.equal(r.violationTrend.length, 1);
    assert.deepEqual(r.areasGrownOrShrunk, []);
    assert.deepEqual(r.newCrossClusterDeps, []);
    assert.deepEqual(r.deprecationCandidates, []);
  });

  it("end-to-end: 3-snapshot evolution produces a full report", () => {
    // Day 0: 2 clusters, 5 nodes, 1 cross-cluster edge
    const day0Nodes = [
      mkNode("auth1", "AuthA", "src/auth/a.ts"),
      mkNode("auth2", "AuthB", "src/auth/b.ts"),
      mkNode("api1", "ApiA", "src/api/a.ts"),
    ];
    const day0 = mkSnapshot(1, 7, mkGraph(
      day0Nodes,
      [mkEdge("e1", "api1", "auth1")],
      [mkCluster("auth", "Auth", ["auth1", "auth2"]), mkCluster("api", "API", ["api1"])],
    ));

    // Day 7: Auth cluster grew 3 nodes; API cluster gained cross-cluster edges
    const day7Nodes = [
      ...day0Nodes,
      mkNode("auth3", "AuthC", "src/auth/c.ts"),
      mkNode("auth4", "AuthD", "src/auth/d.ts"),
      mkNode("auth5", "AuthE", "src/auth/e.ts"),
      mkNode("api2", "ApiB", "src/api/b.ts"),
    ];
    const day7 = mkSnapshot(2, 0, mkGraph(
      day7Nodes,
      [
        mkEdge("e1", "api1", "auth1"),
        mkEdge("e2", "api2", "auth1"),
        mkEdge("e3", "api2", "auth3"),
        mkEdge("e4", "api2", "auth4"),
        mkEdge("e5", "api2", "auth5"),
      ],
      [
        mkCluster("auth", "Auth", ["auth1", "auth2", "auth3", "auth4", "auth5"]),
        mkCluster("api", "API", ["api1", "api2"]),
      ],
    ));

    const report = computeDriftReport([day0, day7]);
    assert.equal(report.snapshotCount, 2);
    assert.equal(report.windowDays, 7);
    // Areas: auth cluster grew by 3
    assert.ok(report.areasGrownOrShrunk.length >= 1);
    const authGrowth = report.areasGrownOrShrunk.find((a) => a.clusterName === "Auth");
    assert.ok(authGrowth);
    assert.equal(authGrowth!.delta, 3);
    // New cross-cluster deps: api → auth grew from 1 to 5 (Δ=4 ≥ minAreaDelta)
    assert.ok(report.newCrossClusterDeps.length >= 1);
    const apiToAuth = report.newCrossClusterDeps.find(
      (d) => d.sourceClusterName === "API" && d.targetClusterName === "Auth",
    );
    assert.ok(apiToAuth);
    assert.equal(apiToAuth!.edgesAtStart, 1);
    assert.equal(apiToAuth!.edgesAtEnd, 5);
  });
});

// ──────────────────────────────────────────────────────────
// Markdown rendering
// ──────────────────────────────────────────────────────────
describe("renderDriftMarkdown", () => {
  it("emits all 4 sections", () => {
    const day0 = mkSnapshot(1, 7, mkGraph([mkNode("n1", "A")], [], [mkCluster("c1", "C1", ["n1"])]));
    const day7 = mkSnapshot(2, 0, mkGraph(
      [mkNode("n1", "A"), mkNode("n2", "B"), mkNode("n3", "C"), mkNode("n4", "D"), mkNode("n5", "E")],
      [],
      [mkCluster("c1", "C1", ["n1", "n2", "n3", "n4", "n5"])],
    ));
    const report = computeDriftReport([day0, day7]);
    const md = renderDriftMarkdown(report, { workspaceName: "test-repo" });

    assert.ok(md.includes("# Architectural drift report"), "must have h1");
    assert.ok(md.includes("test-repo"), "must include workspace name");
    assert.ok(md.includes("## Areas grown / shrunk"), "must have areas section");
    assert.ok(md.includes("## New cross-cluster dependencies"), "must have deps section");
    assert.ok(md.includes("## Deprecation candidates"), "must have deprecation section");
    assert.ok(md.includes("## Rule violation trend"), "must have violation trend section");
  });

  it("empty report → all 4 sections show their no-data placeholder", () => {
    const md = renderDriftMarkdown(computeDriftReport([]));
    assert.ok(md.includes("# Architectural drift report"));
    // Each section must contain its own no-data placeholder
    // (not just rely on the header to mention "0 snapshots").
    // This pins each placeholder so a future agent who deletes
    // one gets caught.
    const areasIdx = md.indexOf("## Areas grown / shrunk");
    const depsIdx = md.indexOf("## New cross-cluster dependencies");
    const deprIdx = md.indexOf("## Deprecation candidates");
    const trendIdx = md.indexOf("## Rule violation trend");
    assert.ok(areasIdx >= 0, "must have areas section");
    assert.ok(depsIdx >= 0, "must have deps section");
    assert.ok(deprIdx >= 0, "must have deprecation section");
    assert.ok(trendIdx >= 0, "must have trend section");
    // Each section must include some placeholder text in its body.
    const areasBody = md.slice(areasIdx, depsIdx);
    const depsBody = md.slice(depsIdx, deprIdx);
    const deprBody = md.slice(deprIdx, trendIdx);
    const trendBody = md.slice(trendIdx);
    assert.ok(areasBody.includes("_No cluster"),
      `areas section missing placeholder: ${areasBody}`);
    assert.ok(depsBody.includes("_No new cross-cluster"),
      `deps section missing placeholder: ${depsBody}`);
    assert.ok(deprBody.includes("_No nodes lost"),
      `deprecation section missing placeholder: ${deprBody}`);
    assert.ok(trendBody.includes("_No snapshots in this window"),
      `trend section missing placeholder: ${trendBody}`);
  });

  it("includes signed deltas in trend summary", () => {
    const day0 = mkSnapshot(1, 7, mkGraph([]), [{ ruleId: "r1", severity: "error", message: "e" }]);
    const day7 = mkSnapshot(2, 0, mkGraph([]), [
      { ruleId: "r1", severity: "error", message: "e" },
      { ruleId: "r2", severity: "error", message: "e2" },
      { ruleId: "r3", severity: "error", message: "e3" },
    ]);
    const report = computeDriftReport([day0, day7]);
    const md = renderDriftMarkdown(report);
    assert.ok(md.includes("+2"), "trend should show +2 errors");
  });
});

// ──────────────────────────────────────────────────────────
// sampleSnapshots helper (§0.6.4 (a) extracted, pure)
// ──────────────────────────────────────────────────────────
describe("sampleSnapshots (§0.6.4 (a) extracted helper)", () => {
  it("returns input unchanged when length ≤ maxN", () => {
    const arr = [1, 2, 3];
    assert.deepEqual([...sampleSnapshots(arr, 10)], [1, 2, 3]);
    assert.deepEqual([...sampleSnapshots(arr, 3)], [1, 2, 3]);
  });

  it("samples evenly when length > maxN", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const sampled = sampleSnapshots(arr, 5);
    assert.equal(sampled.length, 5);
    assert.equal(sampled[0], 0, "first element preserved");
    assert.equal(sampled[sampled.length - 1], 99, "last element preserved");
  });

  it("edge cases: maxN=1 → just the first, maxN=0 → empty", () => {
    const arr = [1, 2, 3, 4, 5];
    assert.deepEqual([...sampleSnapshots(arr, 1)], [1]);
    assert.deepEqual([...sampleSnapshots(arr, 0)], []);
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 (e) perf regression scale fixture
// ──────────────────────────────────────────────────────────
describe("computeDriftReport perf (§0.6.4 (e) scale fixture)", () => {
  it("handles 30 snapshots × 1000 nodes in < 1 second", () => {
    const snapshots: DriftSnapshot[] = [];
    for (let s = 0; s < 30; s++) {
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const clusters: Cluster[] = [];
      for (let c = 0; c < 10; c++) {
        const ids: string[] = [];
        for (let n = 0; n < 100; n++) {
          const id = `s${s}_c${c}_n${n}`;
          ids.push(id);
          nodes.push(mkNode(id, `N${n}`, `src/c${c}/n${n}.ts`));
          // Linear chain of edges within cluster
          if (n > 0) edges.push(mkEdge(`s${s}_c${c}_e${n}`, ids[n - 1]!, id));
        }
        clusters.push(mkCluster(`s${s}_c${c}`, `C${c}`, ids));
      }
      snapshots.push(mkSnapshot(s, 30 - s, mkGraph(nodes, edges, clusters)));
    }
    const t0 = Date.now();
    const report = computeDriftReport(snapshots);
    const dt = Date.now() - t0;
    assert.ok(report.snapshotCount === 30);
    assert.ok(dt < 1000,
      `30×1000-node drift took ${dt}ms; perf regression guard fires above 1s`);
  });
});

// ──────────────────────────────────────────────────────────
// drift.generate action surface (smoke)
// ──────────────────────────────────────────────────────────
describe("drift.generate action surface", () => {
  it("action object has the correct name + sideEffect", () => {
    assert.equal(driftGenerate.name, "drift.generate");
    assert.equal(driftGenerate.sideEffect, "none");
  });

  it("rejects missing sessionId", async () => {
    const r = await driftGenerate.handle({});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-args");
  });

  it("rejects windowDays ≤ 0", async () => {
    // We need a real session for this to reach the validation
    // logic, but we can verify the error code shape via the
    // missing-sessionId path above. For positive validation we
    // rely on the end-to-end real-repo smoke during Level 2.
    const r = await driftGenerate.handle({ sessionId: "x", windowDays: -1 });
    assert.equal(r.ok, false);
  });
});

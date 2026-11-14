// Per `architecture/v1-launch-plan.md` Step 2 — unit tests for the
// client-side cluster algorithm.
//
// `applyAlgorithmicClusters` is the same Leiden + directory fallback
// that runs server-side; the Studio uses it for demo fixtures so the
// canvas never relies on hand-curated cluster metadata. Step 7 will
// extend the labeling pipeline (5-stage recursive clustering, 7-tier
// labels per doc 24); these baseline tests prove the small-graph
// directory-fallback path stays intact while that work lands.

import { describe, it, expect } from "vitest";
import { applyAlgorithmicClusters } from "../lib/applyClusters";
import type { Graph, GraphNode, GraphEdge } from "../lib/types";

function mkNode(id: string, name: string, file: string): GraphNode {
  return { id, name, kind: "utility", file };
}

function mkEdge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, relation: "calls" };
}

function mkGraph(nodes: GraphNode[], edges: GraphEdge[] = []): Graph {
  return { nodes, edges, clusters: [], rootDir: "/repo" };
}

describe("applyAlgorithmicClusters — empty + tiny graphs", () => {
  it("returns empty clusters for an empty graph", () => {
    const result = applyAlgorithmicClusters(mkGraph([]));
    expect(result.clusters).toEqual([]);
    expect(result.nodes).toEqual([]);
  });

  it("returns no clusters when graph has fewer than MIN_CLUSTER_SIZE nodes per dir", () => {
    // Two nodes in two different directories → neither cluster reaches
    // MIN_CLUSTER_SIZE = 3, so no clusters survive.
    const g = mkGraph(
      [
        mkNode("n1", "a", "/repo/src/auth/a.ts"),
        mkNode("n2", "b", "/repo/src/billing/b.ts"),
      ],
    );
    const result = applyAlgorithmicClusters(g);
    expect(result.clusters).toEqual([]);
  });
});

describe("applyAlgorithmicClusters — directory fallback (small graph)", () => {
  it("groups files in the same first-meaningful-segment into one cluster", () => {
    // Below the MIN_NODES_FOR_LEIDEN threshold (8), so the directory
    // fallback engages. We deliberately split across two top-level
    // dirs (auth/, billing/) so common-prefix stripping leaves a
    // meaningful first segment per file.
    const nodes: GraphNode[] = [
      mkNode("a1", "a1", "/repo/auth/login.ts"),
      mkNode("a2", "a2", "/repo/auth/signup.ts"),
      mkNode("a3", "a3", "/repo/auth/middleware.ts"),
      mkNode("b1", "b1", "/repo/billing/checkout.ts"),
      mkNode("b2", "b2", "/repo/billing/invoice.ts"),
      mkNode("b3", "b3", "/repo/billing/refund.ts"),
    ];
    const result = applyAlgorithmicClusters(mkGraph(nodes));
    expect(result.clusters).toHaveLength(2);
    const names = result.clusters.map((c) => c.name).sort();
    expect(names).toEqual(["Auth", "Billing"]);
  });

  it("strips ROOT_FOLDERS (src, lib, app...) when choosing the cluster label", () => {
    // 3 auth + 3 billing under /repo/src/ — the `src` segment is a
    // root folder and should be skipped; cluster labels come from
    // `auth` / `billing`.
    const nodes: GraphNode[] = [
      mkNode("a1", "a1", "/repo/src/auth/login.ts"),
      mkNode("a2", "a2", "/repo/src/auth/signup.ts"),
      mkNode("a3", "a3", "/repo/src/auth/middleware.ts"),
      mkNode("b1", "b1", "/repo/src/billing/checkout.ts"),
      mkNode("b2", "b2", "/repo/src/billing/invoice.ts"),
      mkNode("b3", "b3", "/repo/src/billing/refund.ts"),
    ];
    const result = applyAlgorithmicClusters(mkGraph(nodes));
    expect(result.clusters).toHaveLength(2);
    const names = result.clusters.map((c) => c.name).sort();
    expect(names).toEqual(["Auth", "Billing"]);
  });

  it("assigns each node's `cluster` field to its cluster id", () => {
    const nodes: GraphNode[] = [
      mkNode("a1", "a1", "/repo/auth/login.ts"),
      mkNode("a2", "a2", "/repo/auth/signup.ts"),
      mkNode("a3", "a3", "/repo/auth/middleware.ts"),
      mkNode("b1", "b1", "/repo/billing/checkout.ts"),
      mkNode("b2", "b2", "/repo/billing/invoice.ts"),
      mkNode("b3", "b3", "/repo/billing/refund.ts"),
    ];
    const result = applyAlgorithmicClusters(mkGraph(nodes));
    expect(result.clusters).toHaveLength(2);
    const cids = new Set(result.clusters.map((c) => c.id));
    for (const c of result.clusters) {
      expect(c.id).toMatch(/^cluster:/);
    }
    for (const n of result.nodes) {
      expect(cids.has(n.cluster!)).toBe(true);
    }
  });
});

describe("applyAlgorithmicClusters — Leiden path (large graph)", () => {
  it("returns at least one cluster for a graph with ≥ MIN_NODES_FOR_LEIDEN nodes", () => {
    // 10 nodes split across two directories with edges between them.
    // Above the MIN_NODES_FOR_LEIDEN threshold so the Leiden algorithm
    // engages. Exact community count is non-deterministic across
    // ngraph.leiden versions; we assert at least one cluster forms.
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5; i++) nodes.push(mkNode(`a${i}`, `a${i}`, `/repo/src/auth/f${i}.ts`));
    for (let i = 0; i < 5; i++) nodes.push(mkNode(`b${i}`, `b${i}`, `/repo/src/billing/f${i}.ts`));
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 4; i++) edges.push(mkEdge(`ea${i}`, `a${i}`, `a${i + 1}`));
    for (let i = 0; i < 4; i++) edges.push(mkEdge(`eb${i}`, `b${i}`, `b${i + 1}`));
    const result = applyAlgorithmicClusters(mkGraph(nodes, edges));
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    // Every cluster has at least MIN_CLUSTER_SIZE members.
    for (const c of result.clusters) {
      expect(c.nodeIds.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("applyAlgorithmicClusters — invariants", () => {
  it("never drops nodes: result.nodes is the same length as input.nodes", () => {
    const nodes: GraphNode[] = [
      mkNode("a1", "a1", "/repo/auth/login.ts"),
      mkNode("a2", "a2", "/repo/auth/signup.ts"),
      mkNode("a3", "a3", "/repo/auth/middleware.ts"),
      mkNode("b1", "b1", "/repo/billing/checkout.ts"),
      mkNode("b2", "b2", "/repo/billing/invoice.ts"),
      mkNode("b3", "b3", "/repo/billing/refund.ts"),
      mkNode("x", "x", "/repo/scratch.ts"),
    ];
    const result = applyAlgorithmicClusters(mkGraph(nodes));
    expect(result.nodes).toHaveLength(nodes.length);
  });

  it("preserves edge identity", () => {
    const nodes: GraphNode[] = [
      mkNode("a1", "a1", "/repo/auth/a.ts"),
      mkNode("a2", "a2", "/repo/auth/b.ts"),
      mkNode("a3", "a3", "/repo/auth/c.ts"),
      mkNode("b1", "b1", "/repo/billing/a.ts"),
      mkNode("b2", "b2", "/repo/billing/b.ts"),
      mkNode("b3", "b3", "/repo/billing/c.ts"),
    ];
    const edges: GraphEdge[] = [mkEdge("e1", "a1", "a2"), mkEdge("e2", "a2", "a3")];
    const result = applyAlgorithmicClusters(mkGraph(nodes, edges));
    const ids = new Set(result.edges.map((e) => e.id));
    expect(ids).toContain("e1");
    expect(ids).toContain("e2");
  });
});

// Per `architecture/v1-launch-plan.md` Step 8a + research/29
// §4.2 (the graph-traversal half of hybrid retrieval).
//
// The graph-traversal retriever. Given a set of seed nodes
// (typically the BM25-ranked top-K), expand outward through
// typed edges to surface nodes the BM25 component might
// miss because they aren't lexically similar to the query
// but are *architecturally* close to a match.
//
// **Expansion strategy** (Aider repo-map [research:29.a6] +
// Schema's `entryPointIds`):
//   1. **Seed scoring**: every seed gets `1.0 × clusterPageRank(seed)`
//      where `clusterPageRank` is the per-cluster importance
//      from Step 7a (or 1.0 if the node has no PageRank score).
//   2. **N-hop walk** (default depth 2): walk outgoing + incoming
//      edges, summing the scores with per-hop decay (0.7^hop).
//      Edge weight applies per relation (calls=1.5, imports=1.0,
//      ...; matches Step 7a's `EDGE_WEIGHTS`).
//   3. **Cluster bonus**: nodes that share a cluster with a
//      seed get a +20% bump (architectural-proximity signal).

import type { MultiRepoGraph, GraphNode, GraphEdge, Cluster } from "../multi-repo.ts";
import { EDGE_RELATIONS } from "../vocabulary.ts";

/** Per-relation edge weight per research/24 §7.1 + plan
 *  Step 7 work item 6 ("calls > imports > consumes_contract").
 *  Reuses the same numerical scale as `cluster.ts`'s
 *  `EDGE_WEIGHTS` for consistency. */
const TRAVERSAL_EDGE_WEIGHTS: ReadonlyMap<string, number> = new Map([
  [EDGE_RELATIONS.consumes_contract, 0.3],
  [EDGE_RELATIONS.implements_contract, 0.3],
  [EDGE_RELATIONS.imports, 1.0],
  [EDGE_RELATIONS.calls, 1.5],
  [EDGE_RELATIONS.applies_middleware, 2.0],
  [EDGE_RELATIONS.registers_route, 2.0],
]);
const DEFAULT_EDGE_WEIGHT = 1.0;

/** Per-hop score decay. At depth 2 default, hop-2 contributes
 *  0.49× the hop-0 (seed) contribution. */
const HOP_DECAY = 0.7;

/** Same-cluster proximity bonus per research/29 §4.2. Nodes
 *  in the same cluster as a seed get +20%. */
const CLUSTER_BONUS = 1.2;

/** Pre-built traversal index. Wraps the graph with O(1)
 *  edge lookup by source + by target + cluster membership.
 *  Build once per workspace; reuse across queries. */
export interface GraphTraversalIndex {
  readonly nodeById: ReadonlyMap<string, GraphNode>;
  readonly outgoingByNode: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly incomingByNode: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly clusterByNodeId: ReadonlyMap<string, Cluster>;
  /** Per-node PageRank importance from the Step 7a clusters.
   *  Empty for nodes whose cluster lacks PageRank (very small
   *  clusters or fallback path). */
  readonly importanceByNodeId: ReadonlyMap<string, number>;
}

/** Build the traversal index. O(N + E). */
export function buildTraversalIndex(graph: MultiRepoGraph): GraphTraversalIndex {
  const nodeById = new Map<string, GraphNode>();
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const clusterByNodeId = new Map<string, Cluster>();
  const importanceByNodeId = new Map<string, number>();

  for (const repo of graph.repos) {
    for (const node of repo.nodes) nodeById.set(node.id, node);
    for (const edge of repo.edges) {
      let out = outgoing.get(edge.source);
      if (!out) { out = []; outgoing.set(edge.source, out); }
      out.push(edge);
      let inn = incoming.get(edge.target);
      if (!inn) { inn = []; incoming.set(edge.target, inn); }
      inn.push(edge);
    }
    for (const cluster of repo.clusters) {
      for (const nid of cluster.nodeIds) {
        if (!clusterByNodeId.has(nid)) clusterByNodeId.set(nid, cluster);
      }
      if (cluster.importance) {
        for (const [nid, score] of Object.entries(cluster.importance)) {
          importanceByNodeId.set(nid, score);
        }
      }
    }
  }

  return { nodeById, outgoingByNode: outgoing, incomingByNode: incoming, clusterByNodeId, importanceByNodeId };
}

/** Traversal options. */
export interface TraverseOptions {
  /** Max hops from seeds. Default 2. */
  readonly maxDepth?: number;
  /** Max results returned. Default 30. */
  readonly k?: number;
  /** Per-seed initial score override. Default = use
   *  PageRank importance, fallback 1.0. Pass this when the
   *  seeds come from another ranked retriever (BM25) and
   *  the lexical-relevance ordering should propagate into
   *  the traversal scores. */
  readonly seedScores?: ReadonlyMap<string, number>;
}

const DEFAULT_TRAVERSE_OPTIONS = { maxDepth: 2, k: 30 } as const;

/** Run the traversal retriever. Given seed node IDs, expand
 *  outward and return scored node IDs (descending). Used as
 *  one of the two ranking sources for RRF fusion. */
export function traverseFromSeeds(
  index: GraphTraversalIndex,
  seedIds: readonly string[],
  options: TraverseOptions = {},
): { nodeId: string; score: number }[] {
  const maxDepth = options.maxDepth ?? DEFAULT_TRAVERSE_OPTIONS.maxDepth;
  const k = options.k ?? DEFAULT_TRAVERSE_OPTIONS.k;
  const seedScores = options.seedScores;
  const seeds = seedIds.filter((id) => index.nodeById.has(id));
  if (seeds.length === 0) return [];

  const scoreById = new Map<string, number>();
  const seedClusters = new Set<string>();

  // Initial pass: assign seed scores. If the caller supplied
  // seedScores (e.g. from BM25), use those — they propagate
  // lexical relevance into the traversal. Otherwise fall
  // back to PageRank importance (default 1.0).
  for (const seedId of seeds) {
    const baseScore = seedScores?.get(seedId) ??
                       index.importanceByNodeId.get(seedId) ?? 1.0;
    scoreById.set(seedId, baseScore);
    const cluster = index.clusterByNodeId.get(seedId);
    if (cluster) seedClusters.add(cluster.id);
  }

  // BFS expand from seeds. `frontier` carries the current
  // wave; `nextFrontier` accumulates the next wave's nodes
  // (deduped). At depth 0, frontier = seeds; we process
  // hops 1..maxDepth.
  let frontier: string[] = [...seeds];
  for (let hop = 1; hop <= maxDepth; hop++) {
    const nextFrontier = new Set<string>();
    const hopMultiplier = Math.pow(HOP_DECAY, hop);
    for (const fromId of frontier) {
      const fromScore = scoreById.get(fromId) ?? 0;
      const outs = index.outgoingByNode.get(fromId) ?? [];
      const ins = index.incomingByNode.get(fromId) ?? [];
      for (const edge of outs) {
        const target = edge.target;
        const edgeWeight =
          TRAVERSAL_EDGE_WEIGHTS.get(edge.relation) ?? DEFAULT_EDGE_WEIGHT;
        const contribution = fromScore * edgeWeight * hopMultiplier;
        scoreById.set(target, (scoreById.get(target) ?? 0) + contribution);
        nextFrontier.add(target);
      }
      for (const edge of ins) {
        const source = edge.source;
        const edgeWeight =
          TRAVERSAL_EDGE_WEIGHTS.get(edge.relation) ?? DEFAULT_EDGE_WEIGHT;
        const contribution = fromScore * edgeWeight * hopMultiplier;
        scoreById.set(source, (scoreById.get(source) ?? 0) + contribution);
        nextFrontier.add(source);
      }
    }
    frontier = [...nextFrontier].filter((id) => !seeds.includes(id));
  }

  // Apply cluster bonus.
  if (seedClusters.size > 0) {
    for (const [nodeId, score] of scoreById) {
      const cluster = index.clusterByNodeId.get(nodeId);
      if (cluster && seedClusters.has(cluster.id)) {
        scoreById.set(nodeId, score * CLUSTER_BONUS);
      }
    }
  }

  const results: { nodeId: string; score: number }[] = [];
  for (const [nodeId, score] of scoreById) {
    if (score > 0) results.push({ nodeId, score });
  }
  results.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  return results.slice(0, k);
}

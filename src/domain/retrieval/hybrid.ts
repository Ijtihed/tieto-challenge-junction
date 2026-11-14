// Per `architecture/v1-launch-plan.md` Step 8a + research/29
// §4.2 (Hybrid RAG orchestrator).
//
// Combines BM25 + graph-traversal retrievers via Reciprocal
// Rank Fusion. The orchestrator is the engine half of Step 8;
// the user-facing `graph.ask` MCP action (Step 8b) wraps this
// + adds presentation (markdown context + hallucinated-API
// guard).
//
// Per the plan's Q2 + research/29 §4.2: BM25 + graph only in
// v1.0. The vector half ships in v1.1 with `GraphCodeBERT`-
// style embeddings. The hybrid orchestrator's input/output
// shape is forward-compatible: adding a third `RankedList`
// to RRF requires no schema changes.

import type { MultiRepoGraph, GraphNode, Cluster } from "../multi-repo.ts";
import {
  buildGraphBm25Index,
  searchGraph,
  type GraphBm25Index,
} from "./graph-bm25.ts";
import {
  buildTraversalIndex,
  traverseFromSeeds,
  type GraphTraversalIndex,
} from "./graph-traversal.ts";
import {
  fuseRrf,
  DEFAULT_RRF_K,
  type RankedList,
} from "./rrf.ts";

/** A pre-built hybrid-RAG index. Holds the BM25 + traversal
 *  sub-indices side by side. Build once per workspace; reuse
 *  across queries. */
export interface HybridIndex {
  readonly bm25: GraphBm25Index;
  readonly traversal: GraphTraversalIndex;
}

/** Build the hybrid index from a graph. O(N + E). */
export function buildHybridIndex(graph: MultiRepoGraph): HybridIndex {
  return {
    bm25: buildGraphBm25Index(graph),
    traversal: buildTraversalIndex(graph),
  };
}

export interface HybridQueryOptions {
  /** Total results to return after fusion. Default 10. */
  readonly k?: number;
  /** BM25 candidate pool size (fed into RRF + used as seeds
   *  for the graph-traversal half). Default 30. */
  readonly bm25K?: number;
  /** Graph-traversal candidate pool size (fed into RRF).
   *  Default 30. */
  readonly traversalK?: number;
  /** RRF k parameter. Default 60 (Cormack et al. 2009). */
  readonly rrfK?: number;
  /** Max BFS depth for graph traversal. Default 2. */
  readonly maxDepth?: number;
}

const DEFAULT_HYBRID_OPTIONS = {
  k: 10,
  bm25K: 30,
  traversalK: 30,
  rrfK: DEFAULT_RRF_K,
  maxDepth: 2,
} as const;

export interface HybridResult {
  readonly nodeId: string;
  readonly node: GraphNode;
  readonly cluster: Cluster | null;
  readonly rrfScore: number;
  /** Source ranks. `bm25.rank = 1` means the node was the
   *  top BM25 hit; `null` means the source didn't surface it. */
  readonly bm25: { readonly rank: number; readonly score: number } | null;
  readonly traversal: { readonly rank: number; readonly score: number } | null;
}

/** Run a hybrid-RAG query. Returns top-K fused results. */
export function queryHybrid(
  index: HybridIndex,
  query: string,
  options: HybridQueryOptions = {},
): HybridResult[] {
  const opts = { ...DEFAULT_HYBRID_OPTIONS, ...options };

  // 1. BM25 over name/path/kind/meta fields.
  const bm25Hits = searchGraph(index.bm25, query, opts.bm25K);

  // 2. Graph traversal seeded by BM25's top hits.
  // The traversal retriever uses BM25's top results as
  // seeds; without BM25 hits, traversal has no anchor and
  // returns empty. This is the intended composition: BM25
  // finds lexical matches, traversal finds architectural
  // neighbours. We pass the BM25 scores as seed scores so
  // the lexical-relevance ordering propagates into the
  // traversal expansion (otherwise seeds with identical
  // PageRank tie alphabetically — Step 8a bug #1).
  const seedIds = bm25Hits.slice(0, 5).map((h) => h.nodeId);
  const seedScores = new Map<string, number>();
  for (const h of bm25Hits.slice(0, 5)) seedScores.set(h.nodeId, h.score);
  const traversalHits = traverseFromSeeds(index.traversal, seedIds, {
    maxDepth: opts.maxDepth,
    k: opts.traversalK,
    seedScores,
  });

  // 3. RRF fusion.
  const fused = fuseRrf(
    [
      {
        name: "bm25",
        items: bm25Hits.map((h) => ({ docId: h.nodeId, score: h.score })),
      },
      {
        name: "traversal",
        items: traversalHits.map((h) => ({ docId: h.nodeId, score: h.score })),
      },
    ],
    { k: opts.rrfK, topK: opts.k },
  );

  // 4. Hydrate into HybridResult. Drop fused docIds that
  // don't resolve in the graph (defence-in-depth: today both
  // sub-retrievers share the same graph so every docId
  // resolves, but Step 8b may add canon docs / external
  // retrievers to the RRF inputs; we must not crash on
  // unknown IDs). Per §0.6.4 (d) integration-boundary rule.
  const out: HybridResult[] = [];
  for (const f of fused) {
    const node = index.bm25.nodeById.get(f.docId);
    if (!node) continue;
    const cluster = index.traversal.clusterByNodeId.get(f.docId) ?? null;
    out.push({
      nodeId: f.docId,
      node,
      cluster,
      rrfScore: f.rrfScore,
      bm25: f.sources.get("bm25") ?? null,
      traversal: f.sources.get("traversal") ?? null,
    });
  }
  return out;
}

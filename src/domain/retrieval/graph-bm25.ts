// Per `architecture/v1-launch-plan.md` Step 8a + research/29
// §4.3 (Sourcegraph BM25F field-weighting).
//
// Build a BM25F index over a `MultiRepoGraph` for the
// BM25 half of hybrid RAG. Each node becomes a document with
// 4 fields (Sourcegraph's BM25F field-weight pattern):
//
//   - `name`     (weight 3.0) — symbol name. Strongest signal.
//   - `path`     (weight 2.0) — workspace-relative file path.
//   - `kind`     (weight 0.7) — NodeKind ("service", "model", ...).
//                Useful for "what services are there?" queries.
//   - `meta`     (weight 0.5) — flattened meta + cluster name.
//
// The weights are Sourcegraph-derived: file/symbol > kind +
// metadata. Comments aren't indexed (Schema's extractors
// don't carry comment text). Function bodies aren't indexed
// either; the symbol-graph is the surface, not the body
// text — research/29 §4.3's "code search" framing.

import type { MultiRepoGraph, GraphNode, Cluster } from "../multi-repo.ts";
import {
  buildIndex,
  searchIndex,
  tokenize,
  type Document,
  type InvertedIndex,
} from "./bm25.ts";

/** Field weights per Sourcegraph BM25F v6.2. Exported so tests
 *  (and the §0.6.4 verification) can pin them as a canonical
 *  set. */
export const GRAPH_BM25_FIELD_WEIGHTS = {
  name: 3.0,
  path: 2.0,
  kind: 0.7,
  meta: 0.5,
} as const;

/** Convert a graph node to a BM25 document. The cluster name
 *  for the node (if any) is included in the `meta` field so
 *  "auth" queries surface nodes whose cluster is named
 *  `Authentication`. */
export function graphNodeToDocument(
  node: GraphNode,
  clusterByNodeId: ReadonlyMap<string, Cluster>,
): Document {
  const cluster = clusterByNodeId.get(node.id);
  const metaText: string[] = [];
  if (cluster) metaText.push(cluster.name);
  if (node.meta) {
    for (const [k, v] of Object.entries(node.meta)) {
      metaText.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }
  return {
    id: node.id,
    fields: [
      { name: "name", tokens: tokenize(node.name), weight: GRAPH_BM25_FIELD_WEIGHTS.name },
      { name: "path", tokens: tokenize(node.filePath ?? ""), weight: GRAPH_BM25_FIELD_WEIGHTS.path },
      { name: "kind", tokens: tokenize(node.kind), weight: GRAPH_BM25_FIELD_WEIGHTS.kind },
      { name: "meta", tokens: tokenize(metaText.join(" ")), weight: GRAPH_BM25_FIELD_WEIGHTS.meta },
    ],
  };
}

/** A BM25 index built over an entire workspace's graph nodes.
 *  Stable across queries; rebuild on graph change. */
export interface GraphBm25Index {
  readonly index: InvertedIndex;
  readonly nodeById: ReadonlyMap<string, GraphNode>;
}

/** Build the per-workspace graph BM25 index. Cost ≈ O(N) where
 *  N = total nodes across all repos. */
export function buildGraphBm25Index(graph: MultiRepoGraph): GraphBm25Index {
  // First pass: map every node to its containing cluster (if
  // any). A node belongs to at most one cluster; we pick the
  // first occurrence.
  const clusterByNodeId = new Map<string, Cluster>();
  for (const repo of graph.repos) {
    for (const cluster of repo.clusters) {
      for (const nid of cluster.nodeIds) {
        if (!clusterByNodeId.has(nid)) clusterByNodeId.set(nid, cluster);
      }
    }
  }

  const docs: Document[] = [];
  const nodeById = new Map<string, GraphNode>();
  for (const repo of graph.repos) {
    for (const node of repo.nodes) {
      nodeById.set(node.id, node);
      docs.push(graphNodeToDocument(node, clusterByNodeId));
    }
  }

  return {
    index: buildIndex(docs),
    nodeById,
  };
}

/** Run a BM25F query against the graph index. Returns the
 *  top-K node ids by BM25F score (descending). */
export function searchGraph(
  index: GraphBm25Index,
  query: string,
  k: number,
): { nodeId: string; score: number }[] {
  const results = searchIndex(index.index, query, k);
  return results.map((r) => ({ nodeId: r.docId, score: r.score }));
}

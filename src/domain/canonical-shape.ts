// Per `architecture/v1-launch-plan.md` Step 7b — canonical-shape
// detector. Classifies a cluster as Service / Domain / Library /
// Mixed from its inbound vs outbound edge ratios.
//
// Why: the Studio layout selection branches on shape (Service →
// top-down fan-out tree; Domain → centred sink; Library →
// balanced grid). Without this signal the canvas has to fall
// back to a generic force-directed layout that's harder to read.
//
// The detector is pure (§0.6.4 (a) extracted) — given a cluster's
// node set + the graph's edges, returns the shape. No I/O.

import type { Cluster, CanonicalShape, GraphEdge, GraphNode } from "./multi-repo.ts";
import { EDGE_RELATIONS } from "./vocabulary.ts";

/** Step 7b canonical: minimum nodes for a cluster to get a
 *  shape classification. Below this size the shape signal is
 *  too noisy — return `mixed` (the default for "we don't know"). */
export const MIN_NODES_FOR_SHAPE = 4;

/** Step 7b canonical: outbound:inbound ratio threshold above
 *  which a cluster is a Service (mostly fan-out). Pinned by
 *  test so a future tweak surfaces. */
export const SERVICE_OUT_IN_RATIO = 2.0;

/** Step 7b canonical: inbound:outbound ratio threshold above
 *  which a cluster is a Domain (mostly sink). */
export const DOMAIN_IN_OUT_RATIO = 2.0;

/** Step 7b canonical: minimum edge count for shape detection.
 *  Below this the ratios are too noisy. */
export const MIN_EDGES_FOR_SHAPE = 3;

/** Pure helper (§0.6.4 (a)): count edges crossing a cluster's
 *  boundary, split by direction. */
export function classifyClusterEdges(
  cluster: Cluster,
  edges: readonly GraphEdge[],
): { outbound: number; inbound: number; internal: number } {
  const inside = new Set(cluster.nodeIds);
  let outbound = 0;
  let inbound = 0;
  let internal = 0;
  for (const edge of edges) {
    // Skip edges that aren't structural (only the relations
    // that drive code-flow + contracts count).
    if (
      edge.relation !== EDGE_RELATIONS.calls &&
      edge.relation !== EDGE_RELATIONS.imports &&
      edge.relation !== EDGE_RELATIONS.applies_middleware &&
      edge.relation !== EDGE_RELATIONS.implements_contract
    ) {
      continue;
    }
    const srcInside = inside.has(edge.source);
    const tgtInside = inside.has(edge.target);
    if (srcInside && tgtInside) internal++;
    else if (srcInside && !tgtInside) outbound++;
    else if (!srcInside && tgtInside) inbound++;
  }
  return { outbound, inbound, internal };
}

/** Step 7b: detect the canonical shape of a single cluster. */
export function detectCanonicalShape(
  cluster: Cluster,
  edges: readonly GraphEdge[],
): CanonicalShape {
  if (cluster.nodeIds.length < MIN_NODES_FOR_SHAPE) return "mixed";
  const { outbound, inbound } = classifyClusterEdges(cluster, edges);
  const total = outbound + inbound;
  if (total < MIN_EDGES_FOR_SHAPE) return "mixed";
  // Use ratios that avoid division-by-zero. A cluster with no
  // inbound edges but many outbound is a clear Service.
  if (inbound === 0 && outbound > 0) return "service";
  if (outbound === 0 && inbound > 0) return "domain";
  const outIn = outbound / Math.max(1, inbound);
  const inOut = inbound / Math.max(1, outbound);
  if (outIn >= SERVICE_OUT_IN_RATIO) return "service";
  if (inOut >= DOMAIN_IN_OUT_RATIO) return "domain";
  return "library";
}

/** Step 7b: detect shapes for every cluster in a list. Pure. */
export function detectAllShapes(
  clusters: readonly Cluster[],
  edges: readonly GraphEdge[],
): Map<string, CanonicalShape> {
  const out = new Map<string, CanonicalShape>();
  for (const cluster of clusters) {
    out.set(cluster.id, detectCanonicalShape(cluster, edges));
  }
  return out;
}

/** Step 7b: annotate clusters with their canonical shape.
 *  Returns a new array; clusters retain their other fields. */
export function annotateClustersWithShape(
  clusters: readonly Cluster[],
  edges: readonly GraphEdge[],
): Cluster[] {
  return clusters.map((c) => ({
    ...c,
    canonicalShape: detectCanonicalShape(c, edges),
  }));
}

// Unused but pinned-by-test imports for §0.6.2 single-source.
void (null as unknown as GraphNode);

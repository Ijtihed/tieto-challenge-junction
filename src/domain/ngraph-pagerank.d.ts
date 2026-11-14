// Minimal type declarations for ngraph.pagerank 2.x.
// The package ships with no .d.ts. These cover the subset we use in
// `src/domain/cluster.ts` for per-cluster personalized PageRank.
//
// Per `architecture/v1-launch-plan.md` Step 7 + research/24 §7.4.

declare module "ngraph.pagerank" {
  import type { Graph } from "ngraph.graph";

  /** Compute PageRank for every node in `graph`.
   *
   *  @param graph - an ngraph.graph instance. Edges should already
   *                 be weighted via `addLink(from, to, weight)` or
   *                 via per-relation weight pre-multiplied edges
   *                 (ngraph.pagerank itself uses uniform weights).
   *  @param internalJumpProbability - damping factor; PageRank
   *                 standard is 0.85.
   *  @param epsilon - convergence threshold; default 0.005.
   *  @returns Record mapping node id → PageRank score (normalised
   *                 so that the sum across all nodes ≈ 1).
   */
  function pageRank(
    graph: Graph,
    internalJumpProbability?: number,
    epsilon?: number,
  ): Record<string, number>;

  export = pageRank;
}

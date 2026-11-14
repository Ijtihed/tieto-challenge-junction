// Minimal type declarations for ngraph.leiden 0.2.x.
// The package ships with no .d.ts; these cover the subset we use in
// clients/studio/src/lib/applyClusters.ts.

declare module "ngraph.leiden" {
  import type { Graph } from "ngraph.graph";

  export interface LeidenOptions {
    quality?: "modularity" | "cpm";
    resolution?: number;
    directed?: boolean;
    randomSeed?: number;
    candidateStrategy?: "neighbors" | "all" | "random" | "random-neighbor";
  }

  export interface ClustersResult {
    getClass(nodeId: string | number): number;
    getCommunities(): Map<number, string[]>;
    quality(): number;
    toJSON(): {
      membership: Record<string, number>;
      meta: { levels: number; quality: number; options: object };
    };
  }

  export function detectClusters(
    input: Graph,
    options?: LeidenOptions,
  ): ClustersResult;
}

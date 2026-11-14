// Per architecture/schema-v3.md §4.5
import type { GraphNode, GraphEdge, Cluster, InterRepoEdge, MultiRepoGraph } from "./multi-repo.ts";

export interface GraphPatch {
  readonly targetRepoUri?: string;
  readonly addNodes?: readonly GraphNode[];
  readonly removeNodeIds?: readonly string[];
  readonly addEdges?: readonly GraphEdge[];
  readonly removeEdgeIds?: readonly string[];
  readonly addClusters?: readonly Cluster[];
  readonly removeClusterIds?: readonly string[];
  readonly patchClusters?: readonly {
    id: string;
    addNodeIds?: readonly string[];
    removeNodeIds?: readonly string[];
    rename?: string;
  }[];
  readonly addInterRepoEdges?: readonly InterRepoEdge[];
  readonly removeInterRepoEdgeIds?: readonly string[];
}

export function applyPatch(graph: MultiRepoGraph, patch: GraphPatch): MultiRepoGraph {
  // Precondition: every removeNodeId must exist somewhere in the graph
  if (patch.removeNodeIds?.length) {
    const allNodeIds = new Set(graph.repos.flatMap((r) => r.nodes.map((n) => n.id)));
    for (const id of patch.removeNodeIds) {
      if (!allNodeIds.has(id)) {
        throw new Error(`applyPatch precondition failure: node '${id}' not found in any repo`);
      }
    }
  }

  if (patch.removeEdgeIds?.length) {
    const allEdgeIds = new Set(graph.repos.flatMap((r) => r.edges.map((e) => e.id)));
    for (const id of patch.removeEdgeIds) {
      if (!allEdgeIds.has(id)) {
        throw new Error(`applyPatch precondition failure: edge '${id}' not found in any repo`);
      }
    }
  }

  const removeNodes = new Set(patch.removeNodeIds ?? []);
  const removeEdges = new Set(patch.removeEdgeIds ?? []);
  const removeClusters = new Set(patch.removeClusterIds ?? []);
  const removeInterRepo = new Set(patch.removeInterRepoEdgeIds ?? []);

  const targetRepoUri = patch.targetRepoUri;

  return {
    ...graph,
    repos: graph.repos.map((repo) => {
      const isTarget = targetRepoUri ? repo.uri === targetRepoUri : true;
      const isFirstRepo = repo === graph.repos[0];
      const shouldAdd = targetRepoUri ? isTarget : isFirstRepo;

      let nodes = repo.nodes.filter((n) => !removeNodes.has(n.id));
      if (patch.addNodes && shouldAdd) nodes = [...nodes, ...patch.addNodes];

      let edges = repo.edges.filter((e) => !removeEdges.has(e.id));
      if (patch.addEdges && shouldAdd) edges = [...edges, ...patch.addEdges];

      let clusters = repo.clusters.filter((c) => !removeClusters.has(c.id));
      if (patch.addClusters && shouldAdd) clusters = [...clusters, ...patch.addClusters];

      if (patch.patchClusters) {
        clusters = clusters.map((c) => {
          const p = patch.patchClusters!.find((pc) => pc.id === c.id);
          if (!p) return c;
          let nodeIds = [...c.nodeIds];
          if (p.removeNodeIds) nodeIds = nodeIds.filter((id) => !p.removeNodeIds!.includes(id));
          if (p.addNodeIds) nodeIds = [...nodeIds, ...p.addNodeIds];
          return { ...c, nodeIds, name: p.rename ?? c.name };
        });
      }

      return { ...repo, nodes, edges, clusters };
    }),
    interRepoEdges: [
      ...graph.interRepoEdges.filter((e) => !removeInterRepo.has(e.id)),
      ...(patch.addInterRepoEdges ?? []),
    ],
  };
}

// Per architecture/specs/semantic-diff.md §2.2
// Computes behavioral impact scores for changed nodes via BFS traversal.

import type { MultiRepoGraph } from "./multi-repo.ts";
import type { NodeDelta, ImpactSummary } from "./delta.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "./vocabulary.ts";

const MAX_BFS_DEPTH = 10;

interface AdjacencyIndex {
  readonly callers: Map<string, string[]>;
  readonly callees: Map<string, string[]>;
  readonly nodeKinds: Map<string, string>;
  readonly nodeNames: Map<string, string>;
}

function buildIndex(graph: MultiRepoGraph): AdjacencyIndex {
  const callers = new Map<string, string[]>();
  const callees = new Map<string, string[]>();
  const nodeKinds = new Map<string, string>();
  const nodeNames = new Map<string, string>();

  for (const repo of graph.repos) {
    for (const node of repo.nodes) {
      nodeKinds.set(node.id, node.kind);
      nodeNames.set(node.id, node.name);
    }
    for (const edge of repo.edges) {
      if (edge.relation === EDGE_RELATIONS.calls || edge.relation === EDGE_RELATIONS.imports) {
        const callerList = callers.get(edge.target);
        if (callerList) callerList.push(edge.source);
        else callers.set(edge.target, [edge.source]);

        const calleeList = callees.get(edge.source);
        if (calleeList) calleeList.push(edge.target);
        else callees.set(edge.source, [edge.target]);
      }
    }
  }

  return { callers, callees, nodeKinds, nodeNames };
}

function bfs(start: string, adjacency: Map<string, string[]>, maxDepth: number): Set<string> {
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: start, depth: 0 }];
  visited.add(start);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    const neighbors = adjacency.get(id);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push({ id: n, depth: depth + 1 });
      }
    }
  }

  visited.delete(start);
  return visited;
}

export function computeImpactScores(
  graph: MultiRepoGraph,
  deltas: readonly NodeDelta[],
): { enrichedNodes: readonly NodeDelta[]; impactSummary: ImpactSummary } {
  const index = buildIndex(graph);
  const allImpactedIds = new Set<string>();
  const allImpactedContracts = new Set<string>();
  let highestImpact: { id: string; name: string; impact: number } | undefined;

  const enrichedNodes: NodeDelta[] = deltas.map((d) => {
    if (d.status === "unchanged") return d;

    const upstream = bfs(d.id, index.callers, MAX_BFS_DEPTH);
    const downstream = bfs(d.id, index.callees, MAX_BFS_DEPTH);

    const contracts: string[] = [];
    for (const id of [...upstream, ...downstream]) {
      allImpactedIds.add(id);
      if (index.nodeKinds.get(id) === NODE_KINDS.contract) {
        contracts.push(id);
        allImpactedContracts.add(id);
      }
    }

    const totalImpact = upstream.size + downstream.size;
    if (!highestImpact || totalImpact > highestImpact.impact) {
      highestImpact = { id: d.id, name: index.nodeNames.get(d.id) ?? d.id, impact: totalImpact };
    }

    return {
      ...d,
      impactedUpstream: upstream.size,
      impactedDownstream: downstream.size,
      impactedContracts: contracts.length > 0 ? contracts : undefined,
    };
  });

  return {
    enrichedNodes,
    impactSummary: {
      totalImpactedNodes: allImpactedIds.size,
      totalImpactedContracts: allImpactedContracts.size,
      highestImpactNode: highestImpact,
    },
  };
}

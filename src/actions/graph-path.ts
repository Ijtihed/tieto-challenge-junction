// Per architecture/schema-v3.md §5.3 action 9 — BFS shortest path
import { getSession } from "../session/index.ts";
import type { GraphNode, GraphEdge } from "../domain/multi-repo.ts";

export const graphPath = {
  name: "graph.path" as const,
  description: "Find the shortest path(s) between two nodes in the graph using BFS, respecting a maximum hop limit.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      from: { type: "string", description: "Source node ID" },
      to: { type: "string", description: "Target node ID" },
      maxHops: { type: "number", description: "Maximum path length in hops (default 6)" },
    },
    required: ["sessionId", "from", "to"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const from = args["from"] as string | undefined;
    const to = args["to"] as string | undefined;
    if (!from || !to) {
      return { ok: false as const, code: "invalid-args", message: "from and to are required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const maxHops = (args["maxHops"] as number | undefined) ?? 6;

    const allNodes = new Map(
      session.graph.repos.flatMap((r) => r.nodes.map((n) => [n.id, n] as const))
    );
    const allEdges = session.graph.repos.flatMap((r) => r.edges);

    if (!allNodes.has(from)) {
      return { ok: false as const, code: "invalid-args", message: `Node ${from} not found` };
    }
    if (!allNodes.has(to)) {
      return { ok: false as const, code: "invalid-args", message: `Node ${to} not found` };
    }

    if (from === to) {
      return { ok: true as const, data: { paths: [[allNodes.get(from)!]], allEdgesByPath: [[]] } };
    }

    const adjacency = new Map<string, { target: string; edge: GraphEdge }[]>();
    for (const edge of allEdges) {
      const list = adjacency.get(edge.source);
      if (list) list.push({ target: edge.target, edge });
      else adjacency.set(edge.source, [{ target: edge.target, edge }]);

      const rList = adjacency.get(edge.target);
      if (rList) rList.push({ target: edge.source, edge });
      else adjacency.set(edge.target, [{ target: edge.source, edge }]);
    }

    const paths: GraphNode[][] = [];
    const allEdgesByPath: GraphEdge[][] = [];

    type BfsEntry = { nodeId: string; path: string[]; edges: GraphEdge[] };
    const queue: BfsEntry[] = [{ nodeId: from, path: [from], edges: [] }];
    const visited = new Set<string>([from]);
    let shortestLength: number | undefined;

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (shortestLength !== undefined && current.path.length > shortestLength) break;
      if (current.path.length > maxHops + 1) break;

      const neighbours = adjacency.get(current.nodeId) ?? [];
      for (const { target, edge } of neighbours) {
        if (target === to) {
          const nodePath = [...current.path, to].map((id) => allNodes.get(id)!);
          const edgePath = [...current.edges, edge];
          paths.push(nodePath);
          allEdgesByPath.push(edgePath);
          shortestLength ??= current.path.length + 1;
          continue;
        }

        if (visited.has(target)) continue;
        if (current.path.length >= maxHops) continue;

        visited.add(target);
        queue.push({
          nodeId: target,
          path: [...current.path, target],
          edges: [...current.edges, edge],
        });
      }
    }

    return { ok: true as const, data: { paths, allEdgesByPath } };
  },
};

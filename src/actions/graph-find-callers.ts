// Per architecture/schema-v3.md §5.3 action 7
import { getSession } from "../session/index.ts";
import type { GraphEdge, GraphNode } from "../domain/multi-repo.ts";

const MAX_RESULTS = 500;

export const graphFindCallers = {
  name: "graph.find_callers" as const,
  description: "Find all nodes that call (have inbound edges to) a given symbol, traversing up to a specified depth.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      symbolId: { type: "string", description: "The target node ID to find callers of" },
      depth: { type: "number", description: "How many hops to traverse (default 1)" },
    },
    required: ["sessionId", "symbolId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const symbolId = args["symbolId"] as string | undefined;
    if (!symbolId) {
      return { ok: false as const, code: "invalid-args", message: "symbolId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const depth = (args["depth"] as number | undefined) ?? 1;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const allNodes = new Map(session.graph.repos.flatMap((r) => r.nodes.map((n) => [n.id, n] as const)));

    const inboundIndex = new Map<string, GraphEdge[]>();
    for (const edge of allEdges) {
      const list = inboundIndex.get(edge.target);
      if (list) list.push(edge);
      else inboundIndex.set(edge.target, [edge]);
    }

    const callers: { id: string; viaEdge: string; locator: string }[] = [];
    const visited = new Set<string>();
    let frontier = [symbolId];
    let truncated = false;

    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        const incoming = inboundIndex.get(nodeId) ?? [];
        for (const edge of incoming) {
          if (visited.has(edge.source)) continue;
          visited.add(edge.source);

          if (callers.length >= MAX_RESULTS) { truncated = true; break; }

          const srcNode = allNodes.get(edge.source);
          callers.push({
            id: edge.source,
            viaEdge: edge.id,
            locator: srcNode?.locator ?? "",
          });
          next.push(edge.source);
        }
        if (truncated) break;
      }
      if (truncated) break;
      frontier = next;
    }

    return { ok: true as const, data: { callers, truncated } };
  },
};

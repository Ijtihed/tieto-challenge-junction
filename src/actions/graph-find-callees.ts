// Per architecture/schema-v3.md §5.3 action 8
import { getSession } from "../session/index.ts";
import type { GraphEdge } from "../domain/multi-repo.ts";
import { EDGE_RELATIONS } from "../domain/vocabulary.ts";

const MAX_RESULTS = 500;

export const graphFindCallees = {
  name: "graph.find_callees" as const,
  description: "Find all nodes that a given symbol calls (has outbound edges to), traversing up to a specified depth.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      symbolId: { type: "string", description: "The source node ID to find callees of" },
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

    const outboundIndex = new Map<string, GraphEdge[]>();
    for (const edge of allEdges) {
      const list = outboundIndex.get(edge.source);
      if (list) list.push(edge);
      else outboundIndex.set(edge.source, [edge]);
    }

    const callees: { id: string; viaEdge: string; locator: string; relation: string }[] = [];
    const visited = new Set<string>();
    let frontier = [symbolId];
    let truncated = false;

    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        const outgoing = outboundIndex.get(nodeId) ?? [];
        for (const edge of outgoing) {
          if (visited.has(edge.target)) continue;
          visited.add(edge.target);

          if (callees.length >= MAX_RESULTS) { truncated = true; break; }

          const tgtNode = allNodes.get(edge.target);
          callees.push({
            id: edge.target,
            viaEdge: edge.id,
            locator: tgtNode?.locator ?? "",
            relation: edge.relation ?? EDGE_RELATIONS.calls,
          });
          next.push(edge.target);
        }
        if (truncated) break;
      }
      if (truncated) break;
      frontier = next;
    }

    return { ok: true as const, data: { callees, truncated } };
  },
};

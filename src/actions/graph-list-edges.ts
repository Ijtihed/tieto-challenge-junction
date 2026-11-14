import { getSession } from "../session/index.ts";

export const graphListEdges = {
  name: "graph.list_edges" as const,
  description: "List all edges in the session graph, optionally filtered by relation or source/target node ID.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      filter: {
        type: "object",
        description: "Optional filter criteria for edges",
        properties: {
          relation: { type: "array", items: { type: "string" }, description: "Include only edges matching these relations" },
          sourceId: { type: "string", description: "Include only edges from this source node" },
          targetId: { type: "string", description: "Include only edges to this target node" },
        },
      },
      limit: { type: "number", description: "Maximum number of edges to return (default 10000)" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const filter = (args["filter"] as Record<string, unknown> | undefined) ?? {};
    const limit = (args["limit"] as number | undefined) ?? 10_000;

    let edges = [
      ...session.graph.repos.flatMap((r) =>
        r.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          relation: e.relation,
          meta: e.meta,
        })),
      ),
      ...session.graph.interRepoEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relation: e.relation,
        meta: e.meta,
      })),
    ];

    if (filter["relation"]) {
      const relations = new Set(filter["relation"] as string[]);
      edges = edges.filter((e) => relations.has(e.relation));
    }
    if (filter["sourceId"]) {
      const sourceId = filter["sourceId"] as string;
      edges = edges.filter((e) => e.source === sourceId);
    }
    if (filter["targetId"]) {
      const targetId = filter["targetId"] as string;
      edges = edges.filter((e) => e.target === targetId);
    }

    const truncated = edges.length > limit;
    const page = edges.slice(0, limit);

    return { ok: true as const, data: { edges: page, truncated } };
  },
};

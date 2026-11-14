// Per architecture/schema-v3.md §5.3 action 5
import { getSession } from "../session/index.ts";
import type { GraphNode } from "../domain/multi-repo.ts";
import type { NodeKind } from "../domain/vocabulary.ts";

export const graphListNodes = {
  name: "graph.list_nodes" as const,
  description: "List graph nodes with optional filtering by kind, cluster, locator prefix, name pattern, or metadata conditions. Supports cursor-based pagination.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      filter: {
        type: "object",
        description: "Filter criteria for nodes",
        properties: {
          kind: { type: "array", items: { type: "string" }, description: "Include only nodes matching these kinds" },
          cluster: { type: "array", items: { type: "string" }, description: "Include only nodes in these cluster IDs" },
          locatorPrefix: { type: "string", description: "Include only nodes whose locator starts with this prefix" },
          namePattern: { type: "string", description: "Regex pattern to match against node names" },
          metaWhere: { type: "array", items: { type: "object", properties: { key: { type: "string" }, equals: {} }, required: ["key", "equals"] }, description: "Metadata equality conditions" },
        },
      },
      limit: { type: "number", description: "Maximum number of nodes to return (default 10000)" },
      cursor: { type: "string", description: "Pagination cursor from a previous response" },
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
    const cursor = args["cursor"] as string | undefined;

    let nodes: GraphNode[] = session.graph.repos.flatMap((r) => r.nodes);

    // Build a reverse map from node id to cluster id so each returned node
    // knows its architectural cluster. This is the data Studio's L1
    // (Architecture) view needs to colour and group nodes correctly.
    const nodeToCluster = new Map<string, string>();
    for (const repo of session.graph.repos) {
      for (const c of repo.clusters) {
        for (const id of c.nodeIds) nodeToCluster.set(id, c.id);
      }
    }

    if (filter["kind"]) {
      const kinds = new Set(filter["kind"] as string[]);
      nodes = nodes.filter((n) => kinds.has(n.kind));
    }

    if (filter["cluster"]) {
      const clusterIds = new Set(filter["cluster"] as string[]);
      const clusterNodeIds = new Set<string>();
      for (const repo of session.graph.repos) {
        for (const c of repo.clusters) {
          if (clusterIds.has(c.id)) {
            for (const id of c.nodeIds) clusterNodeIds.add(id);
          }
        }
      }
      nodes = nodes.filter((n) => clusterNodeIds.has(n.id));
    }

    if (filter["locatorPrefix"]) {
      const prefix = filter["locatorPrefix"] as string;
      nodes = nodes.filter((n) => n.locator.startsWith(prefix));
    }

    if (filter["namePattern"]) {
      const pattern = filter["namePattern"] as string;
      try {
        const re = new RegExp(pattern, "i");
        nodes = nodes.filter((n) => re.test(n.name));
      } catch {
        return { ok: false as const, code: "invalid-args", message: `Invalid namePattern regex: ${pattern}` };
      }
    }

    if (filter["metaWhere"]) {
      const conditions = filter["metaWhere"] as { key: string; equals: unknown }[];
      nodes = nodes.filter((n) =>
        conditions.every((cond) => n.meta?.[cond.key] === cond.equals)
      );
    }

    nodes.sort((a, b) => a.id.localeCompare(b.id));

    if (cursor) {
      const idx = nodes.findIndex((n) => n.id > cursor);
      if (idx === -1) {
        return { ok: true as const, data: { nodes: [], nextCursor: undefined } };
      }
      nodes = nodes.slice(idx);
    }

    const page = nodes.slice(0, limit);
    const nextCursor = page.length === limit && nodes.length > limit
      ? page[page.length - 1]!.id
      : undefined;

    // Enrich each node with its cluster id (read-only field added on top
    // of the base GraphNode shape; client callers can ignore it).
    const enriched = page.map((n) => ({
      ...n,
      cluster: nodeToCluster.get(n.id) ?? null,
    }));

    return { ok: true as const, data: { nodes: enriched, nextCursor } };
  },
};

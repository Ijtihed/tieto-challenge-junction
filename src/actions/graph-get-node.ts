// Per architecture/schema-v3.md §5.3 action 6
import { getSession } from "../session/index.ts";

export const graphGetNode = {
  name: "graph.get_node" as const,
  description: "Retrieve a single graph node by ID, optionally including its source snippet or locator.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      id: { type: "string", description: "The node ID to retrieve" },
      include: { type: "array", items: { type: "string", enum: ["snippet", "source"] }, description: "Additional data to include with the node" },
    },
    required: ["sessionId", "id"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const id = args["id"] as string | undefined;
    if (!id) {
      return { ok: false as const, code: "invalid-args", message: "id is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const include = (args["include"] as string[] | undefined) ?? [];

    let found = undefined as import("../domain/multi-repo.ts").GraphNode | undefined;
    for (const repo of session.graph.repos) {
      found = repo.nodes.find((n) => n.id === id);
      if (found) break;
    }

    if (!found) {
      return { ok: false as const, code: "invalid-args", message: `Node ${id} not found` };
    }

    const result: Record<string, unknown> = { node: found };

    if (include.includes("snippet") && found.filePath && found.startLine !== undefined && found.endLine !== undefined) {
      result["snippet"] = `${found.filePath}#L${found.startLine}-L${found.endLine}`;
    }

    if (include.includes("source") && found.filePath) {
      result["source"] = found.locator;
    }

    return { ok: true as const, data: result };
  },
};

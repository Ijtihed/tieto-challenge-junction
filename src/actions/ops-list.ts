// Per architecture/schema-v3.md §5.3 action 17
import { getSession } from "../session/index.ts";
import { BUNDLED_OPS } from "../domain/bundled-ops.ts";

export const opsList = {
  name: "ops.list" as const,
  description: "List available bundled operations, optionally filtered to those applicable to a specific symbol's kind.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      symbolId: { type: "string", description: "Optional node ID to filter ops by applicable kind" },
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

    const symbolId = args["symbolId"] as string | undefined;
    let ops = BUNDLED_OPS.map((o) => ({
      id: o.id, name: o.name, description: o.description,
      applicableToKind: [...o.applicableToKind],
    }));

    if (symbolId) {
      const node = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.id === symbolId);
      if (node) {
        ops = ops.filter((o) => o.applicableToKind.includes(node.kind as never));
      }
    }

    return { ok: true as const, data: { ops } };
  },
};

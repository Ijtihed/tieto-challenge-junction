// Per architecture/schema-v3.md §5.3 action 3
import { closeSession } from "../session/index.ts";

export const workspaceClose = {
  name: "workspace.close" as const,
  description: "Close an open workspace session and release its resources.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The session ID to close" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const closed = closeSession(sessionId);
    if (!closed) {
      return { ok: false as const, code: "session-not-found", message: `No open session with id ${sessionId}` };
    }

    return { ok: true as const, data: { closed: true } };
  },
};

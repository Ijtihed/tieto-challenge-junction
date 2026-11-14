// Per architecture/phase-13.md §2.4 T1.9 — read file for Monaco editor.
import { getSession } from "../session/index.ts";
import { buildAdapterSet } from "../adapters/index.ts";

export const workspaceReadFile = {
  name: "workspace.read_file" as const,
  description: "Read a file from the workspace. Path must be within the session's workspace URI allow-list.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      path: { type: "string", description: "Absolute path to the file to read" },
    },
    required: ["sessionId", "path"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const path = args["path"] as string | undefined;
    if (!path) return { ok: false as const, code: "invalid-args", message: "path is required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const adapters = buildAdapterSet(session.adapterMode);
    const allowList = session.workspaceUris.map(
      (u) => u.startsWith("file://") ? u.slice(7) : u,
    );

    if (!adapters.fs.resolveAllowed(path, allowList)) {
      return { ok: false as const, code: "access-denied", message: `Path ${path} is outside the workspace allow-list` };
    }

    try {
      const content = await adapters.fs.readFile(path);
      return { ok: true as const, data: { content, path } };
    } catch (err) {
      return { ok: false as const, code: "read-error", message: `Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

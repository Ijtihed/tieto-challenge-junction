// Per `architecture/v1-launch-plan.md` Step 5a.
//
// L1 control plane companion to `workspace.watch_start`: tear
// down the chokidar watcher and release OS resources. Idempotent
// — calling on a session with no watcher is a no-op.
//
// Also called automatically by `session.close()` so MCP clients
// that exit without explicit `watch_stop` still release the
// inotify / FSEvents handles.

import { getSession } from "../session/index.ts";
import { logger } from "../obs/index.ts";

export const workspaceWatchStop = {
  name: "workspace.watch_stop" as const,
  description:
    "Stop watching the workspace for file changes. Idempotent — calling on a session with no active watcher returns `{ wasWatching: false }`.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
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
    session.lastActivityAt = Date.now();

    const watcher = session.fileWatcher;
    if (!watcher) {
      return {
        ok: true as const,
        data: { sessionId: session.id, watching: false, wasWatching: false },
      };
    }

    const finalStats = watcher.stats();
    await watcher.stop();
    session.fileWatcher = null;
    session.eventBus.emit({ kind: "workspace.watch_stopped", at: Date.now() });
    logger.info("workspace-watch-stop", `stopped (final stats: emitted=${finalStats.eventsEmitted}, coalesced=${finalStats.burstsCoalesced})`);

    return {
      ok: true as const,
      data: {
        sessionId: session.id,
        watching: false,
        wasWatching: true,
        finalStats,
      },
    };
  },
};

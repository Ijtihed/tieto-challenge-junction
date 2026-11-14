// Per `architecture/v1-launch-plan.md` Step 5a + research/27 §7.1.
//
// L1 control plane: lets an MCP client opt the workspace into
// live file watching. The watcher emits `files.changed` events
// into the session event bus; the existing SSE channel at
// `GET /mcp/events/:sessionId` routes those events to subscribed
// clients (Cursor, Claude Code, Studio, ...). No new transport
// added — the §0.6.4 inventory pass confirmed the SSE channel
// already exists and works.
//
// Watching is **opt-in** rather than auto-on at `workspace.open`
// because:
//  1. Some MCP clients are one-shot (CI bots, `pr.review` agents)
//     and never need live updates — keeping watching off saves
//     them the chokidar process / OS file descriptors.
//  2. Studio is the canonical live consumer; it calls
//     `workspace.watch_start` immediately after `workspace.open`.
//  3. Server-side: a long-running MCP server holding many
//     sessions doesn't want every session burning an inotify
//     watch when most aren't being actively interacted with.

import { resolve } from "node:path";
import { getSession } from "../session/index.ts";
import { createFileWatcher } from "../adapters/fs/file-watch.ts";
import { fsAdapterImpls } from "../adapters/fs/index.ts";
import { logger } from "../obs/index.ts";

export const workspaceWatchStart = {
  name: "workspace.watch_start" as const,
  description:
    "Start watching the workspace for file changes. Emits `files.changed` events into the session bus (delivered to SSE subscribers). Idempotent — re-calling on an already-watching session is a no-op.",
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
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }
    session.lastActivityAt = Date.now();

    const rootUri = session.workspaceUris[0];
    if (!rootUri) {
      return { ok: false as const, code: "no-workspace", message: "Session has no workspace URI" };
    }
    const rootPath = rootUri.startsWith("file://") ? rootUri.slice(7) : rootUri;
    const absRoot = resolve(rootPath);

    // Build the same composed filter Step 4 uses for extraction
    // so the watcher never fires on gitignored / always-ignored
    // paths. This is critical: without it a `git pull` on a
    // monorepo would emit thousands of useless events.
    const adapter = fsAdapterImpls.real;
    let filter;
    try {
      filter = await adapter.buildFilter?.(absRoot);
    } catch (err) {
      logger.warn(
        "workspace-watch-start",
        `buildFilter failed (${err instanceof Error ? err.message : String(err)}); proceeding without filter`,
      );
    }

    if (session.fileWatcher) {
      // Already running — idempotent ok.
      return {
        ok: true as const,
        data: {
          sessionId: session.id,
          watching: true,
          alreadyRunning: true,
          stats: session.fileWatcher.stats(),
        },
      };
    }

    const watcher = createFileWatcher(
      session.eventBus,
      filter ? { filter } : {},
    );
    try {
      await watcher.start(absRoot);
    } catch (err) {
      return {
        ok: false as const,
        code: "watch-start-failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    session.fileWatcher = watcher;
    session.eventBus.emit({
      kind: "workspace.watch_started",
      workspaceRoot: absRoot,
      at: Date.now(),
    });
    logger.info("workspace-watch-start", `watching ${absRoot}`);

    return {
      ok: true as const,
      data: {
        sessionId: session.id,
        watching: true,
        alreadyRunning: false,
        workspaceRoot: absRoot,
        stats: watcher.stats(),
      },
    };
  },
};

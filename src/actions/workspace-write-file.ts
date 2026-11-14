// Per architecture/phase-13.md §2.4 T1.9 — write file from Monaco editor + trigger re-extraction.
import { getSession } from "../session/index.ts";
import { buildAdapterSet } from "../adapters/index.ts";
import { contentHash } from "../extractors/file-hash.ts";

export const workspaceWriteFile = {
  name: "workspace.write_file" as const,
  description: "Write a file to the workspace and trigger incremental re-extraction. Path must be within the session's workspace URI allow-list.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      path: { type: "string", description: "Absolute path to the file to write" },
      content: { type: "string", description: "File content to write" },
    },
    required: ["sessionId", "path", "content"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const path = args["path"] as string | undefined;
    if (!path) return { ok: false as const, code: "invalid-args", message: "path is required" };

    const content = args["content"] as string | undefined;
    if (content === undefined || content === null) {
      return { ok: false as const, code: "invalid-args", message: "content is required" };
    }

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
      await adapters.fs.writeFile(path, content);
    } catch (err) {
      return { ok: false as const, code: "write-error", message: `Failed to write ${path}: ${err instanceof Error ? err.message : String(err)}` };
    }

    session.fileHashes.set(path, contentHash(content));

    const touchedSet = new Set([path]);
    const newRepos = session.graph.repos.map((repo) => {
      const filteredNodes = repo.nodes.filter((n) => !(n.filePath && touchedSet.has(n.filePath)));
      const remainingIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = repo.edges.filter((e) => remainingIds.has(e.source) && remainingIds.has(e.target));
      return { ...repo, nodes: filteredNodes, edges: filteredEdges };
    });
    session.graph = { ...session.graph, repos: newRepos };

    session.eventBus.emit({
      kind: "file.written",
      path,
      at: Date.now(),
    });

    session.eventBus.emit({
      kind: "extractor.invalidated",
      touchedUris: [path],
      at: Date.now(),
    });

    return { ok: true as const, data: { written: true, path } };
  },
};

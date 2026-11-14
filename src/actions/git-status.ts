// Per architecture/schema-v3.md §5.3 action 25
import { getSession } from "../session/index.ts";
import { buildAdapterSet } from "../adapters/index.ts";

export const gitStatus = {
  name: "git.status" as const,
  description: "Return the git status of the workspace including current branch, ahead/behind counts, dirty state, and untracked files.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const rootUri = session.workspaceUris[0];
    const rootPath = rootUri?.startsWith("file://") ? rootUri.slice(7) : undefined;
    if (!rootPath) return { ok: false as const, code: "invalid-args", message: "No file:// workspace URI" };

    const adapters = buildAdapterSet(session.adapterMode);

    try {
      const branch = await adapters.git.currentBranch(rootPath);
      const dirty = await adapters.git.isDirty(rootPath);

      const statusResult = await adapters.git.run(["status", "--porcelain"], { cwd: rootPath });
      const untracked = statusResult.stdout.trim().split("\n")
        .filter((l) => l.startsWith("??"))
        .map((l) => l.slice(3).trim());

      const aheadBehindResult = await adapters.git.run(
        ["rev-list", "--left-right", "--count", `HEAD...@{upstream}`],
        { cwd: rootPath },
      );
      let ahead = 0, behind = 0;
      if (aheadBehindResult.exitCode === 0) {
        const parts = aheadBehindResult.stdout.trim().split(/\s+/);
        ahead = parseInt(parts[0] ?? "0", 10) || 0;
        behind = parseInt(parts[1] ?? "0", 10) || 0;
      }

      return { ok: true as const, data: { branch, ahead, behind, dirty, untracked } };
    } catch (err) {
      return { ok: false as const, code: "io-error", message: `git failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

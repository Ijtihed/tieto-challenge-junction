// Per architecture/schema-v3.md §5.3 action 26
// Requires GITHUB_TOKEN env var or session-provided token.
import { getSession } from "../session/index.ts";
import { buildAdapterSet } from "../adapters/index.ts";

export const githubOpenPr = {
  name: "github.open_pr" as const,
  description: "Create a GitHub pull request from the current branch using the GitHub API. Requires GITHUB_TOKEN environment variable.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      title: { type: "string", description: "The PR title" },
      body: { type: "string", description: "The PR body/description (default empty)" },
      base: { type: "string", description: "The base branch to merge into (default 'main')" },
    },
    required: ["sessionId", "title"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const title = args["title"] as string | undefined;
    if (!title) return { ok: false as const, code: "invalid-args", message: "title is required" };

    const body = (args["body"] as string | undefined) ?? "";
    const base = (args["base"] as string | undefined) ?? "main";

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const rootUri = session.workspaceUris[0];
    const rootPath = rootUri?.startsWith("file://") ? rootUri.slice(7) : undefined;
    if (!rootPath) return { ok: false as const, code: "invalid-args", message: "No file:// workspace URI" };

    const token = process.env["GITHUB_TOKEN"];
    if (!token) {
      return { ok: false as const, code: "vendor-unavailable", message: "Set GITHUB_TOKEN environment variable to create PRs" };
    }

    const adapters = buildAdapterSet(session.adapterMode);

    try {
      const branch = await adapters.git.currentBranch(rootPath);

      const remoteResult = await adapters.git.run(["remote", "get-url", "origin"], { cwd: rootPath });
      const remoteUrl = remoteResult.stdout.trim();
      const repoMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      if (!repoMatch) return { ok: false as const, code: "invalid-args", message: `Cannot parse GitHub repo from remote: ${remoteUrl}` };

      const repo = repoMatch[1]!;
      const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept": "application/vnd.github+json",
        },
        body: JSON.stringify({ title, body, head: branch, base }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        return { ok: false as const, code: "io-error", message: `GitHub API error ${response.status}: ${errBody.slice(0, 200)}` };
      }

      const pr = await response.json() as { html_url: string; number: number };

      session.eventBus.emit({ kind: "github.pr_opened", url: pr.html_url, number: pr.number, at: Date.now() });

      return { ok: true as const, data: { url: pr.html_url, number: pr.number } };
    } catch (err) {
      return { ok: false as const, code: "io-error", message: `Failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

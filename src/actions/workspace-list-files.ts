// Per architecture/phase-13.md §2.4 T1.10 — file tree for Schema Studio.
import { getSession } from "../session/index.ts";
import { buildAdapterSet } from "../adapters/index.ts";
import { ALWAYS_IGNORED_DIRS } from "../domain/path-ignore.ts";
import { resolve, relative, basename } from "node:path";
import { readFile } from "node:fs/promises";

interface GitignoreRule {
  pattern: string;
  negated: boolean;
  regex: RegExp;
}

export function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const raw of content.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);
    const isDir = line.endsWith("/");
    if (isDir) line = line.slice(0, -1);
    const escaped = line
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "§GLOBSTAR§")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/§GLOBSTAR§/g, ".*");
    let anchor: string;
    if (isDir) {
      anchor = `(^|/)${escaped}(/|$)`;
    } else if (line.includes("/")) {
      anchor = `^${escaped}$`;
    } else {
      anchor = `(^|/)${escaped}($|/)`;
    }
    rules.push({ pattern: line, negated, regex: new RegExp(anchor) });
  }
  return rules;
}

export function isIgnored(relPath: string, rules: GitignoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(relPath)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

/** Re-exported from `domain/path-ignore` for backwards compatibility. */
export const ALWAYS_IGNORED = ALWAYS_IGNORED_DIRS;

export interface FileEntry {
  path: string;
  name: string;
  relativePath: string;
  isDirectory: boolean;
}

export const workspaceListFiles = {
  name: "workspace.list_files" as const,
  description: "List files in the workspace, respecting .gitignore and Schema ignore patterns.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      path: { type: "string", description: "Subdirectory to list (relative to workspace root). Omit for root." },
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

    const adapters = buildAdapterSet(session.adapterMode);
    const files: FileEntry[] = [];

    for (const uri of session.workspaceUris) {
      const rootPath = uri.startsWith("file://") ? uri.slice(7) : uri;
      const targetPath = args["path"]
        ? resolve(rootPath, args["path"] as string)
        : rootPath;

      if (!adapters.fs.resolveAllowed(targetPath, session.workspaceUris.map(
        (u) => u.startsWith("file://") ? u.slice(7) : u,
      ))) {
        continue;
      }

      let gitignoreRules: GitignoreRule[] = [];
      try {
        const gi = await readFile(resolve(rootPath, ".gitignore"), "utf-8");
        gitignoreRules = parseGitignore(gi);
      } catch { /* no .gitignore */ }

      const allFiles = await adapters.fs.listDir(targetPath, { recursive: true });
      for (const filePath of allFiles) {
        const rel = relative(rootPath, filePath);
        const parts = rel.split("/");
        if (parts.some((p) => ALWAYS_IGNORED.has(p))) continue;
        if (isIgnored(rel, gitignoreRules)) continue;

        files.push({
          path: filePath,
          name: basename(filePath),
          relativePath: rel,
          isDirectory: false,
        });
      }
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return { ok: true as const, data: { files } };
  },
};

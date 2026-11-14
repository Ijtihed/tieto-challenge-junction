import { execFile } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { promisify } from "node:util";
import { runCsharpAst, type CsGraph, type CsDiff } from "../extractors/extractor-csharp/sidecar.ts";

const exec = promisify(execFile);

export async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

export async function revParse(repo: string, ref: string): Promise<string> {
  return (await git(repo, "rev-parse", ref)).trim();
}

export function cacheDir(repo: string): string {
  const dir = join(process.env.SCHEMA_TRUST_CACHE ?? join(homedir(), ".cache", "schema-trust"), basename(repo));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Export a commit's tree to a cache dir (no worktree metadata touched). */
export async function snapshot(repo: string, sha: string): Promise<string> {
  const dir = join(cacheDir(repo), "tree-" + sha);
  if (existsSync(join(dir, ".complete"))) return dir;
  mkdirSync(dir, { recursive: true });
  await exec("bash", ["-c", `git -C "$0" archive "$1" | tar -x -C "$2"`, repo, sha, dir], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(dir, ".complete"), sha);
  return dir;
}

async function cachedJson<T>(path: string, make: () => Promise<T>): Promise<T> {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
  const value = await make();
  writeFileSync(path, JSON.stringify(value));
  return value;
}

export async function headGraph(repo: string, sha: string): Promise<CsGraph> {
  return cachedJson(join(cacheDir(repo), `graph-${sha}.json`), async () =>
    runCsharpAst<CsGraph>(["graph", await snapshot(repo, sha)]));
}

export async function astDiff(repo: string, baseSha: string, headSha: string): Promise<CsDiff> {
  return cachedJson(join(cacheDir(repo), `diff-${baseSha}-${headSha}.json`), () =>
    runCsharpAst<CsDiff>(["diff", repo, baseSha, headSha]));
}

export interface LineDiff { file: string; added: string[]; removed: string[]; addedAt: number[]; removedAt: number[] }

/** Zero-context unified diff, split per file into added/removed lines. */
export async function lineDiff(repo: string, baseSha: string, headSha: string): Promise<Map<string, LineDiff>> {
  const out = await git(repo, "-c", "core.quotepath=false", "diff", "-U0", "-M", "--no-color", baseSha, headSha);
  const files = new Map<string, LineDiff>();
  let cur: LineDiff | null = null;
  let oldPath = "";
  let oldNo = 0;
  let newNo = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = null;
    } else if (line.startsWith("--- ")) {
      oldPath = line.slice(4).replace(/\t$/, "").replace(/^a\//, "");
    } else if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/\t$/, "").replace(/^b\//, "");
      const key = path === "/dev/null" ? oldPath : path;
      cur = { file: key, added: [], removed: [], addedAt: [], removedAt: [] };
      files.set(key, cur);
    } else if (cur && line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      oldNo = Number(m?.[1] ?? 0);
      newNo = Number(m?.[2] ?? 0);
    } else if (cur && line.startsWith("+")) {
      cur.added.push(line.slice(1)); cur.addedAt.push(newNo++);
    } else if (cur && line.startsWith("-")) {
      cur.removed.push(line.slice(1)); cur.removedAt.push(oldNo++);
    }
  }
  return files;
}

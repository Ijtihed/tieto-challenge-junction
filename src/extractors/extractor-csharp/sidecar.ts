// Locates and runs the Roslyn sidecar (tools/csharp-ast).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CsNode {
  key: string; name: string; csKind: string; kind: string; file: string;
  startLine: number; endLine: number; accessibility: string; publicApi: boolean;
  attributes: string[]; signature: string; fingerprint: number; generated: boolean; isTest: boolean;
}
export interface CsEdge { source: string; target: string; relation: string; resolved: boolean }
export interface CsGraph { files: string[]; nodes: CsNode[]; edges: CsEdge[]; stats: Record<string, number> }

export interface CsSide { signature: string; accessibility: string; publicApi: boolean; attributes: string[]; startLine: number; endLine: number; text: string }
export interface CsMemberChange {
  key: string; name: string; csKind: string; file: string; changes: string[]; isTest: boolean;
  publicApiBefore: boolean; publicApiAfter: boolean; before?: CsSide; after?: CsSide;
}
export interface CsFileChange {
  path: string; status: string; oldPath?: string; isCs: boolean; generated: boolean; isTest: boolean;
  added: number; deleted: number; triviaOnly: boolean; fileLevel: string[];
}
export interface CsDiff { baseRef: string; headRef: string; baseSha: string; headSha: string; files: CsFileChange[]; members: CsMemberChange[] }

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function csharpAstBinary(): string {
  return process.env.SCHEMA_CSHARP_AST ?? join(REPO_ROOT, "tools/csharp-ast/bin/out/csharp-ast");
}

function dotnetEnv(): NodeJS.ProcessEnv {
  const dotnetRoot = process.env.DOTNET_ROOT ?? join(homedir(), ".dotnet");
  return { ...process.env, DOTNET_ROOT: dotnetRoot, DOTNET_CLI_TELEMETRY_OPTOUT: "1" };
}

export function runCsharpAst<T>(args: string[], signal?: AbortSignal): Promise<T> {
  const bin = csharpAstBinary();
  if (!existsSync(bin)) {
    return Promise.reject(new Error(`csharp-ast not built at ${bin}; run: npm run build:csharp`));
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { env: dotnetEnv(), signal });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => { err += b.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`csharp-ast ${args[0]} exited ${code}: ${err.slice(0, 2000)}`));
      try {
        resolvePromise(JSON.parse(Buffer.concat(out).toString("utf8")) as T);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

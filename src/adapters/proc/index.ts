// Per architecture/schema-v3.md §3.4
import { spawn } from "node:child_process";

export interface ProcAdapter {
  exec(cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

const real: ProcAdapter = {
  exec: (cmd, args, opts) =>
    new Promise((res, rej) => {
      const child = spawn(cmd, args, {
        cwd: opts?.cwd,
        timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: opts?.signal,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      let stdoutBytes = 0, stderrBytes = 0;
      child.stdout.on("data", (d: Buffer) => {
        stdoutBytes += d.length;
        if (stdoutBytes <= MAX_OUTPUT_BYTES) stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderrBytes += d.length;
        if (stderrBytes <= MAX_OUTPUT_BYTES) stderr += d.toString();
      });
      child.on("error", rej);
      child.on("close", (code) => res({ stdout, stderr, exitCode: code ?? 1 }));
    }),
};

const demo: ProcAdapter = {
  exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
};

export const procAdapterImpls = { real, demo } as const;

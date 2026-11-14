// Per architecture/schema-v3.md §3.4
import type { ProcAdapter } from "../proc/index.ts";
import { procAdapterImpls } from "../proc/index.ts";

export interface GitAdapter {
  run(args: string[], opts?: { cwd?: string }): Promise<{ stdout: string; exitCode: number }>;
  currentBranch(cwd: string): Promise<string>;
  headSha(cwd: string): Promise<string>;
  isDirty(cwd: string): Promise<boolean>;
}

function createReal(proc: ProcAdapter): GitAdapter {
  return {
    run: async (args, opts) => {
      const cwd = opts?.cwd;
      const r = await proc.exec("git", args, cwd ? { cwd } : undefined);
      return { stdout: r.stdout, exitCode: r.exitCode };
    },
    currentBranch: async (cwd) => {
      const r = await proc.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
      if (r.exitCode !== 0) throw new Error(`Not a git repository or git error: ${r.stderr.trim()}`);
      return r.stdout.trim();
    },
    headSha: async (cwd) => {
      const r = await proc.exec("git", ["rev-parse", "HEAD"], { cwd });
      if (r.exitCode !== 0) throw new Error(`Not a git repository or git error: ${r.stderr.trim()}`);
      return r.stdout.trim();
    },
    isDirty: async (cwd) => {
      const r = await proc.exec("git", ["status", "--porcelain"], { cwd });
      if (r.exitCode !== 0) throw new Error(`Not a git repository or git error: ${r.stderr.trim()}`);
      return r.stdout.trim().length > 0;
    },
  };
}

const demo: GitAdapter = {
  run: async () => ({ stdout: "", exitCode: 0 }),
  currentBranch: async () => "main",
  headSha: async () => "0".repeat(40),
  isDirty: async () => false,
};

export const gitAdapterImpls = {
  get real() { return createReal(procAdapterImpls.real); },
  demo,
} as const;

export type { ProcAdapter };

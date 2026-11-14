// Per `architecture/v1-launch-plan.md` Step 4 + Hora et al. 2026
// (arXiv:2605.16701) — 95.3% of active GitHub repos have a
// .gitignore. Schema must honour them; otherwise vendored
// dependencies, generated artefacts, and committed cache dirs
// pollute the graph.
//
// The runtime parser lives in the `ignore` npm package (pure JS;
// the canonical implementation used by eslint and many others).
// This module wraps it with a typed factory + the domain-level
// composition rules: gitignore is applied FIRST, then the
// `path-ignore.ts` hardcoded list runs as a belt-and-suspenders
// second pass. The two layers stack — gitignore catches what the
// user opted out of; the hardcoded list catches what 100% of
// repos opt out of even when they forgot to add it
// (`node_modules`, `.git`, etc.).
//
// Wire shape: the per-file outcome is one of
//   { allowed: true }
//   { allowed: false, reason: "gitignore" }   — matched a .gitignore rule
//   { allowed: false, reason: "always" }      — matched ALWAYS_IGNORED_*
// `path-ignore.ts` continues to expose `isIgnoredPath` for the
// "always" case; this module composes the two.

import ignore, { type Ignore } from "ignore";
import { isIgnoredPath } from "./path-ignore.ts";

export type IgnoreReason = "gitignore" | "always";

export interface FilterOutcome {
  readonly allowed: boolean;
  /** Only present when `allowed === false`. */
  readonly reason?: IgnoreReason;
}

/** One .gitignore at a specific directory inside the workspace.
 *  The `directory` is relative to the workspace root; the
 *  `patterns` are the lines of that .gitignore file (already
 *  stripped of comments + blank lines by `ignore`). */
export interface GitignoreSource {
  /** Workspace-relative directory hosting this .gitignore. Use
   *  `""` for the root .gitignore. */
  readonly directory: string;
  readonly patterns: readonly string[];
}

/** Composed filter: gitignore-aware + always-ignored.
 *  Stateless after construction; safe to share across requests. */
export interface ComposedFilter {
  /** Test a workspace-relative path (NOT absolute). Returns
   *  the outcome with reason. */
  check(relativePath: string): FilterOutcome;
}

/** Build a composed filter from a set of .gitignore sources at
 *  varying depths. Each source's patterns apply only to paths
 *  inside its `directory` (per the gitignore spec). */
export function buildComposedFilter(sources: readonly GitignoreSource[]): ComposedFilter {
  // Group by directory so subdir .gitignore files compose
  // correctly. The `ignore` library expects relative paths; we
  // re-root each path under the subdir before checking.
  const byDir = new Map<string, Ignore>();
  for (const src of sources) {
    if (src.patterns.length === 0) continue;
    const inst = byDir.get(src.directory) ?? ignore();
    inst.add([...src.patterns]);
    byDir.set(src.directory, inst);
  }

  return {
    check(relativePath: string): FilterOutcome {
      const norm = normalize(relativePath);
      if (norm === "" || norm === "/") return { allowed: true };

      // 1. Apply each .gitignore source. A path inside subdir
      //    `pkg/foo/` is checked against `.gitignore` at
      //    `pkg/foo/`, `pkg/`, and root, in increasing breadth.
      for (const [dir, inst] of byDir) {
        if (dir === "" || norm.startsWith(`${dir}/`)) {
          const subPath = dir === "" ? norm : norm.slice(dir.length + 1);
          if (subPath.length === 0) continue;
          if (inst.ignores(subPath)) {
            return { allowed: false, reason: "gitignore" };
          }
        }
      }

      // 2. Belt-and-suspenders: the canonical always-ignored
      //    set. Some patterns are universal (`node_modules`,
      //    `.git`) and don't depend on a .gitignore being
      //    present — repos forget; we don't.
      if (isIgnoredPath(norm)) {
        return { allowed: false, reason: "always" };
      }

      return { allowed: true };
    },
  };
}

/** Empty filter: no gitignore sources, always-ignored only.
 *  Used as the default when a workspace has no .gitignore at
 *  all (the ~5% of repos per Hora et al.). */
export function emptyComposedFilter(): ComposedFilter {
  return buildComposedFilter([]);
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

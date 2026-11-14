// Per architecture/schema-v3.md §3.4
// Per architecture/v1-launch-plan.md Step 4: the real FS adapter
// reads `.gitignore` files at workspace open and composes them
// with the hardcoded `path-ignore.ts` list. Both layers stack —
// gitignore catches what the user opted out of; the hardcoded
// list catches what 100% of repos opt out of even when they
// forget. Hora et al. 2026 reports 95.3% of active GitHub repos
// have a .gitignore; the 4.7% that don't are still covered by
// the always-ignored set.
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { isIgnoredPath } from "../../domain/path-ignore.ts";
import {
  buildComposedFilter,
  emptyComposedFilter,
  type ComposedFilter,
  type GitignoreSource,
} from "../../domain/gitignore-filter.ts";

// Step 4: the canonical `FilterReason` union lives in
// `domain/extraction-stats.ts` (7 members). The fs adapter
// works in terms of the 2-member `IgnoreReason` from
// `gitignore-filter.ts` (gitignore | always) — those are the
// only reasons IO-layer filtering can fire. Re-exporting either
// here would create a parallel-union §0.6.2 violation; the
// caller (workspace-open.ts) maps the IgnoreReason into the
// broader FilterReason at the action layer.

export interface FsAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string, opts?: { recursive?: boolean }): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  resolveAllowed(path: string, allowList: readonly string[]): boolean;
  /** Build the workspace-scoped composed filter (gitignore +
   *  always-ignored). Called by `workspace.open` once per repo so
   *  callers can surface filter stats. `listDir` already applies
   *  this filter internally; the explicit accessor exists for
   *  tests + caching.stats. */
  buildFilter?(workspaceRoot: string): Promise<ComposedFilter>;
}

const real: FsAdapter = {
  readFile: (p) => readFile(p, "utf-8"),
  writeFile: async (p, c) => { await mkdir(resolve(p, ".."), { recursive: true }); await writeFile(p, c, "utf-8"); },
  listDir: async (p, opts) => {
    // The recursive-listDir path is what workspace.open + the
    // extractors call. Read every .gitignore inside the workspace
    // (recursive) BEFORE walking files, build the composed
    // filter, then apply it to every candidate path. The
    // hardcoded path-ignore list is applied via the same filter
    // (composeFilter calls `isIgnoredPath` internally) so call
    // sites get one decision per file, with one reason.
    const filter = opts?.recursive ? await buildFilterForWorkspace(p) : null;
    const entries = await readdir(p, { recursive: opts?.recursive ?? false, withFileTypes: true });
    const all = entries
      .filter((e) => e.isFile())
      .map((e) => resolve(e.parentPath, e.name));
    if (!filter) {
      // Non-recursive listDir is used for root-level
      // inspection (e.g., archetype detection reading basenames
      // — see actions/workspace-open.ts). Apply the hardcoded
      // list only; the gitignore patterns would have no effect
      // on bare basenames at the root anyway.
      return all.filter((path) => !isIgnoredPath(path));
    }
    return all.filter((path) => {
      const rel = relative(p, path);
      return filter.check(rel).allowed;
    });
  },
  exists: async (p) => { try { await stat(p); return true; } catch { return false; } },
  resolveAllowed: (p, allowList) => {
    const resolved = resolve(p);
    return allowList.some((a) => {
      const allowed = resolve(a);
      return resolved === allowed || resolved.startsWith(allowed + "/");
    });
  },
  buildFilter: (workspaceRoot) => buildFilterForWorkspace(workspaceRoot),
};

/** Read every `.gitignore` inside `workspaceRoot` (recursive)
 *  and compose them into a single filter. Skips the always-
 *  ignored dirs up-front so we don't descend into `node_modules`
 *  to look for a `.gitignore` that we'd never honour anyway. */
async function buildFilterForWorkspace(workspaceRoot: string): Promise<ComposedFilter> {
  const sources: GitignoreSource[] = [];
  let entries;
  try {
    entries = await readdir(workspaceRoot, { recursive: true, withFileTypes: true });
  } catch {
    return emptyComposedFilter();
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name !== ".gitignore") continue;
    const full = resolve(e.parentPath, e.name);
    // Skip .gitignore files inside always-ignored directories
    // (e.g., node_modules/some-pkg/.gitignore). They shouldn't
    // influence the user's workspace.
    if (isIgnoredPath(full)) continue;
    let content: string;
    try {
      content = await readFile(full, "utf-8");
    } catch {
      continue;
    }
    const patterns = content
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    if (patterns.length === 0) continue;
    const directory = relative(workspaceRoot, e.parentPath).replace(/\\/g, "/");
    sources.push({ directory, patterns });
  }
  return buildComposedFilter(sources);
}

const readonlyFs: FsAdapter = {
  ...real,
  writeFile: async () => { throw new Error("fs.writeFile blocked in readonly mode"); },
};

const demo: FsAdapter = {
  readFile: async () => "",
  writeFile: async () => {},
  listDir: async () => [],
  exists: async () => false,
  resolveAllowed: () => true,
};

export const fsAdapterImpls = { real, readonly: readonlyFs, demo } as const;

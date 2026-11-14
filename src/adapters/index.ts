// Per architecture/schema-v3.md §3.4
import type { FsAdapter } from "./fs/index.ts";
import type { ProcAdapter } from "./proc/index.ts";
import type { NetAdapter } from "./net/index.ts";
import type { GitAdapter } from "./git/index.ts";
import type { GithubAdapter } from "./github/index.ts";
import type { SqliteAdapter } from "./sqlite/index.ts";

import { fsAdapterImpls } from "./fs/index.ts";
import { procAdapterImpls } from "./proc/index.ts";
import { netAdapterImpls } from "./net/index.ts";
import { gitAdapterImpls } from "./git/index.ts";
import { githubAdapterImpls } from "./github/index.ts";
import { sqliteAdapterImpls } from "./sqlite/index.ts";

export type { FsAdapter, ProcAdapter, NetAdapter, GitAdapter, GithubAdapter, SqliteAdapter };
export { fsAdapterImpls, procAdapterImpls, netAdapterImpls, gitAdapterImpls, githubAdapterImpls, sqliteAdapterImpls };

export type AdapterMode = "real" | "demo" | "readonly";

export interface AdapterSet {
  readonly fs: FsAdapter;
  readonly proc: ProcAdapter;
  readonly net: NetAdapter;
  readonly git: GitAdapter;
  readonly github: GithubAdapter;
  readonly sqlite: SqliteAdapter;
}

export function buildAdapterSet(mode: AdapterMode): AdapterSet {
  return {
    fs: mode === "demo" ? fsAdapterImpls.demo : (mode === "readonly" ? fsAdapterImpls.readonly : fsAdapterImpls.real),
    proc: mode === "demo" ? procAdapterImpls.demo : procAdapterImpls.real,
    net: mode === "demo" ? netAdapterImpls.demo : netAdapterImpls.real,
    git: mode === "demo" ? gitAdapterImpls.demo : gitAdapterImpls.real,
    github: mode === "demo" ? githubAdapterImpls.demo : githubAdapterImpls.real,
    sqlite: mode === "demo" ? sqliteAdapterImpls.demo : sqliteAdapterImpls.real,
  };
}

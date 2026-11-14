# Graph Persistence — Stage 1 (v1.0 Moat Slice M-A)

Per architecture/schema-v3.md §17.7. Implements persistent
graph snapshots in SQLite for cache-accelerated workspace.open
and time-travel-lite graph.diff_against.

---

## 1. Goal + Non-goals

**Goal:** Persist the complete extracted `MultiRepoGraph` to
SQLite after extraction, keyed by workspace path + git HEAD SHA.
`workspace.open` on a previously-seen repo loads from cache in
**<100 ms** instead of re-extracting (~2-15 s). `graph.diff_against`
can diff against any previously-persisted SHA, giving time-travel
lite without running git checkout.

**Non-goals:**
- HAMT-based O(Δ) snapshots (Stage 2, Series B per §17.7).
- Cross-repo graph federation (Hub feature).
- Snapshot export/import across machines.
- Automatic background re-extraction on file change (future).
- Compressing the SQLite DB (better-sqlite3 is already compact).

---

## 2. Data Model (SQLite Schema)

DB location: `~/.schema/graph-cache.db`

```sql
-- WAL journal mode set on first open for concurrent reads.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  path          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,  -- epoch ms
  last_accessed INTEGER NOT NULL   -- epoch ms, updated on load
);

CREATE TABLE IF NOT EXISTS snapshots (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_path          TEXT NOT NULL REFERENCES workspaces(path),
  git_sha                 TEXT NOT NULL,
  extractor_version_hash  TEXT NOT NULL,
  bridges_version_hash    TEXT NOT NULL,
  wire_format_version     TEXT NOT NULL,
  node_count              INTEGER NOT NULL,
  edge_count              INTEGER NOT NULL,
  size_bytes              INTEGER NOT NULL,  -- sum of all row bytes
  created_at              INTEGER NOT NULL,
  last_accessed           INTEGER NOT NULL,
  -- Step 6 (research/27 §7.5): stacked-overlay. NULL parent means
  -- full base snapshot; non-NULL parent + overlay_unit_uris_json
  -- (JSON array of "<repoUri>:<filePath>" units the overlay
  -- supersedes) means an overlay. Chain depth is bounded at 50
  -- per §9.3 — beyond which we materialise a fresh full snapshot.
  parent_snapshot_id      INTEGER REFERENCES snapshots(id) ON DELETE CASCADE,
  overlay_unit_uris_json  TEXT,
  UNIQUE(workspace_path, git_sha, extractor_version_hash, bridges_version_hash)
);

CREATE TABLE IF NOT EXISTS nodes (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  repo_uri      TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  locator       TEXT NOT NULL,
  file_path     TEXT,
  start_line    INTEGER,
  end_line      INTEGER,
  body_fp       INTEGER,          -- bodyFingerprint
  meta_json     TEXT,             -- JSON.stringify(meta) or NULL
  PRIMARY KEY (snapshot_id, node_id)
);

CREATE TABLE IF NOT EXISTS edges (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  edge_id       TEXT NOT NULL,
  src_node_id   TEXT NOT NULL,
  dst_node_id   TEXT NOT NULL,
  repo_uri      TEXT NOT NULL,
  relation      TEXT NOT NULL,
  meta_json     TEXT,
  PRIMARY KEY (snapshot_id, edge_id)
);

CREATE TABLE IF NOT EXISTS clusters (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  cluster_id    TEXT NOT NULL,
  repo_uri      TEXT NOT NULL,
  name          TEXT NOT NULL,
  node_ids_json TEXT NOT NULL,    -- JSON array of node id strings
  PRIMARY KEY (snapshot_id, cluster_id)
);

-- Indices for graph.search and diff queries.
CREATE INDEX IF NOT EXISTS idx_nodes_file   ON nodes(snapshot_id, file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_kind   ON nodes(snapshot_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_rel    ON edges(snapshot_id, relation);
CREATE INDEX IF NOT EXISTS idx_edges_src    ON edges(snapshot_id, src_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst    ON edges(snapshot_id, dst_node_id);
CREATE INDEX IF NOT EXISTS idx_snap_ws      ON snapshots(workspace_path, last_accessed);
```

---

## 3. Cache Key

A cache hit requires an **exact match** on all four components:

| Component | Source | Why |
|---|---|---|
| `workspace_path` | Resolved absolute path from `session.workspaceUris[0]` | Different repos |
| `git_sha` | `adapters.git.headSha(rootPath)` — full 40-char SHA | Different commits |
| `extractor_version_hash` | FNV-1a of sorted extractor ids + versions from `EXTRACTORS` | Extractor code change invalidates cache |
| `bridges_version_hash` | FNV-1a of sorted bridge detector versions | Bridge logic change invalidates cache |

The UNIQUE constraint on `snapshots` enforces this. A workspace.open
that matches returns the snapshot; a miss triggers full extraction
then persists.

---

## 4. Eviction Policy

- **Per-workspace:** max **50 snapshots** per workspace (oldest by
  `last_accessed` evicted first).
- **Global:** max **5 GB** total `size_bytes` across all snapshots.
  When exceeded, evict least-recently-accessed snapshots across
  all workspaces until under budget.
- **Eviction trigger:** after every `saveSnapshot` call, run the
  eviction check. `ON DELETE CASCADE` on nodes/edges/clusters
  ensures referential cleanup.
- **Manual:** `graph.delete_snapshot` action for explicit cleanup.

---

## 5. Migration Strategy

- **Schema version** stored as `PRAGMA user_version = 1`.
- On `openStore`, check `PRAGMA user_version`:
  - `0` (fresh DB): create all tables, set `user_version = 1`.
  - `1`: current schema, no migration.
  - Future versions: run sequential migrations.
- **Extractor change invalidation:** handled by the cache key's
  `extractor_version_hash`. Changed extractor code → different
  hash → cache miss → fresh extraction → old snapshot untouched
  until LRU evicts it.
- **Corrupt DB:** if `better-sqlite3` throws on open, delete the
  file and create a fresh DB. Log a warning. Never crash.

---

## 6. New MCP Actions

### `graph.list_snapshots`

```
name: "graph.list_snapshots"
sideEffect: "none"
in:  { sessionId: string }
out: { snapshots: SnapshotMeta[] }

SnapshotMeta = {
  id: number;
  gitSha: string;
  createdAt: number;
  lastAccessed: number;
  nodeCount: number;
  edgeCount: number;
  sizeBytes: number;
}
```

Returns all persisted snapshots for the current session's workspace,
sorted by `last_accessed` descending.

### `graph.delete_snapshot`

```
name: "graph.delete_snapshot"
sideEffect: "final"
in:  { sessionId: string, snapshotId: number }
out: { deleted: boolean }
```

Deletes one snapshot and its nodes/edges/clusters via CASCADE.

### `graph.diff_against` (extended)

Existing action. New behavior: if `ref` is a 40-character hex
string that matches a persisted snapshot's `git_sha` (and not a
valid git ref), load the snapshot graph and use `computeDelta`
instead of running `git diff`. Falls back to git if no snapshot
matches.

---

## 7. Round-trip Integration

### workspace.open cache-load path

Modified flow in `src/actions/workspace-open.ts`:

```
1. Resolve workspace path, call adapters.git.headSha(rootPath).
2. Compute extractorVersionHash, bridgesVersionHash.
3. cacheKey = (workspacePath, sha, extHash, bridgesHash).
4. store.loadSnapshot(cacheKey):
   a. HIT → deserialize MultiRepoGraph from SQLite rows.
          Set session.graph = loaded graph.
          Run populateEdb(graph) for Datalog.
          Return { ..., fromCache: true }.
          Time budget: <100 ms.
   b. MISS → extract normally (existing flow).
          store.saveSnapshot(workspacePath, sha, extHash,
            bridgesHash, graph).
          Return { ..., fromCache: false }.
5. Update snapshot.last_accessed = now.
```

New field in workspace.open response:
`fromCache: boolean` — allows the client/agent to know whether
the graph was freshly extracted or served from cache.

### graph.diff_against snapshot-fetch path

```
1. Receive (sessionId, ref).
2. If ref looks like a 40-char SHA:
   a. Try store.loadSnapshot(workspacePath, ref) with
      any extractor/bridges hash (match on workspace + sha only).
   b. If found: load the snapshot graph, call
      computeDelta(snapshotGraph, session.graph).
   c. Return the GraphDelta with refType: "snapshot".
3. Otherwise: existing git diff flow.
```

---

## 8. Failure Modes

| Failure | Behavior |
|---|---|
| **SQLite file locked** (another process) | Retry 3× with 100ms backoff. If still locked, skip cache (extract fresh), log warning. Never block workspace.open. |
| **Disk full** | `saveSnapshot` catches SQLITE_FULL, logs warning, proceeds without caching. Next eviction pass will free space if possible. |
| **Corrupt DB** | `openStore` catches any `better-sqlite3` open error, deletes the file, creates fresh. Log warning. |
| **Cache key mismatch** | Expected behavior: miss → fresh extraction. Not an error. |
| **Snapshot missing nodes/edges** (partial write from crash) | Detect via `node_count` mismatch between snapshots row and actual COUNT(nodes). If mismatched, delete snapshot, extract fresh. |
| **Git not available** (bare workspace) | Skip SHA lookup, skip cache entirely. Extract fresh every time. |

---

## 9. Test Matrix

Target: **30+ new tests** in `src/__tests__/graph-persistence.test.ts`.

| Category | Tests |
|---|---|
| **Store basics** | `openStore` creates tables on fresh DB; `openStore` on existing DB is a no-op; `openStore` on corrupt file recreates |
| **Save/load roundtrip** | Save a MultiRepoGraph, load it back, assert deep equality on nodes, edges, clusters, counts |
| **Cache key match** | Same (workspace, sha, ext, bridges) → hit; different sha → miss; different ext hash → miss |
| **Eviction LRU** | Save 51 snapshots for one workspace, verify oldest is evicted; global 5GB cap evicts across workspaces |
| **Concurrent access** | Two openStore() on same file don't crash (WAL mode) |
| **graph.diff_against (snapshot)** | Diff against a persisted SHA produces same result shape as live-extract diff |
| **workspace.open cache path** | Second open on same workspace returns fromCache: true; <100 ms on fixture |
| **graph.list_snapshots** | Returns correct count and metadata |
| **graph.delete_snapshot** | Deletes snapshot + cascades to nodes/edges |
| **Migration** | Fresh DB gets user_version=1; existing v1 DB doesn't re-run CREATE |
| **Failure handling** | Locked DB falls back to extract; corrupt DB is recreated |

---

## 10. Implementation Files

| File | What |
|---|---|
| `src/domain/persistence/schema.sql` | DDL from §2 above |
| `src/domain/persistence/store.ts` | `GraphStore` class with save/load/list/delete/evict |
| `src/domain/persistence/version.ts` | `computeExtractorVersionHash()`, `computeBridgesVersionHash()` |
| `src/actions/workspace-open.ts` | Cache-load path (§7) |
| `src/actions/graph-diff-against.ts` | Snapshot-fetch path (§7) |
| `src/actions/graph-list-snapshots.ts` | New action |
| `src/actions/graph-delete-snapshot.ts` | New action |
| `src/__tests__/graph-persistence.test.ts` | Tests (§9) |
| `src/__tests__/v1-readiness-invariants.test.ts` | Updated assertions |

---

## 11. Dependencies

- `better-sqlite3` — Add to `package.json` dependencies.
  Node-native SQLite binding, synchronous API (no async overhead
  for the <100 ms budget), WAL mode for concurrent reads.
  Already identified as the target dep per architecture/schema-v3.md
  and the binding research.

---

## 12. Acceptance Criteria

1. Open schemav3 fixture: first open extracts + persists.
2. Close session. Re-open same workspace: loads from cache.
   `fromCache: true` in response. Time <100 ms.
3. `graph.list_snapshots` returns 1 snapshot.
4. `graph.diff_against` with the persisted SHA returns a valid
   GraphDelta.
5. `graph.delete_snapshot` removes it; subsequent list returns 0.
6. 728+ existing tests still pass. 30+ new persistence tests pass.
7. Action count rises from 44 → 46.

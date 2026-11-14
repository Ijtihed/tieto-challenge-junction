-- Graph persistence schema — per architecture/specs/graph-persistence.md §2.
-- WAL journal mode set programmatically on open.

CREATE TABLE IF NOT EXISTS workspaces (
  path          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL
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
  size_bytes              INTEGER NOT NULL,
  created_at              INTEGER NOT NULL,
  last_accessed           INTEGER NOT NULL,
  -- Step 6 (research/27 §7.5): stacked-overlay storage. A snapshot
  -- with parent_snapshot_id is an overlay; its nodes/edges/clusters
  -- are merged with the parent's at load time, with the entries in
  -- `overlay_unit_uris_json` (per-file repo URIs whose facts the
  -- overlay supersedes) acting as the "hide" set. NULL parent means
  -- a base/full snapshot.
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
  body_fp       INTEGER,
  meta_json     TEXT,
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
  snapshot_id          INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  cluster_id           TEXT NOT NULL,
  repo_uri             TEXT NOT NULL,
  name                 TEXT NOT NULL,
  node_ids_json        TEXT NOT NULL,
  -- Step 7a additions, surfaced as a real DC.8a bug: these
  -- fields were on the `Cluster` interface but dropped by the
  -- persistence layer. Step 8b's `graph.ask` + Studio's
  -- entry-point ★ rendering consume them.
  importance_json      TEXT,    -- Record<nodeId, score>
  entry_point_ids_json TEXT,    -- string[]
  label_tier           TEXT,    -- ClusterLabelTier
  PRIMARY KEY (snapshot_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_file   ON nodes(snapshot_id, file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_kind   ON nodes(snapshot_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_rel    ON edges(snapshot_id, relation);
CREATE INDEX IF NOT EXISTS idx_edges_src    ON edges(snapshot_id, src_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst    ON edges(snapshot_id, dst_node_id);
CREATE INDEX IF NOT EXISTS idx_snap_ws      ON snapshots(workspace_path, last_accessed);
-- Step 6: index for overlay-chain walks (load resolves parent → child path).
CREATE INDEX IF NOT EXISTS idx_snap_parent  ON snapshots(parent_snapshot_id);

// Graph persistence store — SQLite-backed, per specs/graph-persistence.md.
import Database from "better-sqlite3";
import { readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MultiRepoGraph, GraphNode, GraphEdge, RepoSubgraph, Cluster, ClusterLabelTier } from "../multi-repo.ts";
import { CURRENT_WIRE_VERSION } from "../wire-format.ts";
import { logger } from "../../obs/index.ts";

// Per `architecture/v1-launch-plan.md` Step 6 + research/27 §7.5:
// stacked-overlay persistence ships at SCHEMA_VERSION 2. The
// migration is in-place (existing v1 DBs are upgraded without
// dropping snapshots) — v1.0 hasn't shipped yet but Schema is
// already self-extracting + dogfooded, so the developer caches
// in `~/.schema/graph-cache.db` carry real value.
const SCHEMA_VERSION = 3;
const MAX_SNAPSHOTS_PER_WORKSPACE = 50;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
// Step 6 (research/27 §9.3): if a parent_snapshot_id chain depth
// exceeds this threshold we materialise a fresh full snapshot at
// the current SHA and break the chain. Prevents pathological
// long-running daemons from accumulating deep overlay walks at
// load time.
const MAX_OVERLAY_CHAIN_DEPTH = 50;

export interface SnapshotMeta {
  id: number;
  gitSha: string;
  extractorVersionHash: string;
  bridgesVersionHash: string;
  createdAt: number;
  lastAccessed: number;
  nodeCount: number;
  edgeCount: number;
  sizeBytes: number;
  /** Step 6: NULL for base/full snapshots; the id of the parent
   *  snapshot for overlays. */
  parentSnapshotId: number | null;
  /** Step 6: per-file units the overlay supersedes from the
   *  resolved parent chain. Empty array for base snapshots; a
   *  non-empty array means "when this overlay is on top, replace
   *  the parent's nodes/edges for these files." */
  overlayUnits: readonly string[];
}

export interface CacheKey {
  workspacePath: string;
  gitSha: string;
  extractorVersionHash: string;
  bridgesVersionHash: string;
}

export interface EvictionReport {
  snapshotsEvicted: number;
  bytesFreed: number;
}

/** Per `architecture/v1-launch-plan.md` Step 6 + research/27 §7.5.
 *
 *  Save options describing how the new snapshot relates to the
 *  current cache state. `mode: "auto"` (default) decides
 *  base-vs-overlay based on whether a parent snapshot exists for
 *  the same workspace; `mode: "base"` forces a full base snapshot;
 *  `mode: "overlay"` requires a parentSnapshotId.
 *
 *  Early cutoff at L5 (research/27 §7.5): if `mode: "auto"` and the
 *  computed overlay would have zero overlay units (no file's facts
 *  actually changed vs the parent), `saveSnapshot` returns the
 *  parent id WITHOUT writing a new row. The caller can detect this
 *  via the returned id matching the parent.
 */
export interface SaveOptions {
  /** Default `"auto"`. */
  mode?: "auto" | "base" | "overlay";
  /** Required when `mode === "overlay"`. Either explicit, or
   *  resolved automatically when `mode === "auto"`. */
  parentSnapshotId?: number;
}

export interface SaveResult {
  /** Snapshot id of the row that represents the saved graph. May
   *  be a freshly-created row (overlay or full) OR the parent's id
   *  if the L5 early cutoff fired and no overlay was written. */
  id: number;
  /** Whether a new row was written (true) or the parent was reused
   *  (false; early-cutoff fired). */
  written: boolean;
  /** What kind of row was written. `"none"` if early-cutoff. */
  kind: "base" | "overlay" | "none";
  /** Per-file overlay units when kind === "overlay". Empty
   *  otherwise. */
  overlayUnits: readonly string[];
  /** Chain depth of the saved/reused snapshot (0 = base, 1 = first
   *  overlay, ...). Used by `incremental.stats` + tests. */
  chainDepth: number;
}

export interface GraphStore {
  saveSnapshot(key: CacheKey, graph: MultiRepoGraph, opts?: SaveOptions): SaveResult;
  loadSnapshot(key: CacheKey): MultiRepoGraph | null;
  loadSnapshotBySha(workspacePath: string, gitSha: string): MultiRepoGraph | null;
  listSnapshots(workspacePath: string): SnapshotMeta[];
  deleteSnapshot(id: number): boolean;
  evictLRU(): EvictionReport;
  /** Step 6: walk the parent chain from a leaf snapshot to its
   *  base. Returns ids in [leaf, parent, grandparent, ..., base]
   *  order. Used by `graph.list_snapshots` + tests. */
  getChain(snapshotId: number): readonly number[];
  close(): void;
}

function readSchemaSql(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(thisDir, "schema.sql"), "utf-8");
}

// Per `architecture/v1-launch-plan.md` Step 6.
//
// In-place schema migration. Each `from < N` block migrates a v(N-1)
// DB to v(N) shape; the blocks run in order and are individually
// idempotent (ALTER ... ADD COLUMN with IF NOT EXISTS semantics via
// PRAGMA `table_info` probe). The store's `corrupt → drop + recreate`
// fallback in `openStore` catches any migration that throws.
function migrateInPlace(db: Database.Database, from: number): void {
  if (from < 2) {
    // v1 → v2: add stacked-overlay columns to `snapshots`. SQLite
    // doesn't support `ADD COLUMN IF NOT EXISTS`; probe the column
    // list with `table_info` first so the migration is idempotent
    // (re-running it on an already-migrated DB is a no-op).
    const cols = (db.pragma("table_info(snapshots)") as { name: string }[])
      .map((c) => c.name);
    if (!cols.includes("parent_snapshot_id")) {
      db.exec(
        `ALTER TABLE snapshots ADD COLUMN parent_snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE CASCADE`,
      );
    }
    if (!cols.includes("overlay_unit_uris_json")) {
      db.exec(`ALTER TABLE snapshots ADD COLUMN overlay_unit_uris_json TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_snap_parent ON snapshots(parent_snapshot_id)`);
  }
  if (from < 3) {
    // v2 → v3: add Step 7a cluster columns (importance,
    // entryPointIds, labelTier). Discovered as a silent
    // regression during Step 8a's double-check: the
    // persistence layer dropped these fields on save, so
    // cached snapshots loaded with `unknown` tiers + no
    // entry points + no importance. Step 8b's `graph.ask`
    // + Studio ★ rendering depend on them. Idempotent
    // ALTER TABLE pattern matching v1→v2.
    const cols = (db.pragma("table_info(clusters)") as { name: string }[])
      .map((c) => c.name);
    if (!cols.includes("importance_json")) {
      db.exec(`ALTER TABLE clusters ADD COLUMN importance_json TEXT`);
    }
    if (!cols.includes("entry_point_ids_json")) {
      db.exec(`ALTER TABLE clusters ADD COLUMN entry_point_ids_json TEXT`);
    }
    if (!cols.includes("label_tier")) {
      db.exec(`ALTER TABLE clusters ADD COLUMN label_tier TEXT`);
    }
  }
  // Future migrations: if (from < 4) { ... } etc.
}

export function openStore(dbPath: string): GraphStore {
  mkdirSync(dirname(dbPath), { recursive: true });

  let db: Database.Database;
  try {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const userVersion = db.pragma("user_version", { simple: true }) as number;
    if (userVersion === 0) {
      // Fresh DB — run the full schema.sql which already has the
      // v2 shape (parent_snapshot_id + overlay_unit_uris_json on
      // the CREATE TABLE statement + idx_snap_parent).
      db.exec(readSchemaSql());
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    } else if (userVersion < SCHEMA_VERSION) {
      // In-place migration. Each step is idempotent + bounded; if
      // any step fails the catch block below tears the DB down +
      // recreates (safety net).
      migrateInPlace(db, userVersion);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      logger.info("graph-store", `migrated DB ${dbPath} from v${userVersion} to v${SCHEMA_VERSION}`);
    }
  } catch (err) {
    logger.warn("graph-store", `corrupt or unusable DB at ${dbPath}, recreating: ${err instanceof Error ? err.message : String(err)}`);
    try { unlinkSync(dbPath); } catch { /* may not exist */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* */ }
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(readSchemaSql());
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  const stmts = {
    ensureWorkspace: db.prepare(
      `INSERT INTO workspaces (path, name, created_at, last_accessed)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET last_accessed = excluded.last_accessed`
    ),
    findSnapshot: db.prepare(
      `SELECT id FROM snapshots
       WHERE workspace_path = ? AND git_sha = ?
         AND extractor_version_hash = ? AND bridges_version_hash = ?`
    ),
    findSnapshotBySha: db.prepare(
      `SELECT id FROM snapshots
       WHERE workspace_path = ? AND git_sha = ?
       ORDER BY last_accessed DESC LIMIT 1`
    ),
    insertSnapshot: db.prepare(
      `INSERT INTO snapshots (workspace_path, git_sha, extractor_version_hash,
         bridges_version_hash, wire_format_version, node_count, edge_count,
         size_bytes, created_at, last_accessed,
         parent_snapshot_id, overlay_unit_uris_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    insertNode: db.prepare(
      `INSERT OR IGNORE INTO nodes (snapshot_id, repo_uri, node_id, kind, name, locator,
         file_path, start_line, end_line, body_fp, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    insertEdge: db.prepare(
      `INSERT OR IGNORE INTO edges (snapshot_id, edge_id, src_node_id, dst_node_id,
         repo_uri, relation, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    insertCluster: db.prepare(
      `INSERT INTO clusters (snapshot_id, cluster_id, repo_uri, name, node_ids_json,
         importance_json, entry_point_ids_json, label_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    touchSnapshot: db.prepare(
      `UPDATE snapshots SET last_accessed = ? WHERE id = ?`
    ),
    loadNodes: db.prepare(
      `SELECT * FROM nodes WHERE snapshot_id = ?`
    ),
    loadEdges: db.prepare(
      `SELECT * FROM edges WHERE snapshot_id = ?`
    ),
    loadClusters: db.prepare(
      `SELECT * FROM clusters WHERE snapshot_id = ?`
    ),
    snapshotMeta: db.prepare(
      `SELECT id, git_sha, extractor_version_hash, bridges_version_hash,
              created_at, last_accessed, node_count, edge_count, size_bytes,
              parent_snapshot_id, overlay_unit_uris_json
       FROM snapshots WHERE workspace_path = ?
       ORDER BY last_accessed DESC`
    ),
    deleteSnap: db.prepare(
      `DELETE FROM snapshots WHERE id = ?`
    ),
    countPerWorkspace: db.prepare(
      `SELECT COUNT(*) as cnt FROM snapshots WHERE workspace_path = ?`
    ),
    // Step 6: LRU eviction MUST NOT evict a snapshot that has
    // descendants — otherwise the ON DELETE CASCADE wipes the
    // chain and the cache loses more than the count says it
    // should. We evict only leaves (snapshots with no children)
    // sorted by last_accessed ascending.
    oldestLeavesPerWorkspace: db.prepare(
      `SELECT id FROM snapshots s
       WHERE workspace_path = ?
         AND NOT EXISTS (
           SELECT 1 FROM snapshots c WHERE c.parent_snapshot_id = s.id
         )
       ORDER BY last_accessed ASC LIMIT ?`
    ),
    totalBytes: db.prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) as total FROM snapshots`
    ),
    // Step 6: same leaf-only constraint applies to global LRU.
    oldestLeavesGlobal: db.prepare(
      `SELECT id, size_bytes FROM snapshots s
       WHERE NOT EXISTS (
         SELECT 1 FROM snapshots c WHERE c.parent_snapshot_id = s.id
       )
       ORDER BY last_accessed ASC LIMIT ?`
    ),
    snapshotById: db.prepare(
      `SELECT wire_format_version, parent_snapshot_id, overlay_unit_uris_json
       FROM snapshots WHERE id = ?`
    ),
    snapshotMetaById: db.prepare(
      `SELECT id, workspace_path, parent_snapshot_id, overlay_unit_uris_json
       FROM snapshots WHERE id = ?`
    ),
    distinctRepoUris: db.prepare(
      `SELECT DISTINCT repo_uri FROM nodes WHERE snapshot_id = ?`
    ),
    findParentForWorkspace: db.prepare(
      // Latest base+overlay leaf for the same workspace, regardless of
      // git_sha. The leaf is the most-recently-accessed snapshot.
      `SELECT id FROM snapshots WHERE workspace_path = ?
       ORDER BY last_accessed DESC LIMIT 1`
    ),
  };

  function estimateSize(graph: MultiRepoGraph): number {
    let bytes = 0;
    for (const repo of graph.repos) {
      for (const n of repo.nodes) bytes += 200 + n.name.length + (n.locator?.length ?? 0) + (n.filePath?.length ?? 0);
      for (const e of repo.edges) bytes += 150 + (e.id?.length ?? 0);
      for (const c of repo.clusters) bytes += 100 + c.nodeIds.length * 20;
    }
    return bytes;
  }

  function saveSnapshot(
    key: CacheKey,
    graph: MultiRepoGraph,
    opts?: SaveOptions,
  ): SaveResult {
    const now = Date.now();
    const mode = opts?.mode ?? "auto";

    const save = db.transaction((): SaveResult => {
      stmts.ensureWorkspace.run(
        key.workspacePath,
        key.workspacePath.split("/").pop() ?? key.workspacePath,
        now, now,
      );

      // Reuse-existing-key path (idempotent): same (workspace,
      // git_sha, extractor_hash, bridges_hash) → return existing row.
      const existing = stmts.findSnapshot.get(
        key.workspacePath, key.gitSha,
        key.extractorVersionHash, key.bridgesVersionHash,
      ) as { id: number } | undefined;
      if (existing) {
        stmts.touchSnapshot.run(now, existing.id);
        const depth = chainDepth(existing.id);
        return {
          id: existing.id,
          written: false,
          kind: "none",
          overlayUnits: [],
          chainDepth: depth,
        };
      }

      // Decide base vs overlay. `mode: "auto"` looks for the most
      // recently-accessed snapshot for the same workspace and uses
      // it as the parent IF its chain depth is below the bound;
      // otherwise materialises a fresh base.
      let parentId: number | null = null;
      if (mode === "overlay") {
        if (opts?.parentSnapshotId === undefined) {
          throw new Error("saveSnapshot mode='overlay' requires parentSnapshotId");
        }
        parentId = opts.parentSnapshotId;
      } else if (mode === "auto") {
        const parentRow = stmts.findParentForWorkspace.get(
          key.workspacePath,
        ) as { id: number } | undefined;
        if (parentRow) {
          const parentDepth = chainDepth(parentRow.id);
          if (parentDepth < MAX_OVERLAY_CHAIN_DEPTH - 1) {
            parentId = parentRow.id;
          } else {
            logger.info(
              "graph-store",
              `overlay chain depth ${parentDepth} ≥ ${MAX_OVERLAY_CHAIN_DEPTH - 1}; materialising fresh base`,
            );
          }
        }
      }

      // Resolve the parent graph (if any) to compute overlay units.
      // Per research/27 §7.5: a unit is `repoUri:filePath` and an
      // overlay supersedes the parent's facts for that unit.
      let overlayUnits: readonly string[] = [];
      if (parentId !== null) {
        const parentGraph = loadGraphFromSnapshot(parentId);
        if (parentGraph) {
          overlayUnits = computeOverlayUnits(parentGraph, graph);
          // L5 early cutoff (research/27 §6.3 + §7.5): if no file
          // unit changed (overlayUnits empty) AND no edges crossed
          // a unit boundary, skip the overlay write entirely. Just
          // touch the parent's last_accessed so LRU keeps it warm.
          if (overlayUnits.length === 0) {
            stmts.touchSnapshot.run(now, parentId);
            const depth = chainDepth(parentId);
            return {
              id: parentId,
              written: false,
              kind: "none",
              overlayUnits: [],
              chainDepth: depth,
            };
          }
        } else {
          // Parent vanished (shouldn't happen — ON DELETE CASCADE
          // would have wiped this code path). Fall back to base.
          parentId = null;
        }
      }

      // Compute counts + size from the FULL graph (the snapshot
      // table holds the merged-graph size for stats; the
      // nodes/edges rows hold only the overlay's contribution
      // when this is an overlay snapshot).
      const nodeCount = graph.repos.reduce((s, r) => s + r.nodes.length, 0);
      const edgeCount = graph.repos.reduce((s, r) => s + r.edges.length, 0);
      const sizeBytes = estimateSize(graph);

      const overlayJson = parentId !== null
        ? JSON.stringify(overlayUnits)
        : null;
      const info = stmts.insertSnapshot.run(
        key.workspacePath, key.gitSha,
        key.extractorVersionHash, key.bridgesVersionHash,
        graph.version, nodeCount, edgeCount, sizeBytes, now, now,
        parentId, overlayJson,
      );
      const snapId = Number(info.lastInsertRowid);

      // For an overlay, only persist nodes/edges/clusters whose
      // file unit is in `overlayUnits` — that's the "new facts"
      // half of the Glean pattern. Files NOT in the unit set are
      // resolved from the parent at load time.
      const unitSet = parentId !== null ? new Set(overlayUnits) : null;
      for (const repo of graph.repos) {
        for (const n of repo.nodes) {
          if (unitSet && n.filePath && !unitSet.has(`${repo.uri}:${n.filePath}`)) {
            continue;
          }
          stmts.insertNode.run(
            snapId, repo.uri, n.id, n.kind, n.name, n.locator,
            n.filePath ?? null, n.startLine ?? null, n.endLine ?? null,
            n.bodyFingerprint ?? null,
            n.meta ? JSON.stringify(n.meta) : null,
          );
        }
        for (const e of repo.edges) {
          // Edges are persisted on the overlay if EITHER endpoint's
          // source node sits in an overlay unit. This avoids the
          // edge-orphan problem when an overlay only changes one
          // side of a contract.
          if (unitSet) {
            const sourceNode = repo.nodes.find((n) => n.id === e.source);
            const targetNode = repo.nodes.find((n) => n.id === e.target);
            const sourceUnit = sourceNode?.filePath
              ? `${repo.uri}:${sourceNode.filePath}`
              : null;
            const targetUnit = targetNode?.filePath
              ? `${repo.uri}:${targetNode.filePath}`
              : null;
            const inUnit =
              (sourceUnit !== null && unitSet.has(sourceUnit)) ||
              (targetUnit !== null && unitSet.has(targetUnit));
            if (!inUnit) continue;
          }
          stmts.insertEdge.run(
            snapId, e.id, e.source, e.target, repo.uri, e.relation,
            e.meta ? JSON.stringify(e.meta) : null,
          );
        }
        for (const c of repo.clusters) {
          // Clusters are always written on the overlay (they're
          // computed at the workspace level, not per-file). The
          // load path overwrites the parent's clusters with the
          // overlay's whenever the overlay has clusters.
          stmts.insertCluster.run(
            snapId, c.id, repo.uri, c.name,
            JSON.stringify(c.nodeIds),
            c.importance ? JSON.stringify(c.importance) : null,
            c.entryPointIds ? JSON.stringify(c.entryPointIds) : null,
            c.labelTier ?? null,
          );
        }
      }

      const finalDepth = chainDepth(snapId);
      return {
        id: snapId,
        written: true,
        kind: parentId !== null ? "overlay" : "base",
        overlayUnits,
        chainDepth: finalDepth,
      };
    });

    const result = save();
    evictLRU();
    return result;
  }

  /** Walk the parent chain from leaf to base. Returns ids in
   *  [leaf, parent, grandparent, ..., base] order. The chain is
   *  bounded by MAX_OVERLAY_CHAIN_DEPTH + 1 (defensive: if we ever
   *  end up with a longer chain it means a migration / external
   *  edit; we cap to avoid infinite loops). */
  function getChain(snapshotId: number): readonly number[] {
    const ids: number[] = [];
    let cur: number | null = snapshotId;
    const guard = MAX_OVERLAY_CHAIN_DEPTH + 5;
    let steps = 0;
    while (cur !== null && steps < guard) {
      ids.push(cur);
      const row = stmts.snapshotMetaById.get(cur) as
        | { parent_snapshot_id: number | null }
        | undefined;
      if (!row) break;
      cur = row.parent_snapshot_id;
      steps++;
    }
    return ids;
  }

  function chainDepth(snapshotId: number): number {
    return getChain(snapshotId).length - 1;
  }

  /** Load the rows owned by a single snapshot id WITHOUT walking
   *  the chain. Used as the per-overlay primitive. */
  function loadSingleRows(snapId: number): {
    repoUris: string[];
    nodes: ReturnType<typeof rowToNode>[];
    edges: ReturnType<typeof rowToEdge>[];
    clusters: ReturnType<typeof rowToCluster>[];
  } {
    const repoUris = (stmts.distinctRepoUris.all(snapId) as { repo_uri: string }[]).map(
      (r) => r.repo_uri,
    );
    const nodeRows = stmts.loadNodes.all(snapId) as Parameters<typeof rowToNode>[0][];
    const edgeRows = stmts.loadEdges.all(snapId) as Parameters<typeof rowToEdge>[0][];
    const clusterRows = stmts.loadClusters.all(snapId) as Parameters<typeof rowToCluster>[0][];
    return {
      repoUris,
      nodes: nodeRows.map(rowToNode),
      edges: edgeRows.map(rowToEdge),
      clusters: clusterRows.map(rowToCluster),
    };
  }

  function loadGraphFromSnapshot(snapId: number): MultiRepoGraph | null {
    const snapRow = stmts.snapshotById.get(snapId) as
      | {
          wire_format_version: string;
          parent_snapshot_id: number | null;
          overlay_unit_uris_json: string | null;
        }
      | undefined;
    if (!snapRow) return null;

    const now = Date.now();
    stmts.touchSnapshot.run(now, snapId);

    // Walk the parent chain from base → leaf. Step 6: each overlay
    // supersedes its parent's facts for the units in
    // `overlayUnitUris`. We accumulate by replaying overlays from
    // oldest (base) to newest (leaf) so the final result is the
    // leaf's view of the workspace.
    const chainAscending: number[] = [...getChain(snapId)].reverse();
    if (chainAscending.length === 0) return null;

    type Acc = {
      repoUris: Set<string>;
      nodesByRepo: Map<string, Map<string, GraphNode>>;
      edgesByRepo: Map<string, Map<string, GraphEdge>>;
      clustersByRepo: Map<string, Map<string, Cluster>>;
    };
    const acc: Acc = {
      repoUris: new Set(),
      nodesByRepo: new Map(),
      edgesByRepo: new Map(),
      clustersByRepo: new Map(),
    };

    for (let i = 0; i < chainAscending.length; i++) {
      const layerId = chainAscending[i]!;
      const layerRow = stmts.snapshotMetaById.get(layerId) as
        | { overlay_unit_uris_json: string | null }
        | undefined;
      const unitSet: Set<string> | null = (() => {
        if (!layerRow?.overlay_unit_uris_json) return null;
        try {
          const arr = JSON.parse(layerRow.overlay_unit_uris_json) as string[];
          return new Set(arr);
        } catch {
          return null;
        }
      })();

      const layer = loadSingleRows(layerId);

      // For an overlay (unitSet !== null), evict accumulated
      // nodes/edges whose repoUri:filePath is in the unit set, then
      // splat in the overlay's contribution.
      if (unitSet !== null) {
        for (const [uri, nodeMap] of acc.nodesByRepo) {
          for (const [nodeId, node] of nodeMap) {
            if (node.filePath && unitSet.has(`${uri}:${node.filePath}`)) {
              nodeMap.delete(nodeId);
            }
          }
        }
        for (const [uri, edgeMap] of acc.edgesByRepo) {
          const nodeMap = acc.nodesByRepo.get(uri) ?? new Map<string, GraphNode>();
          // After node eviction above, edges that reference an
          // evicted node are orphans — drop them too. They'll be
          // re-added by the overlay's edge insertions below if the
          // overlay re-establishes them.
          for (const [edgeId, edge] of edgeMap) {
            if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
              edgeMap.delete(edgeId);
            }
          }
        }
        // Clusters: any overlay that includes any cluster row
        // replaces clusters wholesale per repo (they're computed
        // at workspace scope; partial replacement would be
        // semantically incoherent).
        const overlayRepoClusters = new Map<string, boolean>();
        for (const c of layer.clusters) {
          overlayRepoClusters.set(c.repoUri, true);
        }
        for (const uri of overlayRepoClusters.keys()) {
          acc.clustersByRepo.set(uri, new Map());
        }
      }

      // Splat layer contributions.
      for (const uri of layer.repoUris) acc.repoUris.add(uri);
      for (const n of layer.nodes) {
        acc.repoUris.add(n.repoUri);
        let nodeMap = acc.nodesByRepo.get(n.repoUri);
        if (!nodeMap) { nodeMap = new Map(); acc.nodesByRepo.set(n.repoUri, nodeMap); }
        nodeMap.set(n.node.id, n.node);
      }
      for (const e of layer.edges) {
        acc.repoUris.add(e.repoUri);
        let edgeMap = acc.edgesByRepo.get(e.repoUri);
        if (!edgeMap) { edgeMap = new Map(); acc.edgesByRepo.set(e.repoUri, edgeMap); }
        edgeMap.set(e.edge.id, e.edge);
      }
      for (const c of layer.clusters) {
        acc.repoUris.add(c.repoUri);
        let clusterMap = acc.clustersByRepo.get(c.repoUri);
        if (!clusterMap) { clusterMap = new Map(); acc.clustersByRepo.set(c.repoUri, clusterMap); }
        clusterMap.set(c.cluster.id, c.cluster);
      }
    }

    const repos: RepoSubgraph[] = [...acc.repoUris].map((uri) => ({
      uri,
      nodes: [...(acc.nodesByRepo.get(uri)?.values() ?? [])],
      edges: [...(acc.edgesByRepo.get(uri)?.values() ?? [])],
      clusters: [...(acc.clustersByRepo.get(uri)?.values() ?? [])],
    }));

    return {
      version: snapRow.wire_format_version as `${number}.${number}`,
      repos,
      interRepoEdges: [],
    };
  }

  function rowToNode(n: {
    repo_uri: string; node_id: string; kind: string; name: string;
    locator: string; file_path: string | null; start_line: number | null;
    end_line: number | null; body_fp: number | null; meta_json: string | null;
  }) {
    const node: GraphNode = {
      id: n.node_id, kind: n.kind, name: n.name, locator: n.locator,
      filePath: n.file_path ?? undefined,
      startLine: n.start_line ?? undefined,
      endLine: n.end_line ?? undefined,
      bodyFingerprint: n.body_fp ?? undefined,
      meta: n.meta_json ? JSON.parse(n.meta_json) : undefined,
    };
    return { repoUri: n.repo_uri, node };
  }

  function rowToEdge(e: {
    repo_uri: string; edge_id: string; src_node_id: string; dst_node_id: string;
    relation: string; meta_json: string | null;
  }) {
    const edge: GraphEdge = {
      id: e.edge_id, source: e.src_node_id, target: e.dst_node_id,
      relation: e.relation,
      meta: e.meta_json ? JSON.parse(e.meta_json) : undefined,
    };
    return { repoUri: e.repo_uri, edge };
  }

  function rowToCluster(c: {
    repo_uri: string; cluster_id: string; name: string; node_ids_json: string;
    importance_json: string | null;
    entry_point_ids_json: string | null;
    label_tier: string | null;
  }) {
    // Step 7a fields restored by the v2→v3 schema fix. Use
    // conditional spread (rather than `field: undefined`) so
    // `exactOptionalPropertyTypes: true` is honoured —
    // legacy rows produce a Cluster without the optional
    // fields, fresh rows produce one with them.
    const cluster: Cluster = {
      id: c.cluster_id, name: c.name,
      nodeIds: JSON.parse(c.node_ids_json) as string[],
      ...(c.importance_json
        ? { importance: JSON.parse(c.importance_json) as Record<string, number> }
        : {}),
      ...(c.entry_point_ids_json
        ? { entryPointIds: JSON.parse(c.entry_point_ids_json) as string[] }
        : {}),
      ...(c.label_tier
        ? { labelTier: c.label_tier as ClusterLabelTier }
        : {}),
    };
    return { repoUri: c.repo_uri, cluster };
  }

  function loadSnapshot(key: CacheKey): MultiRepoGraph | null {
    const row = stmts.findSnapshot.get(
      key.workspacePath, key.gitSha,
      key.extractorVersionHash, key.bridgesVersionHash,
    ) as { id: number } | undefined;
    if (!row) return null;
    return loadGraphFromSnapshot(row.id);
  }

  function loadSnapshotBySha(workspacePath: string, gitSha: string): MultiRepoGraph | null {
    const row = stmts.findSnapshotBySha.get(workspacePath, gitSha) as { id: number } | undefined;
    if (!row) return null;
    return loadGraphFromSnapshot(row.id);
  }

  function listSnapshots(workspacePath: string): SnapshotMeta[] {
    const rows = stmts.snapshotMeta.all(workspacePath) as {
      id: number; git_sha: string; extractor_version_hash: string;
      bridges_version_hash: string; created_at: number; last_accessed: number;
      node_count: number; edge_count: number; size_bytes: number;
      parent_snapshot_id: number | null;
      overlay_unit_uris_json: string | null;
    }[];
    return rows.map((r) => {
      let overlayUnits: readonly string[] = [];
      if (r.overlay_unit_uris_json) {
        try {
          overlayUnits = JSON.parse(r.overlay_unit_uris_json) as string[];
        } catch { overlayUnits = []; }
      }
      return {
        id: r.id,
        gitSha: r.git_sha,
        extractorVersionHash: r.extractor_version_hash,
        bridgesVersionHash: r.bridges_version_hash,
        createdAt: r.created_at,
        lastAccessed: r.last_accessed,
        nodeCount: r.node_count,
        edgeCount: r.edge_count,
        sizeBytes: r.size_bytes,
        parentSnapshotId: r.parent_snapshot_id,
        overlayUnits,
      };
    });
  }

  function deleteSnapshot(id: number): boolean {
    const info = stmts.deleteSnap.run(id);
    return info.changes > 0;
  }

  function evictLRU(): EvictionReport {
    let snapshotsEvicted = 0;
    let bytesFreed = 0;

    const evict = db.transaction(() => {
      // Step 6: only leaf snapshots are candidates for LRU
      // eviction. A snapshot with descendants would CASCADE-delete
      // its chain on removal, wiping the cache silently. We
      // iteratively evict leaves until either the cap is met OR
      // no more leaves are available; pathologically deep chains
      // are bounded by MAX_OVERLAY_CHAIN_DEPTH (chain depth
      // materialisation in saveSnapshot keeps chains short).
      const workspaces = db.prepare(`SELECT DISTINCT workspace_path FROM snapshots`).all() as { workspace_path: string }[];
      for (const ws of workspaces) {
        // Iterate so each new leaf surfaced (after deleting the
        // previous leaf) gets a chance to be evicted.
        for (;;) {
          const cnt = (stmts.countPerWorkspace.get(ws.workspace_path) as { cnt: number }).cnt;
          if (cnt <= MAX_SNAPSHOTS_PER_WORKSPACE) break;
          const toEvict = cnt - MAX_SNAPSHOTS_PER_WORKSPACE;
          const rows = stmts.oldestLeavesPerWorkspace.all(
            ws.workspace_path, toEvict,
          ) as { id: number }[];
          if (rows.length === 0) {
            // All remaining snapshots have descendants — nothing
            // safe to evict. The chain-depth cap in
            // saveSnapshot prevents this in practice.
            break;
          }
          for (const r of rows) {
            stmts.deleteSnap.run(r.id);
            snapshotsEvicted++;
          }
        }
      }

      const total = (stmts.totalBytes.get() as { total: number }).total;
      if (total > MAX_TOTAL_BYTES) {
        let excess = total - MAX_TOTAL_BYTES;
        const batch = 10;
        while (excess > 0) {
          const rows = stmts.oldestLeavesGlobal.all(batch) as { id: number; size_bytes: number }[];
          if (rows.length === 0) break;
          for (const r of rows) {
            stmts.deleteSnap.run(r.id);
            excess -= r.size_bytes;
            bytesFreed += r.size_bytes;
            snapshotsEvicted++;
          }
        }
      }
    });

    evict();
    return { snapshotsEvicted, bytesFreed };
  }

  return {
    saveSnapshot,
    loadSnapshot,
    loadSnapshotBySha,
    listSnapshots,
    deleteSnapshot,
    evictLRU,
    getChain,
    close() { db.close(); },
  };
}

/** Per `architecture/v1-launch-plan.md` Step 6 + research/27 §7.5.
 *
 *  Compute the per-file overlay units that need to ride on a new
 *  overlay snapshot relative to a parent graph. A unit is
 *  `repoUri:filePath`. A file is included in the unit set iff:
 *  - it has any new / modified / removed nodes vs the parent, OR
 *  - it has any new / modified / removed edges (by endpoint
 *    file) vs the parent.
 *
 *  Pure function; exported for testability. Empty result means the
 *  overlay would be a no-op → L5 early cutoff in `saveSnapshot`
 *  skips the write entirely. */
export function computeOverlayUnits(
  parent: MultiRepoGraph,
  current: MultiRepoGraph,
): string[] {
  const units = new Set<string>();

  // Per-repo, build node-by-id maps from the parent so we can
  // detect adds / removes / modifications quickly. A modification
  // is signalled by any of {kind, name, locator, filePath,
  // startLine, endLine, bodyFingerprint} differing.
  for (const currentRepo of current.repos) {
    const parentRepo = parent.repos.find((r) => r.uri === currentRepo.uri);
    const parentNodes = new Map(
      (parentRepo?.nodes ?? []).map((n) => [n.id, n] as const),
    );
    const currentNodes = new Map(currentRepo.nodes.map((n) => [n.id, n] as const));

    // Added or modified
    for (const [id, node] of currentNodes) {
      const fromParent = parentNodes.get(id);
      if (!fromParent) {
        if (node.filePath) units.add(`${currentRepo.uri}:${node.filePath}`);
        continue;
      }
      if (
        fromParent.kind !== node.kind ||
        fromParent.name !== node.name ||
        fromParent.locator !== node.locator ||
        fromParent.filePath !== node.filePath ||
        fromParent.startLine !== node.startLine ||
        fromParent.endLine !== node.endLine ||
        fromParent.bodyFingerprint !== node.bodyFingerprint
      ) {
        // Both the OLD file (so the stale entry can be evicted)
        // and the NEW file (in case of a move) are in-scope.
        if (fromParent.filePath) units.add(`${currentRepo.uri}:${fromParent.filePath}`);
        if (node.filePath) units.add(`${currentRepo.uri}:${node.filePath}`);
      }
    }

    // Removed
    for (const [id, node] of parentNodes) {
      if (!currentNodes.has(id)) {
        if (node.filePath) units.add(`${currentRepo.uri}:${node.filePath}`);
      }
    }

    // Edges: any edge whose source / target node sits in a file
    // already in the unit set is covered; what's left is edges
    // whose endpoints are in unchanged files but the edge itself
    // is new / removed / relation-changed. We resolve endpoint
    // files from the CURRENT graph's nodes since the overlay's
    // edge set is computed against current.
    const parentEdges = new Map(
      (parentRepo?.edges ?? []).map((e) => [e.id, e] as const),
    );
    const currentEdges = new Map(currentRepo.edges.map((e) => [e.id, e] as const));
    const nodeIdToFile = new Map<string, string | undefined>();
    for (const n of currentRepo.nodes) nodeIdToFile.set(n.id, n.filePath);

    for (const [id, edge] of currentEdges) {
      const fromParent = parentEdges.get(id);
      const isNew = !fromParent;
      const relChanged = fromParent && fromParent.relation !== edge.relation;
      if (isNew || relChanged) {
        const sourceFile = nodeIdToFile.get(edge.source);
        const targetFile = nodeIdToFile.get(edge.target);
        if (sourceFile) units.add(`${currentRepo.uri}:${sourceFile}`);
        if (targetFile) units.add(`${currentRepo.uri}:${targetFile}`);
      }
    }
    for (const [id, edge] of parentEdges) {
      if (!currentEdges.has(id)) {
        // Edge removed: include endpoint files (resolved from
        // parent so we get the right file even if a node also
        // moved).
        const parentNodeIdToFile = new Map<string, string | undefined>();
        for (const n of parentRepo?.nodes ?? []) parentNodeIdToFile.set(n.id, n.filePath);
        const sourceFile = parentNodeIdToFile.get(edge.source);
        const targetFile = parentNodeIdToFile.get(edge.target);
        if (sourceFile) units.add(`${currentRepo.uri}:${sourceFile}`);
        if (targetFile) units.add(`${currentRepo.uri}:${targetFile}`);
      }
    }
  }

  return [...units].sort();
}

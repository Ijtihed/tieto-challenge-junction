// Per `architecture/v1-launch-plan.md` Step 6 + research/27 §§5.5,
// 7.5, 8 (stacked-overlay + Iceberg/Delta change-query taxonomy).
//
// Unit + integration coverage for the stacked-overlay storage:
// - Schema migration v1 → v2 (idempotent + lossless)
// - `computeOverlayUnits` correctness (per-file unit set)
// - `saveSnapshot({mode: "auto"})` chooses base vs overlay
// - L5 early cutoff fires when overlay units empty
// - `loadGraphFromSnapshot` walks the chain correctly
// - Chain depth bounded at MAX_OVERLAY_CHAIN_DEPTH (50)
// - `graph.list_snapshots` returns chains
// - `graph.delete_snapshot` cascade
// - `applyChangeQueryMode` for all 4 modes
//
// Each describe block targets a specific contract surface; the
// adversarial verification pass (§0.6.4) mutates each gate to
// confirm it has teeth.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  openStore,
  computeOverlayUnits,
  type CacheKey,
} from "../domain/persistence/store.ts";
import type { MultiRepoGraph } from "../domain/multi-repo.ts";
import {
  applyChangeQueryMode,
  CHANGE_QUERY_MODES,
  type ChangeQueryMode,
  type GraphDelta,
  type NodeDelta,
} from "../domain/delta.ts";
import { collectDescendants } from "../actions/graph-delete-snapshot.ts";
import { buildSnapshotChains } from "../actions/graph-list-snapshots.ts";

const KEY: CacheKey = {
  workspacePath: "/test/repo-overlay",
  gitSha: "a".repeat(40),
  extractorVersionHash: "ext",
  bridgesVersionHash: "bridges",
};

function makeKey(sha: string): CacheKey {
  return { ...KEY, gitSha: sha + "0".repeat(40 - sha.length) };
}

function makeGraph(nodes: { id: string; file: string; bodyFp?: number }[],
                   edges: { id: string; src: string; dst: string }[]): MultiRepoGraph {
  return {
    version: "0.0",
    repos: [{
      uri: "file:///repo",
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: "function",
        name: n.id,
        locator: `file:///repo/${n.file}#${n.id}`,
        filePath: n.file,
        bodyFingerprint: n.bodyFp ?? 1,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.src,
        target: e.dst,
        relation: "calls",
      })),
      clusters: [],
    }],
    interRepoEdges: [],
  };
}

// ──────────────────────────────────────────────────────────
// Schema migration v1 → v2: idempotent ALTER on existing DBs.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: schema migration v1 → v2", () => {
  it("upgrades a v1 DB in-place without dropping snapshots", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-mig-")), "graph.db");

    // Build a v1 DB by hand: create the old-shape schema +
    // pragma user_version = 1, insert one snapshot row.
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE workspaces (
        path TEXT PRIMARY KEY, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_accessed INTEGER NOT NULL
      );
      CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_path TEXT NOT NULL REFERENCES workspaces(path),
        git_sha TEXT NOT NULL,
        extractor_version_hash TEXT NOT NULL,
        bridges_version_hash TEXT NOT NULL,
        wire_format_version TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        edge_count INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        UNIQUE(workspace_path, git_sha, extractor_version_hash, bridges_version_hash)
      );
      CREATE TABLE nodes (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        repo_uri TEXT NOT NULL, node_id TEXT NOT NULL,
        kind TEXT NOT NULL, name TEXT NOT NULL, locator TEXT NOT NULL,
        file_path TEXT, start_line INTEGER, end_line INTEGER,
        body_fp INTEGER, meta_json TEXT,
        PRIMARY KEY (snapshot_id, node_id)
      );
      CREATE TABLE edges (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        edge_id TEXT NOT NULL, src_node_id TEXT NOT NULL, dst_node_id TEXT NOT NULL,
        repo_uri TEXT NOT NULL, relation TEXT NOT NULL, meta_json TEXT,
        PRIMARY KEY (snapshot_id, edge_id)
      );
      CREATE TABLE clusters (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        cluster_id TEXT NOT NULL, repo_uri TEXT NOT NULL,
        name TEXT NOT NULL, node_ids_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, cluster_id)
      );
    `);
    db.exec(`INSERT INTO workspaces (path, name, created_at, last_accessed) VALUES ('/test/migr', 'migr', 0, 0)`);
    db.exec(`INSERT INTO snapshots (workspace_path, git_sha, extractor_version_hash, bridges_version_hash, wire_format_version, node_count, edge_count, size_bytes, created_at, last_accessed) VALUES ('/test/migr', 'oldsha', 'ext', 'bridges', '0.0', 1, 0, 100, 0, 0)`);
    db.pragma("user_version = 1");
    db.close();

    // Open via the store: should run migrateInPlace(...) +
    // bump user_version to 2, and the existing snapshot row
    // should survive.
    const store = openStore(dbPath);
    try {
      const snaps = store.listSnapshots("/test/migr");
      assert.equal(snaps.length, 1, "the v1 snapshot survives migration");
      assert.equal(snaps[0]!.gitSha, "oldsha");
      assert.equal(snaps[0]!.parentSnapshotId, null, "migrated snapshot is treated as a base");
      assert.deepEqual(snaps[0]!.overlayUnits, []);

      // Re-opening must be a no-op (migration idempotent).
      store.close();
      const store2 = openStore(dbPath);
      const snaps2 = store2.listSnapshots("/test/migr");
      assert.equal(snaps2.length, 1, "re-open is idempotent");
      store2.close();
    } finally {
      try { store.close(); } catch { /* may already be closed */ }
    }
  });
});

// ──────────────────────────────────────────────────────────
// Schema migration v2 → v3: Step 7a cluster fields restored.
// Surfaced during the Step 8a double-check as a silent bug:
// the `clusters` table dropped `importance`, `entryPointIds`,
// and `labelTier` on save, so cached snapshots loaded with
// none of the Step 7a payload. Step 8b's `graph.ask` +
// Studio's ★ rendering depend on these fields.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: schema migration v2 → v3", () => {
  it("upgrades a v2 DB in-place adding cluster columns + preserves snapshots", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-mig3-")), "graph.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // v2 schema: clusters table WITHOUT the new columns.
    db.exec(`
      CREATE TABLE workspaces (
        path TEXT PRIMARY KEY, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_accessed INTEGER NOT NULL
      );
      CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_path TEXT NOT NULL REFERENCES workspaces(path),
        git_sha TEXT NOT NULL,
        extractor_version_hash TEXT NOT NULL,
        bridges_version_hash TEXT NOT NULL,
        wire_format_version TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        edge_count INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        parent_snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE CASCADE,
        overlay_unit_uris_json TEXT
      );
      CREATE TABLE nodes (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        repo_uri TEXT NOT NULL, node_id TEXT NOT NULL,
        kind TEXT NOT NULL, name TEXT NOT NULL, locator TEXT NOT NULL,
        file_path TEXT, start_line INTEGER, end_line INTEGER,
        body_fp INTEGER, meta_json TEXT,
        PRIMARY KEY (snapshot_id, node_id)
      );
      CREATE TABLE edges (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        edge_id TEXT NOT NULL, src_node_id TEXT NOT NULL, dst_node_id TEXT NOT NULL,
        repo_uri TEXT NOT NULL, relation TEXT NOT NULL, meta_json TEXT,
        PRIMARY KEY (snapshot_id, edge_id)
      );
      CREATE TABLE clusters (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        cluster_id TEXT NOT NULL, repo_uri TEXT NOT NULL,
        name TEXT NOT NULL, node_ids_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, cluster_id)
      );
      CREATE INDEX idx_snap_parent ON snapshots(parent_snapshot_id);
    `);
    db.exec(`INSERT INTO workspaces (path, name, created_at, last_accessed) VALUES ('/test/mig3', 'mig3', 0, 0)`);
    db.exec(`INSERT INTO snapshots (workspace_path, git_sha, extractor_version_hash, bridges_version_hash, wire_format_version, node_count, edge_count, size_bytes, created_at, last_accessed, parent_snapshot_id, overlay_unit_uris_json) VALUES ('/test/mig3', 'sha', 'ext', 'br', '0.0', 1, 0, 100, 0, 0, NULL, NULL)`);
    db.exec(`INSERT INTO clusters (snapshot_id, cluster_id, repo_uri, name, node_ids_json) VALUES (1, 'c1', 'r1', 'LegacyCluster', '["n1"]')`);
    db.pragma("user_version = 2");
    db.close();

    const store = openStore(dbPath);
    try {
      const snaps = store.listSnapshots("/test/mig3");
      assert.equal(snaps.length, 1, "v2 snapshot survives v2→v3 migration");
      assert.equal(snaps[0]!.gitSha, "sha");

      // Probe directly: the new columns must exist post-migration.
      const probe = new Database(dbPath, { readonly: true });
      const cols = (probe.pragma("table_info(clusters)") as { name: string }[]).map((c) => c.name);
      probe.close();
      assert.ok(cols.includes("importance_json"), "importance_json column added");
      assert.ok(cols.includes("entry_point_ids_json"), "entry_point_ids_json column added");
      assert.ok(cols.includes("label_tier"), "label_tier column added");

      // Re-open must be a no-op (idempotent).
      store.close();
      const store2 = openStore(dbPath);
      const snaps2 = store2.listSnapshots("/test/mig3");
      assert.equal(snaps2.length, 1, "re-open is idempotent");
      store2.close();
    } finally {
      try { store.close(); } catch { /* */ }
    }
  });

  it("legacy v2 clusters load with undefined Step 7a fields (no crash)", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-mig3b-")), "graph.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE workspaces (path TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_accessed INTEGER NOT NULL);
      CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_path TEXT NOT NULL REFERENCES workspaces(path), git_sha TEXT NOT NULL, extractor_version_hash TEXT NOT NULL, bridges_version_hash TEXT NOT NULL, wire_format_version TEXT NOT NULL, node_count INTEGER NOT NULL, edge_count INTEGER NOT NULL, size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, last_accessed INTEGER NOT NULL, parent_snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE CASCADE, overlay_unit_uris_json TEXT);
      CREATE TABLE nodes (snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, repo_uri TEXT NOT NULL, node_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, locator TEXT NOT NULL, file_path TEXT, start_line INTEGER, end_line INTEGER, body_fp INTEGER, meta_json TEXT, PRIMARY KEY (snapshot_id, node_id));
      CREATE TABLE edges (snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, edge_id TEXT NOT NULL, src_node_id TEXT NOT NULL, dst_node_id TEXT NOT NULL, repo_uri TEXT NOT NULL, relation TEXT NOT NULL, meta_json TEXT, PRIMARY KEY (snapshot_id, edge_id));
      CREATE TABLE clusters (snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, cluster_id TEXT NOT NULL, repo_uri TEXT NOT NULL, name TEXT NOT NULL, node_ids_json TEXT NOT NULL, PRIMARY KEY (snapshot_id, cluster_id));
    `);
    db.exec(`INSERT INTO workspaces (path, name, created_at, last_accessed) VALUES ('/t', 't', 0, 0)`);
    db.exec(`INSERT INTO snapshots (workspace_path, git_sha, extractor_version_hash, bridges_version_hash, wire_format_version, node_count, edge_count, size_bytes, created_at, last_accessed, parent_snapshot_id, overlay_unit_uris_json) VALUES ('/t', 'sha', 'ext', 'br', '0.0', 1, 0, 100, 0, 0, NULL, NULL)`);
    db.exec(`INSERT INTO nodes (snapshot_id, repo_uri, node_id, kind, name, locator) VALUES (1, 'r1', 'n1', 'service', 'N', 'file:///r1/n1.ts#n1')`);
    db.exec(`INSERT INTO clusters (snapshot_id, cluster_id, repo_uri, name, node_ids_json) VALUES (1, 'c1', 'r1', 'Legacy', '["n1"]')`);
    db.pragma("user_version = 2");
    db.close();

    const store = openStore(dbPath);
    try {
      const key: CacheKey = { workspacePath: "/t", gitSha: "sha", extractorVersionHash: "ext", bridgesVersionHash: "br" };
      const g = store.loadSnapshot(key)!;
      assert.ok(g);
      const cluster = g.repos[0]!.clusters[0]!;
      assert.equal(cluster.name, "Legacy");
      // The new fields must be `undefined` (not crashed, not set).
      assert.equal(cluster.importance, undefined);
      assert.equal(cluster.entryPointIds, undefined);
      assert.equal(cluster.labelTier, undefined);
    } finally {
      store.close();
    }
  });

  it("fresh save with Step 7a fields round-trips correctly", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-mig3c-")), "graph.db");
    const store = openStore(dbPath);
    try {
      const key: CacheKey = { workspacePath: "/r", gitSha: "shaXY", extractorVersionHash: "ext", bridgesVersionHash: "br" };
      const graph: MultiRepoGraph = {
        version: "0.0",
        repos: [{
          uri: "file:///r",
          nodes: [
            { id: "n1", kind: "service", name: "N1", locator: "file:///r/n1.ts#n1" },
            { id: "n2", kind: "utility", name: "N2", locator: "file:///r/n2.ts#n2" },
          ],
          edges: [],
          clusters: [{
            id: "c1",
            name: "Roundtrip",
            nodeIds: ["n1", "n2"],
            importance: { n1: 0.9, n2: 0.1 },
            entryPointIds: ["n1"],
            labelTier: "folder-archetype",
          }],
        }],
        interRepoEdges: [],
      };
      store.saveSnapshot(key, graph);
      const reloaded = store.loadSnapshot(key)!;
      const cluster = reloaded.repos[0]!.clusters[0]!;
      assert.equal(cluster.name, "Roundtrip");
      assert.deepEqual(cluster.importance, { n1: 0.9, n2: 0.1 },
        "importance must round-trip through save+load");
      assert.deepEqual(cluster.entryPointIds, ["n1"],
        "entryPointIds must round-trip");
      assert.equal(cluster.labelTier, "folder-archetype",
        "labelTier must round-trip");
    } finally {
      store.close();
    }
  });
});

// ──────────────────────────────────────────────────────────
// computeOverlayUnits: the per-file unit-set primitive.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: computeOverlayUnits", () => {
  it("empty-vs-empty produces zero units", () => {
    const base = makeGraph([], []);
    const next = makeGraph([], []);
    assert.deepEqual(computeOverlayUnits(base, next), []);
  });

  it("identical graphs produce zero units (L5 early cutoff foundation)", () => {
    const base = makeGraph([{ id: "n1", file: "a.ts" }], []);
    const next = makeGraph([{ id: "n1", file: "a.ts" }], []);
    assert.deepEqual(computeOverlayUnits(base, next), []);
  });

  it("adding a node yields its file unit", () => {
    const base = makeGraph([{ id: "n1", file: "a.ts" }], []);
    const next = makeGraph(
      [{ id: "n1", file: "a.ts" }, { id: "n2", file: "b.ts" }],
      [],
    );
    assert.deepEqual(computeOverlayUnits(base, next), ["file:///repo:b.ts"]);
  });

  it("modifying a node yields its file unit", () => {
    const base = makeGraph([{ id: "n1", file: "a.ts", bodyFp: 1 }], []);
    const next = makeGraph([{ id: "n1", file: "a.ts", bodyFp: 2 }], []);
    assert.deepEqual(computeOverlayUnits(base, next), ["file:///repo:a.ts"]);
  });

  it("moving a node yields BOTH old and new file units", () => {
    const base = makeGraph([{ id: "n1", file: "old.ts" }], []);
    const next = makeGraph([{ id: "n1", file: "new.ts" }], []);
    const units = computeOverlayUnits(base, next);
    assert.deepEqual(units.sort(), [
      "file:///repo:new.ts",
      "file:///repo:old.ts",
    ]);
  });

  it("removing a node yields its file unit", () => {
    const base = makeGraph(
      [{ id: "n1", file: "a.ts" }, { id: "n2", file: "b.ts" }],
      [],
    );
    const next = makeGraph([{ id: "n1", file: "a.ts" }], []);
    assert.deepEqual(computeOverlayUnits(base, next), ["file:///repo:b.ts"]);
  });

  it("adding an edge yields both endpoint file units", () => {
    const base = makeGraph(
      [{ id: "n1", file: "a.ts" }, { id: "n2", file: "b.ts" }],
      [],
    );
    const next = makeGraph(
      [{ id: "n1", file: "a.ts" }, { id: "n2", file: "b.ts" }],
      [{ id: "e1", src: "n1", dst: "n2" }],
    );
    assert.deepEqual(computeOverlayUnits(base, next).sort(), [
      "file:///repo:a.ts",
      "file:///repo:b.ts",
    ]);
  });
});

// ──────────────────────────────────────────────────────────
// saveSnapshot + loadSnapshot: round-trip with overlays.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: save/load roundtrip", () => {
  let dbPath: string;
  let store: ReturnType<typeof openStore>;
  before(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), "so-rt-")), "graph.db");
    store = openStore(dbPath);
  });

  it("first save is a base snapshot", () => {
    const base = makeGraph(
      [{ id: "n1", file: "a.ts" }, { id: "n2", file: "b.ts" }],
      [{ id: "e1", src: "n1", dst: "n2" }],
    );
    const r = store.saveSnapshot(makeKey("b1"), base);
    assert.equal(r.kind, "base");
    assert.equal(r.written, true);
    assert.equal(r.chainDepth, 0);
    assert.deepEqual(r.overlayUnits, []);
  });

  it("second save with same-content graph fires L5 early cutoff", () => {
    // Same graph as the base (just a different git SHA so the
    // unique key changes). The auto-overlay should detect zero
    // overlay units and skip the write entirely.
    const graph = makeGraph(
      [{ id: "n1", file: "a.ts" }, { id: "n2", file: "b.ts" }],
      [{ id: "e1", src: "n1", dst: "n2" }],
    );
    const r = store.saveSnapshot(makeKey("b2"), graph);
    assert.equal(r.kind, "none", "L5 early cutoff fired");
    assert.equal(r.written, false);
    assert.deepEqual(r.overlayUnits, []);
  });

  it("changing one file produces a 1-unit overlay", () => {
    // Modify b.ts (n2's bodyFp changes); a.ts unchanged.
    const graph = makeGraph(
      [{ id: "n1", file: "a.ts" }, { id: "n2", file: "b.ts", bodyFp: 99 }],
      [{ id: "e1", src: "n1", dst: "n2" }],
    );
    const r = store.saveSnapshot(makeKey("b3"), graph);
    assert.equal(r.kind, "overlay");
    assert.equal(r.written, true);
    assert.equal(r.chainDepth, 1);
    // The overlay should carry b.ts AND a.ts because the edge
    // touches both. (Per saveSnapshot: edges across unit
    // boundaries are also in the unit set.)
    assert.ok(r.overlayUnits.includes("file:///repo:b.ts"));
  });

  it("load via key resolves the chain to the latest state", () => {
    const loaded = store.loadSnapshot(makeKey("b3"));
    assert.ok(loaded);
    const nodes = loaded!.repos[0]!.nodes;
    assert.equal(nodes.length, 2);
    const n2 = nodes.find((n) => n.id === "n2");
    assert.equal(n2?.bodyFingerprint, 99, "overlay supersedes parent's n2");
  });

  it("listSnapshots reports the chain structure", () => {
    const snaps = store.listSnapshots(KEY.workspacePath);
    // We have 2 written snapshots: the base (b1) and the
    // overlay (b3). The b2 save was an L5 early-cutoff so
    // didn't add a row.
    assert.equal(snaps.length, 2);
    const base = snaps.find((s) => s.gitSha.startsWith("b1"));
    const overlay = snaps.find((s) => s.gitSha.startsWith("b3"));
    assert.ok(base);
    assert.ok(overlay);
    assert.equal(base!.parentSnapshotId, null);
    assert.equal(overlay!.parentSnapshotId, base!.id);
    assert.ok(overlay!.overlayUnits.length > 0);
  });

  it("getChain walks leaf → base", () => {
    const snaps = store.listSnapshots(KEY.workspacePath);
    const overlay = snaps.find((s) => s.gitSha.startsWith("b3"))!;
    const base = snaps.find((s) => s.gitSha.startsWith("b1"))!;
    const chain = store.getChain(overlay.id);
    assert.deepEqual([...chain], [overlay.id, base.id]);
  });
});

// ──────────────────────────────────────────────────────────
// Chain depth cap: long chains materialise a fresh base at
// MAX_OVERLAY_CHAIN_DEPTH (50).
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: chain depth materialisation", () => {
  it("after MAX_OVERLAY_CHAIN_DEPTH overlays, the next save is a fresh base", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-depth-")), "graph.db");
    const store = openStore(dbPath);
    try {
      // First snapshot: base
      let prev = makeGraph([{ id: "n1", file: "f.ts", bodyFp: 0 }], []);
      const first = store.saveSnapshot(makeKey("d000"), prev);
      assert.equal(first.kind, "base");

      // Push enough overlays to exceed MAX_OVERLAY_CHAIN_DEPTH.
      // Each overlay changes the bodyFp of n1, so units = {f.ts}
      // and the L5 early cutoff doesn't fire.
      let lastWasBase = false;
      for (let i = 1; i <= 55; i++) {
        const graph = makeGraph([{ id: "n1", file: "f.ts", bodyFp: i }], []);
        const r = store.saveSnapshot(makeKey(`d${String(i).padStart(3, "0")}`), graph);
        if (r.kind === "base") {
          lastWasBase = true;
          assert.ok(i >= 49, `materialisation should happen around depth 49, got at i=${i}`);
        }
        prev = graph;
      }
      assert.ok(lastWasBase, "at least one fresh base was materialised within 55 overlays");
    } finally {
      store.close();
    }
  });
});

// ──────────────────────────────────────────────────────────
// collectDescendants: delete-cascade pre-image.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: collectDescendants", () => {
  it("empty input returns empty", () => {
    assert.deepEqual(collectDescendants([], 1), []);
  });

  it("flat list (no parents) returns empty", () => {
    assert.deepEqual(
      collectDescendants(
        [
          { id: 1, parentSnapshotId: null },
          { id: 2, parentSnapshotId: null },
        ],
        1,
      ),
      [],
    );
  });

  it("returns direct children", () => {
    const r = collectDescendants(
      [
        { id: 1, parentSnapshotId: null },
        { id: 2, parentSnapshotId: 1 },
        { id: 3, parentSnapshotId: 1 },
      ],
      1,
    );
    assert.deepEqual(r.sort(), [2, 3]);
  });

  it("returns transitive descendants in DFS order", () => {
    const r = collectDescendants(
      [
        { id: 1, parentSnapshotId: null },
        { id: 2, parentSnapshotId: 1 },
        { id: 3, parentSnapshotId: 2 },
        { id: 4, parentSnapshotId: 3 },
      ],
      1,
    );
    assert.deepEqual(r.sort(), [2, 3, 4]);
  });
});

// ──────────────────────────────────────────────────────────
// ChangeQueryMode: 4-member canonical set + applyChangeQueryMode
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// buildSnapshotChains: pure helper for graph.list_snapshots
// chain construction. Extracted during the §0.6.4 double-check
// pass when a "chain = just the leaf" mutation slipped past
// every other test. This pins the contract.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: buildSnapshotChains", () => {
  it("empty input yields no chains", () => {
    assert.deepEqual(buildSnapshotChains([], () => []), []);
  });

  it("a single base produces one 1-element chain", () => {
    const result = buildSnapshotChains(
      [{ id: 1, parentSnapshotId: null }],
      (id) => [id],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.leafId, 1);
    assert.deepEqual([...result[0]!.ids], [1]);
  });

  it("a 3-snapshot chain yields one chain leaf → base", () => {
    const result = buildSnapshotChains(
      [
        { id: 1, parentSnapshotId: null }, // base
        { id: 2, parentSnapshotId: 1 },    // overlay
        { id: 3, parentSnapshotId: 2 },    // leaf
      ],
      (id) => {
        if (id === 3) return [3, 2, 1];
        if (id === 2) return [2, 1];
        return [1];
      },
    );
    assert.equal(result.length, 1, "exactly 1 chain (one leaf)");
    assert.equal(result[0]!.leafId, 3);
    assert.deepEqual([...result[0]!.ids], [3, 2, 1]);
  });

  it("two independent bases yield two chains", () => {
    const result = buildSnapshotChains(
      [
        { id: 1, parentSnapshotId: null },
        { id: 2, parentSnapshotId: null },
      ],
      (id) => [id],
    );
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((c) => c.leafId).sort(), [1, 2]);
  });

  it("two leaves sharing a base produce two chains (both leaves emit)", () => {
    // base -> a (leaf) AND base -> b (leaf) is "two leaves
    // sharing a base." Both must surface as chains; their ids
    // overlap on the base which is fine.
    const result = buildSnapshotChains(
      [
        { id: 1, parentSnapshotId: null }, // base
        { id: 2, parentSnapshotId: 1 },    // leaf-a
        { id: 3, parentSnapshotId: 1 },    // leaf-b
      ],
      (id) => {
        if (id === 2) return [2, 1];
        if (id === 3) return [3, 1];
        return [1];
      },
    );
    assert.equal(result.length, 2);
    const ids = result.map((c) => c.leafId).sort();
    assert.deepEqual(ids, [2, 3]);
  });

  it("a chain's ids really walk parent links (catches mutation: chain = [leaf])", () => {
    // The mutation that surfaced this test: a future agent
    // replaces store.getChain(id) with `[id]` in the action's
    // chain-construction loop. Pin that ids.length > 1 when
    // the snapshot has a parent.
    const result = buildSnapshotChains(
      [
        { id: 1, parentSnapshotId: null },
        { id: 2, parentSnapshotId: 1 },
      ],
      (id) => {
        if (id === 2) return [2, 1];
        return [1];
      },
    );
    assert.equal(result.length, 1);
    assert.ok(
      result[0]!.ids.length > 1,
      `the leaf's chain MUST walk to the base; got ${[...result[0]!.ids]}`,
    );
  });
});

describe("stacked-overlay: ChangeQueryMode canonical 4-member set per §0.6.2", () => {
  it("has exactly 4 members", () => {
    assert.equal(CHANGE_QUERY_MODES.length, 4);
  });
  it("members are append | upsert | min-delta | full-delta", () => {
    assert.deepEqual([...CHANGE_QUERY_MODES], [
      "append", "upsert", "min-delta", "full-delta",
    ]);
  });
  it("every member is a non-empty string + no duplicates", () => {
    const set = new Set(CHANGE_QUERY_MODES);
    assert.equal(set.size, CHANGE_QUERY_MODES.length);
    for (const m of CHANGE_QUERY_MODES) {
      assert.ok(typeof m === "string" && m.length > 0);
    }
  });
});

describe("stacked-overlay: applyChangeQueryMode", () => {
  function makeDelta(): GraphDelta {
    const nodes: NodeDelta[] = [
      { id: "n-add", status: "added" },
      { id: "n-mod", status: "modified", reasons: ["body"] },
      { id: "n-rem", status: "removed" },
      { id: "n-unch", status: "unchanged" },
    ];
    return {
      nodes,
      edges: [
        { id: "e-add", source: "n-add", target: "n-unch", relation: "calls", status: "added" },
        { id: "e-rem", source: "n-rem", target: "n-unch", relation: "calls", status: "removed" },
        { id: "e-unch", source: "n-unch", target: "n-mod", relation: "calls", status: "unchanged" },
      ],
      interRepoEdges: [
        { id: "ir-add", status: "added" },
        { id: "ir-rem", status: "removed" },
        { id: "ir-unch", status: "unchanged" },
      ],
      counts: { nodesAdded: 1, nodesRemoved: 1, nodesModified: 1, edgesAdded: 1, edgesRemoved: 1 },
    };
  }

  it("append: only added nodes/edges", () => {
    const d = applyChangeQueryMode(makeDelta(), "append");
    assert.deepEqual(d.nodes.map((n) => n.id), ["n-add"]);
    assert.deepEqual(d.edges.map((e) => e.id), ["e-add"]);
    assert.deepEqual(d.interRepoEdges.map((e) => e.id), ["ir-add"]);
  });

  it("upsert: added + modified nodes (no removed); added edges only", () => {
    const d = applyChangeQueryMode(makeDelta(), "upsert");
    assert.deepEqual(d.nodes.map((n) => n.id).sort(), ["n-add", "n-mod"]);
    assert.deepEqual(d.edges.map((e) => e.id), ["e-add"]);
  });

  it("min-delta: drops only unchanged entries", () => {
    const d = applyChangeQueryMode(makeDelta(), "min-delta");
    assert.deepEqual(d.nodes.map((n) => n.id).sort(), ["n-add", "n-mod", "n-rem"]);
    assert.deepEqual(d.edges.map((e) => e.id).sort(), ["e-add", "e-rem"]);
    assert.deepEqual(d.interRepoEdges.map((e) => e.id).sort(), ["ir-add", "ir-rem"]);
  });

  it("full-delta: pass-through (input is structurally equal to output)", () => {
    const input = makeDelta();
    const output = applyChangeQueryMode(input, "full-delta");
    assert.equal(output.nodes.length, 4);
    assert.equal(output.edges.length, 3);
    assert.equal(output.interRepoEdges.length, 3);
  });

  it("counts are preserved across modes (they describe the full delta)", () => {
    for (const mode of CHANGE_QUERY_MODES) {
      const d = applyChangeQueryMode(makeDelta(), mode as ChangeQueryMode);
      assert.equal(d.counts.nodesAdded, 1);
      assert.equal(d.counts.nodesRemoved, 1);
      assert.equal(d.counts.nodesModified, 1);
    }
  });
});

// ──────────────────────────────────────────────────────────
// LRU vs. chain integrity: surfaced by the Step 6 double-check
// pass. The first implementation of Step 6 used the original
// LRU eviction (delete oldest snapshots regardless of children),
// which cascaded through `ON DELETE CASCADE` and silently wiped
// the chain. The fix: only evict leaf snapshots (no children).
// This test pins the contract so a future agent who "simplifies"
// the LRU back to non-leaf eviction gets caught.
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// Cluster wholesale-replacement: when an overlay carries any
// cluster row, it replaces the parent's clusters WHOLESALE per
// repo. Surfaced by the §0.6.4 double-check pass for Step 6:
// the receipts claimed this behaviour but no test pinned it.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: cluster wholesale-replacement", () => {
  it("an overlay's clusters replace the parent's clusters for that repo", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-cluster-")), "graph.db");
    const store = openStore(dbPath);
    try {
      // Base with 2 clusters
      const baseGraph: MultiRepoGraph = {
        version: "0.0",
        repos: [{
          uri: "file:///repo",
          nodes: [
            { id: "n1", kind: "function", name: "n1", locator: "l1", filePath: "a.ts", bodyFingerprint: 1 },
            { id: "n2", kind: "function", name: "n2", locator: "l2", filePath: "b.ts", bodyFingerprint: 2 },
          ],
          edges: [],
          clusters: [
            { id: "c1", name: "Cluster1", nodeIds: ["n1"] },
            { id: "c2", name: "Cluster2", nodeIds: ["n2"] },
          ],
        }],
        interRepoEdges: [],
      };
      store.saveSnapshot(makeKey("clust-base"), baseGraph);

      // Overlay: a.ts changes + a NEW cluster set (just c3)
      const overlayGraph: MultiRepoGraph = {
        version: "0.0",
        repos: [{
          uri: "file:///repo",
          nodes: [
            { id: "n1", kind: "function", name: "n1", locator: "l1", filePath: "a.ts", bodyFingerprint: 99 },
            { id: "n2", kind: "function", name: "n2", locator: "l2", filePath: "b.ts", bodyFingerprint: 2 },
          ],
          edges: [],
          clusters: [
            // base's c1+c2 should be discarded; only c3 remains
            { id: "c3", name: "BrandNew", nodeIds: ["n1", "n2"] },
          ],
        }],
        interRepoEdges: [],
      };
      const r = store.saveSnapshot(makeKey("clust-ov"), overlayGraph);
      assert.equal(r.kind, "overlay");

      const loaded = store.loadSnapshot(makeKey("clust-ov"));
      assert.ok(loaded);
      const clusters = loaded!.repos[0]!.clusters;
      assert.equal(clusters.length, 1, "exactly one cluster after wholesale replacement");
      assert.equal(clusters[0]!.id, "c3", "overlay's cluster survived");
      assert.equal(clusters[0]!.name, "BrandNew");
    } finally {
      store.close();
    }
  });
});

// ──────────────────────────────────────────────────────────
// Edge orphan eviction: when an overlay evicts a node (because
// its file is in the unit set), edges pointing at that node from
// OTHER files must also be dropped from the load.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: edge orphan resolution", () => {
  it("edges pointing at an evicted node are also evicted at load time", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-orphan-")), "graph.db");
    const store = openStore(dbPath);
    try {
      // Base: a.ts has n1; b.ts has n2; edge e1: n1 → n2
      const baseGraph = makeGraph(
        [
          { id: "n1", file: "a.ts" },
          { id: "n2", file: "b.ts" },
        ],
        [{ id: "e1", src: "n1", dst: "n2" }],
      );
      store.saveSnapshot(makeKey("orph-base"), baseGraph);

      // Overlay: a.ts is removed entirely (no n1 at all). b.ts
      // unchanged. n1 is gone → edge e1 (which points at n1)
      // must NOT survive the load.
      const overlayGraph = makeGraph(
        [
          { id: "n2", file: "b.ts" },
        ],
        [], // overlay doesn't write the edge
      );
      const r = store.saveSnapshot(makeKey("orph-ov"), overlayGraph);
      assert.equal(r.kind, "overlay");
      assert.ok(r.overlayUnits.includes("file:///repo:a.ts"), "a.ts is in the unit set");

      const loaded = store.loadSnapshot(makeKey("orph-ov"));
      assert.ok(loaded);
      const nodes = loaded!.repos[0]!.nodes;
      const edges = loaded!.repos[0]!.edges;
      assert.equal(nodes.length, 1, "only n2 survives");
      assert.equal(nodes[0]!.id, "n2");
      // The CRITICAL assertion: e1 must be evicted because n1
      // (its source) was evicted. No orphan edges.
      assert.equal(edges.length, 0, `e1 must be dropped (orphan after n1 evicted), got ${edges.length} edges`);
    } finally {
      store.close();
    }
  });

  it("edges between TWO evicted nodes are also evicted", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-orphan2-")), "graph.db");
    const store = openStore(dbPath);
    try {
      // Base: a.ts has n1; b.ts has n2 + n3; edges e1: n2 → n3 (both in b.ts)
      const baseGraph = makeGraph(
        [
          { id: "n1", file: "a.ts" },
          { id: "n2", file: "b.ts" },
          { id: "n3", file: "b.ts" },
        ],
        [{ id: "e1", src: "n2", dst: "n3" }],
      );
      store.saveSnapshot(makeKey("orph2-base"), baseGraph);

      // Overlay: b.ts replaced — only n4 now, no n2 / n3.
      const overlayGraph = makeGraph(
        [
          { id: "n1", file: "a.ts" },
          { id: "n4", file: "b.ts" },
        ],
        [],
      );
      store.saveSnapshot(makeKey("orph2-ov"), overlayGraph);

      const loaded = store.loadSnapshot(makeKey("orph2-ov"));
      assert.ok(loaded);
      const edges = loaded!.repos[0]!.edges;
      assert.equal(edges.length, 0, "e1 dropped (both endpoints evicted)");
    } finally {
      store.close();
    }
  });
});

// ──────────────────────────────────────────────────────────
// Per-overlay subset persistence: a real correctness AND
// storage-win contract. Surfaced by the §0.6.4 double-check
// pass: a previous test set would have allowed a future agent
// to "simplify" the per-overlay write to write everything,
// silently destroying the storage savings without any unit
// test catching it. This test pins the contract.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: per-overlay subset persistence", () => {
  it("an overlay row only persists nodes for files in its unit set", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-subset-")), "graph.db");
    const store = openStore(dbPath);
    try {
      // Base: 5 files, 1 node each
      const baseGraph = makeGraph(
        [
          { id: "n1", file: "a.ts" },
          { id: "n2", file: "b.ts" },
          { id: "n3", file: "c.ts" },
          { id: "n4", file: "d.ts" },
          { id: "n5", file: "e.ts" },
        ],
        [],
      );
      const baseR = store.saveSnapshot(makeKey("z01"), baseGraph);
      assert.equal(baseR.kind, "base");

      // Overlay: only b.ts changes
      const overlayGraph = makeGraph(
        [
          { id: "n1", file: "a.ts" },
          { id: "n2", file: "b.ts", bodyFp: 999 },
          { id: "n3", file: "c.ts" },
          { id: "n4", file: "d.ts" },
          { id: "n5", file: "e.ts" },
        ],
        [],
      );
      const overlayR = store.saveSnapshot(makeKey("z02"), overlayGraph);
      assert.equal(overlayR.kind, "overlay");
      assert.deepEqual([...overlayR.overlayUnits], ["file:///repo:b.ts"]);

      // Inspect the SQLite store directly. The overlay snapshot
      // row should contain exactly 1 nodes row (n2 for b.ts),
      // NOT all 5 (which would be the broken behaviour). This
      // is the storage-savings invariant.
      const db = new Database(dbPath, { readonly: true });
      try {
        const baseRow = db.prepare(
          "SELECT id FROM snapshots WHERE git_sha = ?",
        ).get(makeKey("z01").gitSha) as { id: number };
        const overlayRow = db.prepare(
          "SELECT id FROM snapshots WHERE git_sha = ?",
        ).get(makeKey("z02").gitSha) as { id: number };

        const baseNodeCount = (db.prepare(
          "SELECT COUNT(*) as c FROM nodes WHERE snapshot_id = ?",
        ).get(baseRow.id) as { c: number }).c;
        const overlayNodeCount = (db.prepare(
          "SELECT COUNT(*) as c FROM nodes WHERE snapshot_id = ?",
        ).get(overlayRow.id) as { c: number }).c;

        assert.equal(baseNodeCount, 5, "base persists all 5 nodes");
        assert.equal(
          overlayNodeCount, 1,
          `overlay should persist ONLY n2 (1 node, for b.ts), got ${overlayNodeCount}`,
        );
      } finally {
        db.close();
      }

      // Load via the chain — should resolve all 5 nodes from
      // base + overlay's superseding n2.
      const loaded = store.loadSnapshot(makeKey("z02"));
      assert.ok(loaded);
      const nodes = loaded!.repos[0]!.nodes;
      assert.equal(nodes.length, 5, "chain load merges to 5 nodes");
      const n2 = nodes.find((n) => n.id === "n2");
      assert.equal(n2?.bodyFingerprint, 999, "overlay's n2 wins");
    } finally {
      store.close();
    }
  });
});

describe("stacked-overlay: LRU vs chain integrity", () => {
  it("LRU eviction at MAX_SNAPSHOTS_PER_WORKSPACE preserves chain integrity AND doesn't over-evict via CASCADE", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-lru-")), "graph.db");
    const store = openStore(dbPath);
    try {
      // Save 55 snapshots — exceeds MAX_SNAPSHOTS_PER_WORKSPACE
      // (50). With auto-overlay this creates a chain whose base is
      // the oldest snapshot. The NAIVE LRU policy would delete the
      // base, cascading through the whole chain via the
      // `ON DELETE CASCADE` FK; the LEAF-ONLY policy (Step 6
      // double-check fix) only evicts snapshots without
      // descendants, preserving chain integrity AND keeping
      // close to the cap.
      for (let c = 0; c < 55; c++) {
        store.saveSnapshot(
          {
            workspacePath: "/test/lru-chain",
            gitSha: "k" + String(c).padStart(2, "0") + "0".repeat(37),
            extractorVersionHash: "ext",
            bridgesVersionHash: "bridges",
          },
          makeGraph([{ id: "n", file: "src/file" + c + ".ts", bodyFp: c }], []),
        );
      }
      const remaining = store.listSnapshots("/test/lru-chain");

      // INTEGRITY: every remaining snapshot's parent is present.
      const ids = new Set(remaining.map((s) => s.id));
      for (const s of remaining) {
        if (s.parentSnapshotId !== null) {
          assert.ok(
            ids.has(s.parentSnapshotId),
            `chain integrity: snapshot ${s.id} parent ${s.parentSnapshotId} must exist`,
          );
        }
      }

      // COUNT: the LRU must honour the cap (≤ 50).
      assert.ok(remaining.length <= 50, `LRU cap honoured (${remaining.length} ≤ 50)`);

      // CASCADE-OVER-EVICTION GUARD: post-cap we must still have
      // CLOSE to MAX_SNAPSHOTS_PER_WORKSPACE worth of snapshots.
      // The naive LRU drops this to a tiny fraction (the original
      // double-check bug took 55 → 4 retained because evicting one
      // base cascaded through the chain). The leaf-only LRU
      // retains ≥40 because at least the most-recent half of the
      // chain is descendants of materialised bases.
      assert.ok(
        remaining.length >= 40,
        `LRU shouldn't over-evict via CASCADE: ${remaining.length} retained (expect ≥40)`,
      );
    } finally {
      store.close();
    }
  });
});

// ──────────────────────────────────────────────────────────
// Branch-switch coalescing: L1 + L5 together handle the
// burst. This is the integration boundary per the Step 5a
// §0.6.4 lesson — we test it explicitly.
// ──────────────────────────────────────────────────────────
describe("stacked-overlay: branch-switch behaviour", () => {
  it("a no-op rebuild (same graph) hits L5 early cutoff", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "so-bs-")), "graph.db");
    const store = openStore(dbPath);
    try {
      const graph = makeGraph(
        [{ id: "a", file: "x.ts" }, { id: "b", file: "y.ts" }],
        [{ id: "e", src: "a", dst: "b" }],
      );

      // Save the base
      const base = store.saveSnapshot(makeKey("bs01"), graph);
      assert.equal(base.kind, "base");

      // Branch switch coalesces 10 file events into one rebuild;
      // assume the rebuild produces the SAME graph (because the
      // branch hadn't actually diverged at the graph level —
      // common when switching between similar feature branches).
      // L5 should fire its early cutoff.
      const switched = store.saveSnapshot(makeKey("bs02"), graph);
      assert.equal(switched.kind, "none", "L5 early cutoff fired on identical-content rebuild");
      assert.equal(switched.id, base.id, "no new snapshot row written");
    } finally {
      store.close();
    }
  });
});

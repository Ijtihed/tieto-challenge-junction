// Per architecture/specs/graph-persistence.md §9 — 30+ persistence tests.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, type CacheKey, type GraphStore } from "../domain/persistence/store.ts";
import { computeExtractorVersionHash, computeBridgesVersionHash } from "../domain/persistence/version.ts";
import type { MultiRepoGraph, GraphNode, GraphEdge, RepoSubgraph } from "../domain/multi-repo.ts";

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "schema-test-"));
  return join(dir, "test.db");
}

function makeGraph(nodeCount: number, edgeCount: number): MultiRepoGraph {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node:${i}`,
      kind: i % 3 === 0 ? "route_handler" : i % 3 === 1 ? "service" : "utility",
      name: `fn_${i}`,
      locator: `file:///test/src/mod${i}.ts#L${i}-L${i + 10}`,
      filePath: `src/mod${i}.ts`,
      startLine: i,
      endLine: i + 10,
      bodyFingerprint: i * 31,
      meta: i % 5 === 0 ? { tag: `meta-${i}` } : undefined,
    });
  }
  const edges: GraphEdge[] = [];
  for (let i = 0; i < edgeCount && i < nodeCount - 1; i++) {
    edges.push({
      id: `edge:${i}`,
      source: `node:${i}`,
      target: `node:${i + 1}`,
      relation: "calls",
      meta: i % 4 === 0 ? { weight: i } : undefined,
    });
  }
  const repo: RepoSubgraph = {
    uri: "file:///test",
    nodes,
    edges,
    clusters: [{ id: "cluster:main", name: "main", nodeIds: nodes.slice(0, 3).map((n) => n.id) }],
  };
  return { version: "1.0", repos: [repo], interRepoEdges: [] };
}

const KEY_A: CacheKey = {
  workspacePath: "/test/repo-a",
  gitSha: "aaaa" + "0".repeat(36),
  extractorVersionHash: "ext-v1",
  bridgesVersionHash: "brg-v1",
};

describe("graph-persistence store", () => {
  let dbPath: string;
  let store: GraphStore;

  before(() => {
    dbPath = tmpDbPath();
    store = openStore(dbPath);
  });

  after(() => {
    store.close();
    try { rmSync(dbPath, { force: true }); } catch { /* */ }
  });

  // ── Store basics ──

  it("creates tables on fresh DB", () => {
    assert.ok(existsSync(dbPath));
  });

  it("openStore on existing DB is a no-op", () => {
    const store2 = openStore(dbPath);
    store2.close();
  });

  it("openStore on corrupt file recreates", () => {
    const corruptPath = tmpDbPath();
    writeFileSync(corruptPath, "not a sqlite file");
    const s = openStore(corruptPath);
    s.close();
    rmSync(corruptPath, { force: true });
  });

  // ── Save / load roundtrip ──

  it("save then load roundtrip preserves node count", () => {
    const graph = makeGraph(10, 5);
    const result = store.saveSnapshot(KEY_A, graph);
    assert.ok(result.id > 0);
    assert.equal(result.kind, "base");
    assert.equal(result.written, true);

    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
    assert.equal(loaded!.repos.length, 1);
    assert.equal(loaded!.repos[0]!.nodes.length, 10);
  });

  it("roundtrip preserves edge count", () => {
    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
    assert.equal(loaded!.repos[0]!.edges.length, 5);
  });

  it("roundtrip preserves cluster data", () => {
    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
    assert.equal(loaded!.repos[0]!.clusters.length, 1);
    assert.equal(loaded!.repos[0]!.clusters[0]!.name, "main");
    assert.equal(loaded!.repos[0]!.clusters[0]!.nodeIds.length, 3);
  });

  it("roundtrip preserves node fields", () => {
    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
    const n0 = loaded!.repos[0]!.nodes.find((n) => n.id === "node:0");
    assert.ok(n0);
    assert.equal(n0!.kind, "route_handler");
    assert.equal(n0!.name, "fn_0");
    assert.equal(n0!.filePath, "src/mod0.ts");
    assert.equal(n0!.startLine, 0);
    assert.equal(n0!.endLine, 10);
    assert.equal(n0!.bodyFingerprint, 0);
  });

  it("roundtrip preserves node meta", () => {
    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
    const n0 = loaded!.repos[0]!.nodes.find((n) => n.id === "node:0");
    assert.ok(n0);
    assert.deepEqual(n0!.meta, { tag: "meta-0" });
  });

  it("roundtrip preserves edge meta", () => {
    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
    const e0 = loaded!.repos[0]!.edges.find((e) => e.id === "edge:0");
    assert.ok(e0);
    assert.deepEqual(e0!.meta, { weight: 0 });
  });

  it("roundtrip preserves wire format version", () => {
    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
    assert.equal(loaded!.version, "1.0");
  });

  // ── Cache key matching ──

  it("same key hits cache", () => {
    const loaded = store.loadSnapshot(KEY_A);
    assert.ok(loaded);
  });

  it("different SHA misses cache", () => {
    const key = { ...KEY_A, gitSha: "bbbb" + "0".repeat(36) };
    const loaded = store.loadSnapshot(key);
    assert.equal(loaded, null);
  });

  it("different extractor hash misses cache", () => {
    const key = { ...KEY_A, extractorVersionHash: "ext-v2" };
    const loaded = store.loadSnapshot(key);
    assert.equal(loaded, null);
  });

  it("different bridges hash misses cache", () => {
    const key = { ...KEY_A, bridgesVersionHash: "brg-v2" };
    const loaded = store.loadSnapshot(key);
    assert.equal(loaded, null);
  });

  it("different workspace misses cache", () => {
    const key = { ...KEY_A, workspacePath: "/test/repo-b" };
    const loaded = store.loadSnapshot(key);
    assert.equal(loaded, null);
  });

  // ── loadSnapshotBySha ──

  it("loadSnapshotBySha finds by workspace + SHA only", () => {
    const loaded = store.loadSnapshotBySha("/test/repo-a", KEY_A.gitSha);
    assert.ok(loaded);
    assert.equal(loaded!.repos[0]!.nodes.length, 10);
  });

  it("loadSnapshotBySha returns null for unknown SHA", () => {
    const loaded = store.loadSnapshotBySha("/test/repo-a", "cccc" + "0".repeat(36));
    assert.equal(loaded, null);
  });

  // ── List / delete snapshots ──

  it("listSnapshots returns metadata", () => {
    const snaps = store.listSnapshots("/test/repo-a");
    assert.ok(snaps.length >= 1);
    assert.equal(snaps[0]!.gitSha, KEY_A.gitSha);
    assert.equal(snaps[0]!.nodeCount, 10);
    assert.equal(snaps[0]!.edgeCount, 5);
    assert.ok(snaps[0]!.sizeBytes > 0);
  });

  it("listSnapshots sorted by lastAccessed desc", () => {
    const key2 = { ...KEY_A, gitSha: "dddd" + "0".repeat(36) };
    store.saveSnapshot(key2, makeGraph(3, 1));
    const snaps = store.listSnapshots("/test/repo-a");
    assert.ok(snaps.length >= 2);
    assert.ok(snaps[0]!.lastAccessed >= snaps[1]!.lastAccessed);
  });

  it("deleteSnapshot removes the snapshot", () => {
    // Step 6: pick a TRUE leaf snapshot (one with no children) so
    // the cascade doesn't take more than one row. Just using
    // `snaps[0]` (most-recently-accessed) is not robust because
    // SQLite's ORDER BY on equal `last_accessed` timestamps is
    // non-deterministic; on macOS Date.now() has 1 ms resolution
    // and successive saves within a millisecond produce equal
    // timestamps. The previously-flaky version of this test
    // picked `snaps[0]` which could be a parent — deleting it
    // cascaded the chain, leaving the actual leaf detached.
    // Explicit leaf detection makes the test deterministic.
    const snaps = store.listSnapshots("/test/repo-a");
    const parents = new Set<number>();
    for (const s of snaps) {
      if (s.parentSnapshotId !== null) parents.add(s.parentSnapshotId);
    }
    const leaf = snaps.find((s) => !parents.has(s.id));
    assert.ok(leaf, "expected at least one leaf snapshot");
    const deleted = store.deleteSnapshot(leaf!.id);
    assert.equal(deleted, true);
    const after = store.listSnapshots("/test/repo-a");
    assert.equal(after.length, snaps.length - 1);
  });

  it("deleteSnapshot returns false for unknown id", () => {
    const deleted = store.deleteSnapshot(999999);
    assert.equal(deleted, false);
  });

  it("deleteSnapshot cascades to nodes and edges", () => {
    const key3 = { ...KEY_A, gitSha: "eeee" + "0".repeat(36) };
    store.saveSnapshot(key3, makeGraph(5, 3));
    const snaps = store.listSnapshots("/test/repo-a");
    const snap = snaps.find((s) => s.gitSha === key3.gitSha);
    assert.ok(snap);
    store.deleteSnapshot(snap!.id);
    const loaded = store.loadSnapshotBySha("/test/repo-a", key3.gitSha);
    assert.equal(loaded, null);
  });

  // ── Duplicate save is idempotent ──

  it("saving same key twice does not create duplicate", () => {
    const freshKey: CacheKey = {
      workspacePath: "/test/idempotent",
      gitSha: "ffff" + "0".repeat(36),
      extractorVersionHash: "ext-v1",
      bridgesVersionHash: "brg-v1",
    };
    store.saveSnapshot(freshKey, makeGraph(3, 1));
    const before = store.listSnapshots("/test/idempotent").length;
    store.saveSnapshot(freshKey, makeGraph(3, 1));
    const after = store.listSnapshots("/test/idempotent").length;
    assert.equal(after, before);
  });

  // ── Eviction ──

  it("LRU evicts when >50 snapshots per workspace", () => {
    const evictPath = tmpDbPath();
    const evictStore = openStore(evictPath);
    for (let i = 0; i < 52; i++) {
      const sha = i.toString(16).padStart(40, "0");
      evictStore.saveSnapshot(
        { workspacePath: "/evict-test", gitSha: sha, extractorVersionHash: "e", bridgesVersionHash: "b" },
        makeGraph(2, 1),
      );
    }
    const snaps = evictStore.listSnapshots("/evict-test");
    assert.ok(snaps.length <= 50, `Expected <=50, got ${snaps.length}`);
    evictStore.close();
    rmSync(evictPath, { force: true });
  });
});

// ── Version hash tests ──

describe("persistence version hashes", () => {
  it("computeExtractorVersionHash is deterministic", () => {
    const a = computeExtractorVersionHash([{ id: "ts", version: "1.0" }, { id: "py", version: "2.0" }]);
    const b = computeExtractorVersionHash([{ id: "py", version: "2.0" }, { id: "ts", version: "1.0" }]);
    assert.equal(a, b);
  });

  it("computeExtractorVersionHash changes with version", () => {
    const a = computeExtractorVersionHash([{ id: "ts", version: "1.0" }]);
    const b = computeExtractorVersionHash([{ id: "ts", version: "2.0" }]);
    assert.notEqual(a, b);
  });

  it("computeBridgesVersionHash is deterministic", () => {
    const a = computeBridgesVersionHash(["rest", "grpc", "sql"]);
    const b = computeBridgesVersionHash(["sql", "rest", "grpc"]);
    assert.equal(a, b);
  });

  it("computeBridgesVersionHash changes with different bridges", () => {
    const a = computeBridgesVersionHash(["rest"]);
    const b = computeBridgesVersionHash(["rest", "grpc"]);
    assert.notEqual(a, b);
  });

  it("hashes are 16 chars", () => {
    const h = computeExtractorVersionHash([{ id: "ts", version: "1.0" }]);
    assert.equal(h.length, 16);
  });
});

// ── Concurrent access ──

describe("persistence concurrent access", () => {
  it("two stores on same file don't crash (WAL mode)", () => {
    const path = tmpDbPath();
    const s1 = openStore(path);
    const s2 = openStore(path);
    s1.saveSnapshot(
      { workspacePath: "/concurrent", gitSha: "a".repeat(40), extractorVersionHash: "e", bridgesVersionHash: "b" },
      makeGraph(3, 1),
    );
    const loaded = s2.loadSnapshotBySha("/concurrent", "a".repeat(40));
    assert.ok(loaded);
    s1.close();
    s2.close();
    rmSync(path, { force: true });
  });
});

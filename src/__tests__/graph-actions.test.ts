// Per architecture/schema-v3.md §14.3 — Phase 3 gate tests.
//
// Strategy: open the express-todos fixture once, then run every
// graph action against the resulting session.  Test edge cases
// (unknown session, empty graph, node-not-found, pagination,
// search with no matches) and the markdown allowlist (Rule 8).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { graphSummary } from "../actions/graph-summary.ts";
import { graphListNodes } from "../actions/graph-list-nodes.ts";
import { graphGetNode } from "../actions/graph-get-node.ts";
import { graphFindCallers } from "../actions/graph-find-callers.ts";
import { graphFindCallees } from "../actions/graph-find-callees.ts";
import { graphListEdges } from "../actions/graph-list-edges.ts";
import { graphPath } from "../actions/graph-path.ts";
import { graphSearch } from "../actions/graph-search.ts";
import { graphDiffAgainst } from "../actions/graph-diff-against.ts";
import { graphSummarize } from "../actions/graph-summarize.ts";
import { markdownRead } from "../actions/markdown-read.ts";
import { getSession } from "../session/index.ts";

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
const FIXTURE_URI = `file://${FIXTURE_PATH}`;

let sessionId: string;
let allNodeIds: string[];
let fileNodeIds: string[];

// ──────────────────────────────────────────────────────────────
// Setup: open the fixture once for all tests
// ──────────────────────────────────────────────────────────────

before(async () => {
  // Clear graph cache to ensure test isolation.
  try { const { unlinkSync } = await import("node:fs"); const { join } = await import("node:path"); const { homedir } = await import("node:os"); unlinkSync(join(homedir(), ".schema", "graph-cache.db")); } catch { /* */ }
  const result = await workspaceOpen.handle({ uris: [FIXTURE_URI] });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture open failed");
  sessionId = (result.data as { sessionId: string }).sessionId;

  const session = getSession(sessionId)!;
  const nodes = session.graph.repos.flatMap((r) => r.nodes);
  allNodeIds = nodes.map((n) => n.id);
  fileNodeIds = nodes.filter((n) => !n.name.includes(".")).map((n) => n.id);
});

after(async () => {
  await workspaceClose.handle({ sessionId });
});

// ──────────────────────────────────────────────────────────────
// graph.summary (action 4)
// ──────────────────────────────────────────────────────────────

describe("graph.summary", () => {
  it("returns cluster summaries with counts", async () => {
    const r = await graphSummary.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      clusters: { id: string; name: string; size: number; kindMix: Record<string, number>; externalEdges: number }[];
      totalNodes: number;
      totalEdges: number;
      markdownUri: string;
    };
    assert.ok(data.totalNodes >= 5, `Expected >= 5 nodes, got ${data.totalNodes}`);
    assert.ok(data.totalEdges >= 1, `Expected >= 1 edge, got ${data.totalEdges}`);
    assert.ok(data.clusters.length >= 1);
    for (const c of data.clusters) {
      assert.ok(c.size > 0);
      assert.ok(Object.keys(c.kindMix).length > 0);
    }
  });

  it("includes markdownUri (Rule 8 allowlisted)", async () => {
    const r = await graphSummary.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { markdownUri: string };
    assert.ok(data.markdownUri.startsWith("markdown://graph.summary/"));
  });

  it("markdownUri is fetchable via markdown.read", async () => {
    const r = await graphSummary.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { markdownUri } = r.data as { markdownUri: string };

    const mr = await markdownRead.handle({ sessionId, uri: markdownUri });
    assert.equal(mr.ok, true);
    if (!mr.ok) return;
    const md = (mr.data as { markdown: string }).markdown;
    assert.ok(md.includes("# Graph Summary"));
  });

  it("accepts level parameter", async () => {
    const r = await graphSummary.handle({ sessionId, level: "detail" });
    assert.equal(r.ok, true);
  });

  it("returns session-not-found for unknown sessionId", async () => {
    const r = await graphSummary.handle({ sessionId: "sess_nonexistent" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns invalid-args when sessionId is missing", async () => {
    const r = await graphSummary.handle({});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.list_nodes (action 5)
// ──────────────────────────────────────────────────────────────

describe("graph.list_nodes", () => {
  it("returns all nodes with empty filter", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: {} });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { nodes: { id: string; name: string }[]; nextCursor?: string };
    assert.ok(data.nodes.length >= 5);
  });

  it("filters by kind", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: { kind: ["service"] } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { nodes: { kind: string }[] };
    for (const n of data.nodes) {
      assert.equal(n.kind, "service");
    }
  });

  it("filters by namePattern", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: { namePattern: "store" } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { nodes: { name: string }[] };
    assert.ok(data.nodes.length >= 1);
    for (const n of data.nodes) {
      assert.ok(n.name.toLowerCase().includes("store"), `Expected name to match "store", got: ${n.name}`);
    }
  });

  it("filters by locatorPrefix", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: { locatorPrefix: "file://" } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { nodes: { locator: string }[] };
    for (const n of data.nodes) {
      assert.ok(n.locator.startsWith("file://"));
    }
  });

  it("supports cursor-based pagination", async () => {
    const r1 = await graphListNodes.handle({ sessionId, filter: {}, limit: 2 });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const d1 = r1.data as { nodes: { id: string }[]; nextCursor?: string };
    assert.equal(d1.nodes.length, 2);
    assert.ok(d1.nextCursor, "Expected a nextCursor when limit < total nodes");

    const r2 = await graphListNodes.handle({ sessionId, filter: {}, limit: 2, cursor: d1.nextCursor });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    const d2 = r2.data as { nodes: { id: string }[] };
    assert.ok(d2.nodes.length > 0);

    const ids1 = new Set(d1.nodes.map((n) => n.id));
    for (const n of d2.nodes) {
      assert.ok(!ids1.has(n.id), `Page 2 should not overlap with page 1, got duplicate: ${n.id}`);
    }
  });

  it("returns empty array when filter matches nothing", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: { namePattern: "^zzz_nonexistent_xyz$" } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { nodes: unknown[] };
    assert.equal(data.nodes.length, 0);
  });

  it("does NOT include markdownUri (not on allowlist)", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: {} });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("returns session-not-found for unknown sessionId", async () => {
    const r = await graphListNodes.handle({ sessionId: "sess_unknown", filter: {} });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns invalid-args for bad namePattern regex", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: { namePattern: "[invalid" } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.get_node (action 6)
// ──────────────────────────────────────────────────────────────

describe("graph.get_node", () => {
  it("returns a node by id", async () => {
    const firstId = allNodeIds[0]!;
    const r = await graphGetNode.handle({ sessionId, id: firstId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { node: { id: string; name: string } };
    assert.equal(data.node.id, firstId);
  });

  it("returns snippet when include contains 'snippet'", async () => {
    const firstId = allNodeIds[0]!;
    const r = await graphGetNode.handle({ sessionId, id: firstId, include: ["snippet"] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { node: object; snippet?: string };
    assert.ok(data.snippet !== undefined, "Expected snippet to be present");
  });

  it("returns source when include contains 'source'", async () => {
    const firstId = allNodeIds[0]!;
    const r = await graphGetNode.handle({ sessionId, id: firstId, include: ["source"] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { source?: string };
    assert.ok(data.source !== undefined, "Expected source to be present");
  });

  it("returns invalid-args for non-existent node id", async () => {
    const r = await graphGetNode.handle({ sessionId, id: "nonexistent-node-id" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("does NOT include markdownUri (not on allowlist)", async () => {
    const firstId = allNodeIds[0]!;
    const r = await graphGetNode.handle({ sessionId, id: firstId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("returns invalid-args when id is missing", async () => {
    const r = await graphGetNode.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.find_callers (action 7)
// ──────────────────────────────────────────────────────────────

describe("graph.find_callers", () => {
  it("finds callers of a node that has incoming edges", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const nodeWithCallers = allEdges[0]!.target;

    const r = await graphFindCallers.handle({ sessionId, symbolId: nodeWithCallers });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { callers: { id: string; viaEdge: string; locator: string }[]; truncated: boolean };
    assert.ok(data.callers.length >= 1, "Expected at least 1 caller");
    assert.equal(data.truncated, false);
  });

  it("returns empty callers for a node with no incoming edges", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const allTargets = new Set(allEdges.map((e) => e.target));
    const noCallers = allNodeIds.find((id) => !allTargets.has(id));
    if (!noCallers) return;

    const r = await graphFindCallers.handle({ sessionId, symbolId: noCallers });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { callers: unknown[] };
    assert.equal(data.callers.length, 0);
  });

  it("supports depth > 1 for transitive callers", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const nodeWithCallers = allEdges[0]!.target;

    const r = await graphFindCallers.handle({ sessionId, symbolId: nodeWithCallers, depth: 3 });
    assert.equal(r.ok, true);
  });

  it("does NOT include markdownUri (not on allowlist)", async () => {
    const nodeId = allNodeIds[0]!;
    const r = await graphFindCallers.handle({ sessionId, symbolId: nodeId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await graphFindCallers.handle({ sessionId: "sess_fake", symbolId: "x" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.find_callees (action 8)
// ──────────────────────────────────────────────────────────────

describe("graph.find_callees", () => {
  it("finds callees of a node with outgoing edges", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const nodeWithCallees = allEdges[0]!.source;

    const r = await graphFindCallees.handle({ sessionId, symbolId: nodeWithCallees });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { callees: { id: string; viaEdge: string; locator: string; relation: string }[]; truncated: boolean };
    assert.ok(data.callees.length >= 1, "Expected at least 1 callee");
    assert.equal(data.truncated, false);

    for (const callee of data.callees) {
      assert.ok(typeof callee.relation === "string", `callee ${callee.id} should have a relation string`);
      assert.ok(callee.relation.length > 0, `callee ${callee.id} relation should be non-empty`);
    }
  });

  it("returns empty callees for a node with no outgoing edges", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const allSources = new Set(allEdges.map((e) => e.source));
    const noCallees = allNodeIds.find((id) => !allSources.has(id));
    if (!noCallees) return;

    const r = await graphFindCallees.handle({ sessionId, symbolId: noCallees });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { callees: unknown[] };
    assert.equal(data.callees.length, 0);
  });

  it("supports depth > 1 for transitive callees", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const nodeWithCallees = allEdges[0]!.source;

    const r = await graphFindCallees.handle({ sessionId, symbolId: nodeWithCallees, depth: 3 });
    assert.equal(r.ok, true);
  });

  it("does NOT include markdownUri (not on allowlist)", async () => {
    const nodeId = allNodeIds[0]!;
    const r = await graphFindCallees.handle({ sessionId, symbolId: nodeId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("returns invalid-args when symbolId is missing", async () => {
    const r = await graphFindCallees.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.list_edges
// ──────────────────────────────────────────────────────────────

describe("graph.list_edges", () => {
  it("returns all edges from the session graph", async () => {
    const r = await graphListEdges.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { edges: { id: string; source: string; target: string; relation: string }[]; truncated: boolean };
    assert.ok(data.edges.length > 0, "Expected at least 1 edge from express-todos fixture");
    assert.equal(data.truncated, false);
    for (const e of data.edges) {
      assert.ok(typeof e.id === "string" && e.id.length > 0);
      assert.ok(typeof e.source === "string" && e.source.length > 0);
      assert.ok(typeof e.target === "string" && e.target.length > 0);
      assert.ok(typeof e.relation === "string" && e.relation.length > 0);
    }
  });

  it("edges match what find_callees would return", async () => {
    const session = getSession(sessionId)!;
    const expectedEdgeCount = session.graph.repos.reduce((s, r) => s + r.edges.length, 0)
      + session.graph.interRepoEdges.length;

    const r = await graphListEdges.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { edges: unknown[] };
    assert.equal(data.edges.length, expectedEdgeCount);
  });

  it("filters by relation", async () => {
    const r = await graphListEdges.handle({ sessionId, filter: { relation: ["calls"] } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { edges: { relation: string }[] };
    for (const e of data.edges) {
      assert.equal(e.relation, "calls");
    }
  });

  it("returns session-not-found for bad sessionId", async () => {
    const r = await graphListEdges.handle({ sessionId: "bad" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns invalid-args when sessionId is missing", async () => {
    const r = await graphListEdges.handle({});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.path (action 9)
// ──────────────────────────────────────────────────────────────

describe("graph.path", () => {
  it("finds a path between connected nodes", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    if (allEdges.length === 0) return;

    const from = allEdges[0]!.source;
    const to = allEdges[0]!.target;

    const r = await graphPath.handle({ sessionId, from, to });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { paths: { id: string }[][]; allEdgesByPath: object[][] };
    assert.ok(data.paths.length >= 1, "Expected at least 1 path");
    assert.equal(data.paths[0]![0]!.id, from);
    assert.equal(data.paths[0]![data.paths[0]!.length - 1]!.id, to);
    assert.equal(data.paths.length, data.allEdgesByPath.length);
  });

  it("returns empty paths when no path exists within maxHops", async () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const allEdges = session.graph.repos.flatMap((r) => r.edges);

    const edgeNodeIds = new Set([...allEdges.map((e) => e.source), ...allEdges.map((e) => e.target)]);
    const isolatedNodes = allNodes.filter((n) => !edgeNodeIds.has(n.id));

    if (isolatedNodes.length > 0 && allEdges.length > 0) {
      const from = allEdges[0]!.source;
      const to = isolatedNodes[0]!.id;
      const r = await graphPath.handle({ sessionId, from, to, maxHops: 1 });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      const data = r.data as { paths: unknown[][] };
      assert.equal(data.paths.length, 0);
    }
  });

  it("handles from === to (trivial path)", async () => {
    const nodeId = allNodeIds[0]!;
    const r = await graphPath.handle({ sessionId, from: nodeId, to: nodeId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { paths: { id: string }[][] };
    assert.equal(data.paths.length, 1);
    assert.equal(data.paths[0]!.length, 1);
    assert.equal(data.paths[0]![0]!.id, nodeId);
  });

  it("returns invalid-args for non-existent from node", async () => {
    const r = await graphPath.handle({ sessionId, from: "nonexistent", to: allNodeIds[0] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args for non-existent to node", async () => {
    const r = await graphPath.handle({ sessionId, from: allNodeIds[0], to: "nonexistent" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("does NOT include markdownUri (not on allowlist)", async () => {
    const nodeId = allNodeIds[0]!;
    const r = await graphPath.handle({ sessionId, from: nodeId, to: nodeId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });
});

// ──────────────────────────────────────────────────────────────
// graph.search (action 10)
// ──────────────────────────────────────────────────────────────

describe("graph.search", () => {
  it("finds nodes by exact name match", async () => {
    const r = await graphSearch.handle({ sessionId, query: "app.ts" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: { id: string; score: number; why: string }[] };
    assert.ok(data.hits.length >= 1);
    assert.ok(data.hits[0]!.score > 0);
  });

  it("finds nodes by partial name match", async () => {
    const r = await graphSearch.handle({ sessionId, query: "store" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: { id: string; score: number }[] };
    assert.ok(data.hits.length >= 1);
  });

  it("returns empty hits when query matches nothing", async () => {
    const r = await graphSearch.handle({ sessionId, query: "zzzzz_nonexistent_query" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: unknown[] };
    assert.equal(data.hits.length, 0);
  });

  it("respects scope=name", async () => {
    const r = await graphSearch.handle({ sessionId, query: "store", scope: "name" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: { why: string }[] };
    for (const h of data.hits) {
      assert.equal(h.why, "name");
    }
  });

  it("respects limit parameter", async () => {
    const r = await graphSearch.handle({ sessionId, query: "t", limit: 2 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: unknown[] };
    assert.ok(data.hits.length <= 2);
  });

  it("does NOT include markdownUri (not on allowlist)", async () => {
    const r = await graphSearch.handle({ sessionId, query: "app" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await graphSearch.handle({ sessionId: "sess_fake", query: "test" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns invalid-args when query is missing", async () => {
    const r = await graphSearch.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.diff_against (action 11 — stub)
// ──────────────────────────────────────────────────────────────

describe("graph.diff_against", () => {
  it("returns a stub delta with markdownUri", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD~1" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { graphDelta: object; markdownUri: string; fileStats?: unknown[] };
    assert.ok(data.graphDelta);
    assert.ok(data.markdownUri.startsWith("markdown://graph.diff_against/"));
  });

  it("includes fileStats when includeFileStats is true (default)", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as Record<string, unknown>;
    assert.ok("fileStats" in data);
  });

  it("omits fileStats when includeFileStats is false", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD", includeFileStats: false });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as Record<string, unknown>;
    assert.equal(data["fileStats"], undefined);
  });

  it("markdownUri is fetchable via markdown.read", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "main" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { markdownUri } = r.data as { markdownUri: string };

    const mr = await markdownRead.handle({ sessionId, uri: markdownUri });
    assert.equal(mr.ok, true);
    if (!mr.ok) return;
    const md = (mr.data as { markdown: string }).markdown;
    assert.ok(md.includes("Diff against"));
  });

  it("returns invalid-args when ref is missing", async () => {
    const r = await graphDiffAgainst.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.summarize (action 12)
// ──────────────────────────────────────────────────────────────

describe("graph.summarize", () => {
  it("returns an architectural summary with stats", async () => {
    const r = await graphSummarize.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      summary: string;
      edgeStats: { total: number; byRelation: Record<string, number> };
      clusterStats: { id: string; name: string; nodeCount: number; edgeCount: number }[];
      topSmells: { id: string; kind: string; message: string }[];
      markdownUri: string;
    };
    assert.ok(data.summary.length > 0);
    assert.ok(data.edgeStats.total >= 1);
    assert.ok(data.clusterStats.length >= 1);
    assert.ok(Array.isArray(data.topSmells));
  });

  it("includes markdownUri (Rule 8 allowlisted)", async () => {
    const r = await graphSummarize.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { markdownUri: string };
    assert.ok(data.markdownUri.startsWith("markdown://graph.summarize/"));
  });

  it("markdownUri is fetchable via markdown.read", async () => {
    const r = await graphSummarize.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { markdownUri } = r.data as { markdownUri: string };

    const mr = await markdownRead.handle({ sessionId, uri: markdownUri });
    assert.equal(mr.ok, true);
    if (!mr.ok) return;
    const md = (mr.data as { markdown: string }).markdown;
    assert.ok(md.includes("# Architecture Summary"));
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await graphSummarize.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("edgeStats.byRelation includes imports", async () => {
    const r = await graphSummarize.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { edgeStats: { byRelation: Record<string, number> } };
    assert.ok("imports" in data.edgeStats.byRelation, "Expected 'imports' in byRelation");
  });
});

// ──────────────────────────────────────────────────────────────
// markdown.read (action 28)
// ──────────────────────────────────────────────────────────────

describe("markdown.read", () => {
  it("returns stored markdown by URI", async () => {
    const summaryResult = await graphSummary.handle({ sessionId });
    assert.equal(summaryResult.ok, true);
    if (!summaryResult.ok) return;
    const { markdownUri } = summaryResult.data as { markdownUri: string };

    const r = await markdownRead.handle({ sessionId, uri: markdownUri });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { markdown: string; charset: string };
    assert.ok(data.markdown.length > 0);
    assert.equal(data.charset, "utf-8");
  });

  it("returns invalid-args for non-existent URI", async () => {
    const r = await markdownRead.handle({ sessionId, uri: "markdown://graph.summary/nonexistent-id" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args for non-markdown:// URI", async () => {
    const r = await markdownRead.handle({ sessionId, uri: "file:///etc/passwd" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args when uri is missing", async () => {
    const r = await markdownRead.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await markdownRead.handle({ sessionId: "sess_fake", uri: "markdown://x/y" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ──────────────────────────────────────────────────────────────
// Cross-cutting: markdown allowlist (Rule 8) verification
// ──────────────────────────────────────────────────────────────

describe("Rule 8 — markdown allowlist", () => {
  it("graph.summary output includes markdownUri", async () => {
    const r = await graphSummary.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("graph.summarize output includes markdownUri", async () => {
    const r = await graphSummarize.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("graph.diff_against output includes markdownUri", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("graph.list_nodes output does NOT include markdownUri", async () => {
    const r = await graphListNodes.handle({ sessionId, filter: {} });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("graph.get_node output does NOT include markdownUri", async () => {
    const r = await graphGetNode.handle({ sessionId, id: allNodeIds[0] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("graph.find_callers output does NOT include markdownUri", async () => {
    const r = await graphFindCallers.handle({ sessionId, symbolId: allNodeIds[0] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("graph.find_callees output does NOT include markdownUri", async () => {
    const r = await graphFindCallees.handle({ sessionId, symbolId: allNodeIds[0] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("graph.path output does NOT include markdownUri", async () => {
    const nodeId = allNodeIds[0]!;
    const r = await graphPath.handle({ sessionId, from: nodeId, to: nodeId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });

  it("graph.search output does NOT include markdownUri", async () => {
    const r = await graphSearch.handle({ sessionId, query: "app" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });
});

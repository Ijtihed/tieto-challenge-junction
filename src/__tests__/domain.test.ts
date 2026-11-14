// Unit tests for domain/ — locator, patch, delta, graph-hash, vocabulary, body-fingerprint.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { idFromLocator, parseLocator } from "../domain/locator.ts";
import { applyPatch } from "../domain/patch.ts";
import { computeDelta } from "../domain/delta.ts";
import { graphHash } from "../domain/graph-hash.ts";
import { createEmptyGraph } from "../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../domain/vocabulary.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import { fnv1a32, bodyFingerprint } from "../domain/body-fingerprint.ts";
import type { MultiRepoGraph, GraphNode, GraphEdge } from "../domain/multi-repo.ts";

describe("domain/locator", () => {
  it("idFromLocator produces deterministic IDs", () => {
    const loc = { scheme: "file", raw: "file:///src/main.ts" };
    const id1 = idFromLocator(loc);
    const id2 = idFromLocator(loc);
    assert.equal(id1, id2);
    assert.ok(id1.startsWith("file:"), `Expected file: prefix, got ${id1}`);
  });

  it("different locators produce different IDs", () => {
    const a = idFromLocator({ scheme: "file", raw: "file:///a.ts" });
    const b = idFromLocator({ scheme: "file", raw: "file:///b.ts" });
    assert.notEqual(a, b);
  });

  it("parseLocator extracts scheme", () => {
    const loc = parseLocator("proto://events.PageView/Publish");
    assert.equal(loc.scheme, "proto");
    assert.equal(loc.raw, "proto://events.PageView/Publish");
  });

  it("parseLocator defaults to file scheme for bare paths", () => {
    const loc = parseLocator("/src/main.ts");
    assert.equal(loc.scheme, "file");
  });
});

describe("domain/patch", () => {
  function makeGraph(): MultiRepoGraph {
    const nodeA: GraphNode = { id: "n1", kind: NODE_KINDS.utility, name: "a", locator: "file:///a.ts" };
    const nodeB: GraphNode = { id: "n2", kind: NODE_KINDS.utility, name: "b", locator: "file:///b.ts" };
    const edge: GraphEdge = { id: "e1", source: "n1", target: "n2", relation: EDGE_RELATIONS.imports };
    return {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///repo", nodes: [nodeA, nodeB], edges: [edge], clusters: [] }],
      interRepoEdges: [],
    };
  }

  it("adds nodes", () => {
    const graph = makeGraph();
    const newNode: GraphNode = { id: "n3", kind: NODE_KINDS.service, name: "c", locator: "file:///c.ts" };
    const patched = applyPatch(graph, { addNodes: [newNode] });
    assert.equal(patched.repos[0]!.nodes.length, 3);
  });

  it("removes nodes", () => {
    const graph = makeGraph();
    const patched = applyPatch(graph, { removeNodeIds: ["n1"] });
    assert.equal(patched.repos[0]!.nodes.length, 1);
    assert.equal(patched.repos[0]!.nodes[0]!.id, "n2");
  });

  it("throws on missing removeNodeId", () => {
    const graph = makeGraph();
    assert.throws(() => applyPatch(graph, { removeNodeIds: ["nonexistent"] }), /precondition failure/);
  });

  it("removes edges", () => {
    const graph = makeGraph();
    const patched = applyPatch(graph, { removeEdgeIds: ["e1"] });
    assert.equal(patched.repos[0]!.edges.length, 0);
  });

  it("throws on missing removeEdgeId", () => {
    const graph = makeGraph();
    assert.throws(() => applyPatch(graph, { removeEdgeIds: ["nonexistent"] }), /precondition failure/);
  });

  it("is pure — original graph unchanged after patch", () => {
    const graph = makeGraph();
    const _patched = applyPatch(graph, { removeNodeIds: ["n1"] });
    assert.equal(graph.repos[0]!.nodes.length, 2);
  });
});

describe("domain/delta", () => {
  it("detects added and removed nodes", () => {
    const base: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///r", nodes: [{ id: "n1", kind: "utility", name: "a", locator: "" }], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    const head: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///r", nodes: [{ id: "n2", kind: "utility", name: "b", locator: "" }], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    const delta = computeDelta(base, head);
    assert.equal(delta.counts.nodesAdded, 1);
    assert.equal(delta.counts.nodesRemoved, 1);
  });

  it("unchanged nodes have status unchanged", () => {
    const node = { id: "n1", kind: "utility", name: "a", locator: "" } as const;
    const graph: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///r", nodes: [node], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    const delta = computeDelta(graph, graph);
    assert.equal(delta.counts.nodesAdded, 0);
    assert.equal(delta.counts.nodesRemoved, 0);
  });
});

describe("domain/graph-hash", () => {
  it("same graph produces same hash", () => {
    const graph = makeGraphForHash();
    assert.equal(graphHash(graph), graphHash(graph));
  });

  it("different graph produces different hash", () => {
    const a = makeGraphForHash();
    const b: MultiRepoGraph = {
      ...a,
      repos: [{ ...a.repos[0]!, nodes: [...a.repos[0]!.nodes, { id: "extra", kind: "utility", name: "x", locator: "" }] }],
    };
    assert.notEqual(graphHash(a), graphHash(b));
  });

  it("empty graph has a hash", () => {
    const empty = createEmptyGraph(CURRENT_WIRE_VERSION);
    const h = graphHash(empty);
    assert.ok(h.length > 0);
  });
});

function makeGraphForHash(): MultiRepoGraph {
  return {
    version: CURRENT_WIRE_VERSION,
    repos: [{ uri: "file:///r", nodes: [{ id: "n1", kind: "utility", name: "a", locator: "" }], edges: [], clusters: [] }],
    interRepoEdges: [],
  };
}

describe("domain/vocabulary", () => {
  it("NODE_KINDS has 9 entries per §4.1", () => {
    assert.equal(Object.keys(NODE_KINDS).length, 9);
  });

  it("EDGE_RELATIONS has 17 entries per §4.1 + §17.1 + CPG", () => {
    assert.equal(Object.keys(EDGE_RELATIONS).length, 17);
  });

  it("keys match values (const-as pattern)", () => {
    for (const [k, v] of Object.entries(NODE_KINDS)) {
      assert.equal(k, v, `NODE_KINDS key '${k}' should equal value '${v}'`);
    }
    for (const [k, v] of Object.entries(EDGE_RELATIONS)) {
      assert.equal(k, v, `EDGE_RELATIONS key '${k}' should equal value '${v}'`);
    }
  });
});

describe("domain/body-fingerprint", () => {
  it("fnv1a32 is deterministic", () => {
    assert.equal(fnv1a32("hello"), fnv1a32("hello"));
  });

  it("fnv1a32 differs for different inputs", () => {
    assert.notEqual(fnv1a32("hello"), fnv1a32("world"));
  });

  it("fnv1a32 returns a 32-bit unsigned integer", () => {
    const h = fnv1a32("test string");
    assert.ok(h >= 0 && h <= 0xffffffff);
  });

  it("bodyFingerprint ignores comments", () => {
    const a = bodyFingerprint("x = 1; // set x\ny = 2;");
    const b = bodyFingerprint("x = 1;\ny = 2;");
    assert.equal(a, b);
  });

  it("bodyFingerprint ignores block comments", () => {
    const a = bodyFingerprint("x = 1; /* comment */ y = 2;");
    const b = bodyFingerprint("x = 1;  y = 2;");
    assert.equal(a, b);
  });

  it("bodyFingerprint ignores whitespace differences", () => {
    const a = bodyFingerprint("x = 1;\n  y = 2;");
    const b = bodyFingerprint("x = 1; y = 2;");
    assert.equal(a, b);
  });

  it("bodyFingerprint differs for different logic", () => {
    const a = bodyFingerprint("return x + 1;");
    const b = bodyFingerprint("return x * 2;");
    assert.notEqual(a, b);
  });

  it("bodyFingerprint ignores Python-style hash comments", () => {
    const a = bodyFingerprint("x = 1 # comment\ny = 2");
    const b = bodyFingerprint("x = 1\ny = 2");
    assert.equal(a, b);
  });

  it("delta detects body fingerprint changes", () => {
    const base: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///r", nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "", bodyFingerprint: 100 }], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    const head: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///r", nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "", bodyFingerprint: 200 }], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    const delta = computeDelta(base, head);
    assert.equal(delta.counts.nodesModified, 1);
  });
});

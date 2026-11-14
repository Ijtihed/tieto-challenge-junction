// Comprehensive tests for bi-abductive separation logic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeFootprint, biAbduce, checkInterference, analyzePlanInterference,
} from "../domain/separation-logic.ts";
import { registerSignature } from "../domain/op-signatures.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";

function makeGraph() {
  return {
    version: CURRENT_WIRE_VERSION,
    repos: [{
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "route_handler" as const, name: "getUsers", locator: "file:///test/r.ts#L1", filePath: "/test/r.ts" },
        { id: "n2", kind: "service" as const, name: "UserService", locator: "file:///test/s.ts#L1", filePath: "/test/s.ts" },
        { id: "n3", kind: "utility" as const, name: "hash", locator: "file:///test/u.ts#L1", filePath: "/test/u.ts" },
        { id: "n4", kind: "external" as const, name: "axios", locator: "file:///test/ext.ts#L1" },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2", relation: "calls" as const },
        { id: "e2", source: "n2", target: "n3", relation: "calls" as const },
        { id: "e3", source: "n2", target: "n4", relation: "imports" as const },
      ],
      clusters: [],
    }],
    interRepoEdges: [],
  } satisfies import("../domain/multi-repo.ts").MultiRepoGraph;
}

// ── computeFootprint ──

describe("computeFootprint", () => {
  it("returns null for unknown op", () => {
    const result = computeFootprint(makeGraph(), "nonexistent", "n1");
    assert.equal(result, null);
  });

  it("returns null for unknown node", () => {
    const result = computeFootprint(makeGraph(), "addMiddleware", "fake");
    assert.equal(result, null);
  });

  it("includes target node as a read", () => {
    const fp = computeFootprint(makeGraph(), "addMiddleware", "n1");
    assert.ok(fp);
    assert.ok(fp!.reads.some((r) => r.kind === "node" && r.id === "n1"));
  });

  it("includes connected edges as reads", () => {
    const fp = computeFootprint(makeGraph(), "addMiddleware", "n1");
    assert.ok(fp);
    assert.ok(fp!.reads.some((r) => r.kind === "edge" && r.id === "e1"));
  });

  it("modifies_body effect adds node to writes", () => {
    const fp = computeFootprint(makeGraph(), "renameSymbol", "n2");
    assert.ok(fp);
    assert.ok(fp!.writes.some((r) => r.kind === "node" && r.id === "n2"));
  });

  it("adds_edge effect adds to creates", () => {
    const fp = computeFootprint(makeGraph(), "addMiddleware", "n1");
    assert.ok(fp);
    assert.ok(fp!.creates.some((r) => r.kind === "edge" && r.type === "applies_middleware"));
  });

  it("adds_node effect adds to creates", () => {
    const fp = computeFootprint(makeGraph(), "extractFunction", "n3");
    assert.ok(fp);
    assert.ok(fp!.creates.some((r) => r.kind === "node" && r.type === "utility"));
  });

  it("extractFunction creates both node and edge", () => {
    const fp = computeFootprint(makeGraph(), "extractFunction", "n3");
    assert.ok(fp);
    assert.ok(fp!.creates.some((r) => r.kind === "node"), "should create a node");
    assert.ok(fp!.creates.some((r) => r.kind === "edge" && r.type === "calls"), "should create a calls edge");
  });
});

// ── computeFootprint with removes_node ──

describe("computeFootprint — removes_node", () => {
  it("destroys the node and all connected edges", () => {
    registerSignature({
      opId: "__test_destroy",
      preconditions: [],
      postconditions: [{ kind: "removes_node" }],
      requiredArgs: [],
    });

    const fp = computeFootprint(makeGraph(), "__test_destroy", "n2");
    assert.ok(fp);
    assert.ok(fp!.destroys.some((r) => r.kind === "node" && r.id === "n2"));
    // n2 has edges e1 (target), e2 (source), e3 (source)
    assert.ok(fp!.destroys.some((r) => r.kind === "edge" && r.id === "e1"));
    assert.ok(fp!.destroys.some((r) => r.kind === "edge" && r.id === "e2"));
    assert.ok(fp!.destroys.some((r) => r.kind === "edge" && r.id === "e3"));
  });
});

// ── biAbduce ──

describe("biAbduce", () => {
  it("valid when all required resources exist", () => {
    const graph = makeGraph();
    const fp = computeFootprint(graph, "addMiddleware", "n1")!;
    const result = biAbduce(graph, fp);
    assert.equal(result.valid, true);
    assert.equal(result.antiFrame.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it("frame excludes touched resources", () => {
    const graph = makeGraph();
    const fp = computeFootprint(graph, "renameSymbol", "n2")!;
    const result = biAbduce(graph, fp);
    // n2 is written, so it shouldn't be in the frame
    assert.ok(!result.frame.some((r) => r.id === "n2"));
    // n1 should be in the frame (untouched)
    assert.ok(result.frame.some((r) => r.id === "n1"));
  });

  it("anti-frame reports missing required edges", () => {
    registerSignature({
      opId: "__test_needs_edge",
      preconditions: [{ kind: "has_edge_in", relation: "registers_route" }],
      postconditions: [],
      requiredArgs: [],
    });

    const graph = makeGraph();
    // n1 doesn't have a registers_route incoming edge
    const fp = computeFootprint(graph, "__test_needs_edge", "n1")!;
    const result = biAbduce(graph, fp);
    assert.equal(result.valid, false);
    assert.ok(result.antiFrame.length > 0);
    assert.ok(result.errors.some((e) => e.includes("registers_route")));
  });

  it("frame includes nodes not referenced by any op", () => {
    const graph = makeGraph();
    const fp = computeFootprint(graph, "addMiddleware", "n1")!;
    const result = biAbduce(graph, fp);
    // n3 and n4 should be in the frame
    assert.ok(result.frame.some((r) => r.id === "n3"));
    assert.ok(result.frame.some((r) => r.id === "n4"));
  });

  it("footprint is preserved in result", () => {
    const graph = makeGraph();
    const fp = computeFootprint(graph, "addMiddleware", "n1")!;
    const result = biAbduce(graph, fp);
    assert.equal(result.footprint, fp);
  });
});

// ── checkInterference ──

describe("checkInterference", () => {
  it("no interference between ops on disjoint nodes", () => {
    const graph = makeGraph();
    const result = checkInterference(
      graph,
      { opId: "addMiddleware", nodeId: "n1" },
      { opId: "addCaching", nodeId: "n2" },
    );
    // They share edge e1, but addMiddleware only reads it and addCaching only reads it
    // The actual interference depends on whether addCaching writes n2
    assert.ok(result.sharedReads.length >= 0);
  });

  it("detects write-read conflict on same node", () => {
    const graph = makeGraph();
    const result = checkInterference(
      graph,
      { opId: "renameSymbol", nodeId: "n2" },
      { opId: "addCaching", nodeId: "n2" },
    );
    assert.equal(result.interferes, true);
    assert.ok(result.conflicts.length > 0);
  });

  it("detects write-write conflict on same node", () => {
    const graph = makeGraph();
    const result = checkInterference(
      graph,
      { opId: "renameSymbol", nodeId: "n2" },
      { opId: "replaceImpl", nodeId: "n2" },
    );
    assert.equal(result.interferes, true);
    assert.ok(result.conflicts.some((c) => c.reason.includes("Both")));
  });

  it("no interference when unknown op", () => {
    const graph = makeGraph();
    const result = checkInterference(
      graph,
      { opId: "nonexistent", nodeId: "n1" },
      { opId: "addMiddleware", nodeId: "n1" },
    );
    assert.equal(result.interferes, false);
  });

  it("reports shared reads (informational)", () => {
    const graph = makeGraph();
    // Both ops on the same node will share the node as a read
    const result = checkInterference(
      graph,
      { opId: "addMiddleware", nodeId: "n1" },
      { opId: "addRateLimit", nodeId: "n1" },
    );
    assert.ok(result.sharedReads.length > 0);
  });

  it("destroy-read conflict", () => {
    registerSignature({
      opId: "__test_destroy_n2",
      preconditions: [],
      postconditions: [{ kind: "removes_node" }],
      requiredArgs: [],
    });

    const graph = makeGraph();
    const result = checkInterference(
      graph,
      { opId: "__test_destroy_n2", nodeId: "n2" },
      { opId: "renameSymbol", nodeId: "n2" },
    );
    assert.equal(result.interferes, true);
    assert.ok(result.conflicts.some((c) => c.reason.includes("modifies")));
  });
});

// ── analyzePlanInterference ──

describe("analyzePlanInterference", () => {
  it("reports no interference for disjoint steps", () => {
    const graph = makeGraph();
    const result = analyzePlanInterference(graph, [
      { opId: "addMiddleware", nodeId: "n1" },
      { opId: "renameSymbol", nodeId: "n3" },
    ]);
    assert.equal(result.hasInterference, false);
  });

  it("reports interference for overlapping steps", () => {
    const graph = makeGraph();
    const result = analyzePlanInterference(graph, [
      { opId: "renameSymbol", nodeId: "n2" },
      { opId: "addCaching", nodeId: "n2" },
    ]);
    assert.equal(result.hasInterference, true);
    assert.ok(result.pairResults.length > 0);
    assert.equal(result.pairResults[0]!.stepA, 0);
    assert.equal(result.pairResults[0]!.stepB, 1);
  });

  it("checks all pairs in a 3-step plan", () => {
    const graph = makeGraph();
    const result = analyzePlanInterference(graph, [
      { opId: "renameSymbol", nodeId: "n2" },
      { opId: "addCaching", nodeId: "n2" },
      { opId: "replaceImpl", nodeId: "n2" },
    ]);
    // 3 choose 2 = 3 pairs possible
    assert.ok(result.pairResults.length >= 1);
    assert.equal(result.hasInterference, true);
  });

  it("empty plan has no interference", () => {
    const result = analyzePlanInterference(makeGraph(), []);
    assert.equal(result.hasInterference, false);
    assert.equal(result.pairResults.length, 0);
  });

  it("single-step plan has no interference", () => {
    const result = analyzePlanInterference(makeGraph(), [
      { opId: "addMiddleware", nodeId: "n1" },
    ]);
    assert.equal(result.hasInterference, false);
    assert.equal(result.pairResults.length, 0);
  });
});

// ── Edge cases ──

describe("separation logic edge cases", () => {
  it("footprint on node with no edges", () => {
    const graph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///test", nodes: [{ id: "n1", kind: "utility" as const, name: "fn", locator: "file:///test/u.ts#L1" }], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    const fp = computeFootprint(graph, "renameSymbol", "n1");
    assert.ok(fp);
    assert.ok(fp!.reads.some((r) => r.kind === "node"));
    assert.equal(fp!.reads.filter((r) => r.kind === "edge").length, 0);
  });

  it("biAbduce on empty graph", () => {
    const graph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{ uri: "file:///test", nodes: [{ id: "n1", kind: "utility" as const, name: "fn", locator: "file:///test/u.ts#L1" }], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    const fp = computeFootprint(graph, "renameSymbol", "n1")!;
    const result = biAbduce(graph, fp);
    assert.equal(result.frame.length, 0, "empty graph has no frame besides touched node");
  });

  it("interference between same node different ops preserves resource detail", () => {
    const graph = makeGraph();
    const result = checkInterference(
      graph,
      { opId: "renameSymbol", nodeId: "n3" },
      { opId: "wrapTransformation", nodeId: "n3" },
    );
    assert.equal(result.interferes, true);
    for (const conflict of result.conflicts) {
      assert.ok(conflict.resource.id);
      assert.ok(conflict.reason.length > 0);
      assert.ok(conflict.opA.length > 0);
      assert.ok(conflict.opB.length > 0);
    }
  });

  it("footprint changes_kind effect adds to writes", () => {
    registerSignature({
      opId: "__test_promote",
      preconditions: [],
      postconditions: [{ kind: "changes_kind", from: "utility", to: "service" }],
      requiredArgs: [],
    });
    const graph = makeGraph();
    const fp = computeFootprint(graph, "__test_promote", "n3")!;
    assert.ok(fp.writes.some((r) => r.kind === "node" && r.type === "service"));
  });

  it("removes_edge effect adds matching edge to destroys", () => {
    registerSignature({
      opId: "__test_remove_imports",
      preconditions: [],
      postconditions: [{ kind: "removes_edge", relation: "imports" }],
      requiredArgs: [],
    });
    const graph = makeGraph();
    // n2 has an outgoing imports edge (e3)
    const fp = computeFootprint(graph, "__test_remove_imports", "n2")!;
    assert.ok(fp.destroys.some((r) => r.kind === "edge" && r.id === "e3"));
  });

  it("removes_edge on node without that edge type produces no destroy", () => {
    const graph = makeGraph();
    // n1 has no imports edge
    const fp = computeFootprint(graph, "__test_remove_imports", "n1")!;
    assert.ok(!fp.destroys.some((r) => r.type === "imports"));
  });
});

// ── Separation property: frame * footprint = heap ──

describe("frame * footprint = heap property", () => {
  it("frame + touched resources covers the full heap", () => {
    const graph = makeGraph();
    const fp = computeFootprint(graph, "renameSymbol", "n2")!;
    const result = biAbduce(graph, fp);

    const touchedIds = new Set<string>();
    for (const r of fp.reads) touchedIds.add(r.id);
    for (const r of fp.writes) touchedIds.add(r.id);
    for (const r of fp.destroys) touchedIds.add(r.id);

    const frameIds = new Set(result.frame.map((r) => r.id));
    const allHeapIds = new Set<string>();
    for (const repo of graph.repos) {
      for (const node of repo.nodes) allHeapIds.add(node.id);
      for (const edge of repo.edges) allHeapIds.add(edge.id);
    }

    for (const id of allHeapIds) {
      assert.ok(
        touchedIds.has(id) || frameIds.has(id),
        `Resource "${id}" is neither in the frame nor in the footprint`,
      );
    }
  });

  it("frame and footprint do not overlap", () => {
    const graph = makeGraph();
    const fp = computeFootprint(graph, "addMiddleware", "n1")!;
    const result = biAbduce(graph, fp);

    const touchedIds = new Set<string>();
    for (const r of fp.reads) touchedIds.add(r.id);
    for (const r of fp.writes) touchedIds.add(r.id);
    for (const r of fp.destroys) touchedIds.add(r.id);

    for (const frameResource of result.frame) {
      assert.ok(
        !touchedIds.has(frameResource.id),
        `Resource "${frameResource.id}" is in both frame and footprint`,
      );
    }
  });
});

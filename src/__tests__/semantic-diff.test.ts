// Tests for the semantic diff engine: refactoring detection, impact scoring, semantic summary.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MultiRepoGraph, GraphNode, GraphEdge } from "../domain/multi-repo.ts";
import type { NodeDelta } from "../domain/delta.ts";
import { detectRefactorings } from "../domain/refactoring-detect.ts";
import { computeImpactScores } from "../domain/impact-score.ts";
import { computeSemanticSummary } from "../domain/semantic-summary.ts";
import { computeSemanticDiff } from "../domain/semantic-diff.ts";
import { bodyFingerprint } from "../domain/body-fingerprint.ts";

function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): MultiRepoGraph {
  return {
    version: "0.1.0",
    repos: [{ uri: "file:///test", nodes, edges, clusters: [] }],
    interRepoEdges: [],
  };
}

function node(id: string, name: string, kind: string, file: string, body?: string): GraphNode {
  return {
    id, kind, name,
    locator: `file://${file}#${id}`,
    filePath: file,
    startLine: 1, endLine: 10,
    bodyFingerprint: body ? bodyFingerprint(body) : undefined,
  };
}

function edge(source: string, target: string, relation: string): GraphEdge {
  return { id: `${source}->${target}:${relation}`, source, target, relation };
}

// ── Refactoring detection ──

describe("refactoring-detect", () => {
  it("detects a rename (same file, same body, different name)", () => {
    const body = "function foo() { return 1 + 2; }";
    const base = makeGraph([node("n1", "handleUser", "utility", "/src/a.ts", body)]);
    const head = makeGraph([node("n2", "processUser", "utility", "/src/a.ts", body)]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "removed" },
      { id: "n2", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]!.classification, "renamed");
    assert.equal(result.matches[0]!.baseName, "handleUser");
    assert.equal(result.matches[0]!.headName, "processUser");

    const removedDelta = result.enrichedNodes.find((n) => n.id === "n1")!;
    assert.equal(removedDelta.classification, "renamed");
    assert.equal(removedDelta.renamedTo, "n2");

    const addedDelta = result.enrichedNodes.find((n) => n.id === "n2")!;
    assert.equal(addedDelta.classification, "renamed");
    assert.equal(addedDelta.renamedFrom, "n1");
  });

  it("detects a move (different file, same body, same name)", () => {
    const body = "function validate() { check(); }";
    const base = makeGraph([node("n1", "validate", "utility", "/src/old.ts", body)]);
    const head = makeGraph([node("n2", "validate", "utility", "/src/new.ts", body)]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "removed" },
      { id: "n2", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]!.classification, "moved");

    const removedDelta = result.enrichedNodes.find((n) => n.id === "n1")!;
    assert.equal(removedDelta.classification, "moved");
    assert.equal(removedDelta.movedTo, "/src/new.ts");

    const addedDelta = result.enrichedNodes.find((n) => n.id === "n2")!;
    assert.equal(addedDelta.classification, "moved");
    assert.equal(addedDelta.movedFrom, "/src/old.ts");
  });

  it("detects an extraction (new node called by modified parent)", () => {
    const parentBody1 = "function main() { doA(); doB(); doC(); }";
    const parentBody2 = "function main() { helper(); doC(); }";
    const extractedBody = "function helper() { doA(); doB(); }";

    const base = makeGraph(
      [node("parent", "main", "utility", "/src/a.ts", parentBody1)],
      [],
    );
    const head = makeGraph(
      [
        node("parent", "main", "utility", "/src/a.ts", parentBody2),
        node("helper", "helper", "utility", "/src/a.ts", extractedBody),
      ],
      [edge("parent", "helper", "calls")],
    );
    const rawDeltas: NodeDelta[] = [
      { id: "parent", status: "modified" },
      { id: "helper", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);

    const helperDelta = result.enrichedNodes.find((n) => n.id === "helper")!;
    assert.equal(helperDelta.classification, "extracted");
    assert.equal(helperDelta.extractedFrom, "parent");
  });

  it("detects an inline (removed node, caller modified, call edge gone)", () => {
    const helperBody = "function helper() { doA(); }";
    const callerBody1 = "function main() { helper(); doB(); }";
    const callerBody2 = "function main() { doA(); doB(); }";

    const base = makeGraph(
      [
        node("caller", "main", "utility", "/src/a.ts", callerBody1),
        node("helper", "helper", "utility", "/src/a.ts", helperBody),
      ],
      [edge("caller", "helper", "calls")],
    );
    const head = makeGraph(
      [node("caller", "main", "utility", "/src/a.ts", callerBody2)],
      [],
    );
    const rawDeltas: NodeDelta[] = [
      { id: "caller", status: "modified" },
      { id: "helper", status: "removed" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);

    const helperDelta = result.enrichedNodes.find((n) => n.id === "helper")!;
    assert.equal(helperDelta.classification, "inlined");
    assert.equal(helperDelta.inlinedInto, "caller");
  });

  it("detects a signature change (same body fingerprint, different name/location)", () => {
    const body = "function foo() { return 42; }";
    const base = makeGraph([node("n1", "foo", "utility", "/src/a.ts", body)]);
    const headNode = { ...node("n1", "foo", "utility", "/src/a.ts", body), startLine: 5 };
    const head = makeGraph([headNode]);
    const rawDeltas: NodeDelta[] = [{ id: "n1", status: "modified", reasons: ["startLine"] }];

    const result = detectRefactorings(base, head, rawDeltas);

    const n1Delta = result.enrichedNodes.find((n) => n.id === "n1")!;
    assert.equal(n1Delta.classification, "signature_changed");
  });

  it("does not false-positive on unrelated added+removed with different bodies", () => {
    const base = makeGraph([node("n1", "old", "utility", "/src/a.ts", "function old() { return 1; }")]);
    const head = makeGraph([node("n2", "fresh", "utility", "/src/a.ts", "function fresh() { return 99; }")]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "removed" },
      { id: "n2", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    assert.equal(result.matches.length, 0);
  });

  it("classifies plain modified nodes as 'modified'", () => {
    const base = makeGraph([node("n1", "foo", "utility", "/src/a.ts", "return 1")]);
    const head = makeGraph([node("n1", "foo", "utility", "/src/a.ts", "return 2")]);
    const rawDeltas: NodeDelta[] = [{ id: "n1", status: "modified", reasons: ["body"] }];

    const result = detectRefactorings(base, head, rawDeltas);
    const n1 = result.enrichedNodes.find((n) => n.id === "n1")!;
    assert.equal(n1.classification, "modified");
  });

  it("detects move+rename (different file AND different name, same body)", () => {
    const body = "function x() { return a * b; }";
    const base = makeGraph([node("n1", "calcArea", "utility", "/src/math.ts", body)]);
    const head = makeGraph([node("n2", "computeArea", "utility", "/src/geometry.ts", body)]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "removed" },
      { id: "n2", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]!.classification, "moved");

    const addedDelta = result.enrichedNodes.find((n) => n.id === "n2")!;
    assert.equal(addedDelta.classification, "moved");
    assert.equal(addedDelta.movedFrom, "/src/math.ts");
    assert.equal(addedDelta.renamedFrom, "n1");
  });

  it("handles multiple renames in the same file without cross-matching", () => {
    const body1 = "function a() { return 1; }";
    const body2 = "function b() { return 2; }";
    const base = makeGraph([
      node("n1", "foo", "utility", "/src/a.ts", body1),
      node("n2", "bar", "utility", "/src/a.ts", body2),
    ]);
    const head = makeGraph([
      node("n3", "fooRenamed", "utility", "/src/a.ts", body1),
      node("n4", "barRenamed", "utility", "/src/a.ts", body2),
    ]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "removed" },
      { id: "n2", status: "removed" },
      { id: "n3", status: "added" },
      { id: "n4", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    assert.equal(result.matches.length, 2);
    assert.ok(result.matches.every((m) => m.classification === "renamed"));

    const n3 = result.enrichedNodes.find((n) => n.id === "n3")!;
    const n4 = result.enrichedNodes.find((n) => n.id === "n4")!;
    assert.equal(n3.classification, "renamed");
    assert.equal(n4.classification, "renamed");
  });

  it("gracefully handles nodes without fingerprints (no false matches)", () => {
    const base = makeGraph([node("n1", "foo", "utility", "/src/a.ts")]);
    const head = makeGraph([node("n2", "bar", "utility", "/src/a.ts")]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "removed" },
      { id: "n2", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    assert.equal(result.matches.length, 0);
  });

  it("detects extraction even when nodes lack fingerprints (call-edge signal)", () => {
    const base = makeGraph(
      [node("parent", "main", "utility", "/src/a.ts")],
      [],
    );
    const head = makeGraph(
      [
        node("parent", "main", "utility", "/src/a.ts"),
        node("helper", "helper", "utility", "/src/a.ts"),
      ],
      [edge("parent", "helper", "calls")],
    );
    const rawDeltas: NodeDelta[] = [
      { id: "parent", status: "modified" },
      { id: "helper", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    const helperDelta = result.enrichedNodes.find((n) => n.id === "helper")!;
    assert.equal(helperDelta.classification, "extracted");
  });

  it("leaves unchanged nodes untouched (no classification, no overrides)", () => {
    const base = makeGraph([
      node("n1", "foo", "utility", "/src/a.ts", "return 1"),
      node("n2", "bar", "utility", "/src/b.ts", "return 2"),
    ]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "unchanged" },
      { id: "n2", status: "unchanged" },
    ];

    const result = detectRefactorings(base, base, rawDeltas);
    assert.equal(result.matches.length, 0);
    for (const d of result.enrichedNodes) {
      assert.equal(d.status, "unchanged");
      assert.equal(d.classification, undefined);
    }
  });

  it("handles all-added diff (brand new code)", () => {
    const base = makeGraph([]);
    const head = makeGraph([
      node("n1", "newFunc", "utility", "/src/new.ts", "return 42"),
      node("n2", "anotherNew", "service", "/src/new.ts", "return 99"),
    ]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "added" },
      { id: "n2", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    assert.equal(result.matches.length, 0);
  });

  it("handles all-removed diff (deleted code)", () => {
    const base = makeGraph([
      node("n1", "oldFunc", "utility", "/src/old.ts", "return 1"),
      node("n2", "oldHelper", "utility", "/src/old.ts", "return 2"),
    ]);
    const head = makeGraph([]);
    const rawDeltas: NodeDelta[] = [
      { id: "n1", status: "removed" },
      { id: "n2", status: "removed" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    assert.equal(result.matches.length, 0);
  });

  it("does not detect inline when caller is unchanged", () => {
    const base = makeGraph(
      [
        node("caller", "main", "utility", "/src/a.ts", "call helper"),
        node("helper", "helper", "utility", "/src/a.ts", "do stuff"),
      ],
      [edge("caller", "helper", "calls")],
    );
    const head = makeGraph(
      [node("caller", "main", "utility", "/src/a.ts", "call helper")],
      [],
    );
    const rawDeltas: NodeDelta[] = [
      { id: "caller", status: "unchanged" },
      { id: "helper", status: "removed" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    const helperDelta = result.enrichedNodes.find((n) => n.id === "helper")!;
    assert.notEqual(helperDelta.classification, "inlined");
  });

  it("does not match same-name same-file same-body nodes as rename (identical except ID)", () => {
    const body = "function same() { return true; }";
    const base = makeGraph([node("id-old", "same", "utility", "/src/a.ts", body)]);
    const head = makeGraph([node("id-new", "same", "utility", "/src/a.ts", body)]);
    const rawDeltas: NodeDelta[] = [
      { id: "id-old", status: "removed" },
      { id: "id-new", status: "added" },
    ];

    const result = detectRefactorings(base, head, rawDeltas);
    // Same name + same file → doesn't match rename (requires different name)
    // Same name + same file → doesn't match move (requires different file)
    // Should have 0 matches — the ID changed but that's a locator/extraction change, not a rename
    assert.equal(result.matches.length, 0);
  });
});

// ── Impact scoring ──

describe("impact-score", () => {
  it("counts upstream and downstream for a changed node in a call chain", () => {
    const nodes = [
      node("a", "A", "utility", "/src/a.ts"),
      node("b", "B", "service", "/src/b.ts"),
      node("c", "C", "utility", "/src/c.ts"),
      node("d", "D", "utility", "/src/d.ts"),
    ];
    const edges = [
      edge("a", "b", "calls"),
      edge("b", "c", "calls"),
      edge("c", "d", "calls"),
    ];
    const graph = makeGraph(nodes, edges);

    const deltas: NodeDelta[] = [
      { id: "a", status: "unchanged" },
      { id: "b", status: "unchanged" },
      { id: "c", status: "modified" },
      { id: "d", status: "unchanged" },
    ];

    const result = computeImpactScores(graph, deltas);
    const cDelta = result.enrichedNodes.find((n) => n.id === "c")!;
    assert.equal(cDelta.impactedUpstream, 2);
    assert.equal(cDelta.impactedDownstream, 1);
  });

  it("collects impacted contracts", () => {
    const nodes = [
      node("handler", "handler", "route_handler", "/src/h.ts"),
      node("svc", "svc", "service", "/src/s.ts"),
      node("api", "POST /users", "contract", "/src/api.ts"),
    ];
    const edges = [
      edge("handler", "svc", "calls"),
      edge("svc", "api", "calls"),
    ];
    const graph = makeGraph(nodes, edges);
    const deltas: NodeDelta[] = [
      { id: "handler", status: "modified" },
      { id: "svc", status: "unchanged" },
      { id: "api", status: "unchanged" },
    ];

    const result = computeImpactScores(graph, deltas);
    const hDelta = result.enrichedNodes.find((n) => n.id === "handler")!;
    assert.ok(hDelta.impactedContracts?.includes("api"));
    assert.equal(result.impactSummary.totalImpactedContracts, 1);
  });

  it("reports highest-impact node", () => {
    const nodes = [
      node("hub", "hub", "utility", "/src/h.ts"),
      node("a", "a", "utility", "/src/a.ts"),
      node("b", "b", "utility", "/src/b.ts"),
      node("c", "c", "utility", "/src/c.ts"),
      node("leaf", "leaf", "utility", "/src/l.ts"),
    ];
    const edges = [
      edge("a", "hub", "calls"),
      edge("b", "hub", "calls"),
      edge("c", "hub", "calls"),
      edge("hub", "leaf", "calls"),
    ];
    const graph = makeGraph(nodes, edges);
    const deltas: NodeDelta[] = [
      { id: "hub", status: "modified" },
      { id: "leaf", status: "modified" },
      { id: "a", status: "unchanged" },
      { id: "b", status: "unchanged" },
      { id: "c", status: "unchanged" },
    ];

    const result = computeImpactScores(graph, deltas);
    assert.equal(result.impactSummary.highestImpactNode?.name, "hub");
    assert.ok(result.impactSummary.highestImpactNode!.impact >= 4);
  });

  it("handles cycles in the call graph without infinite loop", () => {
    const nodes = [
      node("a", "A", "utility", "/src/a.ts"),
      node("b", "B", "utility", "/src/b.ts"),
      node("c", "C", "utility", "/src/c.ts"),
    ];
    const edges = [
      edge("a", "b", "calls"),
      edge("b", "c", "calls"),
      edge("c", "a", "calls"),
    ];
    const graph = makeGraph(nodes, edges);
    const deltas: NodeDelta[] = [
      { id: "a", status: "modified" },
      { id: "b", status: "unchanged" },
      { id: "c", status: "unchanged" },
    ];

    const result = computeImpactScores(graph, deltas);
    const aDelta = result.enrichedNodes.find((n) => n.id === "a")!;
    assert.equal(aDelta.impactedDownstream, 2);
    assert.equal(aDelta.impactedUpstream, 2);
  });

  it("caps BFS at depth 10 for long chains", () => {
    const count = 15;
    const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, `N${i}`, "utility", `/src/${i}.ts`));
    const edges = Array.from({ length: count - 1 }, (_, i) => edge(`n${i}`, `n${i + 1}`, "calls"));
    const graph = makeGraph(nodes, edges);
    const deltas: NodeDelta[] = nodes.map((n, i) => ({ id: n.id, status: i === 0 ? "modified" as const : "unchanged" as const }));

    const result = computeImpactScores(graph, deltas);
    const n0 = result.enrichedNodes.find((n) => n.id === "n0")!;
    assert.ok(n0.impactedDownstream! <= 10, `downstream should cap at 10, got ${n0.impactedDownstream}`);
  });

  it("does not add impact scores to unchanged nodes", () => {
    const graph = makeGraph(
      [node("a", "A", "utility", "/src/a.ts"), node("b", "B", "utility", "/src/b.ts")],
      [edge("a", "b", "calls")],
    );
    const deltas: NodeDelta[] = [
      { id: "a", status: "unchanged" },
      { id: "b", status: "unchanged" },
    ];

    const result = computeImpactScores(graph, deltas);
    for (const d of result.enrichedNodes) {
      assert.equal(d.impactedUpstream, undefined);
      assert.equal(d.impactedDownstream, undefined);
    }
  });

  it("handles isolated changed node with no edges (zero impact)", () => {
    const graph = makeGraph([node("lonely", "lonely", "utility", "/src/l.ts")]);
    const deltas: NodeDelta[] = [{ id: "lonely", status: "modified" }];

    const result = computeImpactScores(graph, deltas);
    const d = result.enrichedNodes.find((n) => n.id === "lonely")!;
    assert.equal(d.impactedUpstream, 0);
    assert.equal(d.impactedDownstream, 0);
    assert.equal(d.impactedContracts, undefined);
    assert.equal(result.impactSummary.totalImpactedNodes, 0);
  });

  it("follows imports edges for upstream impact", () => {
    const nodes = [
      node("file-a", "a.ts", "utility", "/src/a.ts"),
      node("file-b", "b.ts", "utility", "/src/b.ts"),
    ];
    const edges = [edge("file-a", "file-b", "imports")];
    const graph = makeGraph(nodes, edges);
    const deltas: NodeDelta[] = [
      { id: "file-b", status: "modified" },
      { id: "file-a", status: "unchanged" },
    ];

    const result = computeImpactScores(graph, deltas);
    const bDelta = result.enrichedNodes.find((n) => n.id === "file-b")!;
    assert.equal(bDelta.impactedUpstream, 1);
  });

  it("aggregates impact across multiple changed nodes", () => {
    const nodes = [
      node("a", "A", "utility", "/src/a.ts"),
      node("b", "B", "utility", "/src/b.ts"),
      node("shared", "shared", "utility", "/src/s.ts"),
    ];
    const edges = [
      edge("a", "shared", "calls"),
      edge("b", "shared", "calls"),
    ];
    const graph = makeGraph(nodes, edges);
    const deltas: NodeDelta[] = [
      { id: "a", status: "modified" },
      { id: "b", status: "modified" },
      { id: "shared", status: "unchanged" },
    ];

    const result = computeImpactScores(graph, deltas);
    assert.ok(result.impactSummary.totalImpactedNodes >= 1);
  });
});

// ── Semantic summary ──

describe("semantic-summary", () => {
  it("classifies all-renames as semantic_noop", () => {
    const deltas: NodeDelta[] = [
      { id: "n1", status: "removed", classification: "renamed", renamedTo: "n2" },
      { id: "n2", status: "added", classification: "renamed", renamedFrom: "n1" },
      { id: "n3", status: "unchanged" },
    ];
    const impact = { totalImpactedNodes: 0, totalImpactedContracts: 0 };
    const result = computeSemanticSummary(deltas, impact, 200);

    assert.equal(result.classification, "semantic_noop");
    assert.ok(result.headline.includes("0-line change"));
    assert.equal(result.substantiveChanges, 0);
    assert.equal(result.mechanicalChanges, 2);
  });

  it("classifies mixed renames+modifications as mixed", () => {
    const deltas: NodeDelta[] = [
      { id: "n1", status: "removed", classification: "renamed", renamedTo: "n2" },
      { id: "n2", status: "added", classification: "renamed", renamedFrom: "n1" },
      { id: "n3", status: "modified", classification: "modified" },
    ];
    const impact = { totalImpactedNodes: 3, totalImpactedContracts: 0 };
    const result = computeSemanticSummary(deltas, impact, 500);

    assert.equal(result.classification, "mixed");
    assert.equal(result.substantiveChanges, 1);
    assert.equal(result.mechanicalChanges, 2);
  });

  it("classifies small real changes as low_impact", () => {
    const deltas: NodeDelta[] = [
      { id: "n1", status: "modified", classification: "modified" },
      { id: "n2", status: "unchanged" },
    ];
    const impact = { totalImpactedNodes: 3, totalImpactedContracts: 0 };
    const result = computeSemanticSummary(deltas, impact, 50);

    assert.equal(result.classification, "low_impact");
  });

  it("classifies large changes as high_impact", () => {
    const deltas: NodeDelta[] = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`, status: "modified" as const, classification: "modified" as const,
    }));
    const impact = { totalImpactedNodes: 100, totalImpactedContracts: 5 };
    const result = computeSemanticSummary(deltas, impact, 2000);

    assert.equal(result.classification, "high_impact");
  });

  it("handles empty diff", () => {
    const result = computeSemanticSummary([], { totalImpactedNodes: 0, totalImpactedContracts: 0 }, 0);
    assert.equal(result.classification, "semantic_noop");
    assert.equal(result.substantiveChanges, 0);
  });

  it("classifies extracted+inlined as semantic_noop (all mechanical)", () => {
    const deltas: NodeDelta[] = [
      { id: "n1", status: "added", classification: "extracted", extractedFrom: "parent" },
      { id: "n2", status: "removed", classification: "inlined", inlinedInto: "caller" },
    ];
    const impact = { totalImpactedNodes: 2, totalImpactedContracts: 0 };
    const result = computeSemanticSummary(deltas, impact, 100);

    assert.equal(result.classification, "semantic_noop");
    assert.equal(result.mechanicalChanges, 2);
  });

  it("produces valid headline for semantic_noop", () => {
    const deltas: NodeDelta[] = [
      { id: "n1", status: "removed", classification: "moved", movedTo: "/new.ts" },
    ];
    const impact = { totalImpactedNodes: 0, totalImpactedContracts: 0 };
    const result = computeSemanticSummary(deltas, impact, 300);

    assert.ok(result.headline.includes("300-line"));
    assert.ok(result.headline.includes("0-line change"));
    assert.ok(result.headline.includes("1 moved"));
  });

  it("produces valid headline for mixed", () => {
    const deltas: NodeDelta[] = [
      { id: "n1", status: "removed", classification: "renamed" },
      { id: "n2", status: "modified", classification: "modified" },
    ];
    const impact = { totalImpactedNodes: 5, totalImpactedContracts: 1 };
    const result = computeSemanticSummary(deltas, impact, 400);

    assert.ok(result.headline.includes("400-line"));
    assert.ok(result.headline.includes("1-node change"));
  });

  it("classifies 4 substantive + 0 mechanical + low impact as low_impact", () => {
    const deltas: NodeDelta[] = Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`, status: "modified" as const, classification: "modified" as const,
    }));
    const impact = { totalImpactedNodes: 5, totalImpactedContracts: 0 };
    const result = computeSemanticSummary(deltas, impact, 100);
    assert.equal(result.classification, "low_impact");
  });

  it("counts unclassified added/removed nodes as substantive", () => {
    const deltas: NodeDelta[] = [
      { id: "n1", status: "added" },
      { id: "n2", status: "removed" },
    ];
    const impact = { totalImpactedNodes: 0, totalImpactedContracts: 0 };
    const result = computeSemanticSummary(deltas, impact, 30);
    assert.equal(result.substantiveChanges, 2);
    assert.equal(result.mechanicalChanges, 0);
    assert.equal(result.classification, "low_impact");
  });

  it("classifies 4 substantive + high impact as high_impact", () => {
    const deltas: NodeDelta[] = Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`, status: "modified" as const, classification: "modified" as const,
    }));
    const impact = { totalImpactedNodes: 50, totalImpactedContracts: 3 };
    const result = computeSemanticSummary(deltas, impact, 100);
    assert.equal(result.classification, "high_impact");
  });
});

// ── Full pipeline (computeSemanticDiff) ──

describe("computeSemanticDiff (full pipeline)", () => {
  it("runs all three passes and produces complete result", () => {
    const body = "function foo() { return x + y; }";
    const base = makeGraph(
      [
        node("n1", "oldName", "utility", "/src/a.ts", body),
        node("caller", "main", "service", "/src/main.ts", "function main() { oldName(); }"),
      ],
      [edge("caller", "n1", "calls")],
    );
    const head = makeGraph(
      [
        node("n2", "newName", "utility", "/src/a.ts", body),
        node("caller", "main", "service", "/src/main.ts", "function main() { newName(); }"),
      ],
      [edge("caller", "n2", "calls")],
    );

    const result = computeSemanticDiff(base, head, 50);

    assert.ok(result.semanticSummary);
    assert.ok(result.impactSummary);
    assert.ok(result.nodes.length > 0);

    const renamedNode = result.nodes.find((n) => n.classification === "renamed");
    assert.ok(renamedNode, "should detect the rename");
  });

  it("correctly distinguishes signature change from body change", () => {
    const body = "return 42";
    const base = makeGraph([
      { ...node("n1", "foo", "utility", "/src/a.ts", body), startLine: 1, endLine: 5 },
    ]);
    const head = makeGraph([
      { ...node("n1", "foo", "utility", "/src/a.ts", body), startLine: 10, endLine: 15 },
    ]);

    const result = computeSemanticDiff(base, head);
    const n = result.nodes.find((n) => n.id === "n1")!;
    assert.equal(n.classification, "signature_changed");
  });

  it("produces semantic_noop for a pure rename diff", () => {
    const body = "function x() { return 1 + 2 + 3; }";
    const base = makeGraph([node("n1", "oldName", "utility", "/src/a.ts", body)]);
    const head = makeGraph([node("n2", "newName", "utility", "/src/a.ts", body)]);

    const result = computeSemanticDiff(base, head, 200);
    assert.equal(result.semanticSummary?.classification, "semantic_noop");
    assert.equal(result.semanticSummary?.substantiveChanges, 0);
    assert.equal(result.semanticSummary?.mechanicalChanges, 2);
  });

  it("produces high_impact for large substantive diff with deep call graph", () => {
    const chainLen = 8;
    const baseNodes = Array.from({ length: chainLen }, (_, i) =>
      node(`n${i}`, `fn${i}`, "utility", `/src/${i}.ts`, `body-${i}`),
    );
    const baseEdges = Array.from({ length: chainLen - 1 }, (_, i) =>
      edge(`n${i}`, `n${i + 1}`, "calls"),
    );

    const headNodes = baseNodes.map((n, i) => i < 5
      ? node(n.id, n.name, n.kind, n.filePath!, `body-${i}-modified`)
      : n,
    );

    const base = makeGraph(baseNodes, baseEdges);
    const head = makeGraph(headNodes, baseEdges);

    const result = computeSemanticDiff(base, head, 1000);
    assert.equal(result.semanticSummary?.classification, "high_impact");
    assert.ok(result.semanticSummary!.substantiveChanges >= 5);
    assert.ok(result.impactSummary!.totalImpactedNodes > 0);
  });

  it("handles identical graphs (no changes)", () => {
    const g = makeGraph([node("n1", "foo", "utility", "/src/a.ts", "body")]);
    const result = computeSemanticDiff(g, g);

    assert.equal(result.counts.nodesAdded, 0);
    assert.equal(result.counts.nodesRemoved, 0);
    assert.equal(result.counts.nodesModified, 0);
    assert.equal(result.semanticSummary?.classification, "semantic_noop");
  });

  it("handles multi-repo graphs", () => {
    const body = "function shared() { return true; }";
    const base: MultiRepoGraph = {
      version: "0.1.0",
      repos: [
        { uri: "file:///repo1", nodes: [node("n1", "shared", "utility", "/repo1/a.ts", body)], edges: [], clusters: [] },
        { uri: "file:///repo2", nodes: [node("n2", "consumer", "service", "/repo2/b.ts", "use()")], edges: [], clusters: [] },
      ],
      interRepoEdges: [],
    };
    const head: MultiRepoGraph = {
      version: "0.1.0",
      repos: [
        { uri: "file:///repo1", nodes: [node("n1r", "sharedRenamed", "utility", "/repo1/a.ts", body)], edges: [], clusters: [] },
        { uri: "file:///repo2", nodes: [node("n2", "consumer", "service", "/repo2/b.ts", "use()")], edges: [], clusters: [] },
      ],
      interRepoEdges: [],
    };

    const result = computeSemanticDiff(base, head, 10);
    const renamed = result.nodes.find((n) => n.classification === "renamed");
    assert.ok(renamed, "should detect rename across repos");
  });
});

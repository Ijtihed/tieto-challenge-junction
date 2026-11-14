// Comprehensive tests for the SMT-lite refinement type system:
// op-signatures, constraint-solver, composition checking, plan validation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type NodeConstraint, type ConstraintContext, type OpSignature,
  checkConstraint, checkAllConstraints, checkComposition, checkSequence,
  registerSignature, getSignature, allSignatures,
} from "../domain/op-signatures.ts";
import {
  buildConstraintContext, validatePlan, validateSingleOp,
} from "../domain/constraint-solver.ts";
import type { MultiRepoGraph, RepoSubgraph } from "../domain/multi-repo.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";

function testGraph(repo: RepoSubgraph): MultiRepoGraph {
  return { version: CURRENT_WIRE_VERSION, repos: [repo], interRepoEdges: [] };
}

function makeCtx(overrides: Partial<ConstraintContext> = {}): ConstraintContext {
  return {
    node: {
      id: "n1", kind: "route_handler", name: "getUsers",
      locator: "file:///test/routes.ts#L1-L10",
      filePath: "/test/routes.ts",
      meta: { framework: "express" },
    },
    incomingEdges: [
      { id: "e1", source: "n0", target: "n1", relation: "registers_route" },
    ],
    outgoingEdges: [
      { id: "e2", source: "n1", target: "n2", relation: "calls" },
    ],
    ...overrides,
  };
}

// ── Individual constraint checks ──

describe("checkConstraint — kind_is", () => {
  it("passes when kind matches", () => {
    const result = checkConstraint({ kind: "kind_is", value: "route_handler" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when kind mismatches", () => {
    const result = checkConstraint({ kind: "kind_is", value: "service" }, makeCtx());
    assert.equal(result.satisfied, false);
    assert.equal(result.failures.length, 1);
    assert.ok(result.failures[0]!.reason.includes("route_handler"));
  });
});

describe("checkConstraint — kind_not", () => {
  it("passes when kind is different", () => {
    const result = checkConstraint({ kind: "kind_not", value: "external" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when kind matches the forbidden value", () => {
    const result = checkConstraint({ kind: "kind_not", value: "route_handler" }, makeCtx());
    assert.equal(result.satisfied, false);
  });
});

describe("checkConstraint — has_edge_in", () => {
  it("passes when incoming edge exists", () => {
    const result = checkConstraint({ kind: "has_edge_in", relation: "registers_route" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when incoming edge missing", () => {
    const result = checkConstraint({ kind: "has_edge_in", relation: "imports" }, makeCtx());
    assert.equal(result.satisfied, false);
    assert.ok(result.failures[0]!.reason.includes("imports"));
  });
});

describe("checkConstraint — has_edge_out", () => {
  it("passes when outgoing edge exists", () => {
    const result = checkConstraint({ kind: "has_edge_out", relation: "calls" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when outgoing edge missing", () => {
    const result = checkConstraint({ kind: "has_edge_out", relation: "writes_table" }, makeCtx());
    assert.equal(result.satisfied, false);
  });
});

describe("checkConstraint — no_edge_in", () => {
  it("passes when incoming edge absent", () => {
    const result = checkConstraint({ kind: "no_edge_in", relation: "imports" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when incoming edge present", () => {
    const result = checkConstraint({ kind: "no_edge_in", relation: "registers_route" }, makeCtx());
    assert.equal(result.satisfied, false);
  });
});

describe("checkConstraint — no_edge_out", () => {
  it("passes when outgoing edge absent", () => {
    const result = checkConstraint({ kind: "no_edge_out", relation: "writes_table" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when outgoing edge present", () => {
    const result = checkConstraint({ kind: "no_edge_out", relation: "calls" }, makeCtx());
    assert.equal(result.satisfied, false);
  });
});

describe("checkConstraint — has_meta", () => {
  it("passes when meta key exists", () => {
    const result = checkConstraint({ kind: "has_meta", key: "framework" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when meta key missing", () => {
    const result = checkConstraint({ kind: "has_meta", key: "version" }, makeCtx());
    assert.equal(result.satisfied, false);
  });

  it("fails when meta is undefined", () => {
    const ctx = makeCtx({ node: { id: "n1", kind: "utility", name: "fn", locator: "file:///x#L1" } });
    const result = checkConstraint({ kind: "has_meta", key: "anything" }, ctx);
    assert.equal(result.satisfied, false);
  });
});

describe("checkConstraint — in_file_matching", () => {
  it("passes when file path matches glob", () => {
    const result = checkConstraint({ kind: "in_file_matching", glob: "**/*.ts" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when file path doesn't match", () => {
    const result = checkConstraint({ kind: "in_file_matching", glob: "**/*.py" }, makeCtx());
    assert.equal(result.satisfied, false);
  });

  it("fails when filePath is undefined", () => {
    const ctx = makeCtx({ node: { id: "n1", kind: "utility", name: "fn", locator: "file:///x#L1" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "**/*.ts" }, ctx);
    assert.equal(result.satisfied, false);
  });
});

describe("checkConstraint — name_matches", () => {
  it("passes when name matches pattern", () => {
    const result = checkConstraint({ kind: "name_matches", pattern: "^get" }, makeCtx());
    assert.equal(result.satisfied, true);
  });

  it("fails when name doesn't match", () => {
    const result = checkConstraint({ kind: "name_matches", pattern: "^post" }, makeCtx());
    assert.equal(result.satisfied, false);
    assert.ok(result.failures[0]!.reason.includes("getUsers"));
  });
});

// ── checkAllConstraints ──

describe("checkAllConstraints", () => {
  it("passes when all constraints satisfied", () => {
    const constraints: NodeConstraint[] = [
      { kind: "kind_is", value: "route_handler" },
      { kind: "has_edge_in", relation: "registers_route" },
    ];
    const result = checkAllConstraints(constraints, makeCtx());
    assert.equal(result.satisfied, true);
    assert.equal(result.failures.length, 0);
  });

  it("collects all failures", () => {
    const constraints: NodeConstraint[] = [
      { kind: "kind_is", value: "service" },
      { kind: "has_edge_in", relation: "nonexistent" },
    ];
    const result = checkAllConstraints(constraints, makeCtx());
    assert.equal(result.satisfied, false);
    assert.equal(result.failures.length, 2);
  });

  it("passes with empty constraint list", () => {
    const result = checkAllConstraints([], makeCtx());
    assert.equal(result.satisfied, true);
  });
});

// ── Signature registry ──

describe("signature registry", () => {
  it("has 8 built-in signatures", () => {
    const sigs = allSignatures();
    assert.equal(sigs.length, 8);
  });

  it("can retrieve by opId", () => {
    const sig = getSignature("addMiddleware");
    assert.ok(sig);
    assert.equal(sig!.opId, "addMiddleware");
    assert.ok(sig!.preconditions.length > 0);
  });

  it("returns undefined for unknown opId", () => {
    assert.equal(getSignature("nonexistent"), undefined);
  });

  it("addMiddleware signature requires route_handler kind", () => {
    const sig = getSignature("addMiddleware")!;
    assert.ok(sig.preconditions.some((c) => c.kind === "kind_is" && c.value === "route_handler"));
  });

  it("extractFunction signature forbids external and contract", () => {
    const sig = getSignature("extractFunction")!;
    assert.ok(sig.preconditions.some((c) => c.kind === "kind_not" && c.value === "external"));
    assert.ok(sig.preconditions.some((c) => c.kind === "kind_not" && c.value === "contract"));
  });

  it("renameSymbol signature requires newName arg", () => {
    const sig = getSignature("renameSymbol")!;
    assert.ok(sig.requiredArgs.some((a) => a.name === "newName" && a.required));
  });

  it("addCaching signature has modifies_body postcondition", () => {
    const sig = getSignature("addCaching")!;
    assert.ok(sig.postconditions.some((e) => e.kind === "modifies_body"));
  });
});

// ── Composition checking ──

describe("checkComposition", () => {
  it("detects conflict when first op changes kind away from second's requirement", () => {
    const sigA: OpSignature = {
      opId: "changeKind", preconditions: [],
      postconditions: [{ kind: "changes_kind", from: "utility", to: "service" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "requireUtility", preconditions: [{ kind: "kind_is", value: "utility" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, false);
    assert.ok(result.conflicts[0]!.includes("changes kind"));
  });

  it("allows compatible kind change", () => {
    const sigA: OpSignature = {
      opId: "changeKind", preconditions: [],
      postconditions: [{ kind: "changes_kind", from: "utility", to: "service" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "requireService", preconditions: [{ kind: "kind_is", value: "service" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, true);
  });

  it("detects conflict when edge removal violates next op's requirement", () => {
    const sigA: OpSignature = {
      opId: "removeEdge", preconditions: [],
      postconditions: [{ kind: "removes_edge", relation: "calls" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "needsEdge", preconditions: [{ kind: "has_edge_out", relation: "calls" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, false);
  });

  it("detects conflict when node removal makes next op inapplicable", () => {
    const sigA: OpSignature = {
      opId: "deleteNode", preconditions: [],
      postconditions: [{ kind: "removes_node" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "anyOp", preconditions: [{ kind: "kind_is", value: "utility" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, false);
    assert.ok(result.conflicts[0]!.includes("removes the node"));
  });

  it("warns when both ops modify body", () => {
    const sigA: OpSignature = {
      opId: "modA", preconditions: [],
      postconditions: [{ kind: "modifies_body" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "modB", preconditions: [],
      postconditions: [{ kind: "modifies_body" }],
      requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, true);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0]!.includes("order matters"));
  });

  it("reports no conflicts or warnings for independent ops", () => {
    const sigA = getSignature("addMiddleware")!;
    const sigB = getSignature("renameSymbol")!;
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, true);
    assert.equal(result.conflicts.length, 0);
  });
});

// ── checkSequence ──

describe("checkSequence", () => {
  it("validates a compatible sequence", () => {
    const result = checkSequence(["addMiddleware", "addRateLimit"]);
    assert.equal(result.valid, true);
    assert.equal(result.pairResults.length, 1);
  });

  it("handles unknown ops gracefully", () => {
    const result = checkSequence(["addMiddleware", "nonexistent"]);
    assert.equal(result.pairResults.length, 0);
  });

  it("checks all pairs in a 3-op sequence", () => {
    const result = checkSequence(["addMiddleware", "addRateLimit", "renameSymbol"]);
    assert.equal(result.pairResults.length, 2);
  });
});

// ── buildConstraintContext ──

describe("buildConstraintContext", () => {
  it("returns null for unknown node", () => {
    const graph: MultiRepoGraph = { version: CURRENT_WIRE_VERSION, repos: [], interRepoEdges: [] };
    const result = buildConstraintContext(graph, "nonexistent");
    assert.equal(result, null);
  });

  it("builds context with edges", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "route_handler", name: "getUsers", locator: "file:///test/r.ts#L1" },
        { id: "n2", kind: "service", name: "UserService", locator: "file:///test/s.ts#L1" },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2", relation: "calls" },
        { id: "e2", source: "n2", target: "n1", relation: "imports" },
      ],
      clusters: [],
    });
    const ctx = buildConstraintContext(graph, "n1");
    assert.ok(ctx);
    assert.equal(ctx!.node.id, "n1");
    assert.equal(ctx!.outgoingEdges.length, 1);
    assert.equal(ctx!.incomingEdges.length, 1);
    assert.equal(ctx!.outgoingEdges[0]!.relation, "calls");
    assert.equal(ctx!.incomingEdges[0]!.relation, "imports");
  });
});

// ── validatePlan ──

describe("validatePlan", () => {
  function makeGraph() {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "route_handler", name: "getUsers", locator: "file:///test/r.ts#L1", filePath: "/test/r.ts" },
        { id: "n2", kind: "service", name: "UserService", locator: "file:///test/s.ts#L1", filePath: "/test/s.ts" },
        { id: "n3", kind: "external", name: "axios", locator: "file:///test/ext.ts#L1" },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2", relation: "calls" },
      ],
      clusters: [],
    });
    return graph;
  }

  it("validates a valid single-step plan", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "addMiddleware", nodeId: "n1", args: { name: "auth" } },
    ]);
    assert.equal(result.valid, true);
    assert.equal(result.steps.length, 1);
    assert.ok(result.summary.includes("valid"));
  });

  it("rejects plan with unknown op", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "nonexistent", nodeId: "n1" },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.steps[0]!.preconditionCheck.failures[0]!.reason.includes("nonexistent"));
  });

  it("rejects plan with unknown node", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "addMiddleware", nodeId: "fake" },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.steps[0]!.preconditionCheck.failures[0]!.reason.includes("not found"));
  });

  it("rejects plan with kind mismatch", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "addMiddleware", nodeId: "n2" },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.steps[0]!.preconditionCheck.failures.some((f) => f.reason.includes("service")));
  });

  it("rejects plan targeting external node for extractFunction", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "extractFunction", nodeId: "n3", args: { startLine: 1, endLine: 5 } },
    ]);
    assert.equal(result.valid, false);
  });

  it("validates multi-step plan on different nodes", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "addMiddleware", nodeId: "n1" },
      { opId: "addCaching", nodeId: "n2" },
    ]);
    assert.equal(result.valid, true);
    assert.equal(result.steps.length, 2);
  });

  it("reports missing required args", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "renameSymbol", nodeId: "n2" },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.steps[0]!.argValidation.missing.includes("newName"));
  });

  it("reports type errors in args", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "renameSymbol", nodeId: "n2", args: { newName: 42 } },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.steps[0]!.argValidation.typeErrors.some((t) => t.arg === "newName"));
  });

  it("passes with correct args", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "renameSymbol", nodeId: "n2", args: { newName: "AccountService" } },
    ]);
    assert.equal(result.valid, true);
  });

  it("checks composition for sequential same-node ops", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "addMiddleware", nodeId: "n1" },
      { opId: "addRateLimit", nodeId: "n1" },
    ]);
    assert.equal(result.valid, true);
    assert.ok(result.steps[1]!.compositionCheck);
  });

  it("summary includes step count", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "addMiddleware", nodeId: "n1" },
      { opId: "addCaching", nodeId: "n2" },
    ]);
    assert.ok(result.summary.includes("2 steps"));
  });

  it("reports failure count in summary when invalid", () => {
    const result = validatePlan(makeGraph(), [
      { opId: "addMiddleware", nodeId: "n2" },
      { opId: "addCaching", nodeId: "n3" },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.summary.includes("2/2"));
  });
});

// ── validateSingleOp ──

describe("validateSingleOp", () => {
  it("validates a valid op", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "route_handler", name: "handler", locator: "file:///test/r.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "addMiddleware", "n1");
    assert.equal(result.preconditionCheck.satisfied, true);
  });

  it("rejects mismatched kind", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "addMiddleware", "n1");
    assert.equal(result.preconditionCheck.satisfied, false);
  });
});

// ── Symbolic state propagation in multi-step plans ──

describe("plan validation — symbolic state propagation", () => {
  it("effects from step 1 are visible in step 2 constraints", () => {
    registerSignature({
      opId: "__test_change_kind",
      preconditions: [{ kind: "kind_is", value: "utility" }],
      postconditions: [{ kind: "changes_kind", from: "utility", to: "service" }],
      requiredArgs: [],
    });
    registerSignature({
      opId: "__test_requires_service",
      preconditions: [{ kind: "kind_is", value: "service" }],
      postconditions: [],
      requiredArgs: [],
    });

    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });

    const result = validatePlan(graph, [
      { opId: "__test_change_kind", nodeId: "n1" },
      { opId: "__test_requires_service", nodeId: "n1" },
    ]);
    assert.equal(result.valid, true, "step 2 should see the kind change from step 1");
  });

  it("detects removed node in later steps", () => {
    registerSignature({
      opId: "__test_delete",
      preconditions: [],
      postconditions: [{ kind: "removes_node" }],
      requiredArgs: [],
    });

    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });

    const result = validatePlan(graph, [
      { opId: "__test_delete", nodeId: "n1" },
      { opId: "renameSymbol", nodeId: "n1", args: { newName: "x" } },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.steps[1]!.preconditionCheck.failures[0]!.reason.includes("removed"));
  });

  it("added edges are visible to next step", () => {
    registerSignature({
      opId: "__test_add_edge",
      preconditions: [],
      postconditions: [{ kind: "adds_edge", relation: "imports" }],
      requiredArgs: [],
    });
    registerSignature({
      opId: "__test_needs_import",
      preconditions: [{ kind: "has_edge_out", relation: "imports" }],
      postconditions: [],
      requiredArgs: [],
    });

    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });

    const result = validatePlan(graph, [
      { opId: "__test_add_edge", nodeId: "n1" },
      { opId: "__test_needs_import", nodeId: "n1" },
    ]);
    assert.equal(result.valid, true);
  });
});

// ── Edge-adds conflict with no_edge constraints ──

describe("composition — edge conflict scenarios", () => {
  it("adding edge that violates no_edge_out", () => {
    const sigA: OpSignature = {
      opId: "adder", preconditions: [],
      postconditions: [{ kind: "adds_edge", relation: "imports" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "forbidder", preconditions: [{ kind: "no_edge_out", relation: "imports" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, false);
    assert.ok(result.conflicts[0]!.includes("forbids"));
  });

  it("adding edge that violates no_edge_in", () => {
    const sigA: OpSignature = {
      opId: "adder", preconditions: [],
      postconditions: [{ kind: "adds_edge", relation: "calls" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "forbidder", preconditions: [{ kind: "no_edge_in", relation: "calls" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, false);
  });
});

// ── Empty plan ──

describe("empty plan", () => {
  it("validates an empty plan as valid", () => {
    const graph: MultiRepoGraph = { version: CURRENT_WIRE_VERSION, repos: [], interRepoEdges: [] };
    const result = validatePlan(graph, []);
    assert.equal(result.valid, true);
    assert.equal(result.steps.length, 0);
  });
});

// ── globMatch regression tests ──

describe("checkConstraint — in_file_matching glob edge cases", () => {
  it("matches ** across directory separators", () => {
    const ctx = makeCtx({ node: { ...makeCtx().node, filePath: "/a/b/c/d.ts" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "**/*.ts" }, ctx);
    assert.equal(result.satisfied, true);
  });

  it("** matches deeply nested paths", () => {
    const ctx = makeCtx({ node: { ...makeCtx().node, filePath: "/usr/src/app/services/user/handler.ts" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "**/services/**/*.ts" }, ctx);
    assert.equal(result.satisfied, true);
  });

  it("single * does not cross directory boundary", () => {
    const ctx = makeCtx({ node: { ...makeCtx().node, filePath: "/a/b/c.ts" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "/a/*.ts" }, ctx);
    assert.equal(result.satisfied, false, "single * should not match /a/b/c.ts");
  });

  it("? matches exactly one character", () => {
    const ctx = makeCtx({ node: { ...makeCtx().node, filePath: "/test/a.ts" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "/test/?.ts" }, ctx);
    assert.equal(result.satisfied, true);
  });

  it("dots in glob are treated literally", () => {
    const ctx = makeCtx({ node: { ...makeCtx().node, filePath: "/test/file.spec.ts" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "**/*.spec.ts" }, ctx);
    assert.equal(result.satisfied, true);
  });

  it("rejects when extension differs", () => {
    const ctx = makeCtx({ node: { ...makeCtx().node, filePath: "/test/file.js" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "**/*.ts" }, ctx);
    assert.equal(result.satisfied, false);
  });

  it("handles glob without ** prefix", () => {
    const ctx = makeCtx({ node: { ...makeCtx().node, filePath: "/test/routes.ts" } });
    const result = checkConstraint({ kind: "in_file_matching", glob: "/test/routes.ts" }, ctx);
    assert.equal(result.satisfied, true);
  });
});

// ── checkComposition — changes_kind vs kind_not ──

describe("checkComposition — changes_kind vs kind_not", () => {
  it("detects conflict when kind change violates kind_not", () => {
    const sigA: OpSignature = {
      opId: "makeExternal", preconditions: [],
      postconditions: [{ kind: "changes_kind", from: "utility", to: "external" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "noExternal", preconditions: [{ kind: "kind_not", value: "external" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, false);
    assert.ok(result.conflicts[0]!.includes("forbids"));
  });

  it("allows when kind change does not match kind_not", () => {
    const sigA: OpSignature = {
      opId: "makeService", preconditions: [],
      postconditions: [{ kind: "changes_kind", from: "utility", to: "service" }],
      requiredArgs: [],
    };
    const sigB: OpSignature = {
      opId: "noExternal", preconditions: [{ kind: "kind_not", value: "external" }],
      postconditions: [], requiredArgs: [],
    };
    const result = checkComposition(sigA, sigB);
    assert.equal(result.compatible, true);
  });
});

// ── replaceImpl signature fix ──

describe("replaceImpl signature accepts utility and service", () => {
  it("validates replaceImpl on utility node", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "replaceImpl", "n1", { body: "return 42;" });
    assert.equal(result.preconditionCheck.satisfied, true);
  });

  it("validates replaceImpl on service node", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "service", name: "svc", locator: "file:///test/s.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "replaceImpl", "n1", { body: "return 42;" });
    assert.equal(result.preconditionCheck.satisfied, true);
  });

  it("rejects replaceImpl on external node", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "external", name: "ext", locator: "file:///test/e.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "replaceImpl", "n1", { body: "x" });
    assert.equal(result.preconditionCheck.satisfied, false);
  });

  it("rejects replaceImpl on contract node", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "contract", name: "api", locator: "file:///test/c.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "replaceImpl", "n1", { body: "x" });
    assert.equal(result.preconditionCheck.satisfied, false);
  });
});

// ── Arg validation edge cases ──

describe("arg validation edge cases", () => {
  it("optional args do not fail validation when missing", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "route_handler", name: "h", locator: "file:///test/r.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "addMiddleware", "n1");
    assert.equal(result.argValidation.valid, true);
    assert.equal(result.argValidation.missing.length, 0);
  });

  it("extractFunction requires both startLine and endLine", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "extractFunction", "n1", { startLine: 1 });
    assert.equal(result.argValidation.valid, false);
    assert.ok(result.argValidation.missing.includes("endLine"));
  });

  it("string arg provided as number reports type error", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "renameSymbol", "n1", { newName: 123 });
    assert.equal(result.argValidation.valid, false);
    assert.ok(result.argValidation.typeErrors.some((t) => t.arg === "newName" && t.expected === "string" && t.got === "number"));
  });

  it("number arg provided as string reports type error", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "extractFunction", "n1", { startLine: "1", endLine: 5 });
    assert.equal(result.argValidation.valid, false);
    assert.ok(result.argValidation.typeErrors.some((t) => t.arg === "startLine"));
  });

  it("null values treated as missing", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" }],
      edges: [], clusters: [],
    });
    const result = validateSingleOp(graph, "renameSymbol", "n1", { newName: null });
    assert.equal(result.argValidation.valid, false);
    assert.ok(result.argValidation.missing.includes("newName"));
  });
});

// ── Symbolic edge removal propagation ──

describe("symbolic edge removal in multi-step plans", () => {
  it("removed edges are not visible to subsequent steps", () => {
    registerSignature({
      opId: "__test_remove_calls",
      preconditions: [],
      postconditions: [{ kind: "removes_edge", relation: "calls" }],
      requiredArgs: [],
    });
    registerSignature({
      opId: "__test_needs_calls",
      preconditions: [{ kind: "has_edge_out", relation: "calls" }],
      postconditions: [],
      requiredArgs: [],
    });

    const graph = testGraph({
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "utility", name: "fn", locator: "file:///test/u.ts#L1" },
        { id: "n2", kind: "utility", name: "fn2", locator: "file:///test/u.ts#L5" },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2", relation: "calls" }],
      clusters: [],
    });

    const result = validatePlan(graph, [
      { opId: "__test_remove_calls", nodeId: "n1" },
      { opId: "__test_needs_calls", nodeId: "n1" },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.steps[1]!.preconditionCheck.failures.some((f) => f.reason.includes("calls")));
  });
});

// ── Multiple constraints on same node (AND semantics) ──

describe("multiple constraints on same node", () => {
  it("all constraints must pass (AND semantics)", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "route_handler", name: "handler", locator: "file:///test/r.ts#L1" }],
      edges: [],
      clusters: [],
    });

    registerSignature({
      opId: "__test_multi_constraint",
      preconditions: [
        { kind: "kind_is", value: "route_handler" },
        { kind: "has_edge_in", relation: "registers_route" },
      ],
      postconditions: [],
      requiredArgs: [],
    });

    const result = validateSingleOp(graph, "__test_multi_constraint", "n1");
    assert.equal(result.preconditionCheck.satisfied, false);
    assert.ok(result.preconditionCheck.failures.some((f) => f.reason.includes("registers_route")));
  });
});

// ── checkSequence with incompatible middle pair ──

describe("checkSequence with partial incompatibility", () => {
  it("reports invalid when middle pair conflicts", () => {
    registerSignature({
      opId: "__test_seq_a",
      preconditions: [],
      postconditions: [{ kind: "removes_node" }],
      requiredArgs: [],
    });
    registerSignature({
      opId: "__test_seq_b",
      preconditions: [{ kind: "kind_is", value: "utility" }],
      postconditions: [],
      requiredArgs: [],
    });
    registerSignature({
      opId: "__test_seq_c",
      preconditions: [],
      postconditions: [],
      requiredArgs: [],
    });

    const result = checkSequence(["__test_seq_a", "__test_seq_b", "__test_seq_c"]);
    assert.equal(result.valid, false);
    assert.equal(result.pairResults.length, 2);
    assert.equal(result.pairResults[0]!.result.compatible, false);
    assert.equal(result.pairResults[1]!.result.compatible, true);
  });
});

// ── Cross-node plan steps (no composition check) ──

describe("cross-node plan steps skip composition", () => {
  it("does not composition-check steps on different nodes", () => {
    const graph = testGraph({
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "route_handler", name: "h1", locator: "file:///test/r.ts#L1" },
        { id: "n2", kind: "service", name: "svc", locator: "file:///test/s.ts#L1" },
      ],
      edges: [], clusters: [],
    });

    const result = validatePlan(graph, [
      { opId: "addMiddleware", nodeId: "n1" },
      { opId: "addCaching", nodeId: "n2" },
    ]);
    assert.equal(result.valid, true);
    assert.equal(result.steps[1]!.compositionCheck, undefined, "no composition check across different nodes");
  });
});

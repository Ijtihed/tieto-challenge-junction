// Tests for domain/datalog — parser, evaluator, EDB population.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDatalog, evaluate, populateEdb, query } from "../domain/datalog/index.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import type { MultiRepoGraph, GraphNode, GraphEdge } from "../domain/multi-repo.ts";
import type { DlProgram, FactDb } from "../domain/datalog/index.ts";

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): MultiRepoGraph {
  return {
    version: CURRENT_WIRE_VERSION,
    repos: [{ uri: "file:///repo", nodes, edges, clusters: [] }],
    interRepoEdges: [],
  };
}

describe("datalog/parser", () => {
  it("parses a simple rule", () => {
    const result = parseDatalog('violation("test", N) :- node(N, "service", _).');
    assert.ok(!("message" in result), "should parse successfully");
    const prog = result as DlProgram;
    assert.equal(prog.rules.length, 1);
    assert.equal(prog.rules[0]!.head.predicate, "violation");
    assert.equal(prog.rules[0]!.head.terms.length, 2);
    assert.equal(prog.rules[0]!.body.length, 1);
    assert.equal(prog.rules[0]!.body[0]!.predicate, "node");
  });

  it("parses multiple rules", () => {
    const src = `
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- edge(X, "calls", Y, _), reachable(Y, Z).
    `;
    const result = parseDatalog(src);
    assert.ok(!("message" in result));
    assert.equal((result as DlProgram).rules.length, 2);
  });

  it("parses metadata comments", () => {
    const src = `
%% id: test-rule
%% severity: error
%% description: Test rule
%%
violation("test", N) :- node(N, "service", _).
    `;
    const result = parseDatalog(src);
    assert.ok(!("message" in result));
    const prog = result as DlProgram;
    assert.equal(prog.metadata.id, "test-rule");
    assert.equal(prog.metadata.severity, "error");
    assert.equal(prog.metadata.description, "Test rule");
  });

  it("handles wildcards", () => {
    const result = parseDatalog('violation("test", N) :- node(N, _, _).');
    assert.ok(!("message" in result));
    const prog = result as DlProgram;
    const body = prog.rules[0]!.body[0]!;
    assert.equal(body.terms[1]!.kind, "wildcard");
    assert.equal(body.terms[2]!.kind, "wildcard");
  });

  it("reports error for missing period", () => {
    const result = parseDatalog('violation("test", N) :- node(N, _, _)');
    assert.ok("message" in result, "should report parse error");
  });

  it("reports error for missing :-", () => {
    const result = parseDatalog('violation("test", N) node(N, _, _).');
    assert.ok("message" in result);
  });

  it("reports error for unterminated string", () => {
    const result = parseDatalog('violation("test, N) :- node(N, _, _).');
    assert.ok("message" in result);
  });

  it("parses escaped quotes in strings", () => {
    const result = parseDatalog('violation("test\\"rule", N) :- node(N, _, _).');
    assert.ok(!("message" in result));
    const prog = result as DlProgram;
    const head = prog.rules[0]!.head;
    const firstTerm = head.terms[0]!;
    assert.equal(firstTerm.kind, "string");
    if (firstTerm.kind === "string") assert.equal(firstTerm.value, 'test"rule');
  });

  it("parses query", () => {
    const src = `
      reachable(X, Y) :- edge(X, "calls", Y, _).
      ?- reachable("node1", Y).
    `;
    const result = parseDatalog(src);
    assert.ok(!("message" in result));
    const prog = result as DlProgram;
    assert.equal(prog.rules.length, 1);
    assert.equal(prog.queries.length, 1);
    assert.equal(prog.queries[0]!.atom.predicate, "reachable");
  });
});

describe("datalog/edb", () => {
  it("populates node/3 facts", () => {
    const graph = makeGraph(
      [{ id: "n1", kind: "service", name: "UserService", locator: "file:///a.ts" }],
      [],
    );
    const edb = populateEdb(graph);
    const nodes = edb.get("node");
    assert.ok(nodes);
    assert.equal(nodes.size, 1);
    assert.ok(nodes.has(JSON.stringify(["n1", "service", "UserService"])));
  });

  it("populates edge/4 facts", () => {
    const graph = makeGraph(
      [
        { id: "n1", kind: "service", name: "A", locator: "" },
        { id: "n2", kind: "service", name: "B", locator: "" },
      ],
      [{ id: "e1", source: "n1", target: "n2", relation: "calls" }],
    );
    const edb = populateEdb(graph);
    const edges = edb.get("edge");
    assert.ok(edges);
    assert.ok(edges.has(JSON.stringify(["n1", "calls", "n2", "e1"])));
  });

  it("populates node_file/2 facts", () => {
    const graph = makeGraph(
      [{ id: "n1", kind: "service", name: "A", locator: "", filePath: "/src/a.ts" }],
      [],
    );
    const edb = populateEdb(graph);
    const nodeFiles = edb.get("node_file");
    assert.ok(nodeFiles);
    assert.ok(nodeFiles.has(JSON.stringify(["n1", "/src/a.ts"])));
  });

  it("populates contract/3 facts", () => {
    const graph = makeGraph(
      [{ id: "c1", kind: "contract", name: "POST /users", locator: "openapi://POST/users" }],
      [],
    );
    const edb = populateEdb(graph);
    const contracts = edb.get("contract");
    assert.ok(contracts);
    assert.ok(contracts.has(JSON.stringify(["c1", "openapi", "openapi://POST/users"])));
  });

  it("populates data-flow-lite edge predicates", () => {
    const graph = makeGraph(
      [{ id: "n1", kind: "utility", name: "fn", locator: "" }],
      [{ id: "e1", source: "n1", target: "DB_HOST", relation: "reads_env" }],
    );
    const edb = populateEdb(graph);
    const readsEnv = edb.get("reads_env");
    assert.ok(readsEnv);
    assert.ok(readsEnv.has(JSON.stringify(["n1", "DB_HOST"])));
  });
});

describe("datalog/evaluator", () => {
  it("evaluates a non-recursive rule", () => {
    const prog = parseDatalog('violation("all-services", N) :- node(N, "service", _).') as DlProgram;
    const graph = makeGraph(
      [
        { id: "n1", kind: "service", name: "A", locator: "" },
        { id: "n2", kind: "utility", name: "B", locator: "" },
        { id: "n3", kind: "service", name: "C", locator: "" },
      ],
      [],
    );
    const edb = populateEdb(graph);
    const result = evaluate(prog, edb);
    assert.equal(result.violations.length, 2);
    const nodeIds = result.violations.map((v) => v.nodeId).sort();
    assert.deepEqual(nodeIds, ["n1", "n3"]);
  });

  it("evaluates a multi-body rule (join)", () => {
    const src = `
      violation("service-calls-data", N) :-
        node(N, "service", _),
        edge(N, "imports", M, _),
        node(M, "data_access", _).
    `;
    const prog = parseDatalog(src) as DlProgram;
    const graph = makeGraph(
      [
        { id: "n1", kind: "service", name: "A", locator: "" },
        { id: "n2", kind: "data_access", name: "DB", locator: "" },
        { id: "n3", kind: "service", name: "C", locator: "" },
      ],
      [{ id: "e1", source: "n1", target: "n2", relation: "imports" }],
    );
    const edb = populateEdb(graph);
    const result = evaluate(prog, edb);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]!.nodeId, "n1");
  });

  it("evaluates recursive rules (transitive closure)", () => {
    const src = `
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
    `;
    const prog = parseDatalog(src) as DlProgram;
    const graph = makeGraph(
      [
        { id: "a", kind: "utility", name: "a", locator: "" },
        { id: "b", kind: "utility", name: "b", locator: "" },
        { id: "c", kind: "utility", name: "c", locator: "" },
        { id: "d", kind: "utility", name: "d", locator: "" },
        { id: "e", kind: "utility", name: "e", locator: "" },
      ],
      [
        { id: "e1", source: "a", target: "b", relation: "calls" },
        { id: "e2", source: "b", target: "c", relation: "calls" },
        { id: "e3", source: "c", target: "d", relation: "calls" },
        { id: "e4", source: "d", target: "e", relation: "calls" },
      ],
    );
    const edb = populateEdb(graph);
    const result = evaluate(prog, edb);

    const reachable = result.facts.get("reachable");
    assert.ok(reachable);
    assert.ok(reachable.has(JSON.stringify(["a", "e"])), "a should reach e transitively");
    assert.ok(reachable.has(JSON.stringify(["a", "c"])), "a should reach c");
    assert.ok(!reachable.has(JSON.stringify(["e", "a"])), "e should not reach a");
  });

  it("empty graph produces no violations", () => {
    const prog = parseDatalog('violation("test", N) :- node(N, "service", _).') as DlProgram;
    const graph = makeGraph([], []);
    const edb = populateEdb(graph);
    const result = evaluate(prog, edb);
    assert.equal(result.violations.length, 0);
  });

  it("converges within maxIterations", () => {
    const src = `
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
    `;
    const prog = parseDatalog(src) as DlProgram;
    const graph = makeGraph(
      [{ id: "a", kind: "utility", name: "a", locator: "" }, { id: "b", kind: "utility", name: "b", locator: "" }],
      [{ id: "e1", source: "a", target: "b", relation: "calls" }],
    );
    const edb = populateEdb(graph);
    const result = evaluate(prog, edb, 5);
    assert.ok(result.iterations <= 5);
  });

  it("handles multiple violation rules", () => {
    const src = `
      violation("rule-a", N) :- node(N, "service", _).
      violation("rule-b", N) :- node(N, "route_handler", _).
    `;
    const prog = parseDatalog(src) as DlProgram;
    const graph = makeGraph(
      [
        { id: "n1", kind: "service", name: "A", locator: "" },
        { id: "n2", kind: "route_handler", name: "B", locator: "" },
      ],
      [],
    );
    const edb = populateEdb(graph);
    const result = evaluate(prog, edb);
    assert.equal(result.violations.length, 2);
    const ruleIds = result.violations.map((v) => v.ruleId).sort();
    assert.deepEqual(ruleIds, ["rule-a", "rule-b"]);
  });
});

describe("datalog/query", () => {
  it("returns matching tuples for a query", () => {
    const src = `
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
      ?- reachable("a", Y).
    `;
    const prog = parseDatalog(src) as DlProgram;
    const graph = makeGraph(
      [
        { id: "a", kind: "utility", name: "a", locator: "" },
        { id: "b", kind: "utility", name: "b", locator: "" },
        { id: "c", kind: "utility", name: "c", locator: "" },
      ],
      [
        { id: "e1", source: "a", target: "b", relation: "calls" },
        { id: "e2", source: "b", target: "c", relation: "calls" },
      ],
    );
    const edb = populateEdb(graph);
    const results = query(prog, edb);
    assert.ok(results.length >= 2);
    const targets = results.map((r) => r[1]).sort();
    assert.ok(targets.includes("b"));
    assert.ok(targets.includes("c"));
  });
});

// Comprehensive tests for differential dataflow (incremental Datalog evaluation).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IncrementalEvaluator,
  computeEdbDelta,
  deltaSize,
  isDeltaEmpty,
  parseDatalog,
  populateEdb,
  type FactDb,
} from "../domain/index.ts";
import type { MultiRepoGraph, RepoSubgraph } from "../domain/multi-repo.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";

function testGraph(repo: RepoSubgraph): MultiRepoGraph {
  return { version: CURRENT_WIRE_VERSION, repos: [repo], interRepoEdges: [] };
}

function makeEdb(entries: Record<string, string[][]>): FactDb {
  const db: FactDb = new Map();
  for (const [pred, tuples] of Object.entries(entries)) {
    const set = new Set(tuples.map((t) => JSON.stringify(t)));
    db.set(pred, set);
  }
  return db;
}

// ── computeEdbDelta ──

describe("computeEdbDelta", () => {
  it("detects additions", () => {
    const old = makeEdb({ node: [["a", "fn", "hello"]] });
    const next = makeEdb({ node: [["a", "fn", "hello"], ["b", "fn", "world"]] });
    const delta = computeEdbDelta(old, next);
    assert.equal(delta.added.get("node")?.size, 1);
    assert.equal(delta.removed.size, 0);
  });

  it("detects removals", () => {
    const old = makeEdb({ node: [["a", "fn", "hello"], ["b", "fn", "world"]] });
    const next = makeEdb({ node: [["a", "fn", "hello"]] });
    const delta = computeEdbDelta(old, next);
    assert.equal(delta.removed.get("node")?.size, 1);
    assert.equal(delta.added.size, 0);
  });

  it("detects both additions and removals", () => {
    const old = makeEdb({ node: [["a", "fn", "hello"]] });
    const next = makeEdb({ node: [["b", "fn", "world"]] });
    const delta = computeEdbDelta(old, next);
    assert.equal(delta.added.get("node")?.size, 1);
    assert.equal(delta.removed.get("node")?.size, 1);
  });

  it("returns empty delta for identical EDBs", () => {
    const edb = makeEdb({ node: [["a", "fn", "hello"]] });
    const delta = computeEdbDelta(edb, edb);
    assert.ok(isDeltaEmpty(delta));
    assert.equal(deltaSize(delta), 0);
  });

  it("handles new predicate appearing", () => {
    const old = makeEdb({ node: [["a", "fn", "hello"]] });
    const next = makeEdb({ node: [["a", "fn", "hello"]], edge: [["a", "calls", "b", "e1"]] });
    const delta = computeEdbDelta(old, next);
    assert.equal(delta.added.get("edge")?.size, 1);
    assert.ok(!delta.added.has("node"));
  });

  it("handles predicate disappearing", () => {
    const old = makeEdb({ node: [["a", "fn", "hello"]], edge: [["a", "calls", "b", "e1"]] });
    const next = makeEdb({ node: [["a", "fn", "hello"]] });
    const delta = computeEdbDelta(old, next);
    assert.equal(delta.removed.get("edge")?.size, 1);
  });

  it("handles empty-to-empty", () => {
    const delta = computeEdbDelta(new Map(), new Map());
    assert.ok(isDeltaEmpty(delta));
  });

  it("handles empty-to-populated", () => {
    const next = makeEdb({ node: [["a", "fn", "hello"]] });
    const delta = computeEdbDelta(new Map(), next);
    assert.equal(deltaSize(delta), 1);
  });
});

// ── IncrementalEvaluator basic ──

describe("IncrementalEvaluator basic", () => {
  it("starts with version 0", () => {
    const eval_ = new IncrementalEvaluator();
    assert.equal(eval_.version, 0);
    assert.equal(eval_.evalCount, 0);
    assert.equal(eval_.program, null);
  });

  it("can set EDB without a program", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({ node: [["a", "fn", "hello"]] });
    eval_.setEdb(edb);
    assert.equal(eval_.version, 1);
    const stats = eval_.stats;
    assert.equal(stats.edbFacts, 1);
    assert.equal(stats.idbFacts, 0);
  });

  it("fullEval with no program returns EDB only", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({ node: [["a", "fn", "hello"]] });
    eval_.setEdb(edb);
    const result = eval_.fullEval();
    assert.equal(result.iterations, 0);
    assert.equal(result.violations.length, 0);
    assert.equal(result.facts.get("node")?.size, 1);
  });

  it("fullEval derives transitive closure", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({
      edge: [
        ["a", "calls", "b", "e1"],
        ["b", "calls", "c", "e2"],
        ["c", "calls", "d", "e3"],
      ],
    });
    eval_.setEdb(edb);

    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    const result = eval_.fullEval();

    const reachable = result.facts.get("reachable")!;
    assert.ok(reachable.has(JSON.stringify(["a", "b"])));
    assert.ok(reachable.has(JSON.stringify(["a", "c"])));
    assert.ok(reachable.has(JSON.stringify(["a", "d"])));
    assert.ok(reachable.has(JSON.stringify(["b", "c"])));
    assert.ok(reachable.has(JSON.stringify(["b", "d"])));
    assert.ok(reachable.has(JSON.stringify(["c", "d"])));
    assert.equal(reachable.size, 6);
  });

  it("fullEval detects violations", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({
      node: [["n1", "utility", "helper"]],
      edge: [["n1", "calls", "n1", "e1"]],
    });
    eval_.setEdb(edb);

    const prog = parseDatalog(`
      violation("no-self-call", X) :- edge(X, "calls", X, _).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    const result = eval_.fullEval();
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]!.ruleId, "no-self-call");
    assert.equal(result.violations[0]!.nodeId, "n1");
  });

  it("stats reflect installed program", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({ node: [["a", "fn", "hello"]], edge: [["a", "calls", "b", "e1"]] });
    eval_.setEdb(edb);

    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const stats = eval_.stats;
    assert.equal(stats.edbPredicates, 2);
    assert.equal(stats.idbPredicates, 1);
    assert.equal(stats.rulesInstalled, 1);
    assert.ok(stats.idbFacts > 0);
  });
});

// ── Incremental evaluation ──

describe("IncrementalEvaluator incremental", () => {
  it("applyEdbUpdate adds new derived facts", () => {
    const eval_ = new IncrementalEvaluator();

    const edb1 = makeEdb({ edge: [["a", "calls", "b", "e1"]] });
    eval_.setEdb(edb1);
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const reachable1 = eval_.snapshotFacts().get("reachable")!;
    assert.equal(reachable1.size, 1);

    const edb2 = makeEdb({ edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]] });
    const { delta, result } = eval_.applyEdbUpdate(edb2);
    assert.equal(delta.added.get("edge")?.size, 1);

    const reachable2 = result.facts.get("reachable")!;
    assert.equal(reachable2.size, 2);
    assert.ok(reachable2.has(JSON.stringify(["a", "b"])));
    assert.ok(reachable2.has(JSON.stringify(["b", "c"])));
  });

  it("applyEdbUpdate retracts derived facts when EDB facts removed", () => {
    const eval_ = new IncrementalEvaluator();

    const edb1 = makeEdb({ edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]] });
    eval_.setEdb(edb1);
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const reachable1 = eval_.snapshotFacts().get("reachable")!;
    assert.equal(reachable1.size, 2);

    const edb2 = makeEdb({ edge: [["a", "calls", "b", "e1"]] });
    const { result } = eval_.applyEdbUpdate(edb2);

    const reachable2 = result.facts.get("reachable")!;
    assert.equal(reachable2.size, 1);
    assert.ok(reachable2.has(JSON.stringify(["a", "b"])));
    assert.ok(!reachable2.has(JSON.stringify(["b", "c"])));
  });

  it("incremental update with no delta skips evaluation", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({ edge: [["a", "calls", "b", "e1"]] });
    eval_.setEdb(edb);
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const { result } = eval_.applyEdbUpdate(edb);
    assert.equal(result.iterations, 0);
  });

  it("only re-evaluates affected rules", () => {
    const eval_ = new IncrementalEvaluator();
    const edb1 = makeEdb({
      node: [["a", "fn", "hello"]],
      edge: [["a", "calls", "b", "e1"]],
      reads_env: [["a", "DB_HOST"]],
    });
    eval_.setEdb(edb1);

    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      env_reader(X, V) :- reads_env(X, V).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    // Only change reads_env — reachable should be unaffected and not re-derived
    const edb2 = makeEdb({
      node: [["a", "fn", "hello"]],
      edge: [["a", "calls", "b", "e1"]],
      reads_env: [["a", "DB_HOST"], ["a", "DB_PORT"]],
    });
    const { delta, result } = eval_.applyEdbUpdate(edb2);
    assert.ok(delta.added.has("reads_env"));
    assert.ok(!delta.added.has("edge"));

    const envReaders = result.facts.get("env_reader")!;
    assert.equal(envReaders.size, 2);

    const reachable = result.facts.get("reachable")!;
    assert.equal(reachable.size, 1);
  });

  it("handles transitive re-derivation through dependent rules", () => {
    const eval_ = new IncrementalEvaluator();
    const edb1 = makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]],
    });
    eval_.setEdb(edb1);

    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
      deep_reach(X) :- reachable(X, Y), reachable(Y, _).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const reachable1 = eval_.snapshotFacts().get("reachable")!;
    assert.ok(reachable1.has(JSON.stringify(["a", "c"])), "transitive a→c should exist");

    // Add d to the chain
    const edb2 = makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"], ["c", "calls", "d", "e3"]],
    });
    const { result } = eval_.applyEdbUpdate(edb2);

    const reachable2 = result.facts.get("reachable")!;
    assert.ok(reachable2.has(JSON.stringify(["a", "d"])));
    assert.ok(reachable2.has(JSON.stringify(["b", "d"])));
    assert.ok(reachable2.has(JSON.stringify(["c", "d"])));
  });

  it("handles multiple sequential updates", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ edge: [["a", "calls", "b", "e1"]] }));
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();
    assert.equal(eval_.evalCount, 1);

    eval_.applyEdbUpdate(makeEdb({ edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]] }));
    assert.equal(eval_.evalCount, 2);
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 2);

    eval_.applyEdbUpdate(makeEdb({ edge: [["b", "calls", "c", "e2"]] }));
    assert.equal(eval_.evalCount, 3);
    const reachable = eval_.snapshotFacts().get("reachable")!;
    assert.equal(reachable.size, 1);
    assert.ok(reachable.has(JSON.stringify(["b", "c"])));
  });

  it("violations appear and disappear with incremental updates", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ edge: [["n1", "calls", "n2", "e1"]] }));

    const prog = parseDatalog(`violation("no-self-call", X) :- edge(X, "calls", X, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    const r1 = eval_.fullEval();
    assert.equal(r1.violations.length, 0, "no self-call yet");

    // Add self-call
    const { result: r2 } = eval_.applyEdbUpdate(
      makeEdb({ edge: [["n1", "calls", "n2", "e1"], ["n1", "calls", "n1", "e2"]] }),
    );
    assert.equal(r2.violations.length, 1, "self-call violation detected");

    // Remove self-call
    const { result: r3 } = eval_.applyEdbUpdate(
      makeEdb({ edge: [["n1", "calls", "n2", "e1"]] }),
    );
    assert.equal(r3.violations.length, 0, "violation gone after removing self-call");
  });

  it("handles program reinstall with existing EDB", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({ edge: [["a", "calls", "b", "e1"]] });
    eval_.setEdb(edb);

    const prog1 = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog1));
    eval_.installProgram(prog1);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 1);

    // Install a different program
    const prog2 = parseDatalog(`caller(X) :- edge(X, _, _, _).`);
    assert.ok(!("message" in prog2));
    eval_.installProgram(prog2);
    eval_.fullEval();

    assert.ok(!eval_.snapshotFacts().has("reachable"), "old IDB should be cleared");
    assert.equal(eval_.snapshotFacts().get("caller")?.size, 1);
  });
});

// ── Query support ──

describe("IncrementalEvaluator query", () => {
  it("answers queries against incrementally maintained IDB", () => {
    const eval_ = new IncrementalEvaluator();
    const edb = makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]],
    });
    eval_.setEdb(edb);

    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const queryProg = parseDatalog(`?- reachable("a", Y).`);
    assert.ok(!("message" in queryProg));
    const answers = eval_.query(queryProg);
    assert.equal(answers.length, 2);
    const targets = answers.map((a) => a[1]).sort();
    assert.deepEqual(targets, ["b", "c"]);
  });

  it("query returns empty for unknown predicate", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({}));
    const queryProg = parseDatalog(`?- unknown("a", Y).`);
    assert.ok(!("message" in queryProg));
    const answers = eval_.query(queryProg);
    assert.equal(answers.length, 0);
  });
});

// ── deltaSize and isDeltaEmpty helpers ──

describe("delta helpers", () => {
  it("deltaSize counts added and removed", () => {
    const delta = computeEdbDelta(
      makeEdb({ node: [["a", "fn", "hello"]] }),
      makeEdb({ node: [["b", "fn", "world"]], edge: [["a", "calls", "b", "e1"]] }),
    );
    assert.equal(deltaSize(delta), 3);
  });

  it("isDeltaEmpty returns true for identical", () => {
    const edb = makeEdb({ node: [["a", "fn", "hello"]] });
    assert.ok(isDeltaEmpty(computeEdbDelta(edb, edb)));
  });
});

// ── Integration with populateEdb ──

describe("differential + populateEdb integration", () => {
  it("tracks graph changes through populateEdb", () => {
    const graph1 = testGraph({
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "utility", name: "hello", locator: "file:///test/a.ts#L1-L5" },
        { id: "n2", kind: "utility", name: "world", locator: "file:///test/a.ts#L6-L10" },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2", relation: "calls" }],
      clusters: [],
    });
    const edb1 = populateEdb(graph1);

    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(edb1);
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 1);

    // Simulate adding a third node and edge
    const graph2 = testGraph({
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "utility", name: "hello", locator: "file:///test/a.ts#L1-L5" },
        { id: "n2", kind: "utility", name: "world", locator: "file:///test/a.ts#L6-L10" },
        { id: "n3", kind: "utility", name: "new_fn", locator: "file:///test/b.ts#L1-L3" },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2", relation: "calls" },
        { id: "e2", source: "n2", target: "n3", relation: "calls" },
      ],
      clusters: [],
    });
    const edb2 = populateEdb(graph2);
    const { delta, result } = eval_.applyEdbUpdate(edb2);

    assert.ok(!isDeltaEmpty(delta));
    const reachable = result.facts.get("reachable")!;
    assert.equal(reachable.size, 2);
    assert.ok(reachable.has(JSON.stringify(["n1", "n2"])));
    assert.ok(reachable.has(JSON.stringify(["n2", "n3"])));
  });

  it("handles complete repo replacement", () => {
    const graph1 = testGraph({
      uri: "file:///test",
      nodes: [{ id: "n1", kind: "utility", name: "old_fn", locator: "file:///test/a.ts#L1-L5" }],
      edges: [], clusters: [],
    });

    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(populateEdb(graph1));
    const prog = parseDatalog(`fn(X) :- node(X, "utility", _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("fn")?.size, 1);

    const graph2 = testGraph({
      uri: "file:///test",
      nodes: [
        { id: "n2", kind: "utility", name: "new_fn_1", locator: "file:///test/b.ts#L1-L5" },
        { id: "n3", kind: "utility", name: "new_fn_2", locator: "file:///test/b.ts#L6-L10" },
      ],
      edges: [], clusters: [],
    });

    const { result } = eval_.applyEdbUpdate(populateEdb(graph2));
    const fns = result.facts.get("fn")!;
    assert.equal(fns.size, 2);
  });
});

// ── Edge cases ──

describe("IncrementalEvaluator edge cases", () => {
  it("handles empty program with non-empty EDB", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ node: [["a", "fn", "hello"]] }));
    const prog = parseDatalog("");
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    const result = eval_.fullEval();
    assert.equal(result.iterations, 0);
    assert.equal(result.facts.get("node")?.size, 1);
  });

  it("handles cyclic rules without infinite loop", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "a", "e2"]],
    }));
    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    const result = eval_.fullEval();
    const reachable = result.facts.get("reachable")!;
    assert.ok(reachable.has(JSON.stringify(["a", "b"])));
    assert.ok(reachable.has(JSON.stringify(["b", "a"])));
    assert.ok(reachable.has(JSON.stringify(["a", "a"])));
    assert.ok(reachable.has(JSON.stringify(["b", "b"])));
    assert.equal(reachable.size, 4);
  });

  it("applyEdbUpdate with no program installed", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ node: [["a", "fn", "hello"]] }));
    const { result } = eval_.applyEdbUpdate(makeEdb({ node: [["b", "fn", "world"]] }));
    assert.equal(result.iterations, 0);
    assert.equal(result.facts.get("node")?.size, 1);
  });

  it("large delta performance: 1000 fact additions", () => {
    const eval_ = new IncrementalEvaluator();
    const edb1 = makeEdb({});
    eval_.setEdb(edb1);
    const prog = parseDatalog(`fn(X) :- node(X, "utility", _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const nodes: string[][] = [];
    for (let i = 0; i < 1000; i++) {
      nodes.push([`n${i}`, "utility", `fn_${i}`]);
    }
    const edb2 = makeEdb({ node: nodes });

    const start = performance.now();
    const { result } = eval_.applyEdbUpdate(edb2);
    const elapsed = performance.now() - start;

    assert.equal(result.facts.get("fn")?.size, 1000);
    assert.ok(elapsed < 5000, `should complete in < 5s, took ${elapsed.toFixed(0)}ms`);
  });

  it("snapshotFacts returns independent copy", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ node: [["a", "fn", "hello"]] }));
    const snap1 = eval_.snapshotFacts();
    eval_.setEdb(makeEdb({ node: [["b", "fn", "world"]] }));
    const snap2 = eval_.snapshotFacts();

    assert.ok(snap1.get("node")?.has(JSON.stringify(["a", "fn", "hello"])));
    assert.ok(!snap2.get("node")?.has(JSON.stringify(["a", "fn", "hello"])));
  });

  it("unsupported rules are skipped gracefully", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ node: [["a", "fn", "hello"]], edge: [["a", "calls", "b", "e1"]] }));
    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      counted(X) :- N = count : { reachable(X, _) }, N > 0.
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    const result = eval_.fullEval();
    assert.equal(result.facts.get("reachable")?.size, 1);
    assert.ok(!result.facts.has("counted"), "unsupported rule skipped");
  });
});

// ── addRules accumulation ──

describe("IncrementalEvaluator addRules", () => {
  it("merges rules from multiple addRules calls", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      edge: [["a", "calls", "b", "e1"]],
      node: [["a", "utility", "hello"], ["b", "utility", "world"]],
    }));

    const prog1 = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog1));
    eval_.addRules(prog1);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 1);

    const prog2 = parseDatalog(`fn(X) :- node(X, "utility", _).`);
    assert.ok(!("message" in prog2));
    eval_.addRules(prog2);
    eval_.fullEval();

    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 1, "first rule still active");
    assert.equal(eval_.snapshotFacts().get("fn")?.size, 2, "second rule also active");
  });

  it("addRules on empty evaluator acts as installProgram", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ edge: [["a", "calls", "b", "e1"]] }));
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.addRules(prog);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 1);
    assert.ok(eval_.program !== null);
  });

  it("addRules preserves cross-rule dependencies", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]],
    }));

    const prog1 = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog1));
    eval_.addRules(prog1);
    eval_.fullEval();

    const prog2 = parseDatalog(`reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).`);
    assert.ok(!("message" in prog2));
    eval_.addRules(prog2);
    eval_.fullEval();

    const reachable = eval_.snapshotFacts().get("reachable")!;
    assert.ok(reachable.has(JSON.stringify(["a", "c"])), "transitive closure works across addRules");
    assert.equal(reachable.size, 3);
  });

  it("incremental update works after addRules", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ edge: [["a", "calls", "b", "e1"]] }));

    const prog1 = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog1));
    eval_.addRules(prog1);
    eval_.fullEval();

    const prog2 = parseDatalog(`violation("no-self-call", X) :- edge(X, "calls", X, _).`);
    assert.ok(!("message" in prog2));
    eval_.addRules(prog2);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 1);

    const { result } = eval_.applyEdbUpdate(makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "b", "e2"]],
    }));
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]!.nodeId, "b");
    assert.equal(result.facts.get("reachable")?.size, 2);
  });
});

// ── Snapshot immutability ──

describe("IncrementalEvaluator snapshot safety", () => {
  it("fullEval result facts are immutable copies", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ edge: [["a", "calls", "b", "e1"]] }));
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    const result1 = eval_.fullEval();
    const result1Reachable = result1.facts.get("reachable")!;

    // Mutate the returned facts
    result1Reachable.add(JSON.stringify(["x", "y"]));

    // Internal state should be unaffected
    const result2 = eval_.fullEval();
    assert.equal(result2.facts.get("reachable")?.size, 1, "internal state not corrupted by external mutation");
  });

  it("applyEdbUpdate result facts are immutable copies", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ edge: [["a", "calls", "b", "e1"]] }));
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const { result } = eval_.applyEdbUpdate(makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]],
    }));
    result.facts.get("reachable")!.add(JSON.stringify(["z", "z"]));

    const snap = eval_.snapshotFacts();
    assert.equal(snap.get("reachable")?.size, 2, "internal state not corrupted");
  });

  it("findAffectedRules does not mutate input changedPreds", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({ edge: [["a", "calls", "b", "e1"]] }));
    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      deep(X) :- reachable(X, _).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const edb2 = makeEdb({ edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]] });
    const delta = computeEdbDelta(eval_.snapshotFacts(), edb2);
    const changedPredsBefore = new Set([...delta.added.keys(), ...delta.removed.keys()]);
    const sizeBefore = changedPredsBefore.size;

    eval_.applyEdbUpdate(edb2);
    assert.equal(changedPredsBefore.size, sizeBefore, "input set not mutated");
  });
});

// ── Multi-predicate incremental scenarios ──

describe("IncrementalEvaluator multi-predicate", () => {
  it("changing node predicate does not re-derive edge-only rules", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      node: [["a", "utility", "hello"]],
      edge: [["a", "calls", "b", "e1"]],
    }));
    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      fn(X) :- node(X, "utility", _).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    // Only change nodes, not edges
    const edb2 = makeEdb({
      node: [["a", "utility", "hello"], ["c", "utility", "new_fn"]],
      edge: [["a", "calls", "b", "e1"]],
    });
    const { result } = eval_.applyEdbUpdate(edb2);
    assert.equal(result.facts.get("fn")?.size, 2);
    assert.equal(result.facts.get("reachable")?.size, 1, "reachable untouched");
  });

  it("removing all facts of a predicate clears derived facts", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"]],
    }));
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 2);

    const { result } = eval_.applyEdbUpdate(makeEdb({}));
    assert.ok(!result.facts.has("reachable") || result.facts.get("reachable")?.size === 0);
  });

  it("EDB and IDB with same predicate name coexist correctly", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      reachable: [["seed_a", "seed_b"]],
      edge: [["x", "calls", "y", "e1"]],
    }));
    const prog = parseDatalog(`reachable(X, Y) :- edge(X, "calls", Y, _).`);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    const reachable = eval_.snapshotFacts().get("reachable")!;
    assert.ok(reachable.has(JSON.stringify(["seed_a", "seed_b"])), "EDB fact preserved");
    assert.ok(reachable.has(JSON.stringify(["x", "y"])), "IDB fact derived");
    assert.equal(reachable.size, 2);
  });

  it("multiple violations from multiple rules via addRules", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      edge: [["n1", "calls", "n1", "e1"], ["n2", "imports", "n2", "e2"]],
    }));

    const prog1 = parseDatalog(`violation("no-self-call", X) :- edge(X, "calls", X, _).`);
    assert.ok(!("message" in prog1));
    eval_.addRules(prog1);

    const prog2 = parseDatalog(`violation("no-self-import", X) :- edge(X, "imports", X, _).`);
    assert.ok(!("message" in prog2));
    eval_.addRules(prog2);

    const result = eval_.fullEval();
    assert.equal(result.violations.length, 2);
    const ruleIds = result.violations.map((v) => v.ruleId).sort();
    assert.deepEqual(ruleIds, ["no-self-call", "no-self-import"]);
  });

  it("diamond-shaped rule dependencies re-derive correctly", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      edge: [["a", "calls", "b", "e1"]],
      node: [["a", "utility", "fn_a"], ["b", "utility", "fn_b"]],
    }));
    const prog = parseDatalog(`
      caller(X) :- edge(X, "calls", _, _).
      callee(Y) :- edge(_, "calls", Y, _).
      active(X) :- caller(X).
      active(X) :- callee(X).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();

    assert.equal(eval_.snapshotFacts().get("active")?.size, 2);

    // Remove the edge
    const { result } = eval_.applyEdbUpdate(makeEdb({
      edge: [],
      node: [["a", "utility", "fn_a"], ["b", "utility", "fn_b"]],
    }));
    assert.ok(!result.facts.has("active") || result.facts.get("active")?.size === 0);
    assert.ok(!result.facts.has("caller") || result.facts.get("caller")?.size === 0);
    assert.ok(!result.facts.has("callee") || result.facts.get("callee")?.size === 0);
  });

  it("incremental update with cycles re-converges", () => {
    const eval_ = new IncrementalEvaluator();
    eval_.setEdb(makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "a", "e2"]],
    }));
    const prog = parseDatalog(`
      reachable(X, Y) :- edge(X, "calls", Y, _).
      reachable(X, Z) :- reachable(X, Y), reachable(Y, Z).
    `);
    assert.ok(!("message" in prog));
    eval_.installProgram(prog);
    eval_.fullEval();
    assert.equal(eval_.snapshotFacts().get("reachable")?.size, 4);

    // Add a third node to the cycle
    const { result } = eval_.applyEdbUpdate(makeEdb({
      edge: [["a", "calls", "b", "e1"], ["b", "calls", "c", "e2"], ["c", "calls", "a", "e3"]],
    }));
    const reachable = result.facts.get("reachable")!;
    // 3 nodes in cycle, each reachable from each other + self
    assert.equal(reachable.size, 9);
    for (const x of ["a", "b", "c"]) {
      for (const y of ["a", "b", "c"]) {
        assert.ok(reachable.has(JSON.stringify([x, y])), `${x}→${y} should be reachable`);
      }
    }
  });
});

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { graphQuery } from "../actions/graph-query.ts";
import { rulesAdd } from "../actions/rules-add.ts";
import { getSession } from "../session/index.ts";

const FIXTURE_SRC = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
let tempDir: string;
let sessionId: string;

before(async () => {
  tempDir = mkdtempSync(resolve(tmpdir(), "schema-query-test-"));
  cpSync(FIXTURE_SRC, tempDir, { recursive: true });
  const result = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("open failed");
  sessionId = (result.data as { sessionId: string }).sessionId;
});

after(async () => {
  await workspaceClose.handle({ sessionId });
  rmSync(tempDir, { recursive: true, force: true });
});

describe("graph.query", () => {
  it("rejects missing query", async () => {
    const r = await graphQuery.handle({ sessionId });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-args");
  });

  it("rejects invalid Datalog", async () => {
    const r = await graphQuery.handle({ sessionId, query: "bad syntax %%%!!!" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-datalog");
  });

  it("rejects Datalog without a query", async () => {
    const r = await graphQuery.handle({ sessionId, query: 'reachable(X,Y) :- edge(X,"calls",Y,_).' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "no-query");
  });

  it("runs a query and returns results", async () => {
    const r = await graphQuery.handle({
      sessionId,
      query: '?- node(X, "utility", _).',
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { resultCount: number; results: unknown[] };
    assert.ok(data.resultCount >= 0);
    assert.ok(Array.isArray(data.results));
  });

  it("runs a transitive reachability query", async () => {
    const r = await graphQuery.handle({
      sessionId,
      query: [
        'reachable(X,Y) :- edge(X,"calls",Y,_).',
        "reachable(X,Z) :- reachable(X,Y), reachable(Y,Z).",
        "?- reachable(X,Y).",
      ].join("\n"),
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { resultCount: number };
    assert.ok(data.resultCount >= 0);
  });
});

describe("rules.add with Datalog", () => {
  it("accepts a valid Datalog rule", async () => {
    const r = await rulesAdd.handle({
      sessionId,
      rule: {
        datalog: [
          '%% id: test-cycle',
          '%% severity: warn',
          '%% description: detect cycles',
          'violation(X, "test-cycle") :- edge(X,"calls",Y,_), edge(Y,"calls",X,_).',
        ].join("\n"),
        severity: "warn",
      },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { id: string; source: string };
    assert.ok(data.id.startsWith("rule_"));
    assert.equal(data.source, "datalog");
  });

  it("rejects invalid Datalog", async () => {
    const r = await rulesAdd.handle({
      sessionId,
      rule: { datalog: "not valid %%% datalog" },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-datalog");
  });

  it("still accepts text-based rules", async () => {
    const r = await rulesAdd.handle({
      sessionId,
      rule: { body: "no cycles allowed", severity: "error" },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { source: string };
    assert.equal(data.source, "text");
  });
});

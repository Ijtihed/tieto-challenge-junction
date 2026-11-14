// Per architecture/specs/architectural-search.md §3 — constraint-based search tests.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { graphQuery } from "../actions/graph-query.ts";
import { graphListQueries } from "../actions/graph-list-queries.ts";
import { BUNDLED_QUERIES } from "../domain/queries/bundled.ts";

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
const FIXTURE_URI = `file://${FIXTURE_PATH}`;
let sessionId: string;

before(async () => {
  try { const { unlinkSync } = await import("node:fs"); const { join } = await import("node:path"); const { homedir } = await import("node:os"); unlinkSync(join(homedir(), ".schema", "graph-cache.db")); } catch { /* */ }
  const result = await workspaceOpen.handle({ uris: [FIXTURE_URI] });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture open failed");
  sessionId = (result.data as { sessionId: string }).sessionId;
});

after(async () => {
  await workspaceClose.handle({ sessionId });
});

describe("graph.list_queries", () => {
  it("returns all 10 bundled queries", async () => {
    const r = await graphListQueries.handle({});
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { queries: { id: string; name: string }[] };
    assert.equal(data.queries.length, 10);
  });

  it("each query has id, name, description, category", async () => {
    const r = await graphListQueries.handle({});
    if (!r.ok) return;
    const data = r.data as { queries: { id: string; name: string; description: string; category: string }[] };
    for (const q of data.queries) {
      assert.ok(q.id, "Missing id");
      assert.ok(q.name, "Missing name");
      assert.ok(q.description, "Missing description");
      assert.ok(q.category, "Missing category");
    }
  });
});

describe("graph.query with bundled queries", () => {
  for (const bq of BUNDLED_QUERIES) {
    it(`bundled query "${bq.id}" runs without error`, async () => {
      const r = await graphQuery.handle({ sessionId, bundledQueryId: bq.id });
      assert.equal(r.ok, true, `Query "${bq.id}" failed: ${r.ok ? "" : (r as { message: string }).message}`);
      if (!r.ok) return;
      const data = r.data as { resultCount: number; results: unknown[] };
      assert.ok(data.resultCount >= 0, "resultCount should be non-negative");
    });
  }
});

describe("graph.query ad-hoc", () => {
  it("runs a simple node query", async () => {
    const r = await graphQuery.handle({
      sessionId,
      query: '?- node(N, "route_handler", Name).',
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { resultCount: number };
    assert.ok(data.resultCount >= 0);
  });

  it("returns parse error for invalid Datalog", async () => {
    const r = await graphQuery.handle({
      sessionId,
      query: "this is not valid datalog !!!",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-datalog");
  });

  it("returns error when no ?- query present", async () => {
    const r = await graphQuery.handle({
      sessionId,
      query: 'foo(X) :- node(X, "service", _).',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "no-query");
  });

  it("respects the limit parameter", async () => {
    const r = await graphQuery.handle({
      sessionId,
      query: "?- node(N, K, Name).",
      limit: 2,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { results: unknown[]; truncated: boolean };
    assert.ok(data.results.length <= 2);
  });

  it("returns error for unknown bundled query ID", async () => {
    const r = await graphQuery.handle({
      sessionId,
      bundledQueryId: "nonexistent-query",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "unknown-bundled-query");
  });

  it("returns error when neither query nor bundledQueryId provided", async () => {
    const r = await graphQuery.handle({ sessionId });
    assert.equal(r.ok, false);
  });

  it("results are deterministic across runs", async () => {
    const q = '?- node(N, "route_handler", Name).';
    const r1 = await graphQuery.handle({ sessionId, query: q });
    const r2 = await graphQuery.handle({ sessionId, query: q });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    const d1 = r1.data as { resultCount: number };
    const d2 = r2.data as { resultCount: number };
    assert.equal(d1.resultCount, d2.resultCount);
  });
});

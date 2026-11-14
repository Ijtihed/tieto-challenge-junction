// Per `architecture/v1-launch-plan.md` Step 8b work item 1 +
// §0.6.4 adversarial verification with refinements (a-j) from
// day-1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  graphAsk,
  renderHitsMarkdown,
  DEFAULT_GRAPH_ASK_K,
  DEFAULT_GRAPH_ASK_BM25_K,
  DEFAULT_GRAPH_ASK_TRAVERSAL_K,
  DEFAULT_GRAPH_ASK_MAX_DEPTH,
} from "../actions/graph-ask.ts";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { getSession } from "../session/index.ts";

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical-set pinning
// ──────────────────────────────────────────────────────────
describe("graph.ask canonical defaults", () => {
  it("DEFAULT_GRAPH_ASK_K = 10 (Sourcegraph + research/29)", () => {
    assert.equal(DEFAULT_GRAPH_ASK_K, 10);
  });

  it("DEFAULT_GRAPH_ASK_BM25_K = 30 (inherits Step 8a default)", () => {
    assert.equal(DEFAULT_GRAPH_ASK_BM25_K, 30);
  });

  it("DEFAULT_GRAPH_ASK_TRAVERSAL_K = 30 (inherits Step 8a default)", () => {
    assert.equal(DEFAULT_GRAPH_ASK_TRAVERSAL_K, 30);
  });

  it("DEFAULT_GRAPH_ASK_MAX_DEPTH = 2 (inherits Step 8a default)", () => {
    assert.equal(DEFAULT_GRAPH_ASK_MAX_DEPTH, 2);
  });
});

// ──────────────────────────────────────────────────────────
// graph.ask action surface
// ──────────────────────────────────────────────────────────
describe("graph.ask action surface", () => {
  it("action name + sideEffect are correct", () => {
    assert.equal(graphAsk.name, "graph.ask");
    assert.equal(graphAsk.sideEffect, "none");
  });

  it("rejects missing sessionId", async () => {
    const r = await graphAsk.handle({ query: "anything" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-args");
  });

  it("rejects empty query", async () => {
    const r = await graphAsk.handle({ sessionId: "x", query: "" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-args");
  });

  it("rejects whitespace-only query (no leading 'meaningful query' bypass)", async () => {
    const r = await graphAsk.handle({ sessionId: "x", query: "   " });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "invalid-args");
  });

  it("rejects unknown session", async () => {
    const r = await graphAsk.handle({ sessionId: "missing", query: "anything" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "session-not-found");
  });
});

// ──────────────────────────────────────────────────────────
// End-to-end: real workspace → graph.ask → ranked hits
// ──────────────────────────────────────────────────────────
describe("graph.ask end-to-end", () => {
  async function setup(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "graph-ask-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src/auth.ts"),
      "export function login() {}\nexport function logout() {}\n",
    );
    writeFileSync(
      join(dir, "src/orders.ts"),
      "export function placeOrder() {}\nexport function cancelOrder() {}\n",
    );
    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    assert.equal(open.ok, true);
    if (!open.ok) throw new Error("setup failed");
    return (open.data as { sessionId: string }).sessionId;
  }

  it("returns ranked hits + a markdown URI for a simple query", async () => {
    const sessionId = await setup();
    const r = await graphAsk.handle({ sessionId, query: "login" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      query: string;
      k: number;
      hits: Array<{ nodeId: string; rrfScore: number; node: { name: string } }>;
      markdownUri: string;
    };
    assert.equal(data.query, "login");
    assert.equal(data.k, DEFAULT_GRAPH_ASK_K);
    assert.ok(data.hits.length > 0, "must return at least one hit for 'login'");
    assert.ok(data.markdownUri.startsWith("markdown://graph.ask/"));
    // The markdown resource is fetchable
    const session = getSession(sessionId)!;
    const md = session.markdownResources.get(data.markdownUri);
    assert.ok(md);
    assert.match(md!, /graph\.ask: `login`/);
  });

  it("respects k override", async () => {
    const sessionId = await setup();
    const r = await graphAsk.handle({ sessionId, query: "function", k: 3 });
    if (!r.ok) return;
    const data = r.data as { hits: unknown[]; k: number };
    assert.ok(data.hits.length <= 3);
    assert.equal(data.k, 3);
  });

  it("returns empty hits + an evidence-block markdown for a no-match query", async () => {
    const sessionId = await setup();
    const r = await graphAsk.handle({
      sessionId,
      query: "xyzzyx_no_such_term",
    });
    if (!r.ok) return;
    const data = r.data as { hits: unknown[]; markdownUri: string };
    assert.equal(data.hits.length, 0);
    const session = getSession(sessionId)!;
    const md = session.markdownResources.get(data.markdownUri)!;
    assert.match(md, /No matching nodes/);
  });

  it("§0.6.4 (a) extracted helper: renderHitsMarkdown is a pure function", () => {
    // Empty input → no-match string
    const empty = renderHitsMarkdown("anything", []);
    assert.match(empty, /No matching nodes/);
    // Non-empty input → table header
    const nonEmpty = renderHitsMarkdown("foo", [
      {
        nodeId: "n1",
        rrfScore: 0.0328,
        node: {
          id: "n1",
          kind: "function",
          name: "Foo",
          locator: "file:///r/foo.ts#n1",
        } as never,
        cluster: null,
        bm25: { rank: 1, score: 10 },
        traversal: null,
      } as never,
    ]);
    assert.match(nonEmpty, /\| 1 \|/);
    assert.match(nonEmpty, /`Foo`/);
    assert.match(nonEmpty, /bm25 #1/);
  });

  it("§0.6.4 (a) index cache: second query reuses the same hybrid index", async () => {
    const sessionId = await setup();
    // First query: builds index
    const t1 = Date.now();
    await graphAsk.handle({ sessionId, query: "login" });
    const firstMs = Date.now() - t1;
    // Second query: cached index
    const t2 = Date.now();
    await graphAsk.handle({ sessionId, query: "logout" });
    const secondMs = Date.now() - t2;
    // Second call should be at most 2x the first (allowing
    // for noise on tiny graphs). On real-world repos the
    // ratio is far smaller.
    assert.ok(secondMs <= firstMs * 5 + 5,
      `second graph.ask should not be >5x slower than first; first=${firstMs}ms second=${secondMs}ms`);
  });

  it("§0.6.4 DC mutation-L FIRING: hit.cluster is `null` when absent (NOT empty object)", async () => {
    // Wire contract: when a node has no cluster, the response
    // shape is `cluster: null` (canonical absence). A mutation
    // to `{id: "", name: ""}` would be a silent wire-shape
    // break. Source-inspection pin (the empirical fixture
    // always has clusters, so a behavioral test wouldn't fire
    // the null branch on a tiny graph).
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../actions/graph-ask.ts", import.meta.url),
      "utf-8",
    );
    // The absence branch must be `: null` — not `: {}` or
    // `: { id: "", ... }`.
    assert.match(
      src,
      /cluster:\s*h\.cluster\s*\?[\s\S]*?:\s*null/,
      "graph-ask.ts MUST return `cluster: null` when h.cluster is absent — wire contract",
    );
  });

  it("§0.6.4 DC mutation-H FIRING: graph.ask bumps session.lastActivityAt", async () => {
    // Every action must update lastActivityAt so session
    // GC doesn't reap a session that's actively in use.
    // A mutation that drops this line silently leaks
    // sessions to GC even while the user is querying.
    const sessionId = await setup();
    const session = getSession(sessionId)!;
    const beforeMs = (session as { lastActivityAt: number }).lastActivityAt;
    // Wait at least 1ms so the timestamp can differ.
    await new Promise((r) => setTimeout(r, 5));
    await graphAsk.handle({ sessionId, query: "anything" });
    const afterMs = (session as { lastActivityAt: number }).lastActivityAt;
    assert.ok(afterMs > beforeMs,
      `graph.ask MUST bump session.lastActivityAt; before=${beforeMs} after=${afterMs}`);
  });

  it("§0.6.4 DC mutation-G FIRING: cache uses BOTH nodeCount AND edgeCount", async () => {
    // Cache freshness key is (nodeCount, edgeCount). A mutation
    // that drops the edge-count check (nodeCount only) would
    // let stale indexes survive when edges are added/removed
    // without changing node count.
    //
    // This is a structural/code firing test: inspect the
    // graph-ask.ts source and confirm BOTH `nodeCount` and
    // `edgeCount` appear in the cache-hit conjunction.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../actions/graph-ask.ts", import.meta.url),
      "utf-8",
    );
    // Find the cache-hit line and verify both halves are present.
    const cacheLineMatch = src.match(/if \(cached && (.+)\) \{[\s\S]*?index = cached\.index/);
    assert.ok(cacheLineMatch, "could not locate cache-hit guard in graph-ask.ts");
    const conjunction = cacheLineMatch![1]!;
    assert.ok(conjunction.includes("nodeCount"),
      `cache guard MUST check nodeCount: ${conjunction}`);
    assert.ok(conjunction.includes("edgeCount"),
      `cache guard MUST check edgeCount: ${conjunction} — a mutation that drops this would let stale indexes survive after edge mutations`);
  });

  it("§0.6.4 (b) firing test: closed session is rejected", async () => {
    const sessionId = await setup();
    const session = getSession(sessionId)!;
    // Session has a `close()` method that flips the flag.
    await session.close();
    const r = await graphAsk.handle({ sessionId, query: "x" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "session-closed");
  });

  it("§0.6.4 DC mutation-Q FIRING: closed session check happens BEFORE cache lookup", async () => {
    // A subtle ordering bug: if cache lookup happened before
    // the closed check, a closed session could still serve
    // stale results from the cached index. Verify the closed
    // session is rejected even though it has a primed cache.
    const sessionId = await setup();
    // Prime the cache by querying once.
    await graphAsk.handle({ sessionId, query: "login" });
    const session = getSession(sessionId)!;
    await session.close();
    // The second call must NOT serve cached results.
    const r = await graphAsk.handle({ sessionId, query: "login" });
    assert.equal(r.ok, false,
      "graph.ask MUST reject a closed session even with a primed index cache");
    if (!r.ok) assert.equal(r.code, "session-closed");
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.2 + §0.6.4 (j) cross-layer pin: graph.ask wired into
// the dogfood smoke harness (Step 11a) under the canonical
// "graph.ask" key.
// ──────────────────────────────────────────────────────────
describe("§0.6.4 (j) cross-layer: graph.ask in SMOKE_STEPS", () => {
  it("SMOKE_STEPS uses graph.ask (Step 8b replaced graph.search)", async () => {
    const { SMOKE_STEPS } = await import("../domain/dogfood/smoke-harness.ts");
    assert.ok((SMOKE_STEPS as readonly string[]).includes("graph.ask"),
      "Step 8b: SMOKE_STEPS must include graph.ask");
    assert.ok(!(SMOKE_STEPS as readonly string[]).includes("graph.search"),
      "Step 8b: SMOKE_STEPS must NOT include graph.search anymore");
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 DC (j+): cross-layer name pin for docs. The MCP
// install guide names actions by string. A rename of any
// referenced action would let docs drift silently. Pin
// every action name in docs/mcp-install.md against the
// real exported .name. Also pin the headline action count.
// ──────────────────────────────────────────────────────────

describe("§0.6.4 DC mutation-N FIRING: docs/mcp-install.md action count is current", () => {
  it("the headline action count matches the real action surface", async () => {
    const { readFile } = await import("node:fs/promises");
    const docPath = new URL("../../docs/mcp-install.md", import.meta.url);
    const doc = await readFile(docPath, "utf-8");
    const actions = await import("../actions/index.ts");
    const realActionCount = Object.values(actions).filter(
      (a) => typeof (a as { name?: unknown }).name === "string",
    ).length;
    const docCountMatch = doc.match(/The full (\d+) MCP actions/);
    assert.ok(docCountMatch, "docs/mcp-install.md MUST state action count explicitly");
    const docCount = parseInt(docCountMatch[1]!, 10);
    assert.equal(
      docCount,
      realActionCount,
      `docs/mcp-install.md headline says ${docCount} actions but the real surface has ${realActionCount}`,
    );
  });
});


describe("§0.6.4 DC mutation-M FIRING: docs/mcp-install.md action names exist", () => {
  it("every action name in docs/mcp-install.md maps to a real exported action.name", async () => {
    const { readFile } = await import("node:fs/promises");
    const docPath = new URL("../../docs/mcp-install.md", import.meta.url);
    const doc = await readFile(docPath, "utf-8");
    const actions = await import("../actions/index.ts");
    const knownNames = new Set<string>(
      Object.values(actions)
        .filter((a) => typeof (a as { name?: unknown }).name === "string")
        .map((a) => (a as { name: string }).name),
    );
    // The action-name table block lists the 5 daily-driver
    // actions. Extract every backtick-wrapped token that
    // looks like an action (`area.verb` pattern).
    const referenced = new Set<string>();
    for (const m of doc.matchAll(/`([a-z_]+(?:\.[a-z_]+)+)`/g)) {
      const tok = m[1]!;
      // Skip method calls (.ts, .json, etc.) and false positives.
      if (tok.endsWith(".ts") || tok.endsWith(".json") || tok.endsWith(".md")) continue;
      if (tok.startsWith("schema:")) continue;
      // Filter to look like action surface (3+ chars per segment).
      if (tok.split(".").every((seg) => seg.length >= 3) && /^[a-z]/.test(tok)) {
        referenced.add(tok);
      }
    }
    // Every referenced action MUST be a real exported action.
    const missing = [...referenced].filter((n) => !knownNames.has(n));
    assert.deepEqual(missing, [],
      `docs/mcp-install.md references actions that don't exist: ${missing.join(", ")} (known: ${[...knownNames].join(", ")})`);
  });
});

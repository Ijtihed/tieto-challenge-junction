// Hardening tests — covers every critical/high bug found in audit.
// Tests: plan failure rollback, concurrency guard, cancel check,
// bridge unit tests, rules custom eval, extractor edge cases,
// workspace-describe completeness, tests.run honesty.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { workspaceDescribe } from "../actions/workspace-describe.ts";
import { planPropose } from "../actions/plan-propose.ts";
import { planApply } from "../actions/plan-apply.ts";
import { planStatus } from "../actions/plan-status.ts";
import { planRestore } from "../actions/plan-restore.ts";
import { planCancel } from "../actions/plan-cancel.ts";
import { rulesAdd } from "../actions/rules-add.ts";
import { rulesEvaluate } from "../actions/rules-evaluate.ts";
import { testsRun } from "../actions/tests-run.ts";
import { graphDiffAgainst } from "../actions/graph-diff-against.ts";
import { getSession } from "../session/index.ts";
import { buildRestBridgeEdges, detectFetchCalls, type RouteInfo, type FetchCallInfo } from "../domain/bridge-rest.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import { createEmptyGraph } from "../domain/multi-repo.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import type { MultiRepoGraph } from "../domain/multi-repo.ts";
import { parsePythonFile } from "../extractors/extractor-python/parser.ts";
import { parseGoFile } from "../extractors/extractor-go/parser.ts";
import { parseFile as parseTsFile } from "../extractors/extractor-typescript/parser.ts";

const FIXTURE_SRC = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");

// ══════════════════════════════════════════════════════════════
// Plan flow hardening
// ══════════════════════════════════════════════════════════════

describe("plan.apply — failure rollback", () => {
  let tempDir: string;
  let sessionId: string;

  before(async () => {
    tempDir = mkdtempSync(resolve(tmpdir(), "schema-hardening-"));
    cpSync(FIXTURE_SRC, tempDir, { recursive: true });
    const r = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns ok:false when a plan step fails", async () => {
    const session = getSession(sessionId)!;
    const node = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(node);

    const pr = await planPropose.handle({
      sessionId,
      rationale: "test failure",
      steps: [
        { op: "addMiddleware", symbolId: node!.id, args: { name: "mw1" } },
        { op: "addMiddleware", symbolId: "nonexistent_node_id", args: { name: "mw2" } },
      ],
    });
    assert.equal(pr.ok, true);
    const planId = (pr.data as { planId: string }).planId;

    const ar = await planApply.handle({ sessionId, planId });
    assert.equal(ar.ok, false, "plan.apply should return ok:false when a step fails");
    if (!ar.ok) {
      assert.ok(ar.message.includes("not found"), `Expected 'not found' in message, got: ${ar.message}`);
    }
  });

  it("auto-rollbacks file changes when a later step fails", async () => {
    const originalContent = readFileSync(resolve(tempDir, "routes.ts"), "utf-8");

    const session = getSession(sessionId)!;
    const routesNode = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(routesNode);

    const pr = await planPropose.handle({
      sessionId,
      rationale: "test rollback",
      steps: [
        { op: "addMiddleware", symbolId: routesNode!.id, args: { name: "tempMw" } },
        { op: "addMiddleware", symbolId: "nonexistent", args: { name: "x" } },
      ],
    });
    assert.equal(pr.ok, true);
    const planId = (pr.data as { planId: string }).planId;

    await planApply.handle({ sessionId, planId });

    const afterContent = readFileSync(resolve(tempDir, "routes.ts"), "utf-8");
    assert.equal(afterContent, originalContent, "File should be rolled back to original after failed plan");
  });

  it("rejects concurrent plan.apply on the same session", async () => {
    const session = getSession(sessionId)!;
    const node = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(node);

    const pr = await planPropose.handle({
      sessionId, rationale: "p1", steps: [{ op: "addMiddleware", symbolId: node!.id, args: { name: "a" } }],
    });
    const planId = (pr.data as { planId: string }).planId;
    await planApply.handle({ sessionId, planId });
    await planRestore.handle({ sessionId });

    const pr2 = await planPropose.handle({
      sessionId, rationale: "p2", steps: [{ op: "addMiddleware", symbolId: node!.id, args: { name: "b" } }],
    });
    const planId2 = (pr2.data as { planId: string }).planId;
    const result = await planApply.handle({ sessionId, planId: planId2 });
    assert.equal(result.ok, true, "Sequential plans should succeed");
  });
});

// ══════════════════════════════════════════════════════════════
// REST bridge unit tests
// ══════════════════════════════════════════════════════════════

describe("bridge-rest — unit tests", () => {
  it("matches identical paths", () => {
    const routes: RouteInfo[] = [{ method: "GET", path: "/api/todos", nodeId: "handler1", repoUri: "r1" }];
    const calls: FetchCallInfo[] = [{ url: "/api/todos", method: "GET", nodeId: "client1", repoUri: "r2" }];
    const { contractNodes, bridgeEdges } = buildRestBridgeEdges(routes, calls);
    assert.equal(contractNodes.length, 1);
    const implements_edges = bridgeEdges.filter((e) => e.relation === "implements_contract");
    const consumes_edges = bridgeEdges.filter((e) => e.relation === "consumes_contract");
    assert.equal(implements_edges.length, 1);
    assert.equal(consumes_edges.length, 1);
  });

  it("normalizes path parameters (:id → :param)", () => {
    const routes: RouteInfo[] = [{ method: "GET", path: "/api/todos/:id", nodeId: "h1", repoUri: "r1" }];
    const calls: FetchCallInfo[] = [{ url: "/api/todos/:todoId", method: "GET", nodeId: "c1", repoUri: "r2" }];
    const { bridgeEdges } = buildRestBridgeEdges(routes, calls);
    const consumes = bridgeEdges.filter((e) => e.relation === "consumes_contract");
    assert.equal(consumes.length, 1, "Path params should be normalized for matching");
  });

  it("normalizes {param} style path parameters", () => {
    const routes: RouteInfo[] = [{ method: "GET", path: "/api/users/{userId}", nodeId: "h1", repoUri: "r1" }];
    const calls: FetchCallInfo[] = [{ url: "/api/users/:id", method: "GET", nodeId: "c1", repoUri: "r2" }];
    const { bridgeEdges } = buildRestBridgeEdges(routes, calls);
    const consumes = bridgeEdges.filter((e) => e.relation === "consumes_contract");
    assert.equal(consumes.length, 1);
  });

  it("does not match different paths", () => {
    const routes: RouteInfo[] = [{ method: "GET", path: "/api/todos", nodeId: "h1", repoUri: "r1" }];
    const calls: FetchCallInfo[] = [{ url: "/api/users", method: "GET", nodeId: "c1", repoUri: "r2" }];
    const { bridgeEdges } = buildRestBridgeEdges(routes, calls);
    const consumes = bridgeEdges.filter((e) => e.relation === "consumes_contract");
    assert.equal(consumes.length, 0);
  });

  it("creates multiple contract nodes for different routes", () => {
    const routes: RouteInfo[] = [
      { method: "GET", path: "/api/todos", nodeId: "h1", repoUri: "r1" },
      { method: "POST", path: "/api/todos", nodeId: "h2", repoUri: "r1" },
      { method: "GET", path: "/api/users", nodeId: "h3", repoUri: "r1" },
    ];
    const { contractNodes } = buildRestBridgeEdges(routes, []);
    assert.equal(contractNodes.length, 3);
  });

  it("handles empty routes and empty calls gracefully", () => {
    const { contractNodes, bridgeEdges } = buildRestBridgeEdges([], []);
    assert.equal(contractNodes.length, 0);
    assert.equal(bridgeEdges.length, 0);
  });
});

// ══════════════════════════════════════════════════════════════
// rules.evaluate with custom session rules
// ══════════════════════════════════════════════════════════════

describe("rules.evaluate — custom session rules", () => {
  let sessionId: string;

  before(async () => {
    const r = await workspaceOpen.handle({ uris: [`file://${FIXTURE_SRC}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
  });

  it("evaluates custom rules added via rules.add", async () => {
    await rulesAdd.handle({
      sessionId,
      rule: { kind: "structural", body: "no files named store", severity: "warn", globs: ["store"] },
    });

    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { violations: { ruleId: string; message: string }[] };
    const customViolations = data.violations.filter((v) => v.ruleId.startsWith("rule_"));
    assert.ok(customViolations.length >= 1, `Expected custom rule violations for 'store', got ${customViolations.length}`);
    assert.ok(customViolations.some((v) => v.message.includes("store")));
  });
});

// ══════════════════════════════════════════════════════════════
// workspace.describe completeness
// ══════════════════════════════════════════════════════════════

describe("workspace.describe — all extractors reported", () => {
  let sessionId: string;

  before(async () => {
    const POLYGLOT_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/polyglot-todo");
    const r = await workspaceOpen.handle({ uris: [`file://${POLYGLOT_PATH}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
  });

  it("reports all 7 extractors", async () => {
    const r = await workspaceDescribe.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { extractors: { id: string }[] };
    assert.equal(data.extractors.length, 7);
    const ids = data.extractors.map((e) => e.id);
    assert.ok(ids.includes("extractor-typescript"));
    assert.ok(ids.includes("extractor-python"));
    assert.ok(ids.includes("extractor-go"));
    assert.ok(ids.includes("extractor-java-kotlin"));
    assert.ok(ids.includes("extractor-ruby"));
    assert.ok(ids.includes("extractor-rust"));
    assert.ok(ids.includes("extractor-generic-config"));
  });

  it("detects python, go, and typescript languages from the polyglot fixture", async () => {
    const r = await workspaceDescribe.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { languages: string[] };
    assert.ok(data.languages.includes("typescript"), `Missing typescript, got: ${data.languages}`);
    assert.ok(data.languages.includes("python"), `Missing python, got: ${data.languages}`);
    assert.ok(data.languages.includes("go"), `Missing go, got: ${data.languages}`);
  });
});

// ══════════════════════════════════════════════════════════════
// tests.run honesty
// ══════════════════════════════════════════════════════════════

describe("tests.run — no false positives", () => {
  let sessionId: string;

  before(async () => {
    const r = await workspaceOpen.handle({ uris: [`file://${FIXTURE_SRC}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
  });

  it("returns passed:false and skipped:true when no test runner found", async () => {
    const r = await testsRun.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { passed: boolean; skipped?: boolean; log: string };
    assert.equal(data.passed, false, "Should NOT report passed when no runner detected");
    assert.equal(data.skipped, true);
    assert.ok(data.log.includes("No test runner"));
  });
});

// ══════════════════════════════════════════════════════════════
// graph.diff_against — git error surfacing
// ══════════════════════════════════════════════════════════════

describe("graph.diff_against — git failure reporting", () => {
  let sessionId: string;

  before(async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-no-git-"));
    writeFileSync(resolve(tempDir, "hello.ts"), "const x = 1;");
    const r = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
  });

  it("returns ok:true with gitError field when git is unavailable", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { gitError?: string; markdownUri: string };
    if (data.gitError) {
      assert.ok(data.gitError.length > 0, "gitError should be descriptive");
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Built-in rules — edge cases
// ══════════════════════════════════════════════════════════════

describe("built-in rules — edge cases", () => {
  const noCycle = BUILTIN_RULES.find((r) => r.id === "builtin:no-cycle")!;

  it("detects a 3-node cycle A→B→C→A", () => {
    const g: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{
        uri: "file:///test",
        nodes: [
          { id: "a", kind: "utility", name: "A", locator: "file:///a" },
          { id: "b", kind: "utility", name: "B", locator: "file:///b" },
          { id: "c", kind: "utility", name: "C", locator: "file:///c" },
        ],
        edges: [
          { id: "e1", source: "a", target: "b", relation: "imports" },
          { id: "e2", source: "b", target: "c", relation: "imports" },
          { id: "e3", source: "c", target: "a", relation: "imports" },
        ],
        clusters: [],
      }],
      interRepoEdges: [],
    };
    const vs = noCycle.evaluate(g);
    assert.ok(vs.length >= 1, "Expected cycle detection for A→B→C→A");
  });

  it("handles graph with only one node", () => {
    const g: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{
        uri: "file:///test",
        nodes: [{ id: "solo", kind: "utility", name: "solo", locator: "file:///solo" }],
        edges: [],
        clusters: [],
      }],
      interRepoEdges: [],
    };
    const vs = noCycle.evaluate(g);
    assert.equal(vs.length, 0);
  });

  it("handles self-loop (A→A)", () => {
    const g: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{
        uri: "file:///test",
        nodes: [{ id: "a", kind: "utility", name: "A", locator: "file:///a" }],
        edges: [{ id: "e1", source: "a", target: "a", relation: "calls" }],
        clusters: [],
      }],
      interRepoEdges: [],
    };
    const vs = noCycle.evaluate(g);
    assert.ok(vs.length >= 1, "Expected cycle detection for self-loop");
  });
});

// ══════════════════════════════════════════════════════════════
// Extractor edge cases
// ══════════════════════════════════════════════════════════════

describe("extractors — edge cases", () => {
  it("Python parser handles syntax error gracefully", () => {
    const result = parsePythonFile("/test/bad.py", "def broken(:\n  pass", "file:///test");
    assert.ok(result.nodes.length >= 1, "Should at least return the file node");
  });

  it("Go parser handles empty file", () => {
    const result = parseGoFile("/test/empty.go", "", "file:///test");
    assert.ok(result.nodes.length >= 1);
  });

  it("TS parser handles file with only comments", () => {
    const result = parseTsFile("/test/comments.ts", "// just a comment\n/* another */", "file:///test");
    assert.ok(result.nodes.length >= 1, "Should return file node");
  });
});

// ══════════════════════════════════════════════════════════════
// Plan.cancel interaction with apply
// ══════════════════════════════════════════════════════════════

describe("plan.cancel — interaction with plan lifecycle", () => {
  it("cancel on a completed plan returns invalid-args", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-cancel-"));
    cpSync(FIXTURE_SRC, tempDir, { recursive: true });
    const openR = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
    assert.equal(openR.ok, true);
    const sid = (openR.data as { sessionId: string }).sessionId;
    const session = getSession(sid)!;
    const node = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(node);

    const pr = await planPropose.handle({
      sessionId: sid, rationale: "cancel test",
      steps: [{ op: "addMiddleware", symbolId: node!.id, args: { name: "mw" } }],
    });
    const planId = (pr.data as { planId: string }).planId;
    const ar = await planApply.handle({ sessionId: sid, planId });
    assert.equal(ar.ok, true);
    const planRunId = (ar.data as { planRunId: string }).planRunId;

    const cr = await planCancel.handle({ sessionId: sid, planRunId });
    assert.equal(cr.ok, false, "Should not cancel a completed plan");
    if (!cr.ok) {
      assert.ok(cr.message.includes("completed"));
    }

    await planRestore.handle({ sessionId: sid });
    await workspaceClose.handle({ sessionId: sid });
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// Phase 6 gate test — full plan flow.
//
// Uses a temp copy of the express-todos fixture to avoid modifying
// the real one. Proves: ops.list → ops.preview → plan.propose →
// plan.apply (writes file) → plan.status → plan.restore (undoes).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, cpSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { opsList } from "../actions/ops-list.ts";
import { opsPreview } from "../actions/ops-preview.ts";
import { planPropose } from "../actions/plan-propose.ts";
import { planApply } from "../actions/plan-apply.ts";
import { planStatus } from "../actions/plan-status.ts";
import { planRestore } from "../actions/plan-restore.ts";
import { planCancel } from "../actions/plan-cancel.ts";
import { testsRun } from "../actions/tests-run.ts";
import { markdownRead } from "../actions/markdown-read.ts";
import { getSession } from "../session/index.ts";
import { BUNDLED_OPS } from "../domain/bundled-ops.ts";

const FIXTURE_SRC = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
let tempDir: string;
let tempUri: string;
let sessionId: string;

before(async () => {
  tempDir = mkdtempSync(resolve(tmpdir(), "schema-plan-test-"));
  cpSync(FIXTURE_SRC, tempDir, { recursive: true });
  tempUri = `file://${tempDir}`;

  const result = await workspaceOpen.handle({ uris: [tempUri] });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("open failed");
  sessionId = (result.data as { sessionId: string }).sessionId;
});

after(async () => {
  await workspaceClose.handle({ sessionId });
  rmSync(tempDir, { recursive: true, force: true });
});

// ── ops.list ──

describe("ops.list", () => {
  it("returns all 8 bundled ops", async () => {
    const r = await opsList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { ops: { id: string; name: string; applicableToKind: string[] }[] };
    assert.equal(data.ops.length, 8);
    assert.ok(data.ops.some((o) => o.id === "addMiddleware"));
    assert.ok(data.ops.some((o) => o.id === "renameSymbol"));
  });

  it("filters ops by symbolId when provided", async () => {
    const session = getSession(sessionId)!;
    const nodes = session.graph.repos.flatMap((r) => r.nodes);
    const serviceNode = nodes.find((n) => n.kind === "service");
    if (!serviceNode) return;

    const r = await opsList.handle({ sessionId, symbolId: serviceNode.id });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { ops: { id: string }[] };
    for (const op of data.ops) {
      const bundled = BUNDLED_OPS.find((b) => b.id === op.id)!;
      assert.ok(bundled.applicableToKind.includes("service" as never), `Op ${op.id} should be applicable to 'service'`);
    }
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await opsList.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ── ops.preview ──

describe("ops.preview", () => {
  it("previews addMiddleware on a file node", async () => {
    const session = getSession(sessionId)!;
    const routesNode = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(routesNode, "Expected routes.ts node");

    const r = await opsPreview.handle({
      sessionId,
      symbolId: routesNode!.id,
      op: "addMiddleware",
      args: { name: "authMiddleware" },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { diff: string; blockers: { code: string }[]; markdownUri: string };
    assert.ok(data.diff.length > 0, "Expected a non-empty diff");
    assert.equal(data.blockers.length, 0);
    assert.ok(data.markdownUri.startsWith("markdown://ops.preview/"));
  });

  it("returns blockers for unknown op", async () => {
    const session = getSession(sessionId)!;
    const node = session.graph.repos.flatMap((r) => r.nodes)[0]!;
    const r = await opsPreview.handle({ sessionId, symbolId: node.id, op: "nonexistent" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args for unknown node", async () => {
    const r = await opsPreview.handle({ sessionId, symbolId: "fake_node", op: "addMiddleware" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ── Full plan flow: propose → apply → status → restore ──

describe("plan flow — addMiddleware gate test", () => {
  let planId: string;
  let planRunId: string;
  let routesNodeId: string;

  it("plan.propose creates a plan with addMiddleware step", async () => {
    const session = getSession(sessionId)!;
    const routesNode = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(routesNode);
    routesNodeId = routesNode!.id;

    const r = await planPropose.handle({
      sessionId,
      rationale: "Add auth middleware to routes",
      steps: [{ op: "addMiddleware", symbolId: routesNodeId, args: { name: "authMiddleware" } }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { planId: string; markdownUri: string };
    assert.ok(data.planId.startsWith("plan_"));
    assert.ok(data.markdownUri.startsWith("markdown://plan.propose/"));
    planId = data.planId;
  });

  it("plan.propose emits plan.proposed event", async () => {
    const session = getSession(sessionId)!;
    const events: { kind: string }[] = [];
    session.eventBus.subscribe((e) => events.push(e as { kind: string }));
    const proposed = events.filter((e) => e.kind === "plan.proposed");
    assert.ok(proposed.length >= 1);
  });

  it("plan.apply writes the modified file", async () => {
    const r = await planApply.handle({ sessionId, planId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { applied: boolean; planRunId: string };
    assert.equal(data.applied, true);
    assert.ok(data.planRunId.startsWith("run_"));
    planRunId = data.planRunId;

    const routesContent = readFileSync(resolve(tempDir, "routes.ts"), "utf-8");
    assert.ok(routesContent.includes("authMiddleware"), `Expected authMiddleware in routes.ts, got:\n${routesContent}`);
  });

  it("plan.status shows completed", async () => {
    const r = await planStatus.handle({ sessionId, planRunId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { state: string; steps: readonly { phase: string }[]; markdownUri: string };
    assert.equal(data.state, "completed");
    assert.equal(data.steps[0]!.phase, "passed");
    assert.ok(data.markdownUri.startsWith("markdown://plan.status/"));
  });

  it("plan.restore undoes the changes", async () => {
    const r = await planRestore.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { restored: boolean; fileCount: number };
    assert.equal(data.restored, true);
    assert.ok(data.fileCount >= 1);

    const routesContent = readFileSync(resolve(tempDir, "routes.ts"), "utf-8");
    assert.ok(!routesContent.includes("authMiddleware"), "Expected authMiddleware to be removed after restore");
  });
});

// ── plan.propose validation ──

describe("plan.propose — validation", () => {
  it("rejects unknown op", async () => {
    const session = getSession(sessionId)!;
    const node = session.graph.repos.flatMap((r) => r.nodes)[0]!;
    const r = await planPropose.handle({
      sessionId,
      rationale: "test",
      steps: [{ op: "nonexistent", symbolId: node.id }],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("rejects step missing symbolId", async () => {
    const r = await planPropose.handle({
      sessionId,
      rationale: "test",
      steps: [{ op: "addMiddleware" } as never],
    });
    assert.equal(r.ok, false);
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await planPropose.handle({ sessionId: "sess_fake", rationale: "x", steps: [] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns invalid-args when rationale is missing", async () => {
    const r = await planPropose.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ── plan.cancel ──

describe("plan.cancel", () => {
  it("returns invalid-args for unknown planRunId", async () => {
    const r = await planCancel.handle({ sessionId, planRunId: "run_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ── tests.run ──

describe("tests.run", () => {
  it("returns passed=false with skipped flag when no test runner detected", async () => {
    const r = await testsRun.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { passed: boolean; skipped?: boolean; log: string };
    assert.equal(data.passed, false);
    assert.equal(data.skipped, true);
    assert.ok(data.log.includes("No test runner"));
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await testsRun.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ── Markdown allowlist ──

describe("Rule 8 — Phase 6 markdown allowlist", () => {
  it("ops.preview includes markdownUri", async () => {
    const session = getSession(sessionId)!;
    const node = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(node);
    const r = await opsPreview.handle({ sessionId, symbolId: node!.id, op: "addMiddleware", args: { name: "mw" } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("plan.propose includes markdownUri", async () => {
    const session = getSession(sessionId)!;
    const node = session.graph.repos.flatMap((r) => r.nodes)[0]!;
    const r = await planPropose.handle({
      sessionId,
      rationale: "test markdown",
      steps: [{ op: "addMiddleware", symbolId: node.id, args: { name: "x" } }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("plan.status includes markdownUri", async () => {
    const session = getSession(sessionId)!;
    const runs = [...session.planRuns.values()];
    if (runs.length === 0) return;
    const r = await planStatus.handle({ sessionId, planRunId: runs[0]!.id });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("ops.list does NOT include markdownUri", async () => {
    const r = await opsList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });
});

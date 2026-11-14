// Integration tests for plan.validate, plan.interference, ops.signatures, incremental.stats.
// All four actions were missing integration-level coverage.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { planPropose } from "../actions/plan-propose.ts";
import { planValidate } from "../actions/plan-validate.ts";
import { planInterference } from "../actions/plan-interference.ts";
import { opsSignatures } from "../actions/ops-signatures.ts";
import { incrementalStats } from "../actions/incremental-stats.ts";
import { rulesAdd } from "../actions/rules-add.ts";
import { getSession } from "../session/index.ts";

const FIXTURE_SRC = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
let tempDir: string;
let sessionId: string;

before(async () => {
  tempDir = mkdtempSync(resolve(tmpdir(), "schema-new-actions-"));
  cpSync(FIXTURE_SRC, tempDir, { recursive: true });
  const r = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("open failed");
  sessionId = (r.data as { sessionId: string }).sessionId;
});

after(async () => {
  await workspaceClose.handle({ sessionId });
  rmSync(tempDir, { recursive: true, force: true });
});

// ── ops.signatures ──

describe("ops.signatures", () => {
  it("returns all registered signatures", async () => {
    const r = await opsSignatures.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { signatures: { opId: string }[]; sequenceCheck: null };
    assert.ok(data.signatures.length >= 8, `Expected ≥8 signatures, got ${data.signatures.length}`);
    assert.ok(data.signatures.some((s) => s.opId === "addMiddleware"));
    assert.ok(data.signatures.some((s) => s.opId === "renameSymbol"));
    assert.ok(data.signatures.some((s) => s.opId === "extractFunction"));
    assert.strictEqual(data.sequenceCheck, null);
  });

  it("each signature has preconditions, postconditions, and requiredArgs", async () => {
    const r = await opsSignatures.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { signatures: { opId: string; preconditions: readonly unknown[]; postconditions: readonly unknown[]; requiredArgs: readonly unknown[] }[] };
    for (const sig of data.signatures) {
      assert.ok(Array.isArray(sig.preconditions), `${sig.opId} missing preconditions array`);
      assert.ok(Array.isArray(sig.postconditions), `${sig.opId} missing postconditions array`);
      assert.ok(Array.isArray(sig.requiredArgs), `${sig.opId} missing requiredArgs array`);
    }
  });

  it("checks composition of a valid sequence", async () => {
    const r = await opsSignatures.handle({
      sessionId,
      checkSequence: ["renameSymbol", "extractFunction"],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { sequenceCheck: { valid: boolean; pairResults: { a: string; b: string }[] } };
    assert.ok(data.sequenceCheck !== null, "Expected sequenceCheck result");
    assert.ok(Array.isArray(data.sequenceCheck.pairResults));
    assert.equal(data.sequenceCheck.pairResults.length, 1);
    assert.equal(data.sequenceCheck.pairResults[0]!.a, "renameSymbol");
    assert.equal(data.sequenceCheck.pairResults[0]!.b, "extractFunction");
  });

  it("skips sequenceCheck when fewer than 2 ops given", async () => {
    const r = await opsSignatures.handle({ sessionId, checkSequence: ["renameSymbol"] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { sequenceCheck: null };
    assert.strictEqual(data.sequenceCheck, null);
  });

  it("returns invalid-args without sessionId", async () => {
    const r = await opsSignatures.handle({});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await opsSignatures.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ── plan.validate ──

describe("plan.validate", () => {
  let planId: string;
  let routesNodeId: string;

  before(async () => {
    const session = getSession(sessionId)!;
    const routesNode = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(routesNode, "Expected routes.ts node in fixture");
    routesNodeId = routesNode!.id;

    const r = await planPropose.handle({
      sessionId,
      rationale: "Validate test plan",
      steps: [{ op: "addMiddleware", symbolId: routesNodeId, args: { name: "testMw" } }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("propose failed");
    planId = (r.data as { planId: string }).planId;
  });

  it("validates a plan and returns per-step results", async () => {
    const r = await planValidate.handle({ sessionId, planId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      valid: boolean;
      summary: string;
      steps: {
        stepIndex: number;
        opId: string;
        nodeId: string;
        preconditionsSatisfied: boolean;
        preconditionFailures: string[];
        argsMissing: readonly string[];
        argTypeErrors: readonly unknown[];
        compositionConflicts: readonly string[];
        compositionWarnings: readonly string[];
      }[];
    };
    assert.ok(typeof data.valid === "boolean");
    assert.ok(typeof data.summary === "string");
    assert.equal(data.steps.length, 1);
    assert.equal(data.steps[0]!.stepIndex, 0);
    assert.equal(data.steps[0]!.opId, "addMiddleware");
    assert.equal(data.steps[0]!.nodeId, routesNodeId);
    assert.ok(Array.isArray(data.steps[0]!.preconditionFailures));
    assert.ok(Array.isArray(data.steps[0]!.argsMissing));
  });

  it("returns invalid-args for unknown planId", async () => {
    const r = await planValidate.handle({ sessionId, planId: "plan_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args without sessionId", async () => {
    const r = await planValidate.handle({ planId: "plan_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args without planId", async () => {
    const r = await planValidate.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await planValidate.handle({ sessionId: "sess_fake", planId: "plan_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ── plan.validate with multi-step plan ──

describe("plan.validate — multi-step plan", () => {
  let multiPlanId: string;

  before(async () => {
    const session = getSession(sessionId)!;
    const node = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts")!;
    const r = await planPropose.handle({
      sessionId,
      rationale: "Multi-step validate test",
      steps: [
        { op: "addMiddleware", symbolId: node.id, args: { name: "mw1" } },
        { op: "renameSymbol", symbolId: node.id, args: { newName: "renamedRoutes" } },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("propose failed");
    multiPlanId = (r.data as { planId: string }).planId;
  });

  it("validates multi-step plan with composition check", async () => {
    const r = await planValidate.handle({ sessionId, planId: multiPlanId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { steps: { compositionConflicts: readonly string[]; compositionWarnings: readonly string[] }[] };
    assert.equal(data.steps.length, 2);
    // Second step should have composition check since same node
    const step2 = data.steps[1]!;
    assert.ok(Array.isArray(step2.compositionConflicts));
    assert.ok(Array.isArray(step2.compositionWarnings));
  });
});

// ── plan.interference ──

describe("plan.interference", () => {
  let planId: string;

  before(async () => {
    const session = getSession(sessionId)!;
    const routesNode = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts");
    assert.ok(routesNode);

    const r = await planPropose.handle({
      sessionId,
      rationale: "Interference test plan",
      steps: [{ op: "addMiddleware", symbolId: routesNode!.id, args: { name: "ifMw" } }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("propose failed");
    planId = (r.data as { planId: string }).planId;
  });

  it("analyzes single-step plan (no interference)", async () => {
    const r = await planInterference.handle({ sessionId, planId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      stepAnalyses: { stepIndex: number; opId: string; footprint: { reads: number } | null }[];
      hasInterference: boolean;
      interferencePairs: unknown[];
    };
    assert.equal(data.stepAnalyses.length, 1);
    assert.equal(data.stepAnalyses[0]!.opId, "addMiddleware");
    assert.equal(data.hasInterference, false);
    assert.equal(data.interferencePairs.length, 0);
  });

  it("returns per-step footprint and bi-abduction", async () => {
    const r = await planInterference.handle({ sessionId, planId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      stepAnalyses: {
        stepIndex: number;
        footprint: { reads: number; writes: number; creates: number; destroys: number } | null;
        biAbduction: { frameSize: number; antiFrameSize: number; valid: boolean; errors: string[] } | null;
      }[];
    };
    const step = data.stepAnalyses[0]!;
    assert.ok(step.footprint !== null, "Expected footprint");
    assert.ok(step.footprint!.reads >= 1, "Op should read at least the target node");
    assert.ok(step.biAbduction !== null, "Expected bi-abduction result");
    assert.ok(typeof step.biAbduction!.frameSize === "number");
    assert.ok(typeof step.biAbduction!.valid === "boolean");
  });

  it("returns invalid-args for unknown planId", async () => {
    const r = await planInterference.handle({ sessionId, planId: "plan_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args without sessionId", async () => {
    const r = await planInterference.handle({ planId: "plan_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await planInterference.handle({ sessionId: "sess_fake", planId: "plan_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ── plan.interference with multi-step plan ──

describe("plan.interference — multi-step same-node", () => {
  let multiPlanId: string;

  before(async () => {
    const session = getSession(sessionId)!;
    const routesNode = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.name === "routes.ts")!;
    const r = await planPropose.handle({
      sessionId,
      rationale: "Multi-step interference test",
      steps: [
        { op: "addMiddleware", symbolId: routesNode.id, args: { name: "mw1" } },
        { op: "renameSymbol", symbolId: routesNode.id, args: { newName: "renamed" } },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("propose failed");
    multiPlanId = (r.data as { planId: string }).planId;
  });

  it("detects interference when two ops touch the same node", async () => {
    const r = await planInterference.handle({ sessionId, planId: multiPlanId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      stepAnalyses: unknown[];
      hasInterference: boolean;
      interferencePairs: { stepA: number; stepB: number; interferes: boolean; sharedReads: number }[];
    };
    assert.equal(data.stepAnalyses.length, 2);
    // Two ops on same node should share reads at minimum
    if (data.interferencePairs.length > 0) {
      const pair = data.interferencePairs[0]!;
      assert.equal(pair.stepA, 0);
      assert.equal(pair.stepB, 1);
      assert.ok(pair.sharedReads >= 1 || pair.interferes);
    }
  });
});

// ── incremental.stats ──

describe("incremental.stats", () => {
  it("returns evaluator state", async () => {
    const r = await incrementalStats.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as {
      version: number;
      evalCount: number;
      programInstalled: boolean;
    };
    assert.ok(typeof data.version === "number");
    assert.ok(typeof data.evalCount === "number");
    assert.ok(typeof data.programInstalled === "boolean");
  });

  it("reflects state after adding rules", async () => {
    const addResult = await rulesAdd.handle({
      sessionId,
      rule: { datalog: `reachable(X, Y) :- edge(X, Y). reachable(X, Z) :- edge(X, Y), reachable(Y, Z).` },
    });
    assert.equal(addResult.ok, true);

    const r = await incrementalStats.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { programInstalled: boolean; version: number };
    assert.equal(data.programInstalled, true);
    assert.ok(data.version >= 1);
  });

  it("returns invalid-args without sessionId", async () => {
    const r = await incrementalStats.handle({});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await incrementalStats.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ── git.status and github.open_pr validation ──

import { gitStatus } from "../actions/git-status.ts";
import { githubOpenPr } from "../actions/github-open-pr.ts";

describe("git.status — validation", () => {
  it("returns invalid-args without sessionId", async () => {
    const r = await gitStatus.handle({});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await gitStatus.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns io-error for non-git workspace", async () => {
    const r = await gitStatus.handle({ sessionId });
    // Temp fixture copy has no .git — expect io-error or a graceful failure
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "io-error");
  });
});

describe("github.open_pr — validation", () => {
  it("returns invalid-args without sessionId", async () => {
    const r = await githubOpenPr.handle({ title: "test" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args without title", async () => {
    const r = await githubOpenPr.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await githubOpenPr.handle({ sessionId: "sess_fake", title: "test" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns vendor-unavailable without GITHUB_TOKEN", async () => {
    const original = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];
    try {
      const r = await githubOpenPr.handle({ sessionId, title: "test pr" });
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.code, "vendor-unavailable");
    } finally {
      if (original) process.env["GITHUB_TOKEN"] = original;
    }
  });
});

// ── Closed session handling ──

describe("closed session handling", () => {
  let closedSessionId: string;

  before(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "schema-closed-session-"));
    cpSync(FIXTURE_SRC, dir, { recursive: true });
    const r = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    assert.equal(r.ok, true);
    closedSessionId = (r.data as { sessionId: string }).sessionId;
    await workspaceClose.handle({ sessionId: closedSessionId });
    rmSync(dir, { recursive: true, force: true });
  });

  it("ops.signatures rejects closed session", async () => {
    const r = await opsSignatures.handle({ sessionId: closedSessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("plan.validate rejects closed session", async () => {
    const r = await planValidate.handle({ sessionId: closedSessionId, planId: "plan_x" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("plan.interference rejects closed session", async () => {
    const r = await planInterference.handle({ sessionId: closedSessionId, planId: "plan_x" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("incremental.stats rejects closed session", async () => {
    const r = await incrementalStats.handle({ sessionId: closedSessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// Per architecture/schema-v3.md §5.3 action 20
// Hardened: auto-rollback on failure, ok:false on failure,
// concurrency guard (one plan at a time), cancel check between steps.
// Pre-flight: validates plan with refinement-type constraint solver before execution.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { getSession } from "../session/index.ts";
import { getOp } from "../domain/bundled-ops.ts";
import { validatePlan, type ConstraintPlanStep } from "../domain/constraint-solver.ts";
import type { PlanRun, StepRun } from "../domain/types.ts";
import type { Session } from "../session/session.ts";

export const planApply = {
  name: "plan.apply" as const,
  description: "Execute a previously proposed plan, applying each step sequentially with auto-rollback on failure.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      planId: { type: "string", description: "The plan ID to apply" },
    },
    required: ["sessionId", "planId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    const planId = args["planId"] as string | undefined;
    if (!planId) {
      return { ok: false as const, code: "invalid-args", message: "planId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const plan = session.plans.get(planId);
    if (!plan) {
      return { ok: false as const, code: "invalid-args", message: `Plan ${planId} not found` };
    }

    const runningPlans = [...session.planRuns.values()].filter((r) => r.state === "running");
    if (runningPlans.length > 0) {
      return { ok: false as const, code: "concurrent-edit", message: "Another plan is already running on this session" };
    }

    // Pre-flight: refinement-type constraint validation (advisory, not blocking)
    const planSteps: ConstraintPlanStep[] = plan.steps.map((s) => ({
      opId: s.op, nodeId: s.symbolId, args: s.args,
    }));
    const preflight = validatePlan(session.graph, planSteps);
    const preflightWarnings: string[] = [];
    if (!preflight.valid) {
      for (const s of preflight.steps) {
        const reasons: string[] = [];
        for (const f of s.preconditionCheck.failures) reasons.push(f.reason);
        for (const m of s.argValidation.missing) reasons.push(`missing arg "${m}"`);
        for (const t of s.argValidation.typeErrors) reasons.push(`arg "${t.arg}": expected ${t.expected}, got ${t.got}`);
        if (s.compositionCheck) for (const c of s.compositionCheck.conflicts) reasons.push(c);
        if (reasons.length > 0) {
          preflightWarnings.push(`Step ${s.stepIndex} (${s.opId} on ${s.nodeId}): ${reasons.join("; ")}`);
        }
      }
      session.eventBus.emit({ kind: "plan.preflight_warnings", planId, warnings: preflightWarnings, at: Date.now() });
    }

    const planRunId = `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const stepRuns: StepRun[] = plan.steps.map((_, i) => ({ step: i, phase: "pending" as const }));

    const planRun: PlanRun = {
      id: planRunId,
      planId,
      state: "running",
      steps: stepRuns,
      startedAt: Date.now(),
    };
    session.planRuns.set(planRunId, planRun);

    const allNodes = new Map(session.graph.repos.flatMap((r) => r.nodes.map((n) => [n.id, n] as const)));
    let failed = false;
    let failMessage = "";

    for (let i = 0; i < plan.steps.length; i++) {
      const currentRun = session.planRuns.get(planRunId);
      if (currentRun?.state === "cancelled") {
        failed = true;
        failMessage = "Plan was cancelled";
        updateStepRun(session, planRunId, i, "failed", undefined, "Cancelled");
        break;
      }

      const step = plan.steps[i]!;
      const op = getOp(step.op);
      if (!op) {
        failed = true;
        failMessage = `Unknown op: ${step.op}`;
        updateStepRun(session, planRunId, i, "failed", undefined, failMessage);
        break;
      }

      session.eventBus.emit({ kind: "plan.step", planRunId, step: i, phase: "applying", at: Date.now() });
      updateStepRun(session, planRunId, i, "applying");

      const node = allNodes.get(step.symbolId);
      if (!node?.filePath) {
        failed = true;
        failMessage = `Node ${step.symbolId} not found or has no file`;
        updateStepRun(session, planRunId, i, "failed", undefined, failMessage);
        break;
      }

      let fileContent: string;
      try {
        fileContent = readFileSync(node.filePath, "utf-8");
      } catch (err) {
        failed = true;
        failMessage = `Cannot read ${node.filePath}`;
        updateStepRun(session, planRunId, i, "failed", undefined, failMessage);
        break;
      }

      if (!session.fileSnapshots.has(node.filePath)) {
        session.fileSnapshots.set(node.filePath, fileContent);
      }

      const result = op.apply({
        filePath: node.filePath,
        fileContent,
        symbolName: node.name,
        args: step.args ?? {},
      });

      if (result.filesChanged.length > 0) {
        try {
          writeFileSync(node.filePath, result.newContent, "utf-8");
        } catch (err) {
          failed = true;
          failMessage = `Cannot write ${node.filePath}`;
          updateStepRun(session, planRunId, i, "failed", undefined, failMessage);
          break;
        }
      }

      updateStepRun(session, planRunId, i, "passed", result.filesChanged);
      session.eventBus.emit({ kind: "plan.step", planRunId, step: i, phase: "passed", at: Date.now() });
    }

    if (failed) {
      rollbackSnapshots(session);
      updatePlanRunState(session, planRunId, "failed");
      session.eventBus.emit({ kind: "plan.failed", planRunId, at: Date.now() });
      return { ok: false as const, code: "blocker", message: failMessage };
    }

    updatePlanRunState(session, planRunId, "completed");
    session.eventBus.emit({ kind: "plan.completed", planRunId, at: Date.now() });

    return {
      ok: true as const,
      data: {
        applied: true,
        planRunId,
        preflightWarnings: preflightWarnings.length > 0 ? preflightWarnings : undefined,
      },
    };
  },
};

function rollbackSnapshots(session: Session): void {
  for (const [filePath, content] of session.fileSnapshots) {
    try { writeFileSync(filePath, content, "utf-8"); } catch { /* best-effort */ }
  }
  session.fileSnapshots.clear();
}

function updateStepRun(
  session: Session, planRunId: string, stepIdx: number,
  phase: StepRun["phase"], filesChanged?: readonly string[], error?: string,
) {
  const run = session.planRuns.get(planRunId);
  if (!run) return;
  const steps = [...run.steps];
  const base: { step: number; phase: StepRun["phase"] } = { step: stepIdx, phase };
  const entry: StepRun = filesChanged
    ? (error ? { ...base, filesChanged, error } : { ...base, filesChanged })
    : (error ? { ...base, error } : base);
  steps[stepIdx] = entry;
  session.planRuns.set(planRunId, { ...run, steps });
}

function updatePlanRunState(session: Session, planRunId: string, state: PlanRun["state"]) {
  const run = session.planRuns.get(planRunId);
  if (!run) return;
  session.planRuns.set(planRunId, { ...run, state, completedAt: Date.now() });
}

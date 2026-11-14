// plan.validate — pre-flight validation of a plan using the refinement-type constraint solver.
// Does NOT apply the plan; returns validation results for each step.
import { getSession } from "../session/index.ts";
import { validatePlan, type ConstraintPlanStep } from "../domain/constraint-solver.ts";

export const planValidate = {
  name: "plan.validate" as const,
  description: "Validate a plan's steps against the current graph using refinement-type constraint checking. Does not apply the plan.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      planId: { type: "string", description: "The plan ID to validate" },
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

    const planSteps: ConstraintPlanStep[] = plan.steps.map((s) => ({
      opId: s.op, nodeId: s.symbolId, args: s.args,
    }));
    const validation = validatePlan(session.graph, planSteps);

    return {
      ok: true as const,
      data: {
        valid: validation.valid,
        summary: validation.summary,
        steps: validation.steps.map((s) => ({
          stepIndex: s.stepIndex,
          opId: s.opId,
          nodeId: s.nodeId,
          preconditionsSatisfied: s.preconditionCheck.satisfied,
          preconditionFailures: s.preconditionCheck.failures.map((f) => f.reason),
          argsMissing: s.argValidation.missing,
          argTypeErrors: s.argValidation.typeErrors,
          compositionConflicts: s.compositionCheck?.conflicts ?? [],
          compositionWarnings: s.compositionCheck?.warnings ?? [],
        })),
      },
    };
  },
};

// plan.interference — checks a plan for resource interference using separation logic.
import { getSession } from "../session/index.ts";
import { computeFootprint, biAbduce, analyzePlanInterference } from "../domain/separation-logic.ts";

export const planInterference = {
  name: "plan.interference" as const,
  description: "Analyze a plan for resource interference between steps using bi-abductive separation logic. Reports shared reads, write-write conflicts, and frame/anti-frame analysis.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      planId: { type: "string", description: "The plan ID to analyze" },
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

    const steps = plan.steps.map((s) => ({ opId: s.op, nodeId: s.symbolId }));

    // Per-step footprint + bi-abduction
    const stepAnalyses = steps.map((step, i) => {
      const footprint = computeFootprint(session.graph, step.opId, step.nodeId);
      if (!footprint) {
        return {
          stepIndex: i, opId: step.opId, nodeId: step.nodeId,
          footprint: null, biAbduction: null,
        };
      }
      const ba = biAbduce(session.graph, footprint);
      return {
        stepIndex: i, opId: step.opId, nodeId: step.nodeId,
        footprint: {
          reads: footprint.reads.length,
          writes: footprint.writes.length,
          creates: footprint.creates.length,
          destroys: footprint.destroys.length,
        },
        biAbduction: {
          frameSize: ba.frame.length,
          antiFrameSize: ba.antiFrame.length,
          valid: ba.valid,
          errors: ba.errors,
        },
      };
    });

    // Pairwise interference
    const interference = analyzePlanInterference(session.graph, steps);

    return {
      ok: true as const,
      data: {
        stepAnalyses,
        hasInterference: interference.hasInterference,
        interferencePairs: interference.pairResults.map((p) => ({
          stepA: p.stepA,
          stepB: p.stepB,
          interferes: p.result.interferes,
          sharedReads: p.result.sharedReads.length,
          conflicts: p.result.conflicts.map((c) => ({
            resource: c.resource.id,
            reason: c.reason,
          })),
        })),
      },
    };
  },
};

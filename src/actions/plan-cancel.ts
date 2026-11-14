// Per architecture/schema-v3.md §5.3 action 22
import { getSession } from "../session/index.ts";

export const planCancel = {
  name: "plan.cancel" as const,
  description: "Cancel a currently running plan execution, halting further step processing.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      planRunId: { type: "string", description: "The plan run ID to cancel" },
    },
    required: ["sessionId", "planRunId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    const planRunId = args["planRunId"] as string | undefined;
    if (!planRunId) {
      return { ok: false as const, code: "invalid-args", message: "planRunId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const run = session.planRuns.get(planRunId);
    if (!run) {
      return { ok: false as const, code: "invalid-args", message: `PlanRun ${planRunId} not found` };
    }

    if (run.state !== "running") {
      return { ok: false as const, code: "invalid-args", message: `PlanRun is ${run.state}, not running` };
    }

    session.planRuns.set(planRunId, { ...run, state: "cancelled", completedAt: Date.now() });
    session.eventBus.emit({ kind: "plan.cancelled", planRunId, at: Date.now() });

    return { ok: true as const, data: { cancelled: true } };
  },
};

// Per architecture/schema-v3.md §5.3 action 23
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";

export const planStatus = {
  name: "plan.status" as const,
  description: "Check the execution status of a plan run including per-step results and files changed.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      planRunId: { type: "string", description: "The plan run ID to check status of" },
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

    const filesChanged = run.steps.flatMap((s) => s.filesChanged ?? []);

    const resultId = randomUUID();
    const markdown = [
      `# Plan Run Status`,
      "",
      `**State:** ${run.state}`,
      `**Steps:** ${run.steps.length}`,
      "",
      ...run.steps.map((s) => {
        const icon = s.phase === "passed" ? "✅" : s.phase === "failed" ? "❌" : "⏳";
        return `${icon} Step ${s.step}: ${s.phase}${s.error ? ` — ${s.error}` : ""}`;
      }),
    ].join("\n");
    const markdownUri = `markdown://plan.status/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: {
        state: run.state,
        steps: run.steps,
        filesChanged,
        markdownUri,
      },
    };
  },
};

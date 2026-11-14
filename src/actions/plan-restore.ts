// Per architecture/schema-v3.md §5.3 action 21
import { writeFileSync } from "node:fs";
import { getSession } from "../session/index.ts";

export const planRestore = {
  name: "plan.restore" as const,
  description: "Restore all files modified by plan execution to their pre-plan snapshot state.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    let fileCount = 0;
    for (const [filePath, content] of session.fileSnapshots) {
      try {
        writeFileSync(filePath, content, "utf-8");
        fileCount++;
      } catch {
        // best-effort restore
      }
    }
    session.fileSnapshots.clear();

    const lastRunId = [...session.planRuns.values()].at(-1)?.id ?? "";
    session.eventBus.emit({ kind: "plan.restored", planRunId: lastRunId, at: Date.now() });

    return {
      ok: true as const,
      data: { restored: true, fileCount },
    };
  },
};

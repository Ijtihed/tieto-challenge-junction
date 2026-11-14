// Per `architecture/v1-launch-plan.md` Step 1 — surfaces the latest
// workspace.open extraction stats so callers (Studio, CLI, MCP tools)
// can render a failure banner without scraping stderr.
//
// Forward-compatible: this action's response shape includes only
// extraction stats today. Step 5 (live atlas) will extend it with
// per-layer cache hit rates + p50/p95 latency without breaking
// callers that consume only the `extraction` field.

import { getSession } from "../session/index.ts";
import { emptyExtractionStats } from "../domain/extraction-stats.ts";

export const cachingStats = {
  name: "caching.stats" as const,
  description: "Returns the most recent workspace.open extraction summary: filesAttempted, filesParsed, filesSkipped, failures (with reasons), per-extractor breakdown.",
  sideEffect: "none" as const,
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
    const stats = session.latestExtractionStats ?? emptyExtractionStats();

    return {
      ok: true as const,
      data: {
        extraction: stats,
      },
    };
  },
};

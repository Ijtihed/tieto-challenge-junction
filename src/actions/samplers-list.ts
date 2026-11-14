// Per architecture/schema-v3.md §5.3 action 27
import { getSession } from "../session/index.ts";

const DAY_ONE_SAMPLERS = [
  { id: "sampler-anthropic", vendor: "anthropic", model: "claude-sonnet-4-20250514", envKey: "ANTHROPIC_API_KEY" },
  { id: "sampler-gemini", vendor: "gemini", model: "gemini-2.5-pro", envKey: "GEMINI_API_KEY" },
  { id: "sampler-openai", vendor: "openai", model: "o3", envKey: "OPENAI_API_KEY" },
  { id: "sampler-mock", vendor: "mock", model: "graph-heuristic", envKey: null },
] as const;

export const samplersList = {
  name: "samplers.list" as const,
  description: "List available LLM samplers with their availability status and required environment variables.",
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
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const samplers = DAY_ONE_SAMPLERS.map((s) => {
      const available = s.envKey === null || !!process.env[s.envKey];
      return {
        id: s.id,
        vendor: s.vendor,
        model: s.model,
        available,
        reason: available ? undefined : `Set ${s.envKey} environment variable`,
      };
    });

    return { ok: true as const, data: { samplers } };
  },
};

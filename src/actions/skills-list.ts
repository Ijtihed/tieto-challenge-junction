// Per architecture/schema-v3.md §5.3 action 33
import { getSession } from "../session/index.ts";
import { BUNDLED_SKILLS } from "../wisdom/skills/index.ts";

export const skillsList = {
  name: "skills.list" as const,
  description: "List all bundled wisdom-layer skills with their metadata and skill:// URIs.",
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

    return {
      ok: true as const,
      data: {
        skills: BUNDLED_SKILLS.map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          description: s.description,
          uri: `skill://${s.id}`,
        })),
      },
    };
  },
};

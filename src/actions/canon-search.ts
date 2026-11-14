// Per architecture/schema-v3.md §5.3 action 34
import { getSession } from "../session/index.ts";
import { searchCanon } from "../wisdom/canon/index.ts";

export const canonSearch = {
  name: "canon.search" as const,
  description: "Search the canon knowledge base for architectural wisdom documents by paradigm and/or free-text query.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      query: { type: "string", description: "Free-text search query" },
      paradigm: { type: "string", description: "Optional paradigm filter (e.g. 'otp', 'cqrs', 'ddd')" },
      k: { type: "number", description: "Number of results to return (default 8)" },
    },
    required: ["sessionId", "query"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const paradigm = args["paradigm"] as string | undefined;
    const query = args["query"] as string | undefined;
    if (!query) return { ok: false as const, code: "invalid-args", message: "query is required" };

    const k = (args["k"] as number | undefined) ?? 8;
    const hits = searchCanon(paradigm, query, k);

    return { ok: true as const, data: { hits } };
  },
};

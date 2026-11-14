// Per architecture/schema-v3.md §5.3 action 35
import { getSession } from "../session/index.ts";
import { readCanonDoc } from "../wisdom/canon/index.ts";

export const canonRead = {
  name: "canon.read" as const,
  description: "Read the full body and metadata of a canon knowledge document by its canon:// URI.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      uri: { type: "string", description: "The canon:// URI of the document to read" },
    },
    required: ["sessionId", "uri"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const uri = args["uri"] as string | undefined;
    if (!uri) return { ok: false as const, code: "invalid-args", message: "uri is required" };
    if (!uri.startsWith("canon://")) return { ok: false as const, code: "invalid-args", message: "uri must start with canon://" };

    const chunk = readCanonDoc(uri);
    if (!chunk) return { ok: false as const, code: "invalid-args", message: `Canon document not found: ${uri}` };

    return { ok: true as const, data: { body: chunk.body, metadata: chunk.metadata } };
  },
};

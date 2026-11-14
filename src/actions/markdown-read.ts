// Per architecture/schema-v3.md §5.3 action 28 (Rule 8)
import { getSession } from "../session/index.ts";

export const markdownRead = {
  name: "markdown.read" as const,
  description: "Read a session-stored markdown resource by its markdown:// URI.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      uri: { type: "string", description: "The markdown:// URI to read" },
    },
    required: ["sessionId", "uri"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const uri = args["uri"] as string | undefined;
    if (!uri) {
      return { ok: false as const, code: "invalid-args", message: "uri is required" };
    }

    if (!uri.startsWith("markdown://")) {
      return { ok: false as const, code: "invalid-args", message: "uri must start with markdown://" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const markdown = session.markdownResources.get(uri);
    if (markdown === undefined) {
      return { ok: false as const, code: "invalid-args", message: `Markdown resource not found: ${uri}` };
    }

    return {
      ok: true as const,
      data: { markdown, charset: "utf-8" as const },
    };
  },
};

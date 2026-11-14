// Per architecture/schema-v3.md §5.3 action 31
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import { readAgentsMd } from "../wisdom/agents-md/index.ts";

export const agentsMdRead = {
  name: "agents_md.read" as const,
  description: "Read and parse the AGENTS.md file from the workspace root, extracting the Schema-fenced section.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      includeUserSection: { type: "boolean", description: "Whether to include the user-authored section (default false)" },
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

    const rootUri = session.workspaceUris[0];
    const rootPath = rootUri?.startsWith("file://") ? rootUri.slice(7) : undefined;
    if (!rootPath) return { ok: false as const, code: "invalid-args", message: "No file:// workspace URI" };

    const includeUserSection = (args["includeUserSection"] as boolean | undefined) ?? false;
    const result = readAgentsMd(rootPath, { includeUserSection });
    if (!result) return { ok: false as const, code: "io-error", message: "Could not read AGENTS.md" };

    const resultId = randomUUID();
    const markdown = result.schemaSection || "_No Schema-fenced section found in AGENTS.md._";
    const markdownUri = `markdown://agents_md.read/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return { ok: true as const, data: { ...result, markdownUri } };
  },
};

// Per architecture/schema-v3.md §5.3 action 32
import { getSession } from "../session/index.ts";
import { renderFacts, writeFacts } from "../wisdom/agents-md/index.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import type { Violation } from "../domain/types.ts";

export const agentsMdWriteFacts = {
  name: "agents_md.write_facts" as const,
  description: "Write computed architectural facts (graph structure and rule violations) into the AGENTS.md Schema-fenced section.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      target: { type: "string", description: "Target file name to write facts to (default 'AGENTS.md')" },
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

    const target = (args["target"] as string | undefined) ?? "AGENTS.md";

    const violations: Violation[] = [];
    for (const rule of BUILTIN_RULES) {
      violations.push(...rule.evaluate(session.graph));
    }

    const facts = renderFacts(session.graph, violations);
    const result = writeFacts(rootPath, facts, target);

    session.eventBus.emit({
      kind: "agents_md.facts_written",
      writtenPath: result.writtenPath,
      charsAdded: result.charsAdded,
      charsRemoved: result.charsRemoved,
      at: Date.now(),
    });

    return { ok: true as const, data: result };
  },
};

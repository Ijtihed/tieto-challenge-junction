// Per architecture/schema-v3.md §5.3 action 16
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSession } from "../session/index.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";

export const rulesExport = {
  name: "rules.export" as const,
  description: "Export all active rules (built-in and session-defined) to a schema.config.json file in the workspace root.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      target: { type: "string", description: "Output file name relative to workspace root (default 'schema.config.json')" },
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

    const target = (args["target"] as string | undefined) ?? "schema.config.json";
    const rootUri = session.workspaceUris[0];
    const rootPath = rootUri?.startsWith("file://") ? rootUri.slice(7) : undefined;
    if (!rootPath) return { ok: false as const, code: "invalid-args", message: "No file:// workspace URI" };

    const config = {
      $schema: "https://schema.dev/config-schema.json",
      version: "1.0",
      rules: [
        ...BUILTIN_RULES.map(({ evaluate: _, ...r }) => r),
        ...session.rules,
      ],
    };

    const filePath = resolve(rootPath, target);
    writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    session.eventBus.emit({ kind: "rules.exported", at: Date.now() });

    return {
      ok: true as const,
      data: { writtenPath: filePath, summary: `${config.rules.length} rules exported` },
    };
  },
};

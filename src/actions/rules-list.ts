// Per architecture/schema-v3.md §5.3 action 13
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import type { Rule, ImportedRule } from "../domain/types.ts";

function renderMarkdown(rules: Rule[], imported: ImportedRule[], builtins: Rule[]): string {
  const lines: string[] = ["# Active Rules", ""];
  if (builtins.length > 0) {
    lines.push("## Built-in rules", "");
    for (const r of builtins) {
      lines.push(`- **${r.id}** (${r.severity}): ${r.body}`);
    }
    lines.push("");
  }
  if (rules.length > 0) {
    lines.push("## Session rules", "");
    for (const r of rules) {
      lines.push(`- **${r.id}** (${r.severity}): ${r.body}`);
    }
    lines.push("");
  }
  if (imported.length > 0) {
    lines.push("## Imported rules", "");
    for (const r of imported) {
      lines.push(`- **${r.id}** from ${r.source} (${r.severity}): ${r.body}`);
    }
    lines.push("");
  }
  if (rules.length === 0 && imported.length === 0 && builtins.length === 0) {
    lines.push("_No rules configured._");
  }
  return lines.join("\n");
}

export const rulesList = {
  name: "rules.list" as const,
  description: "List all active rules for the session including built-in, session-defined, and imported rules.",
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

    const builtins: Rule[] = BUILTIN_RULES.map(({ evaluate: _, ...rest }) => rest);
    const imported: ImportedRule[] = [];

    const resultId = randomUUID();
    const markdown = renderMarkdown(session.rules, imported, builtins);
    const markdownUri = `markdown://rules.list/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: { rules: session.rules, imported, builtins, markdownUri },
    };
  },
};

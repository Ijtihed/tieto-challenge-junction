// Per architecture/schema-v3.md §5.3 action 18
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getSession } from "../session/index.ts";
import { getOp } from "../domain/bundled-ops.ts";
import { validateSingleOp } from "../domain/constraint-solver.ts";

export const opsPreview = {
  name: "ops.preview" as const,
  description: "Preview the diff and potential blockers of applying an operation to a specific symbol without making changes.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      symbolId: { type: "string", description: "The target node ID to apply the op to" },
      op: { type: "string", description: "The operation ID to preview" },
      args: { type: "object", description: "Additional arguments for the operation" },
    },
    required: ["sessionId", "symbolId", "op"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    const symbolId = args["symbolId"] as string | undefined;
    if (!symbolId) {
      return { ok: false as const, code: "invalid-args", message: "symbolId is required" };
    }
    const opId = args["op"] as string | undefined;
    if (!opId) {
      return { ok: false as const, code: "invalid-args", message: "op is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const op = getOp(opId);
    if (!op) {
      return { ok: false as const, code: "invalid-args", message: `Unknown op: ${opId}` };
    }

    const node = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.id === symbolId);
    if (!node) {
      return { ok: false as const, code: "invalid-args", message: `Node ${symbolId} not found` };
    }

    if (!node.filePath) {
      return { ok: false as const, code: "invalid-args", message: `Node ${symbolId} has no file path` };
    }

    const opArgs = (args["args"] as Record<string, unknown>) ?? {};
    const preconditionBlockers: { code: string; message: string }[] = [];

    // Refinement-type signature validation (SMT-lite)
    const sigValidation = validateSingleOp(session.graph, opId, symbolId, opArgs);
    if (!sigValidation.preconditionCheck.satisfied) {
      for (const f of sigValidation.preconditionCheck.failures) {
        preconditionBlockers.push({ code: "signature", message: f.reason });
      }
    }
    if (!sigValidation.argValidation.valid) {
      for (const m of sigValidation.argValidation.missing) {
        preconditionBlockers.push({ code: "missing-arg", message: `Required argument "${m}" not provided` });
      }
      for (const t of sigValidation.argValidation.typeErrors) {
        preconditionBlockers.push({ code: "type-error", message: `Argument "${t.arg}" expected ${t.expected}, got ${t.got}` });
      }
    }

    // Legacy precondition check (runtime op-level)
    if (op.preconditions) {
      const allEdges = session.graph.repos.flatMap((r) => r.edges);
      const allNodes = session.graph.repos.flatMap((r) => r.nodes);
      const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
      const incoming = allEdges.filter((e) => e.target === node.id).map((e) => ({ relation: e.relation, sourceKind: nodeMap.get(e.source)?.kind ?? "" }));
      const outgoing = allEdges.filter((e) => e.source === node.id).map((e) => ({ relation: e.relation, targetKind: nodeMap.get(e.target)?.kind ?? "" }));
      const pcResults = op.preconditions({ nodeId: node.id, nodeKind: node.kind, nodeName: node.name, incomingEdges: incoming, outgoingEdges: outgoing });
      for (const r of pcResults) {
        if (!r.pass && r.reason) preconditionBlockers.push({ code: "precondition", message: r.reason });
      }
    }

    let fileContent: string;
    try {
      fileContent = readFileSync(node.filePath, "utf-8");
    } catch {
      return { ok: false as const, code: "io-error", message: `Cannot read file: ${node.filePath}` };
    }

    const preview = op.preview({
      filePath: node.filePath,
      fileContent,
      symbolName: node.name,
      args: opArgs,
    });

    const resultId = randomUUID();
    const markdown = [
      `# Op Preview: ${op.name}`,
      "",
      `**Target:** ${node.name} (\`${node.filePath}\`)`,
      "",
      "```diff",
      preview.diff,
      "```",
      "",
      preview.blockers.length > 0
        ? `**Blockers:**\n${preview.blockers.map((b) => `- ${b.code}: ${b.message}`).join("\n")}`
        : "No blockers.",
    ].join("\n");
    const markdownUri = `markdown://ops.preview/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: {
        diff: preview.diff,
        projectedGraphPatch: null,
        predictedRuleDelta: null,
        preconditionWarnings: preconditionBlockers,
        blockers: preview.blockers,
        markdownUri,
      },
    };
  },
};

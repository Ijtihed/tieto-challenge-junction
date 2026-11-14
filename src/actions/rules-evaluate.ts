// Per architecture/schema-v3.md §5.3 action 14
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import type { Violation } from "../domain/types.ts";
import type { MultiRepoGraph, GraphNode, GraphEdge } from "../domain/multi-repo.ts";

type Scope = "all" | { cluster: string } | { node: string };

function scopeGraph(graph: MultiRepoGraph, scope: Scope): MultiRepoGraph {
  if (scope === "all") return graph;

  if ("cluster" in scope) {
    const clusterNodeIds = new Set<string>();
    for (const repo of graph.repos) {
      for (const c of repo.clusters) {
        if (c.id === scope.cluster) {
          for (const id of c.nodeIds) clusterNodeIds.add(id);
        }
      }
    }
    return {
      ...graph,
      repos: graph.repos.map((r) => ({
        ...r,
        nodes: r.nodes.filter((n) => clusterNodeIds.has(n.id)),
        edges: r.edges.filter((e) => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target)),
      })),
    };
  }

  if ("node" in scope) {
    return {
      ...graph,
      repos: graph.repos.map((r) => ({
        ...r,
        nodes: r.nodes.filter((n) => n.id === scope.node),
        edges: r.edges.filter((e) => e.source === scope.node || e.target === scope.node),
      })),
    };
  }

  return graph;
}

function renderMarkdown(violations: Violation[]): string {
  const lines: string[] = ["# Rule Evaluation", ""];
  if (violations.length === 0) {
    lines.push("All rules pass. No violations found.");
  } else {
    const byRule = new Map<string, Violation[]>();
    for (const v of violations) {
      const list = byRule.get(v.ruleId);
      if (list) list.push(v);
      else byRule.set(v.ruleId, [v]);
    }
    for (const [ruleId, vs] of byRule) {
      const icon = vs[0]!.severity === "error" ? "❌" : vs[0]!.severity === "warn" ? "⚠️" : "ℹ️";
      lines.push(`## ${icon} ${ruleId} (${vs.length} violation${vs.length > 1 ? "s" : ""})`, "");
      for (const v of vs) {
        lines.push(`- ${v.message}`);
      }
      lines.push("");
    }
  }
  lines.push(`**Total:** ${violations.length} violation(s)`);
  return lines.join("\n");
}

export const rulesEvaluate = {
  name: "rules.evaluate" as const,
  description: "Evaluate all active rules against the current graph, returning any violations found. Supports scoping to a specific cluster or node.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      scope: { description: "Evaluation scope: 'all', or an object with cluster or node ID", oneOf: [{ type: "string", enum: ["all"] }, { type: "object", properties: { cluster: { type: "string" } }, required: ["cluster"] }, { type: "object", properties: { node: { type: "string" } }, required: ["node"] }] },
      llm: { type: "boolean", description: "Whether to include LLM-evaluated rules (default false)" },
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

    const scope = (args["scope"] as Scope | undefined) ?? "all";
    const llm = (args["llm"] as boolean | undefined) ?? false;

    const scoped = scopeGraph(session.graph, scope);
    const violations: Violation[] = [];

    for (const rule of BUILTIN_RULES) {
      if (rule.evaluation === "llm" && !llm) continue;
      violations.push(...rule.evaluate(scoped));
    }

    const incEval = session.incrementalEval;
    if (incEval.program) {
      const incResult = incEval.fullEval();
      for (const v of incResult.violations) {
        violations.push({
          ruleId: v.ruleId,
          severity: "warn",
          message: v.message ?? `Datalog rule "${v.ruleId}" violated by ${v.nodeId}`,
          nodeIds: [v.nodeId],
        });
      }
    }

    for (const rule of session.rules) {
      if (rule.evaluation === "llm" && !llm) continue;
      if (rule.kind === "structural") {
        const allNodes = scoped.repos.flatMap((r) => r.nodes);
        for (const node of allNodes) {
          if (rule.globs && rule.globs.length > 0) {
            const matchesGlob = rule.globs.some((g) => node.filePath?.includes(g) || node.name.includes(g));
            if (!matchesGlob) continue;
          }
          violations.push({
            ruleId: rule.id,
            severity: rule.severity,
            message: `Custom rule "${rule.body}" applies to ${node.name}`,
            nodeIds: [node.id],
          });
        }
      }
    }

    const resultId = randomUUID();
    const markdown = renderMarkdown(violations);
    const markdownUri = `markdown://rules.evaluate/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: { violations, llmEvaluated: llm ? [] : undefined, markdownUri },
    };
  },
};

// Per architecture/schema-v3.md §5.3 action 12
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import type { Insight } from "../domain/types.ts";

interface EdgeStats {
  readonly total: number;
  readonly byRelation: Readonly<Record<string, number>>;
}

interface ClusterStats {
  readonly id: string;
  readonly name: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

export const graphSummarize = {
  name: "graph.summarize" as const,
  description: "Generate an architecture-level narrative summary of the graph including edge breakdown, cluster stats, and code smell detection.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      scope: { description: "Scope of summarization: 'all' or an object with a cluster ID", oneOf: [{ type: "string", enum: ["all"] }, { type: "object", properties: { cluster: { type: "string" } }, required: ["cluster"] }] },
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

    const scope = args["scope"] as "all" | { cluster: string } | undefined ?? "all";

    let nodes = session.graph.repos.flatMap((r) => r.nodes);
    let edges = session.graph.repos.flatMap((r) => r.edges);

    if (typeof scope === "object" && "cluster" in scope) {
      const clusterNodeIds = new Set<string>();
      for (const repo of session.graph.repos) {
        for (const c of repo.clusters) {
          if (c.id === scope.cluster) {
            for (const id of c.nodeIds) clusterNodeIds.add(id);
          }
        }
      }
      nodes = nodes.filter((n) => clusterNodeIds.has(n.id));
      edges = edges.filter((e) => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target));
    }

    const byRelation: Record<string, number> = {};
    for (const e of edges) {
      byRelation[e.relation] = (byRelation[e.relation] ?? 0) + 1;
    }
    const edgeStats: EdgeStats = { total: edges.length, byRelation };

    const clusterStats: ClusterStats[] = [];
    for (const repo of session.graph.repos) {
      if (repo.clusters.length > 0) {
        for (const c of repo.clusters) {
          const cSet = new Set(c.nodeIds);
          const cEdges = repo.edges.filter((e) => cSet.has(e.source) && cSet.has(e.target));
          clusterStats.push({ id: c.id, name: c.name, nodeCount: c.nodeIds.length, edgeCount: cEdges.length });
        }
      } else {
        clusterStats.push({
          id: repo.uri,
          name: repo.uri.split("/").pop() ?? repo.uri,
          nodeCount: repo.nodes.length,
          edgeCount: repo.edges.length,
        });
      }
    }

    const topSmells: Insight[] = detectSmells(nodes, edges);

    const summary = buildSummaryText(nodes.length, edges.length, clusterStats, edgeStats, topSmells);

    const resultId = randomUUID();
    const markdownUri = `markdown://graph.summarize/${resultId}`;
    session.markdownResources.set(markdownUri, summary);

    return {
      ok: true as const,
      data: { summary, edgeStats, clusterStats, topSmells, markdownUri },
    };
  },
};

function detectSmells(
  nodes: readonly import("../domain/multi-repo.ts").GraphNode[],
  edges: readonly import("../domain/multi-repo.ts").GraphEdge[],
): Insight[] {
  const insights: Insight[] = [];

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
  }

  const highFanIn = nodes.filter((n) => (inDegree.get(n.id) ?? 0) > Math.max(5, nodes.length * 0.3));
  for (const n of highFanIn) {
    insights.push({
      id: `smell-high-fan-in-${n.id}`,
      kind: "high-fan-in",
      message: `${n.name} has ${inDegree.get(n.id)} incoming edges (potential god module)`,
      severity: "warn",
      nodeIds: [n.id],
    });
  }

  const isolatedNodes = nodes.filter((n) =>
    (inDegree.get(n.id) ?? 0) === 0 && (outDegree.get(n.id) ?? 0) === 0
  );
  if (isolatedNodes.length > 0 && isolatedNodes.length < nodes.length) {
    insights.push({
      id: "smell-orphan-nodes",
      kind: "orphan-nodes",
      message: `${isolatedNodes.length} node(s) with no edges — possibly dead code or missing edges`,
      severity: "info",
      nodeIds: isolatedNodes.map((n) => n.id),
    });
  }

  return insights;
}

function buildSummaryText(
  nodeCount: number,
  edgeCount: number,
  clusters: ClusterStats[],
  edgeStats: EdgeStats,
  smells: Insight[],
): string {
  const lines: string[] = [
    "# Architecture Summary",
    "",
    `**${nodeCount}** nodes · **${edgeCount}** edges`,
    "",
  ];

  if (clusters.length > 0) {
    lines.push("## Clusters", "");
    for (const c of clusters) {
      lines.push(`- **${c.name}**: ${c.nodeCount} nodes, ${c.edgeCount} internal edges`);
    }
    lines.push("");
  }

  if (Object.keys(edgeStats.byRelation).length > 0) {
    lines.push("## Edge breakdown", "");
    for (const [rel, count] of Object.entries(edgeStats.byRelation)) {
      lines.push(`- ${rel}: ${count}`);
    }
    lines.push("");
  }

  if (smells.length > 0) {
    lines.push("## Potential smells", "");
    for (const s of smells) {
      lines.push(`- **${s.kind}** (${s.severity}): ${s.message}`);
    }
  }

  return lines.join("\n");
}

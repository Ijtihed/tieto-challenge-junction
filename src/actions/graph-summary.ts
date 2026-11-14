// Per architecture/schema-v3.md §5.3 action 4
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import type { GraphNode } from "../domain/multi-repo.ts";
import type { NodeKind } from "../domain/vocabulary.ts";

type Level = "architecture" | "modules" | "detail";

interface ClusterSummary {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kindMix: Readonly<Record<string, number>>;
  readonly externalEdges: number;
}

function collectAllNodes(session: import("../session/session.ts").Session): GraphNode[] {
  return session.graph.repos.flatMap((r) => r.nodes);
}

function buildClusterSummaries(session: import("../session/session.ts").Session, _level: Level): ClusterSummary[] {
  const graph = session.graph;
  const summaries: ClusterSummary[] = [];

  for (const repo of graph.repos) {
    if (repo.clusters.length > 0) {
      const nodeIndex = new Map(repo.nodes.map((n) => [n.id, n]));
      const clusterNodeSets = new Map(repo.clusters.map((c) => [c.id, new Set(c.nodeIds)]));

      for (const cluster of repo.clusters) {
        const clusterNodes = cluster.nodeIds
          .map((id) => nodeIndex.get(id))
          .filter((n): n is GraphNode => n !== undefined);

        const kindMix: Record<string, number> = {};
        for (const n of clusterNodes) {
          kindMix[n.kind] = (kindMix[n.kind] ?? 0) + 1;
        }

        const clusterSet = clusterNodeSets.get(cluster.id)!;
        let externalEdges = 0;
        for (const edge of repo.edges) {
          const srcIn = clusterSet.has(edge.source);
          const tgtIn = clusterSet.has(edge.target);
          if (srcIn !== tgtIn) externalEdges++;
        }

        summaries.push({
          id: cluster.id,
          name: cluster.name,
          size: clusterNodes.length,
          kindMix,
          externalEdges,
        });
      }
    } else {
      const kindMix: Record<string, number> = {};
      for (const n of repo.nodes) {
        kindMix[n.kind] = (kindMix[n.kind] ?? 0) + 1;
      }
      summaries.push({
        id: repo.uri,
        name: repo.uri.split("/").pop() ?? repo.uri,
        size: repo.nodes.length,
        kindMix,
        externalEdges: 0,
      });
    }
  }

  return summaries;
}

function renderMarkdown(clusters: ClusterSummary[], totalNodes: number, totalEdges: number): string {
  const lines: string[] = ["# Graph Summary", ""];
  lines.push(`**${totalNodes}** nodes · **${totalEdges}** edges · **${clusters.length}** cluster(s)`, "");
  lines.push("| Cluster | Nodes | Kind mix | External edges |");
  lines.push("|---------|------:|----------|---------------:|");
  for (const c of clusters) {
    const mix = Object.entries(c.kindMix).map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push(`| ${c.name} | ${c.size} | ${mix} | ${c.externalEdges} |`);
  }
  return lines.join("\n");
}

export const graphSummary = {
  name: "graph.summary" as const,
  description: "Return a high-level summary of the code graph including cluster counts, node/edge totals, and kind distribution.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      level: { type: "string", enum: ["architecture", "modules", "detail"], description: "Summary granularity level" },
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

    const level = (args["level"] as Level | undefined) ?? "architecture";
    const allNodes = collectAllNodes(session);
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const totalNodes = allNodes.length;
    const totalEdges = allEdges.length;

    const clusters = buildClusterSummaries(session, level);

    const resultId = randomUUID();
    const markdown = renderMarkdown(clusters, totalNodes, totalEdges);
    const markdownUri = `markdown://graph.summary/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: { clusters, totalNodes, totalEdges, markdownUri },
    };
  },
};

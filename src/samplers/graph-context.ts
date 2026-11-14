import type { MultiRepoGraph } from "../domain/multi-repo.ts";

const MAX_TOKENS_BUDGET = 4000;
const AVG_CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS_BUDGET * AVG_CHARS_PER_TOKEN;

/**
 * Serialize a MultiRepoGraph into a bounded text representation suitable
 * for inclusion in an LLM system prompt. Prioritizes high-connectivity
 * nodes and cluster structure. Stays within ~4k tokens.
 */
export function serializeGraphContext(graph: MultiRepoGraph): string {
  const allNodes = graph.repos.flatMap((r) => r.nodes);
  const allEdges = graph.repos.flatMap((r) => r.edges);
  const allClusters = graph.repos.flatMap((r) => r.clusters);

  if (allNodes.length === 0) return "";

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const e of allEdges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
  }

  const sortedNodes = [...allNodes].sort((a, b) => {
    const aConn = (inDegree.get(a.id) ?? 0) + (outDegree.get(a.id) ?? 0);
    const bConn = (inDegree.get(b.id) ?? 0) + (outDegree.get(b.id) ?? 0);
    return bConn - aConn;
  });

  const lines: string[] = [];
  lines.push("## Codebase Graph Context");
  lines.push(`${allNodes.length} nodes, ${allEdges.length} edges, ${allClusters.length} clusters`);
  lines.push("");

  if (allClusters.length > 0) {
    lines.push("### Clusters");
    for (const c of allClusters) {
      lines.push(`- ${c.name} (${c.nodeIds.length} nodes)`);
    }
    lines.push("");
  }

  lines.push("### Key Nodes (by connectivity)");
  let charCount = lines.join("\n").length;
  const includedNodeIds = new Set<string>();

  for (const node of sortedNodes) {
    const conn = (inDegree.get(node.id) ?? 0) + (outDegree.get(node.id) ?? 0);
    const file = node.filePath ? ` in ${node.filePath}` : "";
    const line = `- ${node.name} [${node.kind}]${file} (${conn} connections)`;
    if (charCount + line.length + 1 > MAX_CHARS * 0.7) break;
    lines.push(line);
    charCount += line.length + 1;
    includedNodeIds.add(node.id);
  }

  lines.push("");
  lines.push("### Key Edges");
  const nodeNameById = new Map(allNodes.map((n) => [n.id, n.name]));

  for (const edge of allEdges) {
    if (!includedNodeIds.has(edge.source) && !includedNodeIds.has(edge.target)) continue;
    const src = nodeNameById.get(edge.source) ?? edge.source;
    const tgt = nodeNameById.get(edge.target) ?? edge.target;
    const line = `- ${src} --[${edge.relation}]--> ${tgt}`;
    if (charCount + line.length + 1 > MAX_CHARS) break;
    lines.push(line);
    charCount += line.length + 1;
  }

  return lines.join("\n");
}

// Per architecture/schema-v3.md §4.5
import { createHash } from "node:crypto";
import type { MultiRepoGraph } from "./multi-repo.ts";

export function graphHash(graph: MultiRepoGraph): string {
  const nodeIds = graph.repos.flatMap((r) => r.nodes.map((n) => n.id)).sort();
  const edgeIds = graph.repos.flatMap((r) => r.edges.map((e) => e.id)).sort();
  const interIds = graph.interRepoEdges.map((e) => e.id).sort();
  const content = [...nodeIds, "|", ...edgeIds, "|", ...interIds].join(",");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

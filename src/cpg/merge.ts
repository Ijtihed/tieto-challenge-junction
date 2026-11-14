// Merge CPG-derived data into Schema's MultiRepoGraph.
// CPG provides richer analysis (DFG, CFG, CDG, PDG) that supplements
// Schema's own extractors (imports, calls, registers_route, bridges).
import type { GraphNode, GraphEdge, RepoSubgraph } from "../domain/multi-repo.ts";
import { idFromLocator } from "../domain/locator.ts";
import { NODE_KINDS } from "../domain/vocabulary.ts";
import { logger } from "../obs/index.ts";

export interface CpgGraphData {
  nodes: CpgNode[];
  edges: CpgEdge[];
}

export interface CpgNode {
  id: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  type: string;
  fullName?: string;
}

export interface CpgEdge {
  source: string;
  target: string;
  type: "DFG" | "CFG" | "CDG" | "PDG" | "AST" | "EOG";
}

const CPG_EDGE_TO_SCHEMA: Record<string, string> = {
  DFG: "data_flow",
  CFG: "control_flow",
  CDG: "control_dependence",
  PDG: "program_dependence",
};

export function mergeCpgData(
  repo: RepoSubgraph,
  cpgData: CpgGraphData,
): RepoSubgraph {
  const existingNodeIds = new Set(repo.nodes.map((n) => n.id));
  const existingEdgeIds = new Set(repo.edges.map((e) => e.id));

  const cpgIdToSchemaId = new Map<string, string>();
  for (const cpgNode of cpgData.nodes) {
    const locator = { scheme: "file" as const, raw: `file://${cpgNode.file}#L${cpgNode.startLine}-L${cpgNode.endLine}` };
    const schemaId = idFromLocator(locator);
    cpgIdToSchemaId.set(cpgNode.id, schemaId);
  }

  const newNodes: GraphNode[] = [];
  for (const cpgNode of cpgData.nodes) {
    const schemaId = cpgIdToSchemaId.get(cpgNode.id);
    if (!schemaId || existingNodeIds.has(schemaId)) continue;

    const locator = `file://${cpgNode.file}#L${cpgNode.startLine}-L${cpgNode.endLine}`;
    newNodes.push({
      id: schemaId,
      kind: NODE_KINDS.utility,
      name: cpgNode.name,
      locator,
      filePath: cpgNode.file,
      startLine: cpgNode.startLine,
      endLine: cpgNode.endLine,
      meta: { cpgType: cpgNode.type, cpgFullName: cpgNode.fullName },
    });
  }

  const newEdges: GraphEdge[] = [];
  for (const cpgEdge of cpgData.edges) {
    const relation = CPG_EDGE_TO_SCHEMA[cpgEdge.type];
    if (!relation) continue;

    const source = cpgIdToSchemaId.get(cpgEdge.source);
    const target = cpgIdToSchemaId.get(cpgEdge.target);
    if (!source || !target) continue;
    if (!existingNodeIds.has(source) && !newNodes.some((n) => n.id === source)) continue;
    if (!existingNodeIds.has(target) && !newNodes.some((n) => n.id === target)) continue;

    const edgeId = `cpg:${source}:${target}:${relation}`;
    if (existingEdgeIds.has(edgeId)) continue;

    newEdges.push({
      id: edgeId,
      source,
      target,
      relation,
      meta: { cpgEdgeType: cpgEdge.type },
    });
  }

  if (newNodes.length > 0 || newEdges.length > 0) {
    logger.info("cpg-merge", `merged ${newNodes.length} nodes + ${newEdges.length} edges from CPG`);
  }

  return {
    ...repo,
    nodes: [...repo.nodes, ...newNodes],
    edges: [...repo.edges, ...newEdges],
  };
}

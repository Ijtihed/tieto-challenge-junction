// Per architecture/specs/datalog-lite.md §2 — EDB population from MultiRepoGraph.

import type { MultiRepoGraph } from "../multi-repo.ts";
import { NODE_KINDS } from "../vocabulary.ts";

export type FactDb = Map<string, Set<string>>;

function key(tuple: string[]): string {
  return JSON.stringify(tuple);
}

function addFact(db: FactDb, predicate: string, tuple: string[]): void {
  let set = db.get(predicate);
  if (!set) { set = new Set(); db.set(predicate, set); }
  set.add(key(tuple));
}

export function populateEdb(graph: MultiRepoGraph): FactDb {
  const db: FactDb = new Map();

  for (const repo of graph.repos) {
    for (const node of repo.nodes) {
      addFact(db, "node", [node.id, node.kind, node.name]);

      if (node.filePath) {
        addFact(db, "node_file", [node.id, node.filePath]);
      }
      if (node.filePath && node.startLine !== undefined && node.endLine !== undefined) {
        addFact(db, "node_loc", [node.id, node.filePath, String(node.startLine), String(node.endLine)]);
      }

      if (node.kind === NODE_KINDS.contract) {
        const scheme = node.locator.split("://")[0] ?? "";
        addFact(db, NODE_KINDS.contract, [node.id, scheme, node.locator]);
      }

      addFact(db, "repo", [repo.uri, node.id]);

      const source = (node.meta as Record<string, unknown> | undefined)?.source;
      if (typeof source === "string") {
        addFact(db, "source", [node.id, source]);
      }
    }

    for (const edge of repo.edges) {
      addFact(db, "edge", [edge.source, edge.relation, edge.target, edge.id]);

      if (edge.relation === "reads_field" || edge.relation === "writes_field" ||
          edge.relation === "reads_table" || edge.relation === "writes_table" ||
          edge.relation === "reads_env" || edge.relation === "writes_env") {
        addFact(db, edge.relation, [edge.source, edge.target]);
      }
    }

    for (const cluster of repo.clusters) {
      for (const nodeId of cluster.nodeIds) {
        addFact(db, "cluster", [cluster.id, nodeId]);
      }
    }
  }

  return db;
}

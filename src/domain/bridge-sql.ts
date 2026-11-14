// Per architecture/schema-v3.md §4.3 + research/03 §3 — SQL DDL bridge.
// Joins sql:table contract nodes (from extractor-generic-config)
// to ORM model references in Python, Ruby, TS, Java.
// Emits consumes_contract edges from ORM model → sql:table contract.

import { readFileSync } from "node:fs";
import type { GraphNode, GraphEdge, RepoSubgraph } from "./multi-repo.ts";
import { EDGE_RELATIONS, NODE_KINDS } from "./vocabulary.ts";
import { createHash } from "node:crypto";

export interface OrmModelInfo {
  readonly tableName: string;
  readonly nodeId: string;
  readonly repoUri: string;
}

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

const TABLE_NAME_PATTERNS = [
  // Python Django: class Meta: db_table = "xxx"
  /db_table\s*=\s*["'](\w+)["']/g,
  // Python SQLAlchemy: __tablename__ = "xxx"
  /__tablename__\s*=\s*["'](\w+)["']/g,
  // Ruby ActiveRecord: self.table_name = "xxx"
  /self\.table_name\s*=\s*["'](\w+)["']/g,
  // Java JPA: @Table(name = "xxx")
  /@Table\s*\(\s*name\s*=\s*["'](\w+)["']/g,
  // TS Prisma: model Xxx { @@map("xxx") }
  /@@map\s*\(\s*["'](\w+)["']\s*\)/g,
  // TS Drizzle/Knex: .table("xxx") or createTable("xxx")
  /\.table\s*\(\s*["'](\w+)["']/g,
  /createTable\s*\(\s*["'](\w+)["']/g,
];

function inferTableFromModelName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/model$/i, "")
    .replace(/_$/, "") + "s";
}

export function detectOrmModels(repos: readonly RepoSubgraph[]): OrmModelInfo[] {
  const models: OrmModelInfo[] = [];
  const modelExts = [".py", ".rb", ".ts", ".java", ".kt"];

  for (const repo of repos) {
    for (const node of repo.nodes) {
      if (!node.filePath || node.kind !== NODE_KINDS.model) continue;
      if (!modelExts.some((ext) => node.filePath!.endsWith(ext))) continue;

      let tableName: string | null = null;

      try {
        const content = readFileSync(node.filePath, "utf-8");
        for (const pattern of TABLE_NAME_PATTERNS) {
          const re = new RegExp(pattern.source, pattern.flags);
          const match = re.exec(content);
          if (match?.[1]) { tableName = match[1]; break; }
        }
      } catch { /* unreadable */ }

      if (!tableName) {
        tableName = inferTableFromModelName(node.name);
      }

      models.push({ tableName, nodeId: node.id, repoUri: repo.uri });
    }
  }

  return models;
}

export function buildSqlBridgeEdges(
  tableNodes: readonly GraphNode[],
  ormModels: OrmModelInfo[],
): { bridgeEdges: GraphEdge[] } {
  const bridgeEdges: GraphEdge[] = [];

  for (const model of ormModels) {
    const matchingTable = tableNodes.find((t) => {
      const tName = t.name.replace("sql:table:", "");
      return tName.toLowerCase() === model.tableName.toLowerCase();
    });

    if (matchingTable) {
      bridgeEdges.push({
        id: edgeId(model.nodeId, matchingTable.id, EDGE_RELATIONS.consumes_contract),
        source: model.nodeId,
        target: matchingTable.id,
        relation: EDGE_RELATIONS.consumes_contract,
      });
    }
  }

  return { bridgeEdges };
}

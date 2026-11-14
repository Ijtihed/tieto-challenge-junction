// Phase 7 — Go extractor with net/http handler recognition.
import type { ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { RepoSubgraph, GraphNode, GraphEdge } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { logger } from "../../obs/index.ts";
import { parseGoFile, type GoParseResult } from "./parser.ts";
import { readForParse, recordFailure, recordParsed } from "../parser-config.ts";
import { createHash } from "node:crypto";

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

export const extractorGo = {
  id: "extractor-go",

  declare() {
    return {
      languages: ["go"] as readonly string[],
      frameworks: ["net/http", "gin", "echo", "chi", "fiber"] as readonly string[],
      introducesNodeKinds: [NODE_KINDS.utility, NODE_KINDS.route_handler, NODE_KINDS.model],
      introducesEdgeRelations: [EDGE_RELATIONS.imports, EDGE_RELATIONS.calls, EDGE_RELATIONS.reads_field, EDGE_RELATIONS.writes_field, EDGE_RELATIONS.reads_env, EDGE_RELATIONS.writes_env],
      needsAdapters: ["fs"] as readonly ("fs")[],
    };
  },

  async *extract(ctx: ExtractContext): AsyncGenerator<ExtractEvent> {
    const { repoUri, fs } = ctx;
    const rootPath = repoUri.startsWith("file://") ? repoUri.slice(7) : repoUri;

    yield { kind: "progress", message: "discovering Go files" };

    let files: string[];
    try {
      files = await fs.listDir(rootPath, { recursive: true });
    } catch (err) {
      yield { kind: "error", message: `listDir failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    const goFiles = files.filter((f) =>
      f.endsWith(".go") && !f.includes("vendor/") && !f.endsWith("_test.go")
    );

    if (goFiles.length === 0) {
      yield { kind: "done", data: { uri: repoUri, nodes: [], edges: [], clusters: [] } };
      return;
    }

    yield { kind: "progress", message: `parsing ${goFiles.length} Go files` };

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const allRoutes: GoParseResult["routes"] = [];

    for (const filePath of goFiles) {
      if (ctx.changedFiles && !ctx.changedFiles.has(filePath)) continue;
      const outcome = await readForParse(fs, filePath, "extractor-go", ctx.stats);
      if (!outcome.ok) continue;
      const content = outcome.content;
      try {
        const result = parseGoFile(filePath, content, repoUri);
        if (ctx.stats) recordParsed(ctx.stats);

        for (const node of result.nodes) nodes.push(node);
        allRoutes.push(...result.routes);

        const nodeByName = new Map(result.nodes.map((n) => [n.name, n]));
        for (const call of result.calls) {
          const calleeNode = nodeByName.get(call.calleeName);
          if (calleeNode) {
            edges.push({
              id: edgeId(call.callerNodeId, calleeNode.id, EDGE_RELATIONS.calls),
              source: call.callerNodeId, target: calleeNode.id, relation: EDGE_RELATIONS.calls,
            });
          }
        }

        for (const field of result.fieldAccesses) {
          const rel = field.kind === "write" ? EDGE_RELATIONS.writes_field : EDGE_RELATIONS.reads_field;
          const targetId = `field:${field.fieldName}`;
          edges.push({
            id: edgeId(field.enclosingNodeId, targetId, rel),
            source: field.enclosingNodeId, target: targetId, relation: rel,
          });
        }

        for (const env of result.envAccesses) {
          const envNodeLoc = { scheme: "env", raw: `env://${env.envVar}` };
          const envNodeId = idFromLocator(envNodeLoc);
          if (!nodes.some((n) => n.id === envNodeId)) {
            nodes.push({ id: envNodeId, kind: NODE_KINDS.external, name: env.envVar, locator: envNodeLoc.raw });
          }
          const rel = env.kind === "write" ? EDGE_RELATIONS.writes_env : EDGE_RELATIONS.reads_env;
          edges.push({
            id: edgeId(env.enclosingNodeId, envNodeId, rel),
            source: env.enclosingNodeId, target: envNodeId, relation: rel,
          });
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("extractor-go", `parse failed for ${filePath}`, { error: detail });
        if (ctx.stats) {
          recordFailure(ctx.stats, { filePath, reason: "parse-failed", extractorId: "extractor-go", detail });
        }
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const nodeEdges = edges.filter((e) => e.source === node.id);
      const reads: string[] = [];
      const writes: string[] = [];
      const callsList: string[] = [];
      for (const e of nodeEdges) {
        if (e.relation === EDGE_RELATIONS.reads_field || e.relation === EDGE_RELATIONS.reads_env || e.relation === EDGE_RELATIONS.reads_table) reads.push(e.target);
        else if (e.relation === EDGE_RELATIONS.writes_field || e.relation === EDGE_RELATIONS.writes_env || e.relation === EDGE_RELATIONS.writes_table) writes.push(e.target);
        else if (e.relation === EDGE_RELATIONS.calls) callsList.push(e.target);
      }
      if (reads.length > 0 || writes.length > 0 || callsList.length > 0) {
        nodes[i] = { ...node, meta: { ...node.meta, effects: { reads, writes, calls: callsList } } };
      }
    }

    yield {
      kind: "done",
      data: { uri: repoUri, nodes, edges, clusters: [], meta: { routes: allRoutes } } as RepoSubgraph & { meta?: unknown },
    };
  },
};

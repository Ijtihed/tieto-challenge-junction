// Per architecture/schema-v3.md §3.6 + §14.2
// Emits: file + function nodes, imports edges, calls edges,
// Express/Fastify/Koa route_handler recognition + registers_route edges.

import type { ExtractorCapability, ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { RepoSubgraph, GraphNode, GraphEdge } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { logger } from "../../obs/index.ts";
import { parseFile } from "./parser.ts";
import { readForParse, recordFailure, recordParsed } from "../parser-config.ts";
import { createHash } from "node:crypto";

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

export type { ExtractorCapability, ExtractContext, ExtractEvent };

export const extractorTypescript = {
  id: "extractor-typescript",

  declare(): ExtractorCapability {
    return {
      languages: ["typescript", "javascript"],
      frameworks: ["express", "fastify", "koa"],
      introducesNodeKinds: [NODE_KINDS.utility, NODE_KINDS.route_handler, NODE_KINDS.service],
      introducesEdgeRelations: [EDGE_RELATIONS.imports, EDGE_RELATIONS.calls, EDGE_RELATIONS.registers_route],
      needsAdapters: ["fs"],
    };
  },

  async *extract(ctx: ExtractContext): AsyncGenerator<ExtractEvent> {
    const { repoUri, fs } = ctx;
    const rootPath = repoUri.startsWith("file://") ? repoUri.slice(7) : repoUri;

    yield { kind: "progress", message: "discovering files" };

    let files: string[];
    try {
      files = await fs.listDir(rootPath, { recursive: true });
    } catch (err) {
      yield { kind: "error", message: `listDir failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    const tsFiles = files.filter((f) => /\.(ts|js|tsx|jsx)$/.test(f) && !f.includes("node_modules") && !f.endsWith(".d.ts"));

    if (tsFiles.length === 0) {
      logger.info("extractor-typescript", "no TS/JS files found", { repoUri });
      yield { kind: "done", data: { uri: repoUri, nodes: [], edges: [], clusters: [] } };
      return;
    }

    yield { kind: "progress", message: `parsing ${tsFiles.length} files` };

    const allNodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const allRoutes: { method: string; path: string; handlerName: string; filePath: string }[] = [];

    for (const filePath of tsFiles) {
      if (ctx.changedFiles && !ctx.changedFiles.has(filePath)) continue;
      const outcome = await readForParse(fs, filePath, "extractor-typescript", ctx.stats);
      if (!outcome.ok) continue;
      const content = outcome.content;
      try {
        const result = parseFile(filePath, content, repoUri);
        if (ctx.stats) recordParsed(ctx.stats);

        for (const node of result.nodes) allNodes.push(node);

        const fileNode = result.nodes.find((n) => n.locator === `file://${filePath}`);
        if (!fileNode) continue;

        for (const imp of result.imports) {
          if (!imp.resolvedPath) continue;
          const targetLoc = { scheme: "file", raw: `file://${imp.resolvedPath}` };
          const targetId = idFromLocator(targetLoc);
          edges.push({
            id: edgeId(fileNode.id, targetId, EDGE_RELATIONS.imports),
            source: fileNode.id, target: targetId, relation: EDGE_RELATIONS.imports,
          });
        }

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

        for (const route of result.routes) {
          const handlerNode = nodeByName.get(route.handlerName);
          if (handlerNode && route.registrarNodeId) {
            edges.push({
              id: edgeId(route.registrarNodeId, handlerNode.id, EDGE_RELATIONS.registers_route),
              source: route.registrarNodeId, target: handlerNode.id, relation: EDGE_RELATIONS.registers_route,
            });
          }
          allRoutes.push({ method: route.method, path: route.path, handlerName: route.handlerName, filePath: route.filePath });
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
          if (!allNodes.some((n) => n.id === envNodeId)) {
            allNodes.push({ id: envNodeId, kind: NODE_KINDS.external, name: env.envVar, locator: envNodeLoc.raw });
          }
          const rel = env.kind === "write" ? EDGE_RELATIONS.writes_env : EDGE_RELATIONS.reads_env;
          edges.push({
            id: edgeId(env.enclosingNodeId, envNodeId, rel),
            source: env.enclosingNodeId, target: envNodeId, relation: rel,
          });
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("extractor-typescript", `parse failed for ${filePath}`, { error: detail });
        if (ctx.stats) {
          recordFailure(ctx.stats, { filePath, reason: "parse-failed", extractorId: "extractor-typescript", detail });
        }
      }
    }

    const globalNodeByName = new Map(allNodes.map((n) => [n.name, n]));

    for (const route of allRoutes) {
      const handlerNode = globalNodeByName.get(route.handlerName);
      if (handlerNode && handlerNode.kind !== NODE_KINDS.route_handler) {
        const idx = allNodes.indexOf(handlerNode);
        if (idx !== -1) {
          allNodes[idx] = { ...handlerNode, kind: NODE_KINDS.route_handler };
          globalNodeByName.set(route.handlerName, allNodes[idx]!);
        }
      }
    }

    for (const route of allRoutes) {
      const handlerNode = globalNodeByName.get(route.handlerName);
      if (handlerNode) {
        const existsAlready = edges.some((e) => e.target === handlerNode.id && e.relation === EDGE_RELATIONS.registers_route);
        if (!existsAlready) {
          const registrar = route.filePath ? allNodes.find((n) => n.locator === `file://${route.filePath}`) : null;
          if (registrar) {
            edges.push({
              id: edgeId(registrar.id, handlerNode.id, EDGE_RELATIONS.registers_route),
              source: registrar.id, target: handlerNode.id, relation: EDGE_RELATIONS.registers_route,
            });
          }
        }
      }
    }

    // §17.4: compute heuristic effect annotations per node
    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i]!;
      const nodeEdges = edges.filter((e) => e.source === node.id);
      const reads: string[] = [];
      const writes: string[] = [];
      const calls: string[] = [];

      for (const e of nodeEdges) {
        if (e.relation === EDGE_RELATIONS.reads_field || e.relation === EDGE_RELATIONS.reads_env || e.relation === EDGE_RELATIONS.reads_table) {
          reads.push(e.target);
        } else if (e.relation === EDGE_RELATIONS.writes_field || e.relation === EDGE_RELATIONS.writes_env || e.relation === EDGE_RELATIONS.writes_table) {
          writes.push(e.target);
        } else if (e.relation === EDGE_RELATIONS.calls) {
          calls.push(e.target);
        }
      }

      if (reads.length > 0 || writes.length > 0 || calls.length > 0) {
        allNodes[i] = { ...node, meta: { ...node.meta, effects: { reads, writes, calls } } };
      }
    }

    yield {
      kind: "done",
      data: { uri: repoUri, nodes: allNodes, edges, clusters: [], meta: { routes: allRoutes } } as RepoSubgraph & { meta?: unknown },
    };
  },
};

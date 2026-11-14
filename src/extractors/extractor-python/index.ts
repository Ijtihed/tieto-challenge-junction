// Phase 7 — Python extractor with FastAPI/Flask/Django recognition.
import type { ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { RepoSubgraph, GraphNode, GraphEdge } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { logger } from "../../obs/index.ts";
import { parsePythonFile, type PyParseResult } from "./parser.ts";
import { readForParse, recordFailure, recordParsed } from "../parser-config.ts";
import { createHash } from "node:crypto";

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

export const extractorPython = {
  id: "extractor-python",

  declare() {
    return {
      languages: ["python"] as readonly string[],
      frameworks: ["fastapi", "flask", "django"] as readonly string[],
      introducesNodeKinds: [NODE_KINDS.utility, NODE_KINDS.route_handler, NODE_KINDS.model],
      introducesEdgeRelations: [EDGE_RELATIONS.imports, EDGE_RELATIONS.calls, EDGE_RELATIONS.reads_field, EDGE_RELATIONS.writes_field, EDGE_RELATIONS.reads_env, EDGE_RELATIONS.writes_env],
      needsAdapters: ["fs"] as readonly ("fs")[],
    };
  },

  async *extract(ctx: ExtractContext): AsyncGenerator<ExtractEvent> {
    const { repoUri, fs } = ctx;
    const rootPath = repoUri.startsWith("file://") ? repoUri.slice(7) : repoUri;

    yield { kind: "progress", message: "discovering Python files" };

    let files: string[];
    try {
      files = await fs.listDir(rootPath, { recursive: true });
    } catch (err) {
      yield { kind: "error", message: `listDir failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    const pyFiles = files.filter((f) =>
      f.endsWith(".py") && !f.includes("node_modules") && !f.includes("__pycache__") && !f.includes(".venv")
    );

    if (pyFiles.length === 0) {
      yield { kind: "done", data: { uri: repoUri, nodes: [], edges: [], clusters: [] } };
      return;
    }

    yield { kind: "progress", message: `parsing ${pyFiles.length} Python files` };

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const allRoutes: PyParseResult["routes"] = [];

    for (const filePath of pyFiles) {
      if (ctx.changedFiles && !ctx.changedFiles.has(filePath)) continue;
      const outcome = await readForParse(fs, filePath, "extractor-python", ctx.stats);
      if (!outcome.ok) continue;
      const content = outcome.content;
      try {
        const result = parsePythonFile(filePath, content, repoUri);
        if (ctx.stats) recordParsed(ctx.stats);

        for (const node of result.nodes) nodes.push(node);
        allRoutes.push(...result.routes);

        const fileNode = result.nodes.find((n) => n.locator === `file://${filePath}`);
        if (!fileNode) continue;

        for (const imp of result.imports) {
          if (imp.module.startsWith(".") || !imp.module.includes(".")) {
            const targetLoc = { scheme: "file", raw: `file://${rootPath}/${imp.module.replace(/\./g, "/")}.py` };
            const targetId = idFromLocator(targetLoc);
            edges.push({
              id: edgeId(fileNode.id, targetId, EDGE_RELATIONS.imports),
              source: fileNode.id, target: targetId, relation: EDGE_RELATIONS.imports,
            });
          }
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
        logger.warn("extractor-python", `parse failed for ${filePath}`, { error: detail });
        if (ctx.stats) {
          recordFailure(ctx.stats, { filePath, reason: "parse-failed", extractorId: "extractor-python", detail });
        }
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const nodeEdges = edges.filter((e) => e.source === node.id);
      const reads: string[] = [];
      const writes: string[] = [];
      const calls: string[] = [];
      for (const e of nodeEdges) {
        if (e.relation === EDGE_RELATIONS.reads_field || e.relation === EDGE_RELATIONS.reads_env || e.relation === EDGE_RELATIONS.reads_table) reads.push(e.target);
        else if (e.relation === EDGE_RELATIONS.writes_field || e.relation === EDGE_RELATIONS.writes_env || e.relation === EDGE_RELATIONS.writes_table) writes.push(e.target);
        else if (e.relation === EDGE_RELATIONS.calls) calls.push(e.target);
      }
      if (reads.length > 0 || writes.length > 0 || calls.length > 0) {
        nodes[i] = { ...node, meta: { ...node.meta, effects: { reads, writes, calls } } };
      }
    }

    yield {
      kind: "done",
      data: { uri: repoUri, nodes, edges, clusters: [], meta: { routes: allRoutes } } as RepoSubgraph & { meta?: unknown },
    };
  },
};

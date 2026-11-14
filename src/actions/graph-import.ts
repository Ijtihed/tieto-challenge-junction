// Per architecture/specs/graph-import.md — import external analyzer results.
import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { getSession } from "../session/index.ts";
import { importScip } from "../domain/import/scip.ts";
import type { GraphNode, GraphEdge, RepoSubgraph } from "../domain/multi-repo.ts";
import { populateEdb } from "../domain/datalog/edb.ts";
import { logger } from "../obs/index.ts";

export const graphImport = {
  name: "graph.import" as const,
  description: "Import an external analyzer index (SCIP) into the current graph.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      format: { type: "string", enum: ["scip"], description: "Import format (currently only 'scip')" },
      filePath: { type: "string", description: "Absolute path to the index file (.scip)" },
    },
    required: ["sessionId", "format", "filePath"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args.sessionId as string;
    if (!sessionId) return { ok: false as const, code: "MISSING_ARG", message: "sessionId required" };

    const format = args.format as string;
    if (format !== "scip") return { ok: false as const, code: "UNSUPPORTED_FORMAT", message: `Unsupported format: ${format}. Only 'scip' is supported.` };

    const filePath = args.filePath as string;
    if (!filePath) return { ok: false as const, code: "MISSING_ARG", message: "filePath required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "SESSION_NOT_FOUND", message: `No session: ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "SESSION_CLOSED", message: "Session is closed" };

    const rootUri = session.workspaceUris[0];
    const rootPath = rootUri?.startsWith("file://") ? rootUri.slice(7) : rootUri ?? "";

    const absPath = isAbsolute(filePath) ? filePath : resolve(rootPath, filePath);

    if (!absPath.startsWith(rootPath) && rootPath) {
      return { ok: false as const, code: "PATH_OUTSIDE_WORKSPACE", message: "File path must be inside the workspace" };
    }

    let buffer: Uint8Array;
    try {
      buffer = readFileSync(absPath);
    } catch (err) {
      return { ok: false as const, code: "FILE_NOT_FOUND", message: `Cannot read ${absPath}: ${err instanceof Error ? err.message : String(err)}` };
    }

    let result;
    try {
      result = importScip(buffer, rootPath);
    } catch (err) {
      return { ok: false as const, code: "PARSE_ERROR", message: `SCIP parse failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    const existingNodeIds = new Set(session.graph.repos.flatMap((r) => r.nodes.map((n) => n.id)));
    const existingEdgeIds = new Set(session.graph.repos.flatMap((r) => r.edges.map((e) => e.id)));

    let conflicts = 0;
    const newNodes: GraphNode[] = [];
    for (const n of result.nodes) {
      if (existingNodeIds.has(n.id)) {
        conflicts++;
        continue;
      }
      newNodes.push(n);
    }

    const newEdges: GraphEdge[] = [];
    for (const e of result.edges) {
      if (existingEdgeIds.has(e.id)) continue;
      const srcExists = existingNodeIds.has(e.source) || newNodes.some((n) => n.id === e.source);
      const tgtExists = existingNodeIds.has(e.target) || newNodes.some((n) => n.id === e.target);
      if (srcExists && tgtExists) newEdges.push(e);
    }

    if (newNodes.length > 0 || newEdges.length > 0) {
      const importRepo: RepoSubgraph = {
        uri: "import://scip",
        nodes: newNodes,
        edges: newEdges,
        clusters: [],
      };

      const updatedGraph = {
        ...session.graph,
        repos: [...session.graph.repos, importRepo],
      };
      session.graph = updatedGraph;
      session.incrementalEval.setEdb(populateEdb(updatedGraph));

      session.eventBus.emit({
        kind: "graph.imported",
        format: "scip",
        nodesImported: newNodes.length,
        edgesImported: newEdges.length,
        conflicts,
        at: Date.now(),
      });
    }

    logger.info("graph-import", `SCIP: +${newNodes.length} nodes, +${newEdges.length} edges, ${conflicts} conflicts`);

    return {
      ok: true as const,
      data: {
        nodesImported: newNodes.length,
        edgesImported: newEdges.length,
        conflicts,
        metadata: result.metadata,
      },
    };
  },
};

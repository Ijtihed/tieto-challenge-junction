// C# extractor. Delegates parsing and symbol binding to the Roslyn sidecar
// in tools/csharp-ast, then maps its output onto Schema's node/edge vocabulary.
// Node ids are keyed on the C# symbol (not line numbers) so they stay stable
// across edits that shift lines, which the review diff relies on.
import type { ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { RepoSubgraph, GraphNode, GraphEdge } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator, parseLocator } from "../../domain/locator.ts";
import { runCsharpAst, type CsGraph } from "./sidecar.ts";
import { createHash } from "node:crypto";

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

// This vocabulary predates the `test` kind; tests stay utility and carry meta.isTest.
const uriToPath = (uri: string) => (uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri);

const KIND_MAP: Record<string, string> = {
  test: NODE_KINDS.utility,
  contract: NODE_KINDS.contract,
  model: NODE_KINDS.model,
  service: NODE_KINDS.service,
  utility: NODE_KINDS.utility,
};

export function csLocator(key: string, rootPath: string): string {
  return key.startsWith("file:") ? `file://${rootPath}/${key.slice(5)}` : `cs://${key}`;
}

export function csNodeId(key: string, rootPath: string): string {
  return idFromLocator(parseLocator(csLocator(key, rootPath)));
}

export function csGraphToSubgraph(graph: CsGraph, repoUri: string, rootPath: string): RepoSubgraph {
  const idOf = new Map<string, string>();
  const nodes: GraphNode[] = graph.nodes.map((n) => {
    const locator = csLocator(n.key, rootPath);
    const id = idFromLocator(parseLocator(locator));
    idOf.set(n.key, id);
    return {
      id,
      kind: KIND_MAP[n.kind] ?? NODE_KINDS.utility,
      name: n.csKind === "file" ? n.name : n.key.split(".").slice(-2).join("."),
      locator,
      filePath: `${rootPath}/${n.file}`,
      startLine: n.startLine,
      endLine: n.endLine,
      bodyFingerprint: n.fingerprint || undefined,
      meta: {
        language: "csharp",
        symbol: n.key,
        csKind: n.csKind,
        accessibility: n.accessibility,
        publicApi: n.publicApi,
        attributes: n.attributes,
        signature: n.signature,
        generated: n.generated,
        isTest: n.isTest,
      },
    };
  });

  // Relations missing from this vocabulary are declared via vocabularyExtensions.
  const relationOf: Record<string, string> = {
    declares: "declares",
    calls: EDGE_RELATIONS.calls,
    references_type: "references_type",
    reads_field: EDGE_RELATIONS.reads_field,
    implements: "implements",
    extends: "extends",
    dispatch: EDGE_RELATIONS.calls,
  };
  const edges: GraphEdge[] = [];
  for (const e of graph.edges) {
    const source = idOf.get(e.source);
    const target = idOf.get(e.target);
    const relation = relationOf[e.relation];
    if (!source || !target || !relation) continue;
    edges.push({
      id: edgeId(source, target, relation),
      source,
      target,
      relation,
      meta: e.relation === "dispatch" ? { resolution: "virtual-dispatch" } : e.resolved ? undefined : { resolution: "name-only" },
    });
  }
  return { uri: repoUri, nodes, edges, clusters: [] };
}

export const extractorCsharp = {
  id: "extractor-csharp",

  declare() {
    return {
      languages: ["csharp"] as readonly string[],
      frameworks: ["roslyn"] as readonly string[],
      introducesNodeKinds: [NODE_KINDS.service, NODE_KINDS.model, NODE_KINDS.contract, NODE_KINDS.utility],
      introducesEdgeRelations: [EDGE_RELATIONS.calls, EDGE_RELATIONS.reads_field, "declares", "references_type", "implements", "extends"],
      needsAdapters: ["fs"] as readonly ("fs")[],
    };
  },

  async *extract(ctx: ExtractContext): AsyncGenerator<ExtractEvent> {
    const rootPath = uriToPath(ctx.repoUri);
    let files: string[];
    try {
      files = await ctx.fs.listDir(rootPath, { recursive: true });
    } catch (err) {
      yield { kind: "error", message: `listDir failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
    if (!files.some((f) => f.endsWith(".cs"))) {
      yield { kind: "done", data: { uri: ctx.repoUri, nodes: [], edges: [], clusters: [] } };
      return;
    }

    yield { kind: "progress", message: "running Roslyn over C# sources" };
    try {
      const graph = await runCsharpAst<CsGraph>(["graph", rootPath], ctx.signal);
      yield { kind: "progress", message: `C#: ${graph.stats.files} files, ${graph.stats.nodes} symbols, ${graph.stats.edges} edges` };
      // Optional canvas-only exclusion (e.g. "benchmark/,sandbox/"); review receipts use their own full graph.
      const skip = (process.env.SCHEMA_CSHARP_EXCLUDE ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (skip.length) {
        const keep = new Set(graph.nodes.filter((n) => !skip.some((p) => n.file.startsWith(p))).map((n) => n.key));
        graph.nodes = graph.nodes.filter((n) => keep.has(n.key));
        graph.edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
      }
      yield { kind: "done", data: csGraphToSubgraph(graph, ctx.repoUri, rootPath) };
    } catch (err) {
      yield { kind: "error", message: `csharp-ast failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

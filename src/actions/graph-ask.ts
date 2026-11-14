// Per `architecture/v1-launch-plan.md` Step 8b work item 1 +
// research/29 §4 (hybrid RAG retrieval).
//
// `graph.ask` — the user-facing MCP action wrapping Step 8a's
// `queryHybrid` engine. Natural-language query in; ranked
// node ids + markdown context out.
//
// **The fastest path from a Cursor/Claude Code question to
// a verified answer.** Per research/29 §4.1 + Sourcegraph
// BM25F v6.2 + research/26 §3: senior+ engineers ask the
// codebase questions all day; `graph.ask` makes those answers
// **grounded in the typed graph** rather than freeform LLM
// guessing.
//
// **Output shape.** Three pieces:
//   - `hits[]`: ranked node ids + their per-source ranks
//     (which retriever surfaced them) + the node + cluster
//     metadata so callers can render without re-fetching
//   - `markdownUri`: a `markdown://graph.ask/<uuid>` URI
//     stored in `session.markdownResources` so MCP clients
//     can fetch the rendered context block via the resource
//     surface
//   - `query` + `k`: echoed back for caller traceability
//
// **Hybrid-strict positioning.** This is a retrieval action,
// not an authority. Schema returns ranked evidence; the
// caller's LLM synthesises the answer. Per the same Q11
// + research/26 §6 hybrid-strict framing as `pr.review`:
// no merge authority + no answer synthesis. The markdown
// resource is **evidence**, not an answer.

import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import {
  buildHybridIndex,
  queryHybrid,
  type HybridIndex,
  type HybridResult,
} from "../domain/retrieval/hybrid.ts";

/** Default top-k. Per research/29 §4.2 + Sourcegraph
 *  BM25F: 10 results balance recall + LLM context budget. */
export const DEFAULT_GRAPH_ASK_K = 10;

/** Default per-retriever pool fed into RRF. Inherits from
 *  `queryHybrid`. Exposed here so callers can override
 *  per-query without re-implementing the hybrid pipeline. */
export const DEFAULT_GRAPH_ASK_BM25_K = 30;
export const DEFAULT_GRAPH_ASK_TRAVERSAL_K = 30;
export const DEFAULT_GRAPH_ASK_MAX_DEPTH = 2;

/** Session-scoped index cache. Per session, the first
 *  `graph.ask` call builds the hybrid index (24-100 ms on
 *  real repos per Step 8a DC); subsequent calls reuse it.
 *  Invalidated when the graph mutates (Step 5b will hook the
 *  reactive layer; today we cache by session + node count +
 *  edge count as a cheap freshness signal). */
const indexCache = new WeakMap<
  ReturnType<typeof getSession> & object,
  { index: HybridIndex; nodeCount: number; edgeCount: number }
>();

/** Render a `HybridResult[]` as markdown evidence block.
 *  Pure function (§0.6.4 (a)). Exported for tests + for
 *  callers (e.g. `pr.review`) that want the same format. */
export function renderHitsMarkdown(query: string, hits: readonly HybridResult[]): string {
  if (hits.length === 0) {
    return `# Schema graph.ask: \`${query}\`\n\n_No matching nodes in the graph._`;
  }
  const lines: string[] = [];
  lines.push(`# Schema graph.ask: \`${query}\``);
  lines.push("");
  lines.push(`> ${hits.length} ranked hit${hits.length === 1 ? "" : "s"} from BM25 + graph-traversal + RRF.`);
  lines.push("");
  lines.push(`| # | Score | Node | Kind | File | Cluster | Sources |`);
  lines.push(`|---:|---:|---|---|---|---|---|`);
  hits.forEach((hit, i) => {
    const sources: string[] = [];
    if (hit.bm25) sources.push(`bm25 #${hit.bm25.rank}`);
    if (hit.traversal) sources.push(`tr #${hit.traversal.rank}`);
    lines.push(
      `| ${i + 1}` +
      ` | ${hit.rrfScore.toFixed(4)}` +
      ` | \`${hit.node.name}\`` +
      ` | ${hit.node.kind}` +
      ` | \`${hit.node.filePath ?? "—"}\`` +
      ` | ${hit.cluster?.name ?? "—"}` +
      ` | ${sources.join(", ")} |`,
    );
  });
  return lines.join("\n");
}

export const graphAsk = {
  name: "graph.ask" as const,
  description:
    "Hybrid-RAG retrieval: given a natural-language query, return the top-K ranked nodes from the workspace's typed graph. Combines BM25F (lexical) + graph traversal (architectural-proximity) via Reciprocal Rank Fusion. Returns ranked nodes + a markdown evidence block. Schema returns evidence; the caller's LLM synthesises the answer (hybrid-strict).",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      query: { type: "string", description: "Natural-language query (e.g. 'where is authentication handled?')" },
      k: { type: "number", description: `Top-K results (default ${DEFAULT_GRAPH_ASK_K})` },
      bm25K: { type: "number", description: `BM25 candidate-pool size (default ${DEFAULT_GRAPH_ASK_BM25_K})` },
      traversalK: { type: "number", description: `Traversal candidate-pool size (default ${DEFAULT_GRAPH_ASK_TRAVERSAL_K})` },
      maxDepth: { type: "number", description: `Max BFS depth for graph traversal (default ${DEFAULT_GRAPH_ASK_MAX_DEPTH})` },
    },
    required: ["sessionId", "query"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    // Validate query shape BEFORE looking up the session.
    // This produces consistent invalid-args responses
    // regardless of whether the session exists yet, which
    // simplifies error handling for MCP clients (they
    // don't have to distinguish "you sent bad input" from
    // "you sent bad input AND your session expired").
    const query = args["query"] as string | undefined;
    if (!query || query.trim().length === 0) {
      return { ok: false as const, code: "invalid-args", message: "query is required" };
    }
    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const k = (args["k"] as number | undefined) ?? DEFAULT_GRAPH_ASK_K;
    const bm25K = (args["bm25K"] as number | undefined) ?? DEFAULT_GRAPH_ASK_BM25_K;
    const traversalK = (args["traversalK"] as number | undefined) ?? DEFAULT_GRAPH_ASK_TRAVERSAL_K;
    const maxDepth = (args["maxDepth"] as number | undefined) ?? DEFAULT_GRAPH_ASK_MAX_DEPTH;

    // Get-or-build the index for this session. Cache key is
    // (node count, edge count) — cheap freshness signal.
    // Step 5b will hook the reactive layer here.
    const totalNodes = session.graph.repos.reduce((s, r) => s + r.nodes.length, 0);
    const totalEdges = session.graph.repos.reduce((s, r) => s + r.edges.length, 0);
    const cached = indexCache.get(session);
    let index: HybridIndex;
    if (cached && cached.nodeCount === totalNodes && cached.edgeCount === totalEdges) {
      index = cached.index;
    } else {
      index = buildHybridIndex(session.graph);
      indexCache.set(session, { index, nodeCount: totalNodes, edgeCount: totalEdges });
    }

    const hits = queryHybrid(index, query, { k, bm25K, traversalK, maxDepth });

    const markdown = renderHitsMarkdown(query, hits);
    const resultId = randomUUID();
    const markdownUri = `markdown://graph.ask/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: {
        query,
        k,
        hits: hits.map((h) => ({
          nodeId: h.nodeId,
          rrfScore: h.rrfScore,
          node: {
            id: h.node.id,
            kind: h.node.kind,
            name: h.node.name,
            ...(h.node.filePath !== undefined ? { filePath: h.node.filePath } : {}),
            locator: h.node.locator,
          },
          cluster: h.cluster
            ? { id: h.cluster.id, name: h.cluster.name }
            : null,
          bm25: h.bm25,
          traversal: h.traversal,
        })),
        markdownUri,
      },
    };
  },
};

// Per `architecture/v1-launch-plan.md` Step 7b work item 2.
//
// MCP action: returns the top-K entry-point nodes per cluster
// (from Step 7a's `entryPointIds` + `importance` fields).
// The Studio `★` hints consume this surface directly.
//
// Pure read (sideEffect: "none"). No graph mutation.

import { getSession } from "../session/index.ts";

export const DEFAULT_ENTRY_POINTS_K = 3;

export interface EntryPointResult {
  readonly clusterId: string;
  readonly clusterName: string;
  readonly canonicalShape?: string | undefined;
  readonly entryPoints: ReadonlyArray<{
    readonly nodeId: string;
    readonly importance: number;
    readonly node: { readonly id: string; readonly kind: string; readonly name: string; readonly locator: string; readonly filePath?: string | undefined };
  }>;
}

export const graphEntryPoints = {
  name: "graph.entry_points" as const,
  description:
    "Return the top-K entry-point nodes per cluster, ranked by PageRank importance. Each entry point is the most architecturally significant node in its cluster — the node through which most of the cluster's inbound/outbound traffic flows. Studio renders these as ★ hints.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      k: { type: "number", description: `Max entry points per cluster (default ${DEFAULT_ENTRY_POINTS_K})` },
      clusterId: { type: "string", description: "Optional: return entry points for only this cluster" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const k = (args["k"] as number | undefined) ?? DEFAULT_ENTRY_POINTS_K;
    const filterClusterId = args["clusterId"] as string | undefined;

    const nodeIndex = new Map<string, { id: string; kind: string; name: string; locator: string; filePath?: string | undefined }>();
    for (const repo of session.graph.repos) {
      for (const node of repo.nodes) {
        nodeIndex.set(node.id, {
          id: node.id,
          kind: node.kind as string,
          name: node.name,
          locator: node.locator,
          ...(node.filePath !== undefined ? { filePath: node.filePath } : {}),
        });
      }
    }

    const results: EntryPointResult[] = [];

    for (const repo of session.graph.repos) {
      for (const cluster of repo.clusters) {
        if (filterClusterId && cluster.id !== filterClusterId) continue;

        const entryPointIds = (cluster.entryPointIds ?? []).slice(0, k);
        const importanceMap = cluster.importance ?? {};

        const entryPoints = entryPointIds
          .map((nodeId) => {
            const node = nodeIndex.get(nodeId);
            if (!node) return null;
            return {
              nodeId,
              importance: importanceMap[nodeId] ?? 0,
              node,
            };
          })
          .filter((ep): ep is NonNullable<typeof ep> => ep !== null);

        results.push({
          clusterId: cluster.id,
          clusterName: cluster.name,
          ...(cluster.canonicalShape ? { canonicalShape: cluster.canonicalShape } : {}),
          entryPoints,
        });
      }
    }

    return {
      ok: true as const,
      data: {
        k,
        clusters: results,
        totalEntryPoints: results.reduce((s, r) => s + r.entryPoints.length, 0),
      },
    };
  },
};

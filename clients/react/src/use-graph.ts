import { useState, useEffect } from "react";
import type { SchemaSession } from "@schema-ai/client";
import type { GraphNode, GraphEdge } from "@schema-ai/client";

interface UseGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGraph(session: SchemaSession | null): UseGraphResult {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const { nodes: n } = await session.graphListNodes({}, 10000);
      setNodes(n);

      const allEdges: GraphEdge[] = [];
      for (const node of n) {
        try {
          const result = await session.graphFindCallees(node.id, 1);
          if (result.edges?.[0]) {
            allEdges.push(...result.edges[0]);
          }
        } catch { /* some nodes may not have callees */ }
      }
      const uniqueEdges = [...new Map(allEdges.map(e => [e.id, e])).values()];
      setEdges(uniqueEdges);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) refresh();
  }, [session]);

  return { nodes, edges, loading, error, refresh };
}

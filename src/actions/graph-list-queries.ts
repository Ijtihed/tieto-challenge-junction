// Per architecture/specs/architectural-search.md — list bundled Datalog queries.
import { BUNDLED_QUERIES } from "../domain/queries/bundled.ts";

export const graphListQueries = {
  name: "graph.list_queries" as const,
  description: "List all bundled architectural search queries.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {},
  },

  async handle(_args: Record<string, unknown>) {
    return {
      ok: true as const,
      data: {
        queries: BUNDLED_QUERIES.map((q) => ({
          id: q.id,
          name: q.name,
          description: q.description,
          category: q.category,
        })),
      },
    };
  },
};

// Per architecture/schema-v3.md §5.3 action 10 — fuzzy name matching
import { getSession } from "../session/index.ts";

type SearchScope = "name" | "file" | "all";

function fuzzyScore(query: string, text: string): number {
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();

  if (lt === lq) return 1.0;
  if (lt.startsWith(lq)) return 0.9;
  if (lt.includes(lq)) return 0.7;

  let qi = 0;
  let matched = 0;
  for (let ti = 0; ti < lt.length && qi < lq.length; ti++) {
    if (lt[ti] === lq[qi]) { matched++; qi++; }
  }
  if (qi < lq.length) return 0;
  return 0.3 + (0.3 * (matched / lt.length));
}

export const graphSearch = {
  name: "graph.search" as const,
  description: "Fuzzy-search graph nodes by name or file path, returning ranked results with relevance scores.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      query: { type: "string", description: "The search query string" },
      scope: { type: "string", enum: ["name", "file", "all"], description: "Which fields to search (default 'all')" },
      limit: { type: "number", description: "Maximum number of results (default 30)" },
    },
    required: ["sessionId", "query"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const query = args["query"] as string | undefined;
    if (!query) {
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

    const scope = (args["scope"] as SearchScope | undefined) ?? "all";
    const limit = (args["limit"] as number | undefined) ?? 30;

    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const hits: { id: string; score: number; why: string }[] = [];

    for (const node of allNodes) {
      let bestScore = 0;
      let why = "";

      if (scope === "name" || scope === "all") {
        const s = fuzzyScore(query, node.name);
        if (s > bestScore) { bestScore = s; why = "name"; }
      }
      if (scope === "file" || scope === "all") {
        const filePart = node.filePath ?? node.locator;
        const s = fuzzyScore(query, filePart);
        if (s > bestScore) { bestScore = s; why = "file"; }
      }

      if (bestScore > 0) {
        hits.push({ id: node.id, score: bestScore, why });
      }
    }

    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    return { ok: true as const, data: { hits: hits.slice(0, limit) } };
  },
};

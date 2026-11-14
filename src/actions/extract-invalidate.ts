// Per architecture/schema-v3.md §5.3 action 29
import { getSession } from "../session/index.ts";
import { populateEdb } from "../domain/datalog/edb.ts";

export const extractInvalidate = {
  name: "extract.invalidate" as const,
  description: "Invalidate (remove) graph nodes and edges associated with changed file URIs, triggering re-extraction on next access.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      touchedUris: { type: "array", items: { type: "string" }, description: "File URIs that have changed and need re-extraction" },
    },
    required: ["sessionId", "touchedUris"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const touchedUris = args["touchedUris"] as string[] | undefined;
    if (!touchedUris || !Array.isArray(touchedUris)) {
      return { ok: false as const, code: "invalid-args", message: "touchedUris is required (string array)" };
    }

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const touchedSet = new Set(touchedUris);
    let invalidated = 0;

    const newRepos = session.graph.repos.map((repo) => {
      const filteredNodes = repo.nodes.filter((n) => {
        if (n.filePath && touchedSet.has(n.filePath)) { invalidated++; return false; }
        return true;
      });
      const remainingIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = repo.edges.filter((e) => remainingIds.has(e.source) && remainingIds.has(e.target));
      return { ...repo, nodes: filteredNodes, edges: filteredEdges };
    });

    session.graph = { ...session.graph, repos: newRepos };

    const newEdb = populateEdb(session.graph);
    const { delta, result } = session.incrementalEval.applyEdbUpdate(newEdb);

    session.eventBus.emit({
      kind: "extractor.invalidated",
      touchedUris,
      edbDelta: { added: delta.added.size, removed: delta.removed.size },
      newViolations: result.violations.length,
      at: Date.now(),
    });

    return { ok: true as const, data: { invalidated, violations: result.violations } };
  },
};

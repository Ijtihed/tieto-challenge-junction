// Per architecture/schema-v3.md §17.9 — constraint-based architectural search via Datalog.
import { getSession } from "../session/index.ts";
import { parseDatalog, queryDatalog, populateEdb } from "../domain/index.ts";
import { BUNDLED_QUERIES, type BundledQuery } from "../domain/queries/bundled.ts";

export const graphQuery = {
  name: "graph.query" as const,
  description: "Run a Datalog query against the current graph. Use 'query' for ad-hoc text or 'bundledQueryId' for a canned query.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      query: { type: "string", description: "Datalog text with rules and a ?- query." },
      bundledQueryId: { type: "string", description: "ID of a bundled query (see graph.list_queries)" },
      limit: { type: "number", description: "Max results to return (default 100)" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    let queryText = args["query"] as string | undefined;
    const bundledId = args["bundledQueryId"] as string | undefined;
    const limit = (args["limit"] as number | undefined) ?? 100;

    if (bundledId) {
      const bundled = BUNDLED_QUERIES.find((q) => q.id === bundledId);
      if (!bundled) {
        return { ok: false as const, code: "unknown-bundled-query", message: `Unknown bundled query: ${bundledId}. Available: ${BUNDLED_QUERIES.map(q => q.id).join(", ")}` };
      }
      queryText = bundled.datalog;
    }

    if (!queryText) {
      return { ok: false as const, code: "invalid-args", message: "Either query or bundledQueryId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const parsed = parseDatalog(queryText);
    if ("message" in parsed) {
      return { ok: false as const, code: "invalid-datalog", message: `Parse error at line ${parsed.line}:${parsed.column}: ${parsed.message}` };
    }

    if (parsed.queries.length === 0) {
      return { ok: false as const, code: "no-query", message: "No ?- query found in the Datalog text. Add a query like: ?- reachable(\"nodeId\", Y)." };
    }

    let results: string[][];
    const incEval = session.incrementalEval;
    if (parsed.rules.length === 0 && incEval.program) {
      results = incEval.query(parsed);
    } else {
      const edb = populateEdb(session.graph);
      results = queryDatalog(parsed, edb);
    }

    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

    const enriched = results.map((tuple) => ({
      tuple,
      nodes: tuple.map((id) => nodeMap.get(id)).filter(Boolean).map((n) => ({ id: n!.id, kind: n!.kind, name: n!.name })),
    }));

    const limited = enriched.slice(0, limit);

    return {
      ok: true as const,
      data: {
        query: parsed.queries.map((q) => `${q.atom.predicate}(${q.atom.terms.map((t) => t.kind === "string" ? `"${t.value}"` : t.kind === "variable" ? t.name : "_").join(", ")})`),
        resultCount: results.length,
        results: limited,
        truncated: results.length > limit,
        bundledQueryId: bundledId ?? null,
      },
    };
  },
};

import { SchemaError } from "./errors.ts";
import type {
  GraphNode, GraphEdge, SummaryData,
  Violation, NodeDetail, CanonResult, SkillInfo,
  SessionEvent, ConnectionStatus,
} from "./types.ts";

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface SchemaSession {
  readonly sessionId: string;

  graphSummary(): Promise<SummaryData>;
  graphListNodes(filter?: { kind?: string; namePattern?: string; locatorPrefix?: string }, limit?: number, cursor?: string): Promise<{ nodes: GraphNode[]; nextCursor?: string }>;
  graphGetNode(id: string, include?: string[]): Promise<NodeDetail>;
  graphFindCallers(symbolId: string, depth?: number): Promise<{ paths: GraphNode[][]; edges: GraphEdge[][] }>;
  graphFindCallees(symbolId: string, depth?: number): Promise<{ paths: GraphNode[][]; edges: GraphEdge[][] }>;
  graphPath(from: string, to: string): Promise<{ paths: GraphNode[][]; edges: GraphEdge[][] }>;
  graphSearch(query: string, scope?: string, limit?: number): Promise<{ nodes: GraphNode[] }>;
  graphDiffAgainst(ref: string): Promise<unknown>;
  rulesEvaluate(): Promise<{ violations: Violation[] }>;
  canonSearch(query: string, paradigm?: string, k?: number): Promise<{ results: CanonResult[] }>;
  skillsList(): Promise<{ skills: SkillInfo[] }>;

  subscribe(handler: (event: SessionEvent) => void, onStatus?: (status: ConnectionStatus) => void): () => void;
  close(): Promise<void>;
}

export interface SchemaClient {
  connect(uris: string[]): Promise<SchemaSession>;
}

export function createSchemaClient(serverUrl: string): SchemaClient {
  let nextId = 1;

  async function rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });

    if (!res.ok) {
      throw new SchemaError(`Server error: ${res.status} ${res.statusText}`, "http-error", res.status);
    }

    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) {
      throw new SchemaError(json.error.message, "rpc-error", json.error.code);
    }
    return json.result as T;
  }

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await rpc<{ content: { type: string; text: string }[] }>("tools/call", { name, arguments: args });
    const text = result.content[0]?.text;
    if (!text) throw new SchemaError("Empty response from server", "empty-response");
    const parsed = JSON.parse(text) as { ok: boolean; data?: T; code?: string; message?: string };
    if (!parsed.ok) {
      throw new SchemaError(parsed.message ?? "Action failed", parsed.code ?? "unknown");
    }
    return parsed.data as T;
  }

  return {
    async connect(uris: string[]): Promise<SchemaSession> {
      const data = await callTool<{ sessionId: string }>("workspace.open", { uris });
      const sessionId = data.sessionId;

      const session: SchemaSession = {
        sessionId,

        graphSummary: () => callTool("graph.summary", { sessionId }),
        graphListNodes: (filter, limit, cursor) => callTool("graph.list_nodes", { sessionId, filter: filter ?? {}, limit, cursor }),
        graphGetNode: (id, include) => callTool("graph.get_node", { sessionId, id, include }),
        graphFindCallers: (symbolId, depth) => callTool("graph.find_callers", { sessionId, symbolId, depth }),
        graphFindCallees: (symbolId, depth) => callTool("graph.find_callees", { sessionId, symbolId, depth }),
        graphPath: (from, to) => callTool("graph.path", { sessionId, from, to }),
        graphSearch: (query, scope, limit) => callTool("graph.search", { sessionId, query, scope, limit }),
        graphDiffAgainst: (ref) => callTool("graph.diff_against", { sessionId, ref }),
        rulesEvaluate: () => callTool("rules.evaluate", { sessionId }),
        canonSearch: (query, paradigm, k) => callTool("canon.search", { sessionId, query, paradigm, k }),
        skillsList: () => callTool("skills.list", { sessionId }),

        subscribe(handler, onStatus) {
          const source = new EventSource(`${serverUrl}/mcp/events/${sessionId}`);
          source.onopen = () => onStatus?.("connected");
          source.onmessage = (e) => {
            try { handler(JSON.parse(e.data as string) as SessionEvent); } catch { /* skip bad events */ }
          };
          source.onerror = () => {
            onStatus?.(source.readyState === EventSource.CONNECTING ? "reconnecting" : "error");
          };
          return () => { source.close(); onStatus?.("disconnected"); };
        },

        close: () => callTool("workspace.close", { sessionId }),
      };

      return session;
    },
  };
}

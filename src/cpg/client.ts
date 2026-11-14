// MCP client for the CPG sidecar server.
// Calls CPG's MCP tools (dataflow, symbol analysis, concept application).
import { logger } from "../obs/index.ts";

export interface CpgClient {
  readonly baseUrl: string;
  callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
  listTools(): Promise<{ name: string; description?: string }[]>;
  analyze(sourceDir: string): Promise<CpgAnalysisResult>;
  dataflowBackward(nodeId: string): Promise<CpgDataflowResult>;
  dataflowForward(nodeId: string): Promise<CpgDataflowResult>;
}

export interface CpgAnalysisResult {
  ok: boolean;
  nodeCount: number;
  edgeCount: number;
  languages: string[];
}

export interface CpgDataflowResult {
  ok: boolean;
  paths: { from: string; to: string; via: string[] }[];
}

let nextId = 1;

export function createCpgClient(baseUrl: string): CpgClient {
  async function mcpCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    if (!res.ok) throw new Error(`CPG server error: ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result as T;
  }

  async function toolCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await mcpCall<{ content: { text: string }[] }>("tools/call", {
      name, arguments: args,
    });
    const text = result.content[0]?.text;
    if (!text) throw new Error("Empty CPG response");
    return JSON.parse(text) as T;
  }

  return {
    get baseUrl() { return baseUrl; },

    callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
      return toolCall<T>(name, args);
    },

    async listTools(): Promise<{ name: string; description?: string }[]> {
      try {
        const result = await mcpCall<{ tools: { name: string; description?: string }[] }>("tools/list");
        return result.tools;
      } catch (err) {
        logger.warn("cpg-client", `listTools failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },

    async analyze(sourceDir: string): Promise<CpgAnalysisResult> {
      try {
        const result = await toolCall<CpgAnalysisResult>("cpg_analyze", { sourceDir });
        return result;
      } catch (err) {
        logger.warn("cpg-client", `analyze failed: ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, nodeCount: 0, edgeCount: 0, languages: [] };
      }
    },

    async dataflowBackward(nodeId: string): Promise<CpgDataflowResult> {
      try {
        return await toolCall<CpgDataflowResult>("cpg_dfg_backward", { nodeId });
      } catch (err) {
        logger.warn("cpg-client", `dataflowBackward failed: ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, paths: [] };
      }
    },

    async dataflowForward(nodeId: string): Promise<CpgDataflowResult> {
      try {
        return await toolCall<CpgDataflowResult>("cpg_dfg_forward", { nodeId });
      } catch (err) {
        logger.warn("cpg-client", `dataflowForward failed: ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, paths: [] };
      }
    },
  };
}

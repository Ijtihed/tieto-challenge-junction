// Per architecture/schema-v3.md §11.3 — stdio transport.
// JSON-RPC over stdin/stdout per MCP 2025-11-25 spec.
import { createInterface } from "node:readline";
import type { McpDispatcher } from "./dispatcher.ts";
import { logger } from "../obs/index.ts";

export interface StdioTransport {
  start(): void;
  close(): void;
}

export function createStdioTransport(dispatcher: McpDispatcher): StdioTransport {
  let closed = false;
  const pending = new Map<unknown, Promise<void>>();
  let seq = 0;

  const rl = createInterface({ input: process.stdin, terminal: false });

  function handleLine(line: string): void {
    if (closed) return;
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: { jsonrpc: string; id?: unknown; method: string; params?: Record<string, unknown> };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      writeJsonRpc({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      return;
    }

    const isNotification = parsed.id === undefined || parsed.id === null;

    if (parsed.method?.startsWith("notifications/")) {
      return;
    }

    if (isNotification) return;

    const order = seq++;
    const job = routeRequest(dispatcher, parsed).then((resp) => {
      if (resp.error) {
        writeJsonRpc({ jsonrpc: "2.0", error: resp.error, id: parsed.id ?? null });
      } else {
        writeJsonRpc({ jsonrpc: "2.0", result: resp.result, id: parsed.id });
      }
    }).catch((err) => {
      writeJsonRpc({
        jsonrpc: "2.0",
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
        id: parsed.id ?? null,
      });
    });

    if (!isNotification) {
      pending.set(order, job);
      job.finally(() => pending.delete(order));
    }
  }

  function writeJsonRpc(msg: Record<string, unknown>): void {
    if (closed) return;
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  return {
    start() {
      logger.info("transport-stdio", "listening on stdin/stdout");
      rl.on("line", handleLine);
      rl.on("close", () => {
        closed = true;
        dispatcher.close();
      });
    },
    close() {
      closed = true;
      rl.close();
    },
  };
}

async function routeRequest(
  dispatcher: McpDispatcher,
  parsed: { method: string; params?: Record<string, unknown> },
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  switch (parsed.method) {
    case "initialize":
      return { result: dispatcher.initialize() };
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: dispatcher.listTools() };
    case "resources/list":
      return { result: dispatcher.listResources() };
    case "resources/read": {
      const resParams = parsed.params as { uri?: string } | undefined;
      if (!resParams?.uri) return { error: { code: -32602, message: "Missing resource URI" } };
      const resResult = dispatcher.readResource(resParams.uri);
      if (!resResult) return { error: { code: -32602, message: `Resource not found: ${resParams.uri}` } };
      return { result: resResult };
    }
    case "tools/call": {
      const params = parsed.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const name = params?.name;
      if (!name) return { error: { code: -32602, message: "Missing tool name" } };
      return { result: await dispatcher.callTool(name, params?.arguments ?? {}) };
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${parsed.method}` } };
  }
}

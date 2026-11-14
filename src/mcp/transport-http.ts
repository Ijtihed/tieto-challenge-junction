// Per architecture/schema-v3.md §11.3 — Streamable HTTP transport
// POST /mcp for JSON-RPC, GET /mcp/events/:sessionId for SSE.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { McpDispatcher } from "./dispatcher.ts";
import { getSession } from "../session/index.ts";
import { logger } from "../obs/index.ts";

export interface TransportHttpOptions {
  host?: string;
  port?: number;
}

export interface HttpTransport {
  listen(): Promise<void>;
  close(): Promise<void>;
  readonly address: string;
  readonly server: Server;
}

export function createHttpTransport(
  dispatcher: McpDispatcher,
  options: TransportHttpOptions = {},
): HttpTransport {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 7474;

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname.startsWith("/mcp/events/")) {
      handleSSE(url.pathname.slice("/mcp/events/".length), req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/mcp") {
      await handleJsonRpc(dispatcher, req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return {
    listen() {
      return new Promise<void>((resolve) => {
        server.listen(port, host, () => {
          logger.info("transport-http", `listening on http://${host}:${port}`);
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    get address() { return `http://${host}:${port}`; },
    get server() { return server; },
  };
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

async function handleJsonRpc(
  dispatcher: McpDispatcher,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) {
    res.writeHead(415, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Unsupported content type, expected application/json" }, id: null }));
    return;
  }

  let body: string;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    const code = err instanceof Error && err.message === "Payload too large" ? 413 : 400;
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: err instanceof Error ? err.message : "Read error" }, id: null }));
    return;
  }

  let parsed: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };

  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null,
    }));
    return;
  }

  if (parsed.method?.startsWith("notifications/")) {
    res.writeHead(202);
    res.end();
    return;
  }

  let result: unknown;

  switch (parsed.method) {
    case "initialize":
      result = dispatcher.initialize();
      break;
    case "ping":
      result = {};
      break;
    case "tools/list":
      result = dispatcher.listTools();
      break;
    case "resources/list":
      result = dispatcher.listResources();
      break;
    case "resources/read": {
      const resParams = parsed.params as { uri?: string } | undefined;
      if (!resParams?.uri) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32602, message: "Missing resource URI" }, id: parsed.id }));
        return;
      }
      result = dispatcher.readResource(resParams.uri);
      if (!result) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32602, message: `Resource not found: ${resParams.uri}` }, id: parsed.id }));
        return;
      }
      break;
    }
    case "tools/call": {
      const params = parsed.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (!name) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32602, message: "Missing tool name" },
          id: parsed.id,
        }));
        return;
      }
      result = await dispatcher.callTool(name, args);
      break;
    }
    default:
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32601, message: `Method not found: ${parsed.method}` },
        id: parsed.id,
      }));
      return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", result, id: parsed.id }));
}

const SSE_HEARTBEAT_MS = 15_000;

function handleSSE(
  sessionId: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const session = getSession(sessionId);
  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("\n");

  let eventSeq = 0;
  const unsub = session.eventBus.subscribe((event) => {
    const id = String(++eventSeq);
    res.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsub();
  });
}

function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) { req.destroy(); reject(new Error("Payload too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

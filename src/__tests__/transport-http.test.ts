// Phase 4 — integration tests for the Streamable HTTP transport.
//
// Starts a real HTTP server on a dynamic port, sends requests,
// verifies responses. Covers JSON-RPC routing, CORS, SSE events,
// error handling, and 404s.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpDispatcher, createHttpTransport, type ActionHandler } from "../mcp/index.ts";
import type { Server } from "node:http";

let baseUrl: string;
let transport: { listen(): Promise<void>; close(): Promise<void>; server: Server };
let dispatcher: McpDispatcher;

async function rpc(method: string, params?: Record<string, unknown>): Promise<{
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json() as Promise<ReturnType<typeof rpc>>;
}

before(async () => {
  dispatcher = new McpDispatcher({ name: "test-server", version: "0.1.0" });

  const echoAction: ActionHandler = {
    name: "test.echo",
    description: "Test echo action",
    sideEffect: "none",
    async handle(args) {
      return { ok: true, data: args };
    },
  };
  const failAction: ActionHandler = {
    name: "test.fail",
    description: "Test fail action",
    sideEffect: "none",
    async handle() {
      return { ok: false, code: "blocker", message: "intentional failure" };
    },
  };
  dispatcher.registerAction(echoAction);
  dispatcher.registerAction(failAction);

  transport = createHttpTransport(dispatcher, { port: 0 });
  await transport.listen();
  const addr = transport.server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await transport.close();
});

// ── JSON-RPC routing ──

describe("transport-http — JSON-RPC", () => {
  it("initialize returns protocolVersion + capabilities", async () => {
    const json = await rpc("initialize");
    assert.ok(json.result);
    const result = json.result as { protocolVersion: string; capabilities: Record<string, unknown> };
    assert.equal(result.protocolVersion, "2025-11-25");
    assert.equal(Object.keys(result.capabilities).length, 3);
  });

  it("tools/list returns registered tools", async () => {
    const json = await rpc("tools/list");
    assert.ok(json.result);
    const result = json.result as { tools: { name: string }[] };
    assert.equal(result.tools.length, 2);
    const names = result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["test.echo", "test.fail"]);
  });

  it("tools/call routes to the action and returns result", async () => {
    const json = await rpc("tools/call", {
      name: "test.echo",
      arguments: { greeting: "hello" },
    });
    assert.ok(json.result);
    const result = json.result as { content: { text: string }[]; isError: boolean };
    assert.equal(result.isError, false);
    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.greeting, "hello");
  });

  it("tools/call for unknown tool returns isError content", async () => {
    const json = await rpc("tools/call", {
      name: "nonexistent",
      arguments: {},
    });
    assert.ok(json.result);
    const result = json.result as { isError: boolean; content: { text: string }[] };
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.code, "unknown-tool");
  });

  it("tools/call for action returning ok:false propagates the error", async () => {
    const json = await rpc("tools/call", {
      name: "test.fail",
      arguments: {},
    });
    assert.ok(json.result);
    const result = json.result as { isError: boolean; content: { text: string }[] };
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.code, "blocker");
    assert.equal(parsed.message, "intentional failure");
  });

  it("tools/call with missing tool name returns JSON-RPC error", async () => {
    const json = await rpc("tools/call", { arguments: {} });
    assert.ok(json.error);
    assert.equal(json.error!.code, -32602);
    assert.ok(json.error!.message.includes("Missing tool name"));
  });

  it("unknown method returns method-not-found JSON-RPC error", async () => {
    const json = await rpc("totally/unknown_method");
    assert.ok(json.error);
    assert.equal(json.error!.code, -32601);
  });

  it("notifications are accepted without error (202)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(res.status, 202);
  });

  it("resources/list returns registered resources", async () => {
    const json = await rpc("resources/list");
    assert.ok(json.result);
  });

  it("invalid JSON body returns parse error", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all{{{",
    });
    assert.equal(res.status, 400);
    const json = await res.json() as { error: { code: number } };
    assert.equal(json.error.code, -32700);
  });
});

// ── CORS ──

describe("transport-http — CORS", () => {
  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.ok(res.headers.get("access-control-allow-methods")?.includes("POST"));
  });

  it("POST responses include CORS origin header", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

// ── 404 ──

describe("transport-http — 404 handling", () => {
  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    assert.equal(res.status, 404);
  });

  it("POST /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 404);
  });

  it("GET / returns 404", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 404);
  });
});

// ── SSE events ──

describe("transport-http — SSE events", () => {
  it("GET /mcp/events/:unknownId returns 404", async () => {
    const res = await fetch(`${baseUrl}/mcp/events/sess_nonexistent`);
    assert.equal(res.status, 404);
  });
});

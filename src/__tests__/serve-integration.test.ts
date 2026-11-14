// Phase 4 — integration test for the full Schema MCP server.
//
// Uses createSchemaServer (the serve.ts factory) with real actions
// on a dynamic port. Proves the full pipeline over HTTP:
// workspace.open → graph.summary → graph.search → markdown.read

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createSchemaServer } from "../mcp/serve.ts";
import type { Server } from "node:http";

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
const FIXTURE_URI = `file://${FIXTURE_PATH}`;

let baseUrl: string;
let transport: { listen(): Promise<void>; close(): Promise<void>; server: Server };

async function rpc(method: string, params?: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const json = await rpc("tools/call", { name, arguments: args });
  const result = json["result"] as { content: { text: string }[]; isError: boolean };
  const parsed = JSON.parse(result.content[0]!.text);
  if (!parsed.ok) throw new Error(`${parsed.code}: ${parsed.message}`);
  return parsed.data as T;
}

before(async () => {
  const server = createSchemaServer({ port: 0 });
  transport = server.transport;
  await transport.listen();
  const addr = transport.server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await transport.close();
});

describe("serve integration — full pipeline over HTTP", () => {
  it("tools/list reports all 51 registered actions", async () => {
    // Step 1 added `caching.stats`: 48 → 49.
    // Step 5a added `workspace.watch_start` + `workspace.watch_stop`: 49 → 51.
    const json = await rpc("tools/list");
    const result = json["result"] as { tools: { name: string }[] };
    assert.equal(result.tools.length, 54);
    const names = result.tools.map((t) => t.name).sort();
    assert.ok(names.includes("workspace.open"));
    assert.ok(names.includes("workspace.list_files"));
    assert.ok(names.includes("workspace.read_file"));
    assert.ok(names.includes("workspace.write_file"));
    assert.ok(names.includes("workspace.watch_start"));
    assert.ok(names.includes("workspace.watch_stop"));
    assert.ok(names.includes("graph.summary"));
    assert.ok(names.includes("graph.search"));
    assert.ok(names.includes("markdown.read"));
    assert.ok(names.includes("rules.list"));
    assert.ok(names.includes("rules.evaluate"));
    assert.ok(names.includes("rules.add"));
    assert.ok(names.includes("ops.list"));
    assert.ok(names.includes("ops.preview"));
    assert.ok(names.includes("plan.propose"));
    assert.ok(names.includes("plan.apply"));
    assert.ok(names.includes("tests.run"));
    assert.ok(names.includes("samplers.list"));
    assert.ok(names.includes("graph.query"));
    assert.ok(names.includes("agents_md.read"));
    assert.ok(names.includes("agents_md.write_facts"));
    assert.ok(names.includes("skills.list"));
    assert.ok(names.includes("canon.search"));
    assert.ok(names.includes("canon.read"));
  });

  it("workspace.open → graph.summary → graph.search → markdown.read round-trip", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    assert.ok(openData.sessionId.startsWith("sess_"));
    const sid = openData.sessionId;

    const summary = await callTool<{
      totalNodes: number;
      totalEdges: number;
      markdownUri: string;
    }>("graph.summary", { sessionId: sid });
    assert.ok(summary.totalNodes >= 5, `Expected >= 5 nodes, got ${summary.totalNodes}`);
    assert.ok(summary.totalEdges >= 1);
    assert.ok(summary.markdownUri.startsWith("markdown://graph.summary/"));

    const search = await callTool<{
      hits: { id: string; score: number; why: string }[];
    }>("graph.search", { sessionId: sid, query: "store" });
    assert.ok(search.hits.length >= 1, "Expected at least 1 search hit for 'store'");

    const md = await callTool<{ markdown: string; charset: string }>(
      "markdown.read",
      { sessionId: sid, uri: summary.markdownUri },
    );
    assert.ok(md.markdown.includes("# Graph Summary"));
    assert.equal(md.charset, "utf-8");

    await callTool("workspace.close", { sessionId: sid });
  });

  it("calling graph actions on an unknown session returns an error over HTTP", async () => {
    const json = await rpc("tools/call", {
      name: "graph.summary",
      arguments: { sessionId: "sess_nonexistent" },
    });
    const result = json["result"] as { content: { text: string }[]; isError: boolean };
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "session-not-found");
  });

  it("workspace.open → graph.list_nodes → graph.get_node round-trip", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    const sid = openData.sessionId;

    const listData = await callTool<{ nodes: { id: string; name: string }[] }>(
      "graph.list_nodes",
      { sessionId: sid, filter: {} },
    );
    assert.ok(listData.nodes.length >= 5);

    const nodeId = listData.nodes[0]!.id;
    const nodeData = await callTool<{ node: { id: string; name: string } }>(
      "graph.get_node",
      { sessionId: sid, id: nodeId },
    );
    assert.equal(nodeData.node.id, nodeId);

    await callTool("workspace.close", { sessionId: sid });
  });

  it("workspace.open → graph.find_callees → graph.path round-trip", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    const sid = openData.sessionId;

    const listData = await callTool<{ nodes: { id: string }[] }>(
      "graph.list_nodes",
      { sessionId: sid, filter: {} },
    );
    const firstNode = listData.nodes[0]!;

    const calleesData = await callTool<{
      callees: { id: string; viaEdge: string }[];
      truncated: boolean;
    }>("graph.find_callees", { sessionId: sid, symbolId: firstNode.id });
    assert.ok(Array.isArray(calleesData.callees));

    const pathData = await callTool<{
      paths: { id: string }[][];
      allEdgesByPath: object[][];
    }>("graph.path", { sessionId: sid, from: firstNode.id, to: firstNode.id });
    assert.equal(pathData.paths.length, 1);
    assert.equal(pathData.paths[0]!.length, 1);

    await callTool("workspace.close", { sessionId: sid });
  });

  it("graph.diff_against returns stub with markdownUri over HTTP", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    const sid = openData.sessionId;

    const diffData = await callTool<{
      graphDelta: object;
      markdownUri: string;
    }>("graph.diff_against", { sessionId: sid, ref: "HEAD" });
    assert.ok(diffData.markdownUri.startsWith("markdown://graph.diff_against/"));
    assert.ok(diffData.graphDelta);

    await callTool("workspace.close", { sessionId: sid });
  });

  it("graph.summarize returns summary + smells over HTTP", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    const sid = openData.sessionId;

    const summarizeData = await callTool<{
      summary: string;
      edgeStats: { total: number };
      clusterStats: object[];
      topSmells: object[];
      markdownUri: string;
    }>("graph.summarize", { sessionId: sid });
    assert.ok(summarizeData.summary.includes("Architecture Summary"));
    assert.ok(summarizeData.edgeStats.total >= 1);
    assert.ok(summarizeData.markdownUri.startsWith("markdown://graph.summarize/"));

    await callTool("workspace.close", { sessionId: sid });
  });

  it("SSE events endpoint returns 404 for non-existent session", async () => {
    const res = await fetch(`${baseUrl}/mcp/events/sess_bogus`);
    assert.equal(res.status, 404);
  });

  it("workspace.list_files returns files over HTTP", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    const sid = openData.sessionId;

    const listData = await callTool<{ files: { name: string; relativePath: string }[] }>(
      "workspace.list_files",
      { sessionId: sid },
    );
    assert.ok(listData.files.length > 0, "should return files");
    assert.ok(listData.files.some((f) => f.name === "app.ts"), "should include app.ts");

    await callTool("workspace.close", { sessionId: sid });
  });

  it("workspace.read_file reads a file over HTTP", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    const sid = openData.sessionId;

    const readData = await callTool<{ content: string; path: string }>(
      "workspace.read_file",
      { sessionId: sid, path: `${FIXTURE_PATH}/app.ts` },
    );
    assert.ok(readData.content.length > 0, "content should not be empty");
    assert.ok(readData.path.endsWith("app.ts"));

    await callTool("workspace.close", { sessionId: sid });
  });

  it("workspace.read_file rejects paths outside allow-list over HTTP", async () => {
    const openData = await callTool<{ sessionId: string }>(
      "workspace.open",
      { uris: [FIXTURE_URI] },
    );
    const sid = openData.sessionId;

    const json = await rpc("tools/call", {
      name: "workspace.read_file",
      arguments: { sessionId: sid, path: "/etc/passwd" },
    });
    const content = JSON.parse((json.result as { content: { text: string }[] }).content[0]!.text);
    assert.equal(content.ok, false);
    assert.equal(content.code, "access-denied");

    await callTool("workspace.close", { sessionId: sid });
  });
});

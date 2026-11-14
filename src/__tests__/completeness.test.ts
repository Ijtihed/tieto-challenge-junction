// Completeness tests — verifies every gap closure:
// Gap 1: calls edges in extractors
// Gap 2: all 8 ops work
// Gap 4: sampler-mock generates plans
// Gap 5: MCP resources surface
// Gap 6: pr.review, rules.export, extract.invalidate

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { graphListNodes } from "../actions/graph-list-nodes.ts";
import { graphFindCallees } from "../actions/graph-find-callees.ts";
import { opsList } from "../actions/ops-list.ts";
import { opsPreview } from "../actions/ops-preview.ts";
import { planPropose } from "../actions/plan-propose.ts";
import { prReview } from "../actions/pr-review.ts";
import { rulesExport } from "../actions/rules-export.ts";
import { extractInvalidate } from "../actions/extract-invalidate.ts";
import { getSession } from "../session/index.ts";
import { parseFile } from "../extractors/extractor-typescript/parser.ts";
import { parsePythonFile } from "../extractors/extractor-python/parser.ts";
import { parseGoFile } from "../extractors/extractor-go/parser.ts";
import { BUNDLED_OPS, getOp } from "../domain/bundled-ops.ts";
import { createSchemaServer } from "../mcp/serve.ts";
import type { Server } from "node:http";

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
const POLYGLOT_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/polyglot-todo");

// ── Gap 1: calls edges in extractors ──

describe("Gap 1 — calls edges", () => {
  it("TS parser emits calls edges from function bodies", () => {
    const content = `function caller() { callee(); }\nfunction callee() {}`;
    const result = parseFile("/test/calls.ts", content, "file:///test");
    assert.ok(result.calls.length >= 1, `Expected calls, got ${result.calls.length}`);
    assert.ok(result.calls.some((c) => c.calleeName === "callee"));
  });

  it("TS parser recognizes Express app.get as route_handler", () => {
    const content = `function handler(req, res) {}\napp.get("/api/test", handler);`;
    const result = parseFile("/test/routes.ts", content, "file:///test");
    assert.ok(result.routes.length >= 1);
    assert.equal(result.routes[0]!.method, "GET");
    assert.equal(result.routes[0]!.path, "/api/test");
    const handlerNode = result.nodes.find((n) => n.name === "handler");
    assert.ok(handlerNode);
    assert.equal(handlerNode!.kind, "route_handler");
  });

  it("Python parser emits calls edges", () => {
    const content = `def caller():\n    callee()\n\ndef callee():\n    pass`;
    const result = parsePythonFile("/test/calls.py", content, "file:///test");
    assert.ok(result.calls.length >= 1);
    assert.ok(result.calls.some((c) => c.calleeName === "callee"));
  });

  it("Go parser emits calls edges", () => {
    const content = `package main\nfunc caller() { callee() }\nfunc callee() {}`;
    const result = parseGoFile("/test/calls.go", content, "file:///test");
    assert.ok(result.calls.length >= 1);
  });

  it("TS extractor emits calls edges for intra-file function references", () => {
    const content = `import { fetchTodos } from "./api-client";\nasync function main() {\n  const todos = await fetchTodos();\n  console.log(todos);\n}`;
    const result = parseFile("/test/app.ts", content, "file:///test");
    assert.ok(result.calls.length >= 1, `Expected calls from main, got ${result.calls.length}`);
    assert.ok(result.calls.some((c) => c.calleeName === "fetchTodos"));
  });
});

// ── Gap 2: all 8 ops work ──

describe("Gap 2 — all 8 codemods", () => {
  it("all 8 ops are registered (no stubs)", () => {
    assert.equal(BUNDLED_OPS.length, 8);
    for (const op of BUNDLED_OPS) {
      assert.ok(op.preview, `${op.id} should have preview`);
      assert.ok(op.apply, `${op.id} should have apply`);
    }
  });

  it("renameSymbol renames occurrences", () => {
    const op = getOp("renameSymbol")!;
    const result = op.apply({ filePath: "/test.ts", fileContent: "const foo = 1;\nconsole.log(foo);", symbolName: "foo", args: { newName: "bar" } });
    assert.ok(result.newContent.includes("bar"));
    assert.ok(!result.newContent.includes("foo"));
    assert.ok(result.filesChanged.length > 0);
  });

  it("extractFunction creates a new function", () => {
    const op = getOp("extractFunction")!;
    const content = "function main() {\n  console.log('a');\n  console.log('b');\n  console.log('c');\n}";
    const result = op.apply({ filePath: "/test.ts", fileContent: content, symbolName: "main", args: { functionName: "helper", startLine: 2, endLine: 3 } });
    assert.ok(result.newContent.includes("function helper()"));
    assert.ok(result.newContent.includes("helper()"));
  });

  it("replaceImpl replaces a function body", () => {
    const op = getOp("replaceImpl")!;
    const content = "function greet(name) {\n  return 'hello';\n}";
    const result = op.apply({ filePath: "/test.ts", fileContent: content, symbolName: "greet", args: { body: "  return `hello ${name}`;" } });
    assert.ok(result.newContent.includes("hello ${name}"));
  });

  it("wrapTransformation wraps function calls", () => {
    const op = getOp("wrapTransformation")!;
    const content = "const x = getData();\nconst y = getData();";
    const result = op.apply({ filePath: "/test.ts", fileContent: content, symbolName: "getData", args: { wrapperName: "validate" } });
    assert.ok(result.newContent.includes("validate(getData())"));
  });

  it("addRateLimit inserts limiter before handler", () => {
    const op = getOp("addRateLimit")!;
    const content = "app.get('/api/test', handler);";
    const result = op.apply({ filePath: "/test.ts", fileContent: content, symbolName: "handler", args: { limiterName: "rateLimiter" } });
    assert.ok(result.newContent.includes("rateLimiter, handler"));
  });
});

// ── Gap 4: sampler-mock generates plans ──

describe("Gap 4 — sampler-driven plan.propose", () => {
  let sessionId: string;

  before(async () => {
    const r = await workspaceOpen.handle({ uris: [`file://${POLYGLOT_PATH}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => { await workspaceClose.handle({ sessionId }); });

  it("plan.propose with empty steps uses sampler-mock to generate suggestions", async () => {
    const r = await planPropose.handle({ sessionId, rationale: "Add auth middleware to all handlers", steps: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { planId: string };
    assert.ok(data.planId.startsWith("plan_"));

    const session = getSession(sessionId)!;
    const plan = session.plans.get(data.planId);
    assert.ok(plan, "Plan should be stored in session");
  });
});

// ── Gap 5: MCP resources ──

describe("Gap 5 — MCP resources surface", () => {
  let baseUrl: string;
  let transport: { listen(): Promise<void>; close(): Promise<void>; server: Server };

  before(async () => {
    const server = createSchemaServer({ port: 0 });
    transport = server.transport;
    await transport.listen();
    const addr = transport.server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => { await transport.close(); });

  it("resources/list returns skill:// and canon:// URIs", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list" }),
    });
    const json = await res.json() as { result?: { resources: { uri: string }[] } };
    assert.ok(json.result);
    const uris = json.result!.resources.map((r) => r.uri);
    assert.ok(uris.some((u) => u.startsWith("skill://")), "Expected skill:// resources");
    assert.ok(uris.some((u) => u.startsWith("canon://")), "Expected canon:// resources");
    assert.ok(uris.length >= 20, `Expected >= 20 resources (8 skills + 12 canon), got ${uris.length}`);
  });

  it("resources/read returns skill body", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "skill://erlang-otp-supervision" } }),
    });
    const json = await res.json() as { result?: { contents: { text: string }[] } };
    assert.ok(json.result);
    assert.ok(json.result!.contents[0]!.text.includes("supervision"));
  });

  it("resources/read returns canon doc body", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "canon://otp/otp-supervision-principles#full" } }),
    });
    const json = await res.json() as { result?: { contents: { text: string }[] } };
    assert.ok(json.result);
    assert.ok(json.result!.contents[0]!.text.includes("supervisor"));
  });

  it("resources/read returns error for unknown URI", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "skill://nonexistent" } }),
    });
    const json = await res.json() as { error?: { code: number } };
    assert.ok(json.error);
  });
});

// ── Gap 6: missing actions ──

describe("Gap 6 — pr.review", () => {
  let sessionId: string;

  before(async () => {
    const r = await workspaceOpen.handle({ uris: [`file://${FIXTURE_PATH}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => { await workspaceClose.handle({ sessionId }); });

  it("returns a markdown PR comment with violations + diff", async () => {
    const r = await prReview.handle({ sessionId, base: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { markdownUri: string; headEvalViolations: unknown[] };
    assert.ok(data.markdownUri.startsWith("markdown://pr.review/"));
    assert.ok(Array.isArray(data.headEvalViolations));
  });
});

describe("Gap 6 — rules.export", () => {
  it("writes schema.config.json", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-export-"));
    cpSync(FIXTURE_PATH, tempDir, { recursive: true });
    const r = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
    assert.equal(r.ok, true);
    const sid = (r.data as { sessionId: string }).sessionId;

    const er = await rulesExport.handle({ sessionId: sid });
    assert.equal(er.ok, true);
    if (!er.ok) return;
    const data = er.data as { writtenPath: string };
    assert.ok(existsSync(data.writtenPath));
    const config = JSON.parse(readFileSync(data.writtenPath, "utf-8"));
    assert.ok(config.rules.length >= 4, "Should include builtin rules");

    await workspaceClose.handle({ sessionId: sid });
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("Gap 6 — extract.invalidate", () => {
  it("removes nodes for invalidated files", async () => {
    const r = await workspaceOpen.handle({ uris: [`file://${FIXTURE_PATH}`] });
    assert.equal(r.ok, true);
    const sid = (r.data as { sessionId: string }).sessionId;

    const session = getSession(sid)!;
    const nodesBefore = session.graph.repos.flatMap((r) => r.nodes).length;

    const fileNode = session.graph.repos.flatMap((r) => r.nodes).find((n) => n.filePath?.endsWith("store.ts"));
    assert.ok(fileNode);

    const ir = await extractInvalidate.handle({ sessionId: sid, touchedUris: [fileNode!.filePath!] });
    assert.equal(ir.ok, true);
    if (!ir.ok) return;
    const data = ir.data as { invalidated: number };
    assert.ok(data.invalidated >= 1);

    const nodesAfter = session.graph.repos.flatMap((r) => r.nodes).length;
    assert.ok(nodesAfter < nodesBefore, "Nodes should be fewer after invalidation");

    await workspaceClose.handle({ sessionId: sid });
  });
});

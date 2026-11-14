// Phase 7 gate — polyglot extractors + REST bridge.
//
// Proves: Python extractor recognises FastAPI routes, Go extractor
// recognises net/http handlers, the REST bridge emits
// implements_contract + consumes_contract edges between the TS
// frontend's fetch() calls and the Python backend's routes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { graphSummary } from "../actions/graph-summary.ts";
import { graphListNodes } from "../actions/graph-list-nodes.ts";
import { graphSearch } from "../actions/graph-search.ts";
import { getSession } from "../session/index.ts";
import { parsePythonFile } from "../extractors/extractor-python/parser.ts";
import { parseGoFile } from "../extractors/extractor-go/parser.ts";
import { detectGrpcImpls, buildGrpcBridgeEdges } from "../domain/bridge-grpc.ts";
import { detectOrmModels, buildSqlBridgeEdges } from "../domain/bridge-sql.ts";
import type { GraphNode, RepoSubgraph } from "../domain/multi-repo.ts";

const POLYGLOT_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/polyglot-todo");
const POLYGLOT_URI = `file://${POLYGLOT_PATH}`;

// ── Python parser unit tests ──

describe("extractor-python/parser", () => {
  const PY_FIXTURE = resolve(POLYGLOT_PATH, "backend-python/main.py");

  it("extracts file-level node", () => {
    const content = `def foo():\n    pass`;
    const result = parsePythonFile("/test/foo.py", content, "file:///test");
    assert.ok(result.nodes.some((n) => n.name === "foo.py"));
  });

  it("extracts function definitions", () => {
    const content = `def hello():\n    return "hi"\n\ndef world():\n    return "world"`;
    const result = parsePythonFile("/test/funcs.py", content, "file:///test");
    assert.ok(result.nodes.some((n) => n.name === "hello"));
    assert.ok(result.nodes.some((n) => n.name === "world"));
  });

  it("recognises FastAPI @app.get decorator as route_handler", () => {
    const content = `from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/api/items")\ndef list_items():\n    return []`;
    const result = parsePythonFile("/test/routes.py", content, "file:///test");
    const handler = result.nodes.find((n) => n.name === "list_items");
    assert.ok(handler, "Expected list_items node");
    assert.equal(handler!.kind, "route_handler");
  });

  it("captures route info from @app.get/post decorators", () => {
    const content = `from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/api/todos")\ndef list_todos():\n    return []\n\n@app.post("/api/todos")\ndef create_todo():\n    pass`;
    const result = parsePythonFile("/test/routes.py", content, "file:///test");
    assert.equal(result.routes.length, 2);
    assert.ok(result.routes.some((r) => r.method === "GET" && r.path === "/api/todos"));
    assert.ok(result.routes.some((r) => r.method === "POST" && r.path === "/api/todos"));
  });

  it("extracts class definitions as model nodes", () => {
    const content = `class TodoItem:\n    title: str\n    done: bool = False`;
    const result = parsePythonFile("/test/models.py", content, "file:///test");
    const model = result.nodes.find((n) => n.name === "TodoItem");
    assert.ok(model, "Expected TodoItem node");
    assert.equal(model!.kind, "model");
  });

  it("handles files with no functions", () => {
    const content = `# just a comment\nx = 42`;
    const result = parsePythonFile("/test/empty.py", content, "file:///test");
    assert.equal(result.nodes.length, 1);
  });
});

// ── Go parser unit tests ──

describe("extractor-go/parser", () => {
  it("extracts file-level node", () => {
    const content = `package main`;
    const result = parseGoFile("/test/main.go", content, "file:///test");
    assert.ok(result.nodes.some((n) => n.name === "main.go"));
  });

  it("extracts function declarations", () => {
    const content = `package main\n\nfunc Hello() {}\nfunc World() {}`;
    const result = parseGoFile("/test/funcs.go", content, "file:///test");
    assert.ok(result.nodes.some((n) => n.name === "Hello"));
    assert.ok(result.nodes.some((n) => n.name === "World"));
  });

  it("recognises http.HandleFunc as route_handler", () => {
    const content = `package main\n\nimport "net/http"\n\nfunc listItems(w http.ResponseWriter, r *http.Request) {}\n\nfunc main() {\n\thttp.HandleFunc("/api/items", listItems)\n}`;
    const result = parseGoFile("/test/server.go", content, "file:///test");
    const handler = result.nodes.find((n) => n.name === "listItems");
    assert.ok(handler, "Expected listItems node");
    assert.equal(handler!.kind, "route_handler");
  });

  it("captures route info from HandleFunc", () => {
    const content = `package main\nimport "net/http"\nfunc handler(w http.ResponseWriter, r *http.Request) {}\nfunc main() {\n\thttp.HandleFunc("/api/todos", handler)\n}`;
    const result = parseGoFile("/test/server.go", content, "file:///test");
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0]!.path, "/api/todos");
    assert.equal(result.routes[0]!.handlerName, "handler");
  });

  it("extracts struct types as model nodes", () => {
    const content = `package main\n\ntype Todo struct {\n\tID int\n\tTitle string\n}`;
    const result = parseGoFile("/test/types.go", content, "file:///test");
    const model = result.nodes.find((n) => n.name === "Todo");
    assert.ok(model, "Expected Todo struct node");
    assert.equal(model!.kind, "model");
  });

  it("extracts method declarations with receiver", () => {
    const content = `package main\n\ntype Svc struct{}\n\nfunc (s *Svc) Handle() {}`;
    const result = parseGoFile("/test/svc.go", content, "file:///test");
    assert.ok(result.nodes.some((n) => n.name === "Svc.Handle"));
  });
});

// ── Polyglot workspace e2e ──

describe("Phase 7 gate — polyglot workspace + REST bridge", () => {
  let sessionId: string;

  before(async () => {
    const result = await workspaceOpen.handle({ uris: [POLYGLOT_URI] });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("open failed");
    sessionId = (result.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
  });

  it("extracts nodes from TS, Python, and Go files", async () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const filePaths = allNodes.map((n) => n.filePath).filter(Boolean);

    const hasTsFiles = filePaths.some((f) => f!.endsWith(".ts"));
    const hasPyFiles = filePaths.some((f) => f!.endsWith(".py"));
    const hasGoFiles = filePaths.some((f) => f!.endsWith(".go"));

    assert.ok(hasTsFiles, "Expected TypeScript files extracted");
    assert.ok(hasPyFiles, "Expected Python files extracted");
    assert.ok(hasGoFiles, "Expected Go files extracted");
  });

  it("extracts route_handler nodes from Python FastAPI decorators", async () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const handlers = allNodes.filter((n) => n.kind === "route_handler");

    assert.ok(handlers.length >= 3, `Expected >= 3 route handlers (3 FastAPI + Go), got ${handlers.length}`);
    assert.ok(handlers.some((h) => h.name === "list_todos"), "Expected list_todos handler");
    assert.ok(handlers.some((h) => h.name === "create_todo"), "Expected create_todo handler");
  });

  it("extracts model nodes from Python dataclasses", async () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const models = allNodes.filter((n) => n.kind === "model");

    assert.ok(models.length >= 2, `Expected >= 2 model nodes, got ${models.length}`);
  });

  it("generates contract nodes from the REST bridge", async () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const contracts = allNodes.filter((n) => n.kind === "contract");

    assert.ok(contracts.length >= 1, `Expected >= 1 contract node from REST bridge, got ${contracts.length}`);
    assert.ok(contracts.some((c) => c.name.includes("/api/todos")), "Expected a contract node for /api/todos");
  });

  it("emits consumes_contract edges from TS fetch() to REST contract", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const consumesEdges = allEdges.filter((e) => e.relation === "consumes_contract");

    assert.ok(consumesEdges.length >= 1, `Expected >= 1 consumes_contract edge, got ${consumesEdges.length}`);
  });

  it("emits implements_contract edges from Python handler to REST contract", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap((r) => r.edges);
    const implementsEdges = allEdges.filter((e) => e.relation === "implements_contract");

    assert.ok(implementsEdges.length >= 1, `Expected >= 1 implements_contract edge, got ${implementsEdges.length}`);
  });

  it("graph.summary reports nodes from all 3 languages", async () => {
    const r = await graphSummary.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { totalNodes: number; totalEdges: number };
    assert.ok(data.totalNodes >= 10, `Expected >= 10 nodes across 3 languages, got ${data.totalNodes}`);
  });

  it("graph.search finds Python handler by name", async () => {
    const r = await graphSearch.handle({ sessionId, query: "list_todos" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: { id: string; score: number }[] };
    assert.ok(data.hits.length >= 1, "Expected to find list_todos by search");
  });

  it("workspace.describe reports python and go languages", async () => {
    const session = getSession(sessionId)!;
    const graph = session.graph;
    const allNodes = graph.repos.flatMap((r) => r.nodes);
    const extensions = new Set(allNodes.map((n) => n.filePath?.split(".").pop()).filter(Boolean));
    assert.ok(extensions.has("py"), "Expected .py files");
    assert.ok(extensions.has("go"), "Expected .go files");
    assert.ok(extensions.has("ts"), "Expected .ts files");
  });
});

// ── gRPC bridge unit tests ──

describe("bridge-grpc — unit tests", () => {
  it("detects Go gRPC server implementations (UnimplementedXxxServer)", () => {
    const repo: RepoSubgraph = {
      uri: "file:///test",
      nodes: [
        { id: "n1", kind: "service", name: "UnimplementedGreeterServer", locator: "file:///test#UnimplementedGreeterServer", filePath: "/test/server.go" },
        { id: "n2", kind: "utility", name: "main", locator: "file:///test#main", filePath: "/test/main.go" },
      ],
      edges: [],
      clusters: [],
    };
    const impls = detectGrpcImpls([repo]);
    assert.equal(impls.length, 1);
    assert.equal(impls[0]!.serviceName, "Greeter");
  });

  it("detects Java gRPC server implementations (XxxGrpc)", () => {
    const repo: RepoSubgraph = {
      uri: "file:///test",
      nodes: [
        { id: "j1", kind: "service", name: "HelloGrpc", locator: "file:///test#HelloGrpc", filePath: "/test/HelloGrpc.java" },
      ],
      edges: [],
      clusters: [],
    };
    const impls = detectGrpcImpls([repo]);
    assert.equal(impls.length, 1);
    assert.equal(impls[0]!.serviceName, "Hello");
  });

  it("builds implements_contract edges from impl to proto contract", () => {
    const protoNodes: GraphNode[] = [
      { id: "c1", kind: "contract", name: "proto:Greeter", locator: "proto://proto:Greeter" },
      { id: "c2", kind: "contract", name: "proto:rpc:SayHello", locator: "proto://proto:rpc:SayHello" },
    ];
    const impls = [{ serviceName: "Greeter", nodeId: "n1", repoUri: "file:///test" }];
    const result = buildGrpcBridgeEdges(protoNodes, impls);
    assert.equal(result.bridgeEdges.length, 1);
    assert.equal(result.bridgeEdges[0]!.source, "n1");
    assert.equal(result.bridgeEdges[0]!.target, "c1");
    assert.equal(result.bridgeEdges[0]!.relation, "implements_contract");
  });

  it("handles no matches gracefully", () => {
    const protoNodes: GraphNode[] = [
      { id: "c1", kind: "contract", name: "proto:Unrelated", locator: "proto://proto:Unrelated" },
    ];
    const impls = [{ serviceName: "Greeter", nodeId: "n1", repoUri: "file:///test" }];
    const result = buildGrpcBridgeEdges(protoNodes, impls);
    assert.equal(result.bridgeEdges.length, 0);
  });
});

// ── SQL bridge unit tests ──

describe("bridge-sql — unit tests", () => {
  it("infers table name from model class name", () => {
    const repo: RepoSubgraph = {
      uri: "file:///test",
      nodes: [
        { id: "m1", kind: "model", name: "UserModel", locator: "file:///test#UserModel", filePath: "/test/models.py" },
      ],
      edges: [],
      clusters: [],
    };
    const models = detectOrmModels([repo]);
    assert.equal(models.length, 1);
    assert.equal(models[0]!.tableName, "users");
  });

  it("builds consumes_contract edges from ORM model to sql:table", () => {
    const tableNodes: GraphNode[] = [
      { id: "t1", kind: "contract", name: "sql:table:users", locator: "sql://sql:table:users" },
    ];
    const models = [{ tableName: "users", nodeId: "m1", repoUri: "file:///test" }];
    const result = buildSqlBridgeEdges(tableNodes, models);
    assert.equal(result.bridgeEdges.length, 1);
    assert.equal(result.bridgeEdges[0]!.source, "m1");
    assert.equal(result.bridgeEdges[0]!.target, "t1");
    assert.equal(result.bridgeEdges[0]!.relation, "consumes_contract");
  });

  it("handles case-insensitive table name matching", () => {
    const tableNodes: GraphNode[] = [
      { id: "t1", kind: "contract", name: "sql:table:Orders", locator: "sql://sql:table:Orders" },
    ];
    const models = [{ tableName: "orders", nodeId: "m1", repoUri: "file:///test" }];
    const result = buildSqlBridgeEdges(tableNodes, models);
    assert.equal(result.bridgeEdges.length, 1);
  });

  it("handles no matches gracefully", () => {
    const tableNodes: GraphNode[] = [
      { id: "t1", kind: "contract", name: "sql:table:products", locator: "sql://sql:table:products" },
    ];
    const models = [{ tableName: "users", nodeId: "m1", repoUri: "file:///test" }];
    const result = buildSqlBridgeEdges(tableNodes, models);
    assert.equal(result.bridgeEdges.length, 0);
  });

  it("handles empty inputs", () => {
    assert.equal(buildSqlBridgeEdges([], []).bridgeEdges.length, 0);
    assert.equal(detectOrmModels([]).length, 0);
  });
});

// Per architecture/v1-readiness.md — invariant tests verifying the claims
// in the readiness doc. If any of these fail, the readiness doc is lying.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { graphFindCallees } from "../actions/graph-find-callees.ts";
import { getSession } from "../session/index.ts";
import { createSchemaServer } from "../mcp/serve.ts";
import { BUNDLED_SKILLS } from "../wisdom/skills/index.ts";
import { CANON_DOCS } from "../wisdom/canon/index.ts";
import { parseGitignore, isIgnored, ALWAYS_IGNORED } from "../actions/workspace-list-files.ts";

const POLYGLOT_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/polyglot-todo");
const POLYGLOT_URI = `file://${POLYGLOT_PATH}`;

// ── Invariant 1: action count ──

describe("v1-readiness invariant: action count", () => {
  // Step 1: 48 baseline + `caching.stats` = 49.
  // Step 5a: + `workspace.watch_start` + `workspace.watch_stop` = 51.
  // Step 9a: + `drift.generate` = 52.
  // Step 7b: + `graph.entry_points` = 54.
  // Tieto challenge: + trust.*, agent.*, issues.*, repo.* and related actions = 72.
  it("server registers exactly 72 active actions", () => {
    const { dispatcher } = createSchemaServer({ port: 0 });
    const tools = dispatcher.listTools();
    assert.equal(tools.tools.length, 72,
      `Expected 72 actions but got ${tools.tools.length}: ${tools.tools.map(t => t.name).join(", ")}`);

  });
});

// ── Invariant 2: skill count ──

describe("v1-readiness invariant: skill count", () => {
  it("bundles exactly 9 skills (5 procedural + 4 paradigm)", () => {
    assert.equal(BUNDLED_SKILLS.length, 9);
    const procedural = BUNDLED_SKILLS.filter(s => s.type === "procedural");
    const paradigm = BUNDLED_SKILLS.filter(s => s.type === "paradigm");
    assert.equal(procedural.length, 5);
    assert.equal(paradigm.length, 4);
  });

  it("includes the Claude Code workflow skill", () => {
    const claude = BUNDLED_SKILLS.find(s => s.id === "claude-code-schema-workflow");
    assert.ok(claude, "claude-code-schema-workflow should exist");
    assert.equal(claude!.type, "procedural");
  });
});

// ── Invariant 3: canon count ──

describe("v1-readiness invariant: canon count", () => {
  it("has at least 60 canon docs", () => {
    assert.ok(CANON_DOCS.length >= 60, `Expected ≥60 canon docs, got ${CANON_DOCS.length}`);
  });
});

// ── Invariant 4: extractor count ──

describe("v1-readiness invariant: extractor count", () => {
  it("workspace.open reports 8 extractors", async () => {
    const r = await workspaceOpen.handle({ uris: [POLYGLOT_URI] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { sessionId: string; workspace: { extractors: { id: string }[] } };
    assert.equal(data.workspace.extractors.length, 8,
      `Expected 8 extractors, got ${data.workspace.extractors.length}: ${data.workspace.extractors.map(e => e.id).join(", ")}`);
    await workspaceClose.handle({ sessionId: data.sessionId });
  });
});

// ── Invariant 5: bridges produce edges on real fixture ──

describe("v1-readiness invariant: bridges produce contract nodes", () => {
  let sessionId: string;

  before(async () => {
    const r = await workspaceOpen.handle({ uris: [POLYGLOT_URI] });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("open failed");
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
  });

  it("extracts proto contract nodes from todo.proto", () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap(r => r.nodes);
    const protoNodes = allNodes.filter(n => n.locator.startsWith("proto://"));
    assert.ok(protoNodes.length >= 1, `Expected proto contract nodes, got ${protoNodes.length}`);
  });

  it("extracts SQL table contract nodes from schema.sql", () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap(r => r.nodes);
    const sqlNodes = allNodes.filter(n => n.locator.startsWith("sql://"));
    assert.ok(sqlNodes.length >= 1, `Expected sql contract nodes, got ${sqlNodes.length}`);
    const tableNames = sqlNodes.map(n => n.name);
    assert.ok(tableNames.some(n => n.includes("todos")), "should have a todos table");
    assert.ok(tableNames.some(n => n.includes("users")), "should have a users table");
  });

  it("REST bridge produces contract nodes from Python routes", () => {
    const session = getSession(sessionId)!;
    const allNodes = session.graph.repos.flatMap(r => r.nodes);
    const restNodes = allNodes.filter(n => n.locator.startsWith("rest://"));
    assert.ok(restNodes.length >= 1, `Expected REST contract nodes, got ${restNodes.length}`);
  });

  it("graph.find_callees returns edges with relation field", async () => {
    const session = getSession(sessionId)!;
    const allEdges = session.graph.repos.flatMap(r => r.edges);
    if (allEdges.length === 0) return;

    const nodeWithEdges = allEdges[0]!.source;
    const r = await graphFindCallees.handle({ sessionId, symbolId: nodeWithEdges });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { callees: { id: string; relation: string }[] };
    if (data.callees.length === 0) return;
    assert.ok(typeof data.callees[0]!.relation === "string");
    assert.ok(data.callees[0]!.relation.length > 0);
  });
});

// ── Invariant 6: gitignore parser ──

describe("gitignore parser", () => {
  it("parses basic patterns", () => {
    const rules = parseGitignore("*.log\nbuild/\n# comment\n");
    assert.equal(rules.length, 2);
  });

  it("ignores matching files", () => {
    const rules = parseGitignore("*.log\nbuild/\n");
    assert.equal(isIgnored("app.log", rules), true);
    assert.equal(isIgnored("src/app.log", rules), true);
    assert.equal(isIgnored("app.ts", rules), false);
  });

  it("handles negation patterns", () => {
    const rules = parseGitignore("*.log\n!important.log\n");
    assert.equal(isIgnored("debug.log", rules), true);
    assert.equal(isIgnored("important.log", rules), false);
  });

  it("handles directory patterns with /", () => {
    const rules = parseGitignore("dist/\n");
    assert.equal(isIgnored("dist/bundle.js", rules), true);
  });

  it("handles globstar patterns", () => {
    const rules = parseGitignore("**/temp/**\n");
    assert.equal(isIgnored("src/temp/file.txt", rules), true);
  });

  it("skips comments and empty lines", () => {
    const rules = parseGitignore("# this is a comment\n\n*.log\n");
    assert.equal(rules.length, 1);
  });

  it("ALWAYS_IGNORED contains node_modules and .git", () => {
    assert.ok(ALWAYS_IGNORED.has("node_modules"));
    assert.ok(ALWAYS_IGNORED.has(".git"));
    assert.ok(ALWAYS_IGNORED.has("__pycache__"));
    assert.ok(ALWAYS_IGNORED.has("dist"));
    assert.ok(ALWAYS_IGNORED.has(".DS_Store"));
  });
});

// ── Invariant 7: all action names follow namespace.verb convention ──

describe("v1-readiness invariant: action naming convention", () => {
  it("every action name contains a dot separator", () => {
    const { dispatcher } = createSchemaServer({ port: 0 });
    const tools = dispatcher.listTools();
    for (const tool of tools.tools) {
      assert.ok(tool.name.includes("."),
        `Action "${tool.name}" should follow namespace.verb convention`);
    }
  });

  it("every action has a non-empty description", () => {
    const { dispatcher } = createSchemaServer({ port: 0 });
    const tools = dispatcher.listTools();
    for (const tool of tools.tools) {
      assert.ok(tool.description.length > 10,
        `Action "${tool.name}" should have a meaningful description`);
    }
  });
});

// Phase 9 hardening — covers untested branches in wisdom layer.
// AGENTS.md: CLAUDE.md fallback, malformed fences, empty graph, custom target.
// Canon: cross-paradigm search, score ordering, all paradigms.
// Skills: body content checks.
// renderFacts: violations rendering, empty graph.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { readAgentsMd, writeFacts, renderFacts } from "../wisdom/agents-md/index.ts";
import { searchCanon, readCanonDoc, CANON_DOCS } from "../wisdom/canon/index.ts";
import { BUNDLED_SKILLS } from "../wisdom/skills/index.ts";
import { createEmptyGraph } from "../domain/multi-repo.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import type { MultiRepoGraph } from "../domain/multi-repo.ts";
import type { Violation } from "../domain/types.ts";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { agentsMdWriteFacts } from "../actions/agents-md-write-facts.ts";
import { canonSearch } from "../actions/canon-search.ts";
import { canonRead } from "../actions/canon-read.ts";

// ── AGENTS.md — direct unit tests ──

describe("readAgentsMd — unit tests", () => {
  it("falls back to CLAUDE.md when AGENTS.md doesn't exist", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-claude-"));
    writeFileSync(resolve(tempDir, "CLAUDE.md"), "# Claude rules\nBe helpful.");
    const result = readAgentsMd(tempDir);
    assert.ok(result);
    assert.ok(result!.writtenPath.endsWith("CLAUDE.md"));
    assert.equal(result!.schemaSection, "");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns AGENTS.md path (not CLAUDE.md) when both exist", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-both-"));
    writeFileSync(resolve(tempDir, "AGENTS.md"), "# Agents\nAgent rules.");
    writeFileSync(resolve(tempDir, "CLAUDE.md"), "# Claude\nClaude rules.");
    const result = readAgentsMd(tempDir);
    assert.ok(result);
    assert.ok(result!.writtenPath.endsWith("AGENTS.md"));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts schema section from existing fence", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-fence-"));
    writeFileSync(resolve(tempDir, "AGENTS.md"),
      "# Project\n\n<!-- schema:facts:start -->\nFact A\nFact B\n<!-- schema:facts:end -->\n\nUser notes.");
    const result = readAgentsMd(tempDir);
    assert.ok(result);
    assert.equal(result!.schemaSection, "Fact A\nFact B");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles fence-start without fence-end (malformed)", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-malformed-"));
    writeFileSync(resolve(tempDir, "AGENTS.md"),
      "# Project\n<!-- schema:facts:start -->\nDangling facts\nNo end fence.");
    const result = readAgentsMd(tempDir);
    assert.ok(result);
    assert.equal(result!.schemaSection, "", "Malformed fence should yield empty schemaSection");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles fence-end before fence-start (reversed)", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-reversed-"));
    writeFileSync(resolve(tempDir, "AGENTS.md"),
      "<!-- schema:facts:end -->\n<!-- schema:facts:start -->\nContent.");
    const result = readAgentsMd(tempDir);
    assert.ok(result);
    assert.equal(result!.schemaSection, "", "Reversed fence markers should yield empty");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns userSection excluding the fence when includeUserSection=true", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-user-"));
    writeFileSync(resolve(tempDir, "AGENTS.md"),
      "# Header\n\nUser text.\n\n<!-- schema:facts:start -->\nFacts\n<!-- schema:facts:end -->\n\nMore user text.");
    const result = readAgentsMd(tempDir, { includeUserSection: true }) as { userSection: string };
    assert.ok(result.userSection.includes("Header"));
    assert.ok(result.userSection.includes("More user text"));
    assert.ok(!result.userSection.includes("schema:facts:start"), "userSection should not contain the fence");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default AGENTS.md path when no file exists", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-empty-"));
    const result = readAgentsMd(tempDir);
    assert.ok(result);
    assert.ok(result!.writtenPath.endsWith("AGENTS.md"));
    assert.equal(result!.schemaSection, "");
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("writeFacts — unit tests", () => {
  it("writes to a custom target path", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-custom-"));
    const result = writeFacts(tempDir, "Custom facts here", "CUSTOM.md");
    assert.ok(result.writtenPath.endsWith("CUSTOM.md"));
    assert.ok(existsSync(result.writtenPath));
    const content = readFileSync(result.writtenPath, "utf-8");
    assert.ok(content.includes("Custom facts here"));
    assert.ok(content.includes("<!-- schema:facts:start -->"));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a new file if it doesn't exist", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-new-"));
    const result = writeFacts(tempDir, "Brand new facts");
    assert.ok(existsSync(result.writtenPath));
    assert.equal(result.charsRemoved, 0);
    assert.ok(result.charsAdded > 0);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("triple write remains idempotent", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-triple-"));
    writeFileSync(resolve(tempDir, "AGENTS.md"), "# Project\n");
    writeFacts(tempDir, "Facts v1");
    writeFacts(tempDir, "Facts v2");
    writeFacts(tempDir, "Facts v3");
    const content = readFileSync(resolve(tempDir, "AGENTS.md"), "utf-8");
    const fenceCount = (content.match(/<!-- schema:facts:start -->/g) || []).length;
    assert.equal(fenceCount, 1, "Triple write should not duplicate fences");
    assert.ok(content.includes("Facts v3"), "Should contain latest facts");
    assert.ok(!content.includes("Facts v1"), "Should not contain old facts");
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("renderFacts — unit tests", () => {
  it("renders empty graph without crashing", () => {
    const graph = createEmptyGraph(CURRENT_WIRE_VERSION);
    const result = renderFacts(graph, []);
    assert.ok(result.includes("**Nodes:** 0"));
    assert.ok(result.includes("**Edges:** 0"));
    assert.ok(result.includes("none detected"));
  });

  it("includes violation details when violations are present", () => {
    const graph = createEmptyGraph(CURRENT_WIRE_VERSION);
    const violations: Violation[] = [
      { ruleId: "test-rule", severity: "error", message: "Something is wrong", nodeIds: [] },
      { ruleId: "test-rule-2", severity: "warn", message: "Minor issue" },
    ];
    const result = renderFacts(graph, violations);
    assert.ok(result.includes("Active violations (2)"));
    assert.ok(result.includes("Something is wrong"));
    assert.ok(result.includes("Minor issue"));
  });

  it("renders node and edge breakdowns from a real graph", () => {
    const graph: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{
        uri: "file:///test",
        nodes: [
          { id: "n1", kind: "utility", name: "app.ts", locator: "file:///test/app.ts", filePath: "/test/app.ts" },
          { id: "n2", kind: "route_handler", name: "getUsers", locator: "file:///test/routes.ts#L1-L5", filePath: "/test/routes.ts" },
        ],
        edges: [{ id: "e1", source: "n1", target: "n2", relation: "imports" }],
        clusters: [],
      }],
      interRepoEdges: [],
    };
    const result = renderFacts(graph, []);
    assert.ok(result.includes("TypeScript"));
    assert.ok(result.includes("utility: 1"));
    assert.ok(result.includes("route_handler: 1"));
    assert.ok(result.includes("imports: 1"));
    assert.ok(result.includes("Route handlers (1)"));
    assert.ok(result.includes("getUsers"));
  });
});

// ── Canon BM25 — edge cases ──

describe("canon BM25 — edge cases", () => {
  it("cross-paradigm search without filter returns results from multiple paradigms", () => {
    const hits = searchCanon(undefined, "concurrency transactions");
    assert.ok(hits.length >= 2);
    const paradigms = new Set(hits.map((h) => h.uri.split("/")[2]));
    assert.ok(paradigms.size >= 2, `Expected hits from multiple paradigms, got: ${[...paradigms]}`);
  });

  it("results are sorted by descending score", () => {
    const hits = searchCanon(undefined, "supervisor restart child process");
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i]!.score <= hits[i - 1]!.score, `Results should be sorted by score desc at index ${i}`);
    }
  });

  it("single-word query returns results", () => {
    const hits = searchCanon(undefined, "consensus");
    assert.ok(hits.length >= 1);
  });

  it("readCanonDoc with valid format but wrong paradigm returns null", () => {
    const result = readCanonDoc("canon://cqrs/otp-supervision-principles#full");
    assert.equal(result, null, "Doc exists under otp, not cqrs");
  });

  it("each paradigm has at least 3 docs", () => {
    for (const p of ["otp", "stm", "cqrs", "distsys"]) {
      const count = CANON_DOCS.filter((d) => d.paradigm === p).length;
      assert.ok(count >= 3, `Paradigm ${p} should have >= 3 docs, got ${count}`);
    }
  });

  it("all paradigms return results for paradigm-specific queries", () => {
    const queries: Record<string, string> = {
      otp: "supervisor",
      stm: "transactional memory",
      cqrs: "event sourcing",
      distsys: "partition",
    };
    for (const [paradigm, query] of Object.entries(queries)) {
      const hits = searchCanon(paradigm, query);
      assert.ok(hits.length >= 1, `Expected hits for ${paradigm}/${query}`);
    }
  });
});

// ── Skills — content verification ──

describe("skills — content verification", () => {
  it("every skill has a non-empty body with markdown structure", () => {
    for (const skill of BUNDLED_SKILLS) {
      assert.ok(skill.body.length > 100, `Skill ${skill.id} body is too short (${skill.body.length} chars)`);
      assert.ok(skill.body.includes("#"), `Skill ${skill.id} body should contain markdown headers`);
    }
  });

  it("procedural skills contain actionable steps", () => {
    const procedural = BUNDLED_SKILLS.filter((s) => s.type === "procedural");
    for (const skill of procedural) {
      assert.ok(skill.body.includes("## ") || skill.body.includes("Steps") || skill.body.includes("When to use"),
        `Procedural skill ${skill.id} should contain structured guidance`);
    }
  });

  it("skill IDs are unique", () => {
    const ids = BUNDLED_SKILLS.map((s) => s.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "Skill IDs must be unique");
  });
});

// ── AGENTS.md write on polyglot fixture ──

describe("agents_md.write_facts — polyglot content", () => {
  let tempDir: string;
  let sessionId: string;

  before(async () => {
    const POLYGLOT_SRC = resolve(import.meta.dirname!, "../../tests/fixtures/polyglot-todo");
    tempDir = mkdtempSync(resolve(tmpdir(), "schema-polyglot-md-"));
    const { cpSync } = await import("node:fs");
    cpSync(POLYGLOT_SRC, tempDir, { recursive: true });
    const r = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("written facts include polyglot language list", async () => {
    await agentsMdWriteFacts.handle({ sessionId });
    const content = readFileSync(resolve(tempDir, "AGENTS.md"), "utf-8");
    assert.ok(content.includes("TypeScript"), "Should mention TypeScript");
    assert.ok(content.includes("Python"), "Should mention Python");
    assert.ok(content.includes("Go"), "Should mention Go");
  });

  it("written facts include route handler count", async () => {
    await agentsMdWriteFacts.handle({ sessionId });
    const content = readFileSync(resolve(tempDir, "AGENTS.md"), "utf-8");
    assert.ok(content.includes("Route handlers"), "Should list route handlers from FastAPI + Go");
  });

  it("written facts include cross-language contracts", async () => {
    await agentsMdWriteFacts.handle({ sessionId });
    const content = readFileSync(resolve(tempDir, "AGENTS.md"), "utf-8");
    assert.ok(content.includes("Cross-language contracts"), "Should show REST bridge contracts");
  });
});

// ── canon.search + canon.read via actions (end-to-end) ──

describe("canon actions — all paradigms e2e", () => {
  let sessionId: string;

  before(async () => {
    const FIXTURE_SRC = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
    const r = await workspaceOpen.handle({ uris: [`file://${FIXTURE_SRC}`] });
    assert.equal(r.ok, true);
    sessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId });
  });

  for (const paradigm of ["otp", "stm", "cqrs", "distsys"]) {
    it(`canon.search returns results for paradigm=${paradigm}`, async () => {
      const r = await canonSearch.handle({ sessionId, paradigm, query: "the" });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      const data = r.data as { hits: { uri: string }[] };
      assert.ok(data.hits.length >= 1, `Expected hits for paradigm=${paradigm}`);
    });
  }

  it("canon.read works for each paradigm", async () => {
    for (const doc of CANON_DOCS.slice(0, 4)) {
      const r = await canonRead.handle({
        sessionId,
        uri: `canon://${doc.paradigm}/${doc.id}#full`,
      });
      assert.equal(r.ok, true, `canon.read failed for ${doc.id}`);
      if (!r.ok) continue;
      const data = r.data as { body: string; metadata: { title: string } };
      assert.ok(data.body.length > 0);
      assert.equal(data.metadata.title, doc.title);
    }
  });
});

// Phase 9 gate tests — wisdom layer.
// Covers: AGENTS.md round-trip (read → write → idempotent re-read),
// skills.list, canon.search + canon.read, samplers.list.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { agentsMdRead } from "../actions/agents-md-read.ts";
import { agentsMdWriteFacts } from "../actions/agents-md-write-facts.ts";
import { skillsList } from "../actions/skills-list.ts";
import { canonSearch } from "../actions/canon-search.ts";
import { canonRead } from "../actions/canon-read.ts";
import { samplersList } from "../actions/samplers-list.ts";
import { markdownRead } from "../actions/markdown-read.ts";
import { getSession } from "../session/index.ts";
import { BUNDLED_SKILLS } from "../wisdom/skills/index.ts";
import { searchCanon, readCanonDoc, CANON_DOCS } from "../wisdom/canon/index.ts";

const FIXTURE_SRC = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
let tempDir: string;
let sessionId: string;

before(async () => {
  tempDir = mkdtempSync(resolve(tmpdir(), "schema-wisdom-"));
  cpSync(FIXTURE_SRC, tempDir, { recursive: true });
  const r = await workspaceOpen.handle({ uris: [`file://${tempDir}`] });
  assert.equal(r.ok, true);
  sessionId = (r.data as { sessionId: string }).sessionId;
});

after(async () => {
  await workspaceClose.handle({ sessionId });
  rmSync(tempDir, { recursive: true, force: true });
});

// ── AGENTS.md round-trip ──

describe("agents_md.read", () => {
  it("returns empty schema section when no AGENTS.md exists", async () => {
    const r = await agentsMdRead.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { schemaSection: string; fenceId: string };
    assert.equal(data.schemaSection, "");
    assert.ok(data.fenceId);
  });

  it("includes markdownUri (Rule 8)", async () => {
    const r = await agentsMdRead.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await agentsMdRead.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
  });
});

describe("agents_md.write_facts", () => {
  it("writes Schema-fenced facts section to AGENTS.md", async () => {
    const r = await agentsMdWriteFacts.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { writtenPath: string; charsAdded: number; fenceId: string };
    assert.ok(data.writtenPath.endsWith("AGENTS.md"));
    assert.ok(data.charsAdded > 0);

    const content = readFileSync(data.writtenPath, "utf-8");
    assert.ok(content.includes("<!-- schema:facts:start -->"));
    assert.ok(content.includes("<!-- schema:facts:end -->"));
    assert.ok(content.includes("Schema-derived architectural facts"));
  });

  it("emits agents_md.facts_written event", async () => {
    const session = getSession(sessionId)!;
    const events: { kind: string }[] = [];
    session.eventBus.subscribe((e) => events.push(e as { kind: string }));

    await agentsMdWriteFacts.handle({ sessionId });

    assert.ok(events.some((e) => e.kind === "agents_md.facts_written"));
  });

  it("is idempotent — second write replaces the fenced section", async () => {
    await agentsMdWriteFacts.handle({ sessionId });
    const firstContent = readFileSync(resolve(tempDir, "AGENTS.md"), "utf-8");
    const firstFenceCount = (firstContent.match(/<!-- schema:facts:start -->/g) || []).length;

    await agentsMdWriteFacts.handle({ sessionId });
    const secondContent = readFileSync(resolve(tempDir, "AGENTS.md"), "utf-8");
    const secondFenceCount = (secondContent.match(/<!-- schema:facts:start -->/g) || []).length;

    assert.equal(firstFenceCount, 1);
    assert.equal(secondFenceCount, 1, "Should not duplicate the fence on second write");
  });

  it("preserves user content outside the fence", async () => {
    const agentsPath = resolve(tempDir, "AGENTS.md");
    writeFileSync(agentsPath, "# My Project\n\nUser notes here.\n");

    await agentsMdWriteFacts.handle({ sessionId });

    const content = readFileSync(agentsPath, "utf-8");
    assert.ok(content.includes("# My Project"), "User content should be preserved");
    assert.ok(content.includes("User notes here"), "User notes should be preserved");
    assert.ok(content.includes("<!-- schema:facts:start -->"));
  });
});

describe("agents_md round-trip — read after write", () => {
  it("read returns the written facts after write", async () => {
    await agentsMdWriteFacts.handle({ sessionId });

    const r = await agentsMdRead.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { schemaSection: string };
    assert.ok(data.schemaSection.length > 0, "Schema section should be non-empty after write");
    assert.ok(data.schemaSection.includes("Nodes:"));
  });

  it("read with includeUserSection returns both sections", async () => {
    const agentsPath = resolve(tempDir, "AGENTS.md");
    writeFileSync(agentsPath, "# Custom Header\n\nSome notes.\n");
    await agentsMdWriteFacts.handle({ sessionId });

    const r = await agentsMdRead.handle({ sessionId, includeUserSection: true });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { schemaSection: string; userSection: string };
    assert.ok(data.schemaSection.includes("Nodes:"));
    assert.ok(data.userSection.includes("Custom Header"));
  });
});

// ── skills.list ──

describe("skills.list", () => {
  it("returns all 9 bundled skills", async () => {
    const r = await skillsList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { skills: { id: string; type: string; title: string; uri: string }[] };
    assert.equal(data.skills.length, 9);
    assert.ok(data.skills.every((s) => s.uri.startsWith("skill://")));
  });

  it("includes 5 procedural + 4 paradigm skills", async () => {
    const r = await skillsList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { skills: { type: string }[] };
    const procedural = data.skills.filter((s) => s.type === "procedural");
    const paradigm = data.skills.filter((s) => s.type === "paradigm");
    assert.equal(procedural.length, 5);
    assert.equal(paradigm.length, 4);
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await skillsList.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
  });

  it("includes the claude-code-schema-workflow skill", async () => {
    const r = await skillsList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { skills: { id: string; type: string; title: string }[] };
    const claude = data.skills.find((s) => s.id === "claude-code-schema-workflow");
    assert.ok(claude, "should include the Claude Code workflow skill");
    assert.equal(claude!.type, "procedural");
  });

  it("claude-code-schema-workflow skill body mentions graph.find_callers", () => {
    const skill = BUNDLED_SKILLS.find((s) => s.id === "claude-code-schema-workflow");
    assert.ok(skill, "skill should exist in BUNDLED_SKILLS");
    assert.ok(skill!.body.includes("graph.find_callers"), "body should mention graph.find_callers");
    assert.ok(skill!.body.includes("rules.evaluate"), "body should mention rules.evaluate");
    assert.ok(skill!.body.includes("ops.preview"), "body should mention ops.preview");
  });
});

// ── canon.search ──

describe("canon.search", () => {
  it("returns results for a relevant query", async () => {
    const r = await canonSearch.handle({ sessionId, query: "supervision tree restart" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: { uri: string; score: number; title: string }[] };
    assert.ok(data.hits.length >= 1, "Expected at least 1 hit for 'supervision tree restart'");
    assert.ok(data.hits[0]!.score > 0);
  });

  it("filters by paradigm", async () => {
    const r = await canonSearch.handle({ sessionId, paradigm: "otp", query: "supervisor restart" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: { uri: string }[] };
    for (const hit of data.hits) {
      assert.ok(hit.uri.startsWith("canon://otp/"), `Expected OTP paradigm, got: ${hit.uri}`);
    }
  });

  it("returns empty for nonsense query", async () => {
    // Step 8a: the shared BM25 tokenizer treats `_` as a token
    // separator (correct behaviour for code: `user_service` →
    // two terms). Previous canon-only tokenizer collapsed
    // underscored words into a single token. The fixture is
    // updated to a query that has no recognisable English
    // substrings — every token must miss the canon index.
    const r = await canonSearch.handle({ sessionId, query: "xyzzyq vvbnm kkjjhh ggffdd" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: unknown[] };
    assert.equal(data.hits.length, 0);
  });

  it("respects k parameter", async () => {
    const r = await canonSearch.handle({ sessionId, query: "distributed", k: 2 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: unknown[] };
    assert.ok(data.hits.length <= 2);
  });

  it("finds CQRS docs when paradigm is cqrs", async () => {
    const r = await canonSearch.handle({ sessionId, paradigm: "cqrs", query: "event sourcing projection" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { hits: { title: string }[] };
    assert.ok(data.hits.length >= 1);
  });

  it("returns invalid-args when query is missing", async () => {
    const r = await canonSearch.handle({ sessionId });
    assert.equal(r.ok, false);
  });
});

// ── canon.read ──

describe("canon.read", () => {
  it("returns doc body and metadata", async () => {
    const r = await canonRead.handle({ sessionId, uri: "canon://otp/otp-supervision-principles#full" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { body: string; metadata: { title: string; author: string } };
    assert.ok(data.body.length > 0);
    assert.ok(data.metadata.title.includes("Supervision"));
  });

  it("returns error for non-existent doc", async () => {
    const r = await canonRead.handle({ sessionId, uri: "canon://otp/nonexistent#full" });
    assert.equal(r.ok, false);
  });

  it("returns error for non-canon URI", async () => {
    const r = await canonRead.handle({ sessionId, uri: "file:///etc/passwd" });
    assert.equal(r.ok, false);
  });
});

// ── canon unit tests ──

describe("canon — BM25 unit tests", () => {
  it("searchCanon returns scored results", () => {
    const hits = searchCanon("otp", "let it crash philosophy");
    assert.ok(hits.length >= 1);
    assert.ok(hits[0]!.title.includes("Crash"));
  });

  it("readCanonDoc returns null for unknown URI", () => {
    const result = readCanonDoc("canon://fake/fake#full");
    assert.equal(result, null);
  });

  it("corpus has 60 docs", () => {
    assert.ok(CANON_DOCS.length >= 60, `Expected ≥60 canon docs, got ${CANON_DOCS.length}`);
  });

  it("corpus covers 4 paradigms", () => {
    const paradigms = new Set(CANON_DOCS.map((d) => d.paradigm));
    assert.ok(paradigms.has("otp"));
    assert.ok(paradigms.has("stm"));
    assert.ok(paradigms.has("cqrs"));
    assert.ok(paradigms.has("distsys"));
  });
});

// ── samplers.list ──

describe("samplers.list", () => {
  it("returns 4 day-one samplers", async () => {
    const r = await samplersList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { samplers: { id: string; vendor: string; available: boolean }[] };
    assert.equal(data.samplers.length, 4);
    const ids = data.samplers.map((s) => s.id);
    assert.ok(ids.includes("sampler-anthropic"));
    assert.ok(ids.includes("sampler-gemini"));
    assert.ok(ids.includes("sampler-openai"));
    assert.ok(ids.includes("sampler-mock"));
  });

  it("sampler-mock is always available", async () => {
    const r = await samplersList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { samplers: { id: string; available: boolean }[] };
    const mock = data.samplers.find((s) => s.id === "sampler-mock");
    assert.ok(mock);
    assert.equal(mock!.available, true);
  });

  it("reports reason when vendor key is missing", async () => {
    const r = await samplersList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { samplers: { id: string; available: boolean; reason?: string }[] };
    const anthropic = data.samplers.find((s) => s.id === "sampler-anthropic");
    if (anthropic && !anthropic.available) {
      assert.ok(anthropic.reason?.includes("ANTHROPIC_API_KEY"));
    }
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await samplersList.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
  });
});

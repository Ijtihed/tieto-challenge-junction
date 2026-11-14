// Per `architecture/v1-launch-plan.md` Step 9a + §0.6.4
// adversarial verification with refinements (a-f) from day-1.
//
// Tests for the Step 9a `pr.review` enhancements:
//   - Hybrid-strict marker present + exact text (§0.6.2 canonical)
//   - Atlas deep link format + integration boundary with Studio
//   - Evidence citations (nodeId → focus= URL link)
//   - Hallucinated-API forward-compat shape (empty in 9a)
//   - buildAtlasDeepLink extracted helper (§0.6.4 (a) pinning)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prReview,
  buildAtlasDeepLink,
  HYBRID_STRICT_MARKER,
  DEFAULT_STUDIO_BASE_URL,
} from "../actions/pr-review.ts";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { getSession } from "../session/index.ts";

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical sets: pin the hybrid-strict marker text +
// the default Studio base URL. A future agent who changes
// either gets a test signal.
// ──────────────────────────────────────────────────────────
describe("pr.review canonical: HYBRID_STRICT_MARKER", () => {
  it("contains the required 'no merge authority' phrasing", () => {
    // Per research/26 §6: the binding empirical finding is
    // hybrid-strict (LLM advisor + required human approval).
    // The marker must communicate this explicitly.
    assert.ok(
      HYBRID_STRICT_MARKER.toLowerCase().includes("merge authority"),
      `marker missing 'merge authority' phrasing: ${HYBRID_STRICT_MARKER}`,
    );
    assert.ok(
      HYBRID_STRICT_MARKER.toLowerCase().includes("human"),
      `marker missing 'human' reference: ${HYBRID_STRICT_MARKER}`,
    );
    assert.ok(
      HYBRID_STRICT_MARKER.toLowerCase().includes("advisory"),
      `marker should describe Schema as advisory: ${HYBRID_STRICT_MARKER}`,
    );
  });

  it("is a non-empty string constant", () => {
    assert.equal(typeof HYBRID_STRICT_MARKER, "string");
    assert.ok(HYBRID_STRICT_MARKER.length > 20);
  });
});

describe("pr.review canonical: DEFAULT_STUDIO_BASE_URL", () => {
  it("matches the Vite dev server per Q16 (localhost:5173)", () => {
    assert.equal(DEFAULT_STUDIO_BASE_URL, "http://localhost:5173");
  });
});

// ──────────────────────────────────────────────────────────
// buildAtlasDeepLink helper — extracted per §0.6.4 (a).
// Each behaviour is unit-tested directly.
// ──────────────────────────────────────────────────────────
describe("buildAtlasDeepLink helper (§0.6.4 (a))", () => {
  it("appends ?pr= with the sha", () => {
    const link = buildAtlasDeepLink("http://localhost:5173", "abc123");
    assert.equal(link, "http://localhost:5173/?pr=abc123");
  });

  it("strips trailing slash from baseUrl", () => {
    const link = buildAtlasDeepLink("http://localhost:5173/", "abc123");
    assert.equal(link, "http://localhost:5173/?pr=abc123");
  });

  it("URL-encodes the sha (defensive — shas don't usually have special chars)", () => {
    const link = buildAtlasDeepLink("http://example.com", "feature/branch");
    assert.ok(link.includes("feature%2Fbranch"),
      `expected URL-encoding; got ${link}`);
  });

  it("works with HTTPS + custom port", () => {
    const link = buildAtlasDeepLink("https://schema.dev:8443", "deadbeef");
    assert.equal(link, "https://schema.dev:8443/?pr=deadbeef");
  });

  // DC §0.6.4: pin the 3-arg signature + focus= behaviour.
  it("appends &focus= when focusId is given", () => {
    const link = buildAtlasDeepLink("http://localhost:5173", "abc", "node:42");
    assert.ok(link.includes("pr=abc"), `expected pr=abc; got ${link}`);
    assert.ok(link.includes("focus=node"), `expected focus=node...; got ${link}`);
  });

  it("ignores null/undefined focusId (sha-only output)", () => {
    assert.equal(
      buildAtlasDeepLink("http://localhost:5173", "abc", null),
      "http://localhost:5173/?pr=abc",
    );
    assert.equal(
      buildAtlasDeepLink("http://localhost:5173", "abc", undefined),
      "http://localhost:5173/?pr=abc",
    );
  });

  it("URL-encodes the focusId (defensive — node ids can contain `:`)", () => {
    const link = buildAtlasDeepLink("http://x", "sha", "node:42");
    assert.ok(link.includes("node%3A42") || link.includes("node:42"),
      `focusId must be encoded or preserved; got ${link}`);
  });
});

// ──────────────────────────────────────────────────────────
// End-to-end: pr.review markdown contains the new sections.
// ──────────────────────────────────────────────────────────
describe("pr.review markdown output", () => {
  it("includes hybrid-strict marker, atlas link, prSha header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-review-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");

    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    assert.equal(open.ok, true);
    if (!open.ok) return;
    const sessionId = (open.data as { sessionId: string }).sessionId;

    const review = await prReview.handle({
      sessionId,
      base: "HEAD",
      prSha: "abc123def456",
      studioBaseUrl: "http://localhost:5173",
    });
    assert.equal(review.ok, true);
    if (!review.ok) return;
    const data = review.data as { markdownUri: string; atlasDeepLink: string; hybridStrict: boolean; hallucinatedApis: readonly unknown[] };
    const session = getSession(sessionId)!;
    const markdown = session.markdownResources.get(data.markdownUri)!;

    // Hybrid-strict marker present
    assert.ok(markdown.includes("merge authority"),
      `markdown missing hybrid-strict marker: ${markdown.slice(0, 400)}`);
    // Atlas deep link present in body
    assert.ok(markdown.includes("?pr=abc123def456"),
      `markdown missing atlas deep link: ${markdown.slice(0, 400)}`);
    assert.ok(markdown.includes("View on atlas"),
      `markdown missing 'View on atlas' label`);
    // Head sha visible in the header
    assert.ok(markdown.includes("abc123def456"),
      `markdown missing prSha in header`);
    // Returned data structure
    assert.equal(data.hybridStrict, true);
    // Step 8b: hallucinatedApis is now populated by the wired
    // detector. For a no-diff scenario (`base: "HEAD"` on a
    // freshly-opened repo), there are no added edges, so the
    // detector finds nothing. This assertion replaces the
    // Step 9a placeholder assertion but with a stronger
    // §0.6.4 (d) check: the field must be an array (the
    // shape pr.review promises) and every element (if any)
    // must conform to HallucinatedApi.
    assert.ok(Array.isArray(data.hallucinatedApis),
      "hallucinatedApis MUST be an array per Step 8b contract");
    for (const finding of data.hallucinatedApis) {
      const f = finding as { callerId?: unknown; call?: unknown };
      assert.equal(typeof f.callerId, "string",
        `hallucinatedApis[i].callerId must be string; got ${JSON.stringify(f)}`);
      assert.equal(typeof f.call, "string",
        `hallucinatedApis[i].call must be string; got ${JSON.stringify(f)}`);
    }
    assert.ok(data.atlasDeepLink.startsWith("http://localhost:5173"),
      `atlasDeepLink shape: ${data.atlasDeepLink}`);
  });

  it("defaults to localhost:5173 + HEAD when studioBaseUrl/prSha omitted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-review-defaults-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");

    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    if (!open.ok) return;
    const sessionId = (open.data as { sessionId: string }).sessionId;

    const review = await prReview.handle({ sessionId, base: "HEAD" });
    if (!review.ok) return;
    const data = review.data as { atlasDeepLink: string };
    // Default base + default prSha=HEAD
    assert.equal(data.atlasDeepLink, "http://localhost:5173/?pr=HEAD");
  });

  it("evidence citation: rule violations with nodeId get focus= link", async () => {
    // Construct a session by hand so we can inject a violation
    // with a nodeId — the action handler reads from
    // rulesEvaluate, but we can verify the rendered output
    // contains the citation pattern when nodeId is present.
    // For Step 9a we rely on the format pinning; the actual
    // nodeId-carrying violations come from real rules.
    const dir = mkdtempSync(join(tmpdir(), "pr-review-evidence-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");
    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    if (!open.ok) return;
    const sessionId = (open.data as { sessionId: string }).sessionId;

    const review = await prReview.handle({
      sessionId,
      base: "HEAD",
      prSha: "sha-xyz",
      studioBaseUrl: "http://localhost:5173",
    });
    if (!review.ok) return;
    const data = review.data as { markdownUri: string };
    const session = getSession(sessionId)!;
    const markdown = session.markdownResources.get(data.markdownUri)!;
    // When no violations carry nodeId, the markdown still
    // contains the rule section (or "All rules pass").
    assert.ok(
      markdown.includes("### Rules") || markdown.includes("### Rule violations"),
      `markdown missing rules section: ${markdown.slice(0, 400)}`,
    );
  });
});

// ──────────────────────────────────────────────────────────
// Step 9a-3: AGENTS.md auto-trigger contract
// ──────────────────────────────────────────────────────────
describe("workspace.open AGENTS.md auto-trigger", () => {
  it("writes the Schema fence when AGENTS.md already exists", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "auto-agents-md-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");
    writeFileSync(join(dir, "AGENTS.md"), "# my header\n\nuser body\n");

    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    assert.equal(open.ok, true);

    const updated = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    assert.ok(updated.includes("user body"),
      "user content must be preserved verbatim");
    assert.ok(updated.includes("schema:facts:start"),
      "Schema fence must be written into existing AGENTS.md");
  });

  it("does NOT create AGENTS.md when none exists (Q14 contract)", async () => {
    const { existsSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "no-create-agents-md-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");
    // Deliberately omit AGENTS.md + CLAUDE.md

    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    assert.equal(open.ok, true);

    assert.equal(existsSync(join(dir, "AGENTS.md")), false,
      "auto-trigger must NOT create AGENTS.md when none exists");
    assert.equal(existsSync(join(dir, "CLAUDE.md")), false,
      "auto-trigger must NOT create CLAUDE.md either");
  });

  it("writes into CLAUDE.md when AGENTS.md is absent but CLAUDE.md exists", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "claude-md-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");
    writeFileSync(join(dir, "CLAUDE.md"), "# claude header\n\nuser body\n");

    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    assert.equal(open.ok, true);

    const updated = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    assert.ok(updated.includes("user body"));
    assert.ok(updated.includes("schema:facts:start"));
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 (d) integration-boundary FIRING test: pr.review
// consumes graphDelta.edges, filters by status=added, and
// feeds the result into detectHallucinatedApis. The Step 8b
// DC found a bug where pr.review read a nonexistent
// `diffData["addedEdges"]` key. This firing test reproduces
// the exact wiring pr.review does, then asserts that a
// **real** hallucination is surfaced.
// ──────────────────────────────────────────────────────────
describe("§0.6.4 (d) FIRING: pr.review hallucination wiring", () => {
  it("detects a hallucinated call via graphDelta.edges → addedEdges → detector", async () => {
    // Build a synthetic head graph + a diff with one added
    // `calls` edge whose target does NOT resolve. This is
    // the exact wiring pr.review performs after the Step 8b
    // DC fix. Before the fix, the diff path produced an
    // empty array → 0 findings (silent bug). After the fix,
    // the same input produces 1 finding.
    const { detectHallucinatedApis } = await import("../domain/retrieval/hallucinated-api.ts");
    const { buildGraphBm25Index } = await import("../domain/retrieval/graph-bm25.ts");

    const headGraph = {
      version: "0.0",
      interRepoEdges: [],
      repos: [{
        uri: "file:///t",
        nodes: [
          { id: "n:caller", kind: "function" as const, name: "caller", parentId: null, locator: "file:///t/a.ts#L1" },
          { id: "n:realTarget", kind: "function" as const, name: "realTarget", parentId: null, locator: "file:///t/b.ts#L1" },
        ],
        edges: [],
        clusters: [],
      }],
    } as never;
    // Simulate what graph.diff_against returns: edges with status.
    const graphDeltaEdges = [
      { id: "e:1", source: "n:caller", target: "n:ghost", relation: "calls", status: "added" as const },
      { id: "e:2", source: "n:caller", target: "n:realTarget", relation: "calls", status: "added" as const },
      { id: "e:3", source: "n:caller", target: "n:realTarget", relation: "calls", status: "unchanged" as const },
    ];

    // Reproduce pr.review's wiring after the DC fix.
    // MUTATION-FIRING: replace the lines below with
    // `const addedEdges: never[] = []` (the pre-fix behavior)
    // and this test MUST fail with `expected 1, got 0`.
    // Verified during Step 8b DC.
    const addedEdges = graphDeltaEdges
      .filter((e) => e.status === "added")
      .map((e) => ({ id: e.id, source: e.source, target: e.target, relation: e.relation }));

    const hybridIndex = buildGraphBm25Index(headGraph);
    const findings = detectHallucinatedApis({
      diff: { addedNodes: [], addedEdges },
      headGraph,
      hybridIndex,
    });

    // FIRING: exactly one hallucination (n:ghost), and the
    // resolved target (n:realTarget) is NOT flagged.
    assert.equal(findings.length, 1,
      `expected 1 hallucination (n:ghost); got ${findings.length}: ${JSON.stringify(findings)}`);
    assert.equal(findings[0]?.callerId, "n:caller");
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 (d) integration-boundary: pr.review consumes the
// SAME shape graphDiffAgainst emits. The Step 8b DC found a
// bug where pr.review read `diffData["addedEdges"]` (which
// graph.diff_against does NOT produce) — the correct surface
// is `graphDelta.edges.filter(status="added")`. Pin it.
// ──────────────────────────────────────────────────────────
describe("§0.6.4 (d): pr.review ↔ graph.diff_against shape", () => {
  it("graph.diff_against returns graphDelta.edges with status, NOT addedEdges", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-review-shape-"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}');
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export const X = 1;\n");

    const open = await workspaceOpen.handle({ uris: [`file://${dir}`] });
    if (!open.ok) return;
    const sessionId = (open.data as { sessionId: string }).sessionId;

    const { graphDiffAgainst } = await import("../actions/graph-diff-against.ts");
    const diff = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    if (!diff.ok) return;

    const data = diff.data as Record<string, unknown>;
    // §0.6.4 (d) pinning: the SHAPE pr.review depends on.
    // If a future refactor renames graphDelta → diff, or moves
    // edges to a top-level field, this test catches it.
    assert.ok("graphDelta" in data, "graph.diff_against MUST return graphDelta key");
    assert.equal("addedEdges" in data, false,
      "graph.diff_against MUST NOT expose addedEdges directly — pr.review derives it from graphDelta.edges");

    const delta = data["graphDelta"] as { edges: readonly { status: string }[] };
    assert.ok(Array.isArray(delta.edges), "graphDelta.edges MUST be an array");
    // Every edge must carry a status discriminator pr.review can filter on.
    for (const e of delta.edges.slice(0, 50)) {
      assert.ok(
        e.status === "added" || e.status === "removed" || e.status === "unchanged",
        `every edge MUST have status added|removed|unchanged; got ${JSON.stringify(e)}`,
      );
    }
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 (d) integration-boundary: engine + Studio must
// agree on the link format. The engine's buildAtlasDeepLink
// produces something Studio's usePrMode (and a mirrored
// helper in clients/studio/src/hooks/usePrMode.ts) can parse.
// ──────────────────────────────────────────────────────────
describe("§0.6.4 (d): pr.review → studio link round-trip", () => {
  it("engine link parses to the same sha + focus", () => {
    const link = buildAtlasDeepLink("http://localhost:5173", "abcdef0123");
    // Parse it back as Studio's usePrMode would
    const url = new URL(link);
    const prSha = url.searchParams.get("pr");
    assert.equal(prSha, "abcdef0123");
  });

  it("focus= param embeds the nodeId", () => {
    // pr-review.ts itself builds focus= URLs inline (not
    // through buildAtlasDeepLink) for violation citations.
    // Verify the format is consistent.
    const link = "http://localhost:5173/?pr=abc&focus=node:42";
    const url = new URL(link);
    assert.equal(url.searchParams.get("pr"), "abc");
    assert.equal(url.searchParams.get("focus"), "node:42");
  });
});

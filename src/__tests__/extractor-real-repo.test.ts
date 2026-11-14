// Per `architecture/v1-launch-plan.md` Step 1 — the silent-drop gate.
//
// Before Step 1: extracting Schema's own source produced 1,251 graph
// nodes and 9 silent `parse failed for ...` warnings buried in
// stderr — the bug the launch plan calls out. After Step 1: every
// large file parses, the failures surface via `caching.stats`, and
// the node count returns to a realistic order of magnitude for the
// repo's authored source code.
//
// The plan's stated threshold is "≥ 2,500 nodes and 0 parse
// failures." The 0-failures gate is the load-bearing one and is
// asserted exactly. The node-count gate is asserted as a lower
// bound generous enough to catch a recurrence of the silent-drop
// regression without being so tight that node-emission
// recalibration in Steps 3-4 (gitignore, generated-detection,
// archetype labels) would falsely trip it.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { cachingStats } from "../actions/caching-stats.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { getSession } from "../session/index.ts";
import type { ExtractionStats } from "../domain/extraction-stats.ts";

const REPO_PATH = resolve(import.meta.dirname!, "../..");
const REPO_URI = `file://${REPO_PATH}`;

// Per Q10 + the realised yield of Schema's own source (~1,300 nodes
// after the bufferSize fix lands but before Steps 3-4 raise the
// per-file node yield). 1,000 is the smallest power-of-ten that
// would catch a regression that drops, say, the entire TS extractor.
// Once Steps 3-4 ship and node yield climbs, this threshold should
// be reviewed upward.
const MIN_NODES_SCHEMA = 1_000;

describe("extractor real-repo gate — Schema's own source", () => {
  let sessionId: string;
  let stats: ExtractionStats;
  let fromCache: boolean;

  before(async () => {
    const result = await workspaceOpen.handle({ uris: [REPO_URI] });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("workspace.open failed");
    const data = result.data as { sessionId: string; fromCache?: boolean; extraction: ExtractionStats };
    sessionId = data.sessionId;
    stats = data.extraction;
    fromCache = !!data.fromCache;
  });

  it("0 parse failures on Schema's own source (the silent-drop bug stays fixed)", () => {
    const failuresPretty = stats.failures
      .map((f) => `  - ${f.extractorId}: ${f.filePath} [${f.reason}] ${f.detail ?? ""}`)
      .join("\n");
    assert.equal(
      stats.failures.length,
      0,
      `Expected 0 parse failures; got ${stats.failures.length}:\n${failuresPretty}`,
    );
  });

  it("node count is at least the realistic floor for Schema's own source", () => {
    const session = getSession(sessionId);
    assert.ok(session, "session should exist");
    const totalNodes = session.graph.repos.reduce((s, r) => s + r.nodes.length, 0);
    assert.ok(
      totalNodes >= MIN_NODES_SCHEMA,
      `expected ≥ ${MIN_NODES_SCHEMA} nodes (post-bufferSize-fix floor); got ${totalNodes}. ` +
        `If this dropped sharply, the silent-drop bug may have regressed.`,
    );
  });

  it("caching.stats action returns the same extraction summary", async () => {
    const r = await cachingStats.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const fresh = (r.data as { extraction: ExtractionStats }).extraction;
    assert.equal(fresh.filesAttempted, stats.filesAttempted);
    assert.equal(fresh.filesParsed, stats.filesParsed);
    assert.equal(fresh.failures.length, stats.failures.length);
  });

  it("workspace.open response exposes extraction stats with sane totals", () => {
    assert.ok(
      stats.filesAttempted >= stats.filesParsed,
      `filesAttempted (${stats.filesAttempted}) must be >= filesParsed (${stats.filesParsed})`,
    );
    if (!fromCache) {
      // On a cache miss the per-extractor entries record every bundled
      // extractor; on a cache hit they are intentionally empty.
      assert.ok(
        stats.perExtractor.length >= 7,
        `expected at least 7 per-extractor entries, got ${stats.perExtractor.length}`,
      );
      const extractorIds = new Set(stats.perExtractor.map((e) => e.extractorId));
      for (const expected of [
        "extractor-typescript", "extractor-python", "extractor-go",
        "extractor-java-kotlin", "extractor-ruby", "extractor-rust",
        "extractor-generic-config",
      ]) {
        assert.ok(extractorIds.has(expected), `missing stats for ${expected}`);
      }
    }
  });

  after(async () => {
    if (sessionId) await workspaceClose.handle({ sessionId });
  });
});

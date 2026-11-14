// Per `architecture/v1-launch-plan.md` Step 11a + §0.6.4
// adversarial verification with refinements (a-i) applied
// from day-1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  aggregateUsage,
  renderUsageMarkdown,
  STEP_11_USAGE_GATE,
} from "../domain/dogfood/usage-aggregator.ts";
import {
  recordSurveyResponse,
  serializeResponse,
  parseResponse,
  SEAN_ELLIS_ANSWERS,
  SEAN_ELLIS_META,
  SEAN_ELLIS_QUESTION,
} from "../domain/dogfood/sean-ellis.ts";
import {
  failureLogStats,
  emptyFailureLog,
  renderEmptyTemplate,
  renderFailureLog,
  FAILURE_SEVERITIES,
} from "../domain/dogfood/failure-log.ts";
import {
  runSmoke,
  renderSmokeMarkdown,
  SMOKE_STEPS,
  type ActionHandler,
} from "../domain/dogfood/smoke-harness.ts";
import {
  readEventLog,
  dogfoodSummary,
  dogfoodSurvey,
  dogfoodInitFailureLog,
  readLatestSurvey,
  buildOverallVerdict,
  DEFAULT_EVENT_LOG_PATH,
  DEFAULT_SURVEY_PATH,
  DEFAULT_FAILURE_LOG_PATH,
} from "../cli/dogfood.ts";

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical-set pinning
// ──────────────────────────────────────────────────────────
describe("STEP_11_USAGE_GATE canonical set", () => {
  it("has exactly 3 keys (minTotalEvents, minDistinctKinds, windowDays)", () => {
    const keys = Object.keys(STEP_11_USAGE_GATE).sort();
    assert.deepEqual(keys, ["minDistinctKinds", "minTotalEvents", "windowDays"]);
  });

  it("pins the plan thresholds (≥50 events, ≥5 kinds, 14 days)", () => {
    assert.equal(STEP_11_USAGE_GATE.minTotalEvents, 50);
    assert.equal(STEP_11_USAGE_GATE.minDistinctKinds, 5);
    assert.equal(STEP_11_USAGE_GATE.windowDays, 14);
  });
});

describe("SEAN_ELLIS_ANSWERS canonical set", () => {
  it("is exactly ['V', 'S', 'N'] in that order", () => {
    assert.deepEqual([...SEAN_ELLIS_ANSWERS], ["V", "S", "N"]);
  });

  it("SEAN_ELLIS_META covers every canonical answer", () => {
    for (const answer of SEAN_ELLIS_ANSWERS) {
      assert.ok(SEAN_ELLIS_META[answer]);
      assert.ok(SEAN_ELLIS_META[answer].label);
      assert.ok(SEAN_ELLIS_META[answer].classification);
    }
  });

  it("only V is pmf-pass (per Q7 strict gate)", () => {
    assert.equal(SEAN_ELLIS_META.V.classification, "pmf-pass");
    assert.equal(SEAN_ELLIS_META.S.classification, "pmf-marginal");
    assert.equal(SEAN_ELLIS_META.N.classification, "pmf-fail");
  });

  it("the Sean Ellis question text is the canonical phrasing", () => {
    assert.match(SEAN_ELLIS_QUESTION, /no longer use Schema/);
  });
});

describe("FAILURE_SEVERITIES canonical set", () => {
  it("is exactly ['blocking', 'wishlist', 'known'] in order (most-severe-first)", () => {
    assert.deepEqual([...FAILURE_SEVERITIES], ["blocking", "wishlist", "known"]);
  });
});

describe("SMOKE_STEPS canonical set", () => {
  it("has exactly 8 daily-driver actions", () => {
    assert.equal(SMOKE_STEPS.length, 8);
  });

  it("starts with workspace.open + ends with agents_md.write_facts", () => {
    assert.equal(SMOKE_STEPS[0], "workspace.open");
    assert.equal(SMOKE_STEPS[SMOKE_STEPS.length - 1], "agents_md.write_facts");
  });

  it("covers the headline daily-driver surfaces", () => {
    // The plan's daily-driver flow demands these specific
    // actions. A future agent who drops one breaks the
    // founder's measured workflow.
    assert.ok(SMOKE_STEPS.includes("graph.summary"));
    assert.ok(SMOKE_STEPS.includes("pr.review"));
    assert.ok(SMOKE_STEPS.includes("drift.generate"));
  });

  // Step 11a DC §0.6.4 (d) integration-boundary equivalence:
  // every SMOKE_STEPS string MUST match a real exported
  // action's `.name`. Without this pin, a future rename of
  // (say) `pr.review` to `pull.review` silently breaks the
  // smoke harness — Step 11b's pre-flight returns "action
  // not found" instead of running the daily-driver flow.
  it("§0.6.4 (d): every SMOKE_STEPS string maps to a real action.name", async () => {
    const actions = await import("../actions/index.ts");
    const exportedNames = new Set<string>();
    for (const [, value] of Object.entries(actions)) {
      const v = value as { name?: string };
      if (typeof v?.name === "string") exportedNames.add(v.name);
    }
    for (const step of SMOKE_STEPS) {
      assert.ok(
        exportedNames.has(step),
        `SMOKE_STEPS contains '${step}' but no exported action has that .name`,
      );
    }
  });
});

// ──────────────────────────────────────────────────────────
// aggregateUsage tests (§0.6.4 (a)+(c)+(g))
// ──────────────────────────────────────────────────────────
describe("aggregateUsage", () => {
  function mkEvent(kind: string, ts: string, sid = "s1"): {
    v: 1;
    ts: string;
    sid: string;
    kind: string;
  } {
    return { v: 1, ts, sid, kind } as never;
  }

  it("empty input → all-zero summary + gate FAIL", () => {
    const summary = aggregateUsage([]);
    assert.equal(summary.totalEvents, 0);
    assert.equal(summary.distinctKinds, 0);
    assert.equal(summary.distinctSessions, 0);
    assert.equal(summary.distinctDays, 0);
    assert.equal(summary.meetsUsageGate, false);
    assert.match(summary.gateExplanation, /FAIL/);
  });

  it("§0.6.4 (c) boundary: 49 events / 5 kinds → FAIL (one event short)", () => {
    const events = [];
    for (let i = 0; i < 49; i++) {
      events.push(mkEvent(`kind${i % 5}`, `2026-05-${(i % 14) + 1}`.padEnd(10, "0") + "T00:00:00Z"));
    }
    const summary = aggregateUsage(events as never);
    assert.equal(summary.meetsUsageGate, false);
  });

  it("§0.6.4 (c) boundary: 50 events / 5 kinds → PASS (exactly at threshold)", () => {
    const events = [];
    for (let i = 0; i < 50; i++) {
      events.push(mkEvent(`kind${i % 5}`, `2026-05-${String((i % 14) + 1).padStart(2, "0")}T00:00:00Z`));
    }
    const summary = aggregateUsage(events as never);
    assert.equal(summary.meetsUsageGate, true);
  });

  it("§0.6.4 (c) boundary: 50 events / 4 kinds → FAIL (kinds short)", () => {
    const events = [];
    for (let i = 0; i < 50; i++) {
      events.push(mkEvent(`kind${i % 4}`, `2026-05-${String((i % 14) + 1).padStart(2, "0")}T00:00:00Z`));
    }
    const summary = aggregateUsage(events as never);
    assert.equal(summary.meetsUsageGate, false);
  });

  it("counts distinct sessions correctly", () => {
    const events = [
      mkEvent("k1", "2026-05-01T00:00:00Z", "s1"),
      mkEvent("k1", "2026-05-01T01:00:00Z", "s1"),
      mkEvent("k1", "2026-05-02T00:00:00Z", "s2"),
      mkEvent("k1", "2026-05-03T00:00:00Z", "s3"),
    ];
    const summary = aggregateUsage(events as never);
    assert.equal(summary.distinctSessions, 3);
  });

  it("§0.6.4 (g) sort: perDay is ascending by date", () => {
    const events = [
      mkEvent("k1", "2026-05-03T10:00:00Z"),
      mkEvent("k1", "2026-05-01T10:00:00Z"),
      mkEvent("k1", "2026-05-02T10:00:00Z"),
    ];
    const summary = aggregateUsage(events as never);
    const dates = summary.perDay.map((d) => d.dayUTC);
    assert.deepEqual(dates, ["2026-05-01", "2026-05-02", "2026-05-03"]);
  });

  it("first / last event timestamps are deterministic regardless of input order", () => {
    const events = [
      mkEvent("k1", "2026-05-05T00:00:00Z"),
      mkEvent("k1", "2026-05-01T00:00:00Z"),
      mkEvent("k1", "2026-05-09T00:00:00Z"),
    ];
    const summary = aggregateUsage(events as never);
    assert.equal(summary.firstEventAt, "2026-05-01T00:00:00Z");
    assert.equal(summary.lastEventAt, "2026-05-09T00:00:00Z");
  });
});

// ──────────────────────────────────────────────────────────
// renderUsageMarkdown (§0.6.4 (g) sort-order rule applied)
// ──────────────────────────────────────────────────────────
describe("renderUsageMarkdown", () => {
  it("empty summary renders the open-Schema nudge", () => {
    const md = renderUsageMarkdown(aggregateUsage([]));
    assert.match(md, /No events recorded/);
    assert.match(md, /clients\/studio/);
  });

  it("§0.6.4 (g) per-kind table sorts by count desc (most-used first)", () => {
    // 3 'kindA', 5 'kindB', 1 'kindC'. Most-used first
    // (kindB), then kindA, then kindC.
    const events = [];
    for (let i = 0; i < 3; i++) events.push({ v: 1, ts: "2026-05-01T00:00:00Z", sid: "s", kind: "kindA" });
    for (let i = 0; i < 5; i++) events.push({ v: 1, ts: "2026-05-01T00:00:00Z", sid: "s", kind: "kindB" });
    for (let i = 0; i < 1; i++) events.push({ v: 1, ts: "2026-05-01T00:00:00Z", sid: "s", kind: "kindC" });
    const md = renderUsageMarkdown(aggregateUsage(events as never));
    const idxB = md.indexOf("kindB");
    const idxA = md.indexOf("kindA");
    const idxC = md.indexOf("kindC");
    assert.ok(idxB > 0 && idxA > 0 && idxC > 0);
    assert.ok(idxB < idxA, "kindB (5) must precede kindA (3)");
    assert.ok(idxA < idxC, "kindA (3) must precede kindC (1)");
  });
});

// ──────────────────────────────────────────────────────────
// Sean Ellis survey (§0.6.4 (a) extracted helpers)
// ──────────────────────────────────────────────────────────
describe("recordSurveyResponse", () => {
  it("V → pmf-pass + PASS decision line", () => {
    const r = recordSurveyResponse("V", { ts: "2026-05-21T00:00:00Z" });
    assert.equal(r.classification, "pmf-pass");
    assert.match(r.decision, /PASS/);
    assert.equal(r.response.answer, "V");
  });

  it("S → pmf-marginal + MARGINAL decision line", () => {
    const r = recordSurveyResponse("S", { ts: "2026-05-21T00:00:00Z" });
    assert.equal(r.classification, "pmf-marginal");
    assert.match(r.decision, /MARGINAL/);
  });

  it("N → pmf-fail + FAIL decision line", () => {
    const r = recordSurveyResponse("N", { ts: "2026-05-21T00:00:00Z" });
    assert.equal(r.classification, "pmf-fail");
    assert.match(r.decision, /FAIL/);
  });

  it("invalid answer throws", () => {
    assert.throws(() => recordSurveyResponse("X" as never));
  });

  it("note + cycle are optional + preserved", () => {
    const r = recordSurveyResponse("V", {
      ts: "2026-05-21T00:00:00Z",
      note: "use it every morning",
      cycle: 2,
    });
    assert.equal(r.response.cycle, 2);
    assert.equal(r.response.note, "use it every morning");
  });

  it("cycle defaults to 1", () => {
    const r = recordSurveyResponse("V");
    assert.equal(r.response.cycle, 1);
  });
});

describe("serializeResponse / parseResponse round-trip", () => {
  it("V answer round-trips", () => {
    const original = recordSurveyResponse("V", {
      ts: "2026-05-21T00:00:00Z",
      cycle: 1,
    }).response;
    const line = serializeResponse(original);
    const parsed = parseResponse(line);
    assert.deepEqual(parsed, original);
  });

  it("V answer with note round-trips", () => {
    const original = recordSurveyResponse("V", {
      ts: "2026-05-21T00:00:00Z",
      cycle: 1,
      note: "love it",
    }).response;
    const line = serializeResponse(original);
    const parsed = parseResponse(line);
    assert.deepEqual(parsed, original);
  });

  it("malformed line → null (resilient parsing)", () => {
    assert.equal(parseResponse("not json"), null);
    assert.equal(parseResponse("{}"), null);
    assert.equal(parseResponse('{"v": 2, "ts": "x", "answer": "V", "cycle": 1}'), null);
    assert.equal(parseResponse('{"v": 1, "answer": "Z", "ts": "x", "cycle": 1}'), null);
  });
});

// ──────────────────────────────────────────────────────────
// failureLogStats + renderEmptyTemplate
// ──────────────────────────────────────────────────────────
describe("failureLogStats", () => {
  it("empty log → meetsGate true (no blockers)", () => {
    const s = failureLogStats(emptyFailureLog(1));
    assert.equal(s.meetsGate, true);
    assert.equal(s.blocking, 0);
    assert.match(s.gateExplanation, /PASS/);
  });

  it("single blocking entry → meetsGate false", () => {
    const s = failureLogStats({
      cycle: 1,
      entries: [
        {
          id: "b1",
          severity: "blocking",
          title: "crash",
          description: "x",
          recordedAt: "2026-05-21",
        },
      ],
    });
    assert.equal(s.meetsGate, false);
    assert.equal(s.blocking, 1);
    assert.match(s.gateExplanation, /FAIL/);
  });

  it("wishlist + known but zero blocking → meetsGate true", () => {
    const s = failureLogStats({
      cycle: 1,
      entries: [
        { id: "w1", severity: "wishlist", title: "nice", description: "x", recordedAt: "2026-05-21" },
        { id: "k1", severity: "known", title: "tracked", description: "x", recordedAt: "2026-05-21" },
      ],
    });
    assert.equal(s.meetsGate, true);
    assert.equal(s.wishlist, 1);
    assert.equal(s.known, 1);
  });

  it("singular vs plural in gate explanation (1 entry vs ≥2)", () => {
    const oneBlocking = failureLogStats({
      cycle: 1,
      entries: [
        { id: "b1", severity: "blocking", title: "x", description: "y", recordedAt: "2026-05-21" },
      ],
    });
    assert.match(oneBlocking.gateExplanation, /1 blocking entry/);
    const twoBlocking = failureLogStats({
      cycle: 1,
      entries: [
        { id: "b1", severity: "blocking", title: "x", description: "y", recordedAt: "2026-05-21" },
        { id: "b2", severity: "blocking", title: "x", description: "y", recordedAt: "2026-05-21" },
      ],
    });
    assert.match(twoBlocking.gateExplanation, /2 blocking entries/);
  });
});

describe("renderEmptyTemplate", () => {
  it("includes all 3 sections in canonical order", () => {
    const md = renderEmptyTemplate(1);
    const idxBlocking = md.indexOf("## Blocking");
    const idxWishlist = md.indexOf("## Wishlist");
    const idxKnown = md.indexOf("## Known");
    assert.ok(idxBlocking > 0 && idxWishlist > 0 && idxKnown > 0);
    assert.ok(idxBlocking < idxWishlist);
    assert.ok(idxWishlist < idxKnown);
  });

  it("includes a pre-filled example wishlist entry", () => {
    const md = renderEmptyTemplate(1);
    assert.match(md, /Example wishlist entry/);
  });

  it("includes the cycle number in the header", () => {
    assert.match(renderEmptyTemplate(3), /cycle 3/);
  });
});

// Step 11a DC §0.6.4 (b) firing test: emptyFailureLog +
// renderFailureLog must thread the cycle through. Step 11
// budgets 2-3 cycles for iteration; if cycle is silently
// dropped, later cycles render with cycle=1 in the header,
// confusing the founder's audit.
describe("emptyFailureLog cycle threading (§0.6.4 (b))", () => {
  it("cycle: 2 → emptyFailureLog returns { cycle: 2 }", () => {
    const log = emptyFailureLog(2);
    assert.equal(log.cycle, 2);
  });

  it("cycle: 3 → emptyFailureLog returns { cycle: 3 }", () => {
    const log = emptyFailureLog(3);
    assert.equal(log.cycle, 3);
  });

  it("default → emptyFailureLog returns { cycle: 1 }", () => {
    const log = emptyFailureLog();
    assert.equal(log.cycle, 1);
  });

  it("renderFailureLog uses the cycle in the header", () => {
    const md = renderFailureLog({ cycle: 7, entries: [] });
    assert.match(md, /cycle 7/);
  });
});

// ──────────────────────────────────────────────────────────
// runSmoke (the harness)
// ──────────────────────────────────────────────────────────
describe("runSmoke", () => {
  // A fake action handler factory.
  function mkOk(data: unknown): ActionHandler {
    return {
      handle: async () => ({ ok: true, data }),
    };
  }
  function mkFail(code: string, message: string): ActionHandler {
    return {
      handle: async () => ({ ok: false, code, message }),
    };
  }
  function mkThrow(msg: string): ActionHandler {
    return {
      handle: async () => { throw new Error(msg); },
    };
  }

  function allOkActions(): Record<string, ActionHandler> {
    return {
      "workspace.open": mkOk({ sessionId: "test-sid" }),
      "graph.summary": mkOk({ totalNodes: 10, totalEdges: 20, clusters: [{}, {}, {}] }),
      "caching.stats": mkOk({ filesAttempted: 100, filesParsed: 100 }),
      "graph.list_snapshots": mkOk({ snapshots: [] }),
      "graph.ask": mkOk({ hits: [{}, {}], markdownUri: "markdown://graph.ask/test" }),
      "pr.review": mkOk({ hybridStrict: true, atlasDeepLink: "http://x" }),
      "drift.generate": mkOk({ snapshotsAnalyzed: 1, report: { windowDays: 0 } }),
      "agents_md.write_facts": mkOk({ writtenPath: "/tmp/a", charsAdded: 100 }),
    };
  }

  it("all 8 OK → smoke gate PASS", async () => {
    const report = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: allOkActions() as never,
    });
    assert.equal(report.passedCount, 8);
    assert.equal(report.failedCount, 0);
    assert.equal(report.meetsGate, true);
    assert.match(report.gateExplanation, /PASS/);
  });

  it("§0.6.4 (d) DC FIRING: smoke harness consumes the SAME shape graph.summary emits", async () => {
    // §0.6.4 (d) integration-boundary: the smoke harness's
    // summarize() for graph.summary must read keys that the
    // real `graph.summary` action emits. The DC found a
    // silent drift (the smoke read `nodeCount`/`edgeCount`
    // but the action returns `totalNodes`/`totalEdges`),
    // resulting in "0 nodes, 0 edges" no matter how big the
    // graph was.
    //
    // Pin: smoke-harness.ts must reference the SAME keys
    // graph-summary.ts emits.
    const { readFile } = await import("node:fs/promises");
    const summarySrc = await readFile(
      new URL("../actions/graph-summary.ts", import.meta.url),
      "utf-8",
    );
    const harnessSrc = await readFile(
      new URL("../domain/dogfood/smoke-harness.ts", import.meta.url),
      "utf-8",
    );
    // graph-summary.ts must emit BOTH totalNodes and totalEdges.
    assert.match(summarySrc, /data:\s*\{[\s\S]*?totalNodes[\s\S]*?totalEdges/,
      "graph-summary.ts MUST emit `data: { ... totalNodes ... totalEdges ... }`");
    // smoke-harness.ts must read BOTH totalNodes and totalEdges (not nodeCount/edgeCount).
    assert.match(harnessSrc, /totalNodes/,
      "smoke-harness.ts MUST consume `totalNodes` from graph.summary output");
    assert.match(harnessSrc, /totalEdges/,
      "smoke-harness.ts MUST consume `totalEdges` from graph.summary output");
    // The bug we're catching is consuming nodeCount/edgeCount in
    // _code_. Comments may legitimately reference the old names.
    // Strip line + block comments before checking.
    const harnessNoComments = harnessSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(harnessNoComments, /\bnodeCount\b/,
      "smoke-harness.ts (excl. comments) MUST NOT use `nodeCount` — graph.summary emits `totalNodes`");
    assert.doesNotMatch(harnessNoComments, /\bedgeCount\b/,
      "smoke-harness.ts (excl. comments) MUST NOT use `edgeCount` — graph.summary emits `totalEdges`");
  });

  it("workspace.open fails → other steps skipped", async () => {
    const actions = allOkActions();
    actions["workspace.open"] = mkFail("open-failed", "no repo");
    const report = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: actions as never,
    });
    assert.equal(report.steps.length, 1);
    assert.equal(report.failedCount, 1);
    assert.equal(report.meetsGate, false);
  });

  it("a middle step throws → harness catches it + continues", async () => {
    const actions = allOkActions();
    actions["pr.review"] = mkThrow("boom");
    const report = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: actions as never,
    });
    assert.equal(report.steps.length, 8);
    const prStep = report.steps.find((s) => s.step === "pr.review")!;
    assert.equal(prStep.ok, false);
    assert.match(prStep.summary, /THREW/);
    assert.equal(report.meetsGate, false);
  });

  it("§0.6.4 (a) deterministic: same inputs → same total step count", async () => {
    const r1 = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: allOkActions() as never,
    });
    const r2 = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: allOkActions() as never,
    });
    assert.equal(r1.steps.length, r2.steps.length);
    assert.deepEqual(
      r1.steps.map((s) => s.step),
      r2.steps.map((s) => s.step),
    );
  });

  it("steps run in canonical SMOKE_STEPS order", async () => {
    const report = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: allOkActions() as never,
    });
    assert.deepEqual(
      report.steps.map((s) => s.step),
      [...SMOKE_STEPS],
    );
  });

  // Step 11a DC §0.6.4 (b) firing test: a missing action
  // handler MUST surface as a smoke FAIL, not a silent
  // skip. The smoke harness is the pre-flight gate; if
  // it silently skips actions, Step 11b would launch
  // blind. Originally this branch didn't exist (the
  // implementation crashed on missing action with a
  // TypeError); we want either the crash (caught by
  // the try/catch as a fail) OR an explicit fail —
  // both flag the issue, but a silent skip does not.
  it("§0.6.4 (b): missing action handler surfaces as a smoke FAIL (never silent-skip)", async () => {
    const partial = allOkActions();
    // Remove one of the 7 follow-on actions.
    // @ts-expect-error: deliberately undefining
    partial["pr.review"] = undefined;
    const report = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: partial as never,
    });
    const prStep = report.steps.find((s) => s.step === "pr.review");
    assert.ok(prStep, "pr.review must still appear in the report");
    assert.equal(prStep!.ok, false,
      "missing handler must surface as a failure, not a silent skip");
    assert.equal(report.meetsGate, false,
      "any missing handler must fail the smoke gate");
  });
});

describe("renderSmokeMarkdown", () => {
  it("renders all step rows with ✓ or ✗", async () => {
    const report = await runSmoke({
      workspaceUri: "file:///tmp/x",
      actions: {
        "workspace.open": { handle: async () => ({ ok: true, data: { sessionId: "sid" } }) },
        "graph.summary": { handle: async () => ({ ok: false, code: "x", message: "y" }) },
        "caching.stats": { handle: async () => ({ ok: true, data: { filesAttempted: 1, filesParsed: 1 } }) },
        "graph.list_snapshots": { handle: async () => ({ ok: true, data: { snapshots: [] } }) },
        "graph.ask": { handle: async () => ({ ok: true, data: { hits: [], markdownUri: "markdown://graph.ask/test" } }) },
        "pr.review": { handle: async () => ({ ok: true, data: { hybridStrict: true } }) },
        "drift.generate": { handle: async () => ({ ok: true, data: { snapshotsAnalyzed: 0 } }) },
        "agents_md.write_facts": { handle: async () => ({ ok: true, data: { writtenPath: "/tmp" } }) },
      } as never,
    });
    const md = renderSmokeMarkdown(report);
    assert.match(md, /Step 11 pre-flight smoke report/);
    assert.match(md, /✓/);
    assert.match(md, /✗/);
  });
});

// ──────────────────────────────────────────────────────────
// CLI helpers — read/write IO using temp dirs
// ──────────────────────────────────────────────────────────
describe("readEventLog", () => {
  it("missing file → empty array", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-evt-"));
    const events = await readEventLog(join(dir, "does-not-exist.jsonl"));
    assert.deepEqual(events, []);
  });

  it("parses valid lines + skips malformed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-evt-"));
    const path = join(dir, "events.jsonl");
    writeFileSync(
      path,
      [
        '{"v":1,"ts":"2026-05-01T00:00:00Z","sid":"s1","kind":"workspace.opened","lc":1,"nc":10,"ec":20}',
        "not-json",
        '{"v":1,"ts":"2026-05-02T00:00:00Z","sid":"s2","kind":"pr.reviewed","vc":0,"nc":0}',
        "",
        '{"missing":"kind"}',
      ].join("\n"),
    );
    const events = await readEventLog(path);
    assert.equal(events.length, 2);
    assert.equal(events[0]!.kind, "workspace.opened");
    assert.equal(events[1]!.kind, "pr.reviewed");
  });
});

describe("dogfoodSummary", () => {
  it("empty event log → exit code 1 + gate FAIL message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-sum-"));
    const result = await dogfoodSummary(join(dir, "empty.jsonl"));
    assert.equal(result.exitCode, 1);
    assert.equal(result.meetsGate, false);
    assert.match(result.markdown, /No events recorded/);
  });

  it("≥50 events + ≥5 kinds → exit code 0 + gate PASS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-sum-"));
    const path = join(dir, "events.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      const kind = `kind${i % 5}`;
      lines.push(
        JSON.stringify({
          v: 1,
          ts: `2026-05-${String((i % 14) + 1).padStart(2, "0")}T00:00:00Z`,
          sid: "s",
          kind,
        }),
      );
    }
    writeFileSync(path, lines.join("\n"));
    const result = await dogfoodSummary(path);
    assert.equal(result.exitCode, 0);
    assert.equal(result.meetsGate, true);
  });
});

describe("dogfoodSurvey", () => {
  it("V answer → exit 0; survey persisted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-svy-"));
    const surveyPath = join(dir, "sean-ellis.jsonl");
    const result = await dogfoodSurvey("V", { surveyPath, note: "love it" });
    assert.equal(result.exitCode, 0);
    assert.match(result.decision, /PASS/);
    // Round-trip: read it back.
    const latest = await readLatestSurvey(surveyPath);
    assert.ok(latest);
    assert.equal(latest!.answer, "V");
    assert.equal(latest!.note, "love it");
  });

  it("S answer → exit 1; classified as marginal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-svy-"));
    const surveyPath = join(dir, "sean-ellis.jsonl");
    const result = await dogfoodSurvey("S", { surveyPath });
    assert.equal(result.exitCode, 1);
    assert.match(result.decision, /MARGINAL/);
  });

  it("N answer → exit 1; classified as fail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-svy-"));
    const surveyPath = join(dir, "sean-ellis.jsonl");
    const result = await dogfoodSurvey("N", { surveyPath });
    assert.equal(result.exitCode, 1);
    assert.match(result.decision, /FAIL/);
  });

  it("invalid answer → exit 1; no survey written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-svy-"));
    const surveyPath = join(dir, "sean-ellis.jsonl");
    const result = await dogfoodSurvey("X", { surveyPath });
    assert.equal(result.exitCode, 1);
    assert.match(result.decision, /INVALID/);
    // Nothing should be written.
    const latest = await readLatestSurvey(surveyPath);
    assert.equal(latest, null);
  });

  it("multiple responses → readLatestSurvey returns the most recent ts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-svy-"));
    const surveyPath = join(dir, "sean-ellis.jsonl");
    await dogfoodSurvey("S", { surveyPath, ts: "2026-05-01T00:00:00Z" });
    await dogfoodSurvey("V", { surveyPath, ts: "2026-05-15T00:00:00Z" });
    await dogfoodSurvey("N", { surveyPath, ts: "2026-05-10T00:00:00Z" });
    const latest = await readLatestSurvey(surveyPath);
    assert.ok(latest);
    assert.equal(latest!.answer, "V");
  });
});

describe("dogfoodInitFailureLog", () => {
  it("creates the template when file doesn't exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-fail-"));
    const path = join(dir, "failure-log.md");
    const result = await dogfoodInitFailureLog(path, 1);
    assert.equal(result.created, true);
    assert.equal(result.path, path);
  });

  it("noop when file already exists (no overwrite)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "df-fail-"));
    const path = join(dir, "failure-log.md");
    writeFileSync(path, "existing content");
    const result = await dogfoodInitFailureLog(path, 1);
    assert.equal(result.created, false);
  });
});

// ──────────────────────────────────────────────────────────
// buildOverallVerdict (§0.6.4 (a) + §0.6.4 (b) firing tests)
// ──────────────────────────────────────────────────────────
describe("buildOverallVerdict", () => {
  it("all 3 gates green → meetsStep11 = true", () => {
    const v = buildOverallVerdict({
      usageMeetsGate: true,
      latestSurvey: { answer: "V" },
      failureLogStats: { meetsGate: true },
    });
    assert.equal(v.meetsStep11, true);
    assert.match(v.verdict, /PASS/);
  });

  it("§0.6.4 (b): usage gate fails → overall fails", () => {
    const v = buildOverallVerdict({
      usageMeetsGate: false,
      latestSurvey: { answer: "V" },
      failureLogStats: { meetsGate: true },
    });
    assert.equal(v.meetsStep11, false);
  });

  it("§0.6.4 (b): survey ≠ V → overall fails", () => {
    const v = buildOverallVerdict({
      usageMeetsGate: true,
      latestSurvey: { answer: "S" },
      failureLogStats: { meetsGate: true },
    });
    assert.equal(v.meetsStep11, false);
  });

  it("§0.6.4 (b): failure-log gate fails → overall fails", () => {
    const v = buildOverallVerdict({
      usageMeetsGate: true,
      latestSurvey: { answer: "V" },
      failureLogStats: { meetsGate: false },
    });
    assert.equal(v.meetsStep11, false);
  });

  it("missing survey → meetsStep11 = false (verdict NOT YET met)", () => {
    const v = buildOverallVerdict({
      usageMeetsGate: true,
      latestSurvey: null,
      failureLogStats: { meetsGate: true },
    });
    assert.equal(v.meetsStep11, false);
    assert.match(v.verdict, /NOT YET/);
  });

  it("missing failure log → meetsStep11 = false", () => {
    const v = buildOverallVerdict({
      usageMeetsGate: true,
      latestSurvey: { answer: "V" },
      failureLogStats: null,
    });
    assert.equal(v.meetsStep11, false);
  });
});

// ──────────────────────────────────────────────────────────
// Default paths canonical
// ──────────────────────────────────────────────────────────
describe("default canonical paths (§0.6.2)", () => {
  it("DEFAULT_EVENT_LOG_PATH ends in .schema/events.jsonl", () => {
    assert.match(DEFAULT_EVENT_LOG_PATH, /\.schema\/events\.jsonl$/);
  });
  it("DEFAULT_SURVEY_PATH ends in .schema/sean-ellis.jsonl", () => {
    assert.match(DEFAULT_SURVEY_PATH, /\.schema\/sean-ellis\.jsonl$/);
  });
  it("DEFAULT_FAILURE_LOG_PATH ends in dogfood-failure-log.md", () => {
    assert.match(DEFAULT_FAILURE_LOG_PATH, /dogfood-failure-log\.md$/);
  });
});

// Phase 5 — comprehensive tests for rules.list, rules.evaluate, rules.add,
// the 4 built-in rules, and the upgraded graph.diff_against.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { rulesList } from "../actions/rules-list.ts";
import { rulesEvaluate } from "../actions/rules-evaluate.ts";
import { rulesAdd } from "../actions/rules-add.ts";
import { graphDiffAgainst } from "../actions/graph-diff-against.ts";
import { markdownRead } from "../actions/markdown-read.ts";
import { getSession } from "../session/index.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import { createEmptyGraph } from "../domain/multi-repo.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import type { MultiRepoGraph } from "../domain/multi-repo.ts";

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
const FIXTURE_URI = `file://${FIXTURE_PATH}`;

let sessionId: string;

before(async () => {
  const result = await workspaceOpen.handle({ uris: [FIXTURE_URI] });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture open failed");
  sessionId = (result.data as { sessionId: string }).sessionId;
});

after(async () => {
  await workspaceClose.handle({ sessionId });
});

// ──────────────────────────────────────────────────────────────
// rules.list (action 13)
// ──────────────────────────────────────────────────────────────

describe("rules.list", () => {
  it("returns 4 built-in rules", async () => {
    const r = await rulesList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { builtins: { id: string }[]; rules: unknown[]; imported: unknown[] };
    assert.equal(data.builtins.length, 4);
    const ids = data.builtins.map((b) => b.id);
    assert.ok(ids.includes("builtin:no-cycle"));
    assert.ok(ids.includes("builtin:must-have-handler"));
    assert.ok(ids.includes("builtin:must-have-inbound"));
    assert.ok(ids.includes("builtin:must-have-outbound"));
  });

  it("returns empty session rules initially", async () => {
    const r = await rulesList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { rules: unknown[] };
    assert.equal(data.rules.length, 0);
  });

  it("returns empty imported rules", async () => {
    const r = await rulesList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { imported: unknown[] };
    assert.equal(data.imported.length, 0);
  });

  it("includes markdownUri (Rule 8 allowlisted)", async () => {
    const r = await rulesList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { markdownUri: string };
    assert.ok(data.markdownUri.startsWith("markdown://rules.list/"));
  });

  it("markdownUri is fetchable via markdown.read", async () => {
    const r = await rulesList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { markdownUri } = r.data as { markdownUri: string };

    const mr = await markdownRead.handle({ sessionId, uri: markdownUri });
    assert.equal(mr.ok, true);
    if (!mr.ok) return;
    const md = (mr.data as { markdown: string }).markdown;
    assert.ok(md.includes("# Active Rules"));
    assert.ok(md.includes("builtin:no-cycle"));
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await rulesList.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });

  it("returns invalid-args when sessionId is missing", async () => {
    const r = await rulesList.handle({});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });
});

// ──────────────────────────────────────────────────────────────
// rules.evaluate (action 14)
// ──────────────────────────────────────────────────────────────

describe("rules.evaluate", () => {
  it("returns violations from built-in rules on the fixture", async () => {
    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { violations: { ruleId: string; severity: string; message: string }[] };
    assert.ok(Array.isArray(data.violations));
  });

  it("no-cycle rule passes on the acyclic fixture", async () => {
    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { violations: { ruleId: string }[] };
    const cycleViolations = data.violations.filter((v) => v.ruleId === "builtin:no-cycle");
    assert.equal(cycleViolations.length, 0, "Fixture should have no cycles");
  });

  it("must-have-inbound detects entry-point files", async () => {
    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { violations: { ruleId: string; message: string }[] };
    const inboundViolations = data.violations.filter((v) => v.ruleId === "builtin:must-have-inbound");
    assert.ok(inboundViolations.length >= 1, "app.ts has no incoming imports but has outgoing imports");
  });

  it("must-have-outbound detects leaf files", async () => {
    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { violations: { ruleId: string; message: string }[] };
    const outboundViolations = data.violations.filter((v) => v.ruleId === "builtin:must-have-outbound");
    assert.ok(outboundViolations.length >= 1, "store.ts/server.ts are imported but import nothing");
  });

  it("includes markdownUri (Rule 8 allowlisted)", async () => {
    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { markdownUri: string };
    assert.ok(data.markdownUri.startsWith("markdown://rules.evaluate/"));
  });

  it("markdownUri is fetchable and contains violation details", async () => {
    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { markdownUri } = r.data as { markdownUri: string };

    const mr = await markdownRead.handle({ sessionId, uri: markdownUri });
    assert.equal(mr.ok, true);
    if (!mr.ok) return;
    const md = (mr.data as { markdown: string }).markdown;
    assert.ok(md.includes("# Rule Evaluation"));
    assert.ok(md.includes("violation"));
  });

  it("scope=all evaluates all rules (default)", async () => {
    const r = await rulesEvaluate.handle({ sessionId, scope: "all" });
    assert.equal(r.ok, true);
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await rulesEvaluate.handle({ sessionId: "sess_fake" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ──────────────────────────────────────────────────────────────
// rules.add (action 15)
// ──────────────────────────────────────────────────────────────

describe("rules.add", () => {
  it("adds a custom rule to the session", async () => {
    const r = await rulesAdd.handle({
      sessionId,
      rule: { kind: "structural", body: "no function names longer than 30 chars", severity: "warn" },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { id: string; persistedTo: string; evaluation: { violations: unknown[] } };
    assert.ok(data.id.startsWith("rule_"));
    assert.equal(data.persistedTo, "session");
    assert.ok(Array.isArray(data.evaluation.violations));
  });

  it("added rule appears in rules.list", async () => {
    const r = await rulesList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { rules: { body: string }[] };
    assert.ok(data.rules.length >= 1, "Expected at least 1 session rule after rules.add");
  });

  it("emits rules.added event", async () => {
    const session = getSession(sessionId);
    assert.ok(session);

    const events: { kind: string; ruleId?: string }[] = [];
    session!.eventBus.subscribe((e) => events.push(e as typeof events[number]));

    await rulesAdd.handle({
      sessionId,
      rule: { body: "test rule for event check" },
    });

    const added = events.filter((e) => e.kind === "rules.added");
    assert.ok(added.length >= 1, "Expected at least one rules.added event");
    assert.ok(added[added.length - 1]!.ruleId, "Event should include ruleId");
  });

  it("returns invalid-args when rule body is missing", async () => {
    const r = await rulesAdd.handle({ sessionId, rule: {} });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns invalid-args when rule is missing entirely", async () => {
    const r = await rulesAdd.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await rulesAdd.handle({ sessionId: "sess_fake", rule: { body: "x" } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ──────────────────────────────────────────────────────────────
// Built-in rules — unit tests against synthetic graphs
// ──────────────────────────────────────────────────────────────

describe("built-in rules — unit evaluation", () => {
  const noCycleRule = BUILTIN_RULES.find((r) => r.id === "builtin:no-cycle")!;
  const mustInbound = BUILTIN_RULES.find((r) => r.id === "builtin:must-have-inbound")!;
  const mustOutbound = BUILTIN_RULES.find((r) => r.id === "builtin:must-have-outbound")!;
  const mustHandler = BUILTIN_RULES.find((r) => r.id === "builtin:must-have-handler")!;

  function makeGraph(nodes: { id: string; kind: string; name: string; locator: string }[],
    edges: { id: string; source: string; target: string; relation: string }[]): MultiRepoGraph {
    return {
      version: CURRENT_WIRE_VERSION,
      repos: [{
        uri: "file:///test",
        nodes,
        edges,
        clusters: [],
      }],
      interRepoEdges: [],
    };
  }

  it("no-cycle detects a simple A→B→A cycle", () => {
    const g = makeGraph(
      [{ id: "a", kind: "utility", name: "A", locator: "file:///a" }, { id: "b", kind: "utility", name: "B", locator: "file:///b" }],
      [{ id: "e1", source: "a", target: "b", relation: "calls" }, { id: "e2", source: "b", target: "a", relation: "calls" }],
    );
    const vs = noCycleRule.evaluate(g);
    assert.ok(vs.length >= 1, "Expected at least 1 cycle violation");
    assert.equal(vs[0]!.ruleId, "builtin:no-cycle");
    assert.equal(vs[0]!.severity, "error");
  });

  it("no-cycle passes on an acyclic graph", () => {
    const g = makeGraph(
      [{ id: "a", kind: "utility", name: "A", locator: "file:///a" }, { id: "b", kind: "utility", name: "B", locator: "file:///b" }],
      [{ id: "e1", source: "a", target: "b", relation: "calls" }],
    );
    const vs = noCycleRule.evaluate(g);
    assert.equal(vs.length, 0);
  });

  it("no-cycle passes on an empty graph", () => {
    const g = createEmptyGraph(CURRENT_WIRE_VERSION);
    const vs = noCycleRule.evaluate(g);
    assert.equal(vs.length, 0);
  });

  it("must-have-handler flags unregistered route_handler nodes", () => {
    const g = makeGraph(
      [{ id: "rh", kind: "route_handler", name: "GET /api", locator: "file:///x" }],
      [],
    );
    const vs = mustHandler.evaluate(g);
    assert.equal(vs.length, 1);
    assert.equal(vs[0]!.ruleId, "builtin:must-have-handler");
  });

  it("must-have-handler passes when handler has inbound edges", () => {
    const g = makeGraph(
      [
        { id: "rh", kind: "route_handler", name: "GET /api", locator: "file:///x" },
        { id: "reg", kind: "utility", name: "register", locator: "file:///y" },
      ],
      [{ id: "e1", source: "reg", target: "rh", relation: "registers_route" }],
    );
    const vs = mustHandler.evaluate(g);
    assert.equal(vs.length, 0);
  });

  it("must-have-inbound flags file nodes with outgoing but no incoming edges", () => {
    const g: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{
        uri: "file:///test",
        nodes: [
          { id: "a", kind: "utility", name: "entry.ts", locator: "file:///test/entry.ts", filePath: "/test/entry.ts" },
          { id: "b", kind: "utility", name: "lib.ts", locator: "file:///test/lib.ts", filePath: "/test/lib.ts" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", relation: "imports" }],
        clusters: [],
      }],
      interRepoEdges: [],
    };
    const vs = mustInbound.evaluate(g);
    assert.ok(vs.some((v) => v.nodeIds?.includes("a")), "entry.ts should be flagged as having no inbound");
  });

  it("must-have-outbound flags file nodes with incoming but no outgoing edges", () => {
    const g: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [{
        uri: "file:///test",
        nodes: [
          { id: "a", kind: "utility", name: "main.ts", locator: "file:///test/main.ts", filePath: "/test/main.ts" },
          { id: "b", kind: "utility", name: "leaf.ts", locator: "file:///test/leaf.ts", filePath: "/test/leaf.ts" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", relation: "imports" }],
        clusters: [],
      }],
      interRepoEdges: [],
    };
    const vs = mustOutbound.evaluate(g);
    assert.ok(vs.some((v) => v.nodeIds?.includes("b")), "leaf.ts should be flagged as having no outbound");
  });
});

// ──────────────────────────────────────────────────────────────
// graph.diff_against — upgraded (Phase 5)
// ──────────────────────────────────────────────────────────────

describe("graph.diff_against — Phase 5 upgrade", () => {
  it("returns graphDelta + ruleDelta + markdownUri", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { graphDelta: object; ruleDelta: object; markdownUri: string };
    assert.ok(data.graphDelta);
    assert.ok(data.ruleDelta);
    assert.ok(data.markdownUri.startsWith("markdown://graph.diff_against/"));
  });

  it("markdownUri is fetchable and contains diff details", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { markdownUri } = r.data as { markdownUri: string };

    const mr = await markdownRead.handle({ sessionId, uri: markdownUri });
    assert.equal(mr.ok, true);
    if (!mr.ok) return;
    const md = (mr.data as { markdown: string }).markdown;
    assert.ok(md.includes("# Diff against"));
    assert.ok(md.includes("Graph impact"));
  });

  it("includes fileStats by default", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as Record<string, unknown>;
    assert.ok("fileStats" in data);
    assert.ok(Array.isArray(data["fileStats"]));
  });

  it("omits fileStats when includeFileStats is false", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD", includeFileStats: false });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as Record<string, unknown>;
    assert.equal(data["fileStats"], undefined);
  });

  it("ruleDelta includes headViolations array", async () => {
    const r = await graphDiffAgainst.handle({ sessionId, ref: "HEAD" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { ruleDelta: { headViolations: unknown[]; baseViolations: unknown[] } };
    assert.ok(Array.isArray(data.ruleDelta.headViolations));
    assert.ok(Array.isArray(data.ruleDelta.baseViolations));
  });

  it("returns invalid-args when ref is missing", async () => {
    const r = await graphDiffAgainst.handle({ sessionId });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "invalid-args");
  });

  it("returns session-not-found for unknown session", async () => {
    const r = await graphDiffAgainst.handle({ sessionId: "sess_fake", ref: "HEAD" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "session-not-found");
  });
});

// ──────────────────────────────────────────────────────────────
// Rule 8 markdown allowlist — Phase 5 additions
// ──────────────────────────────────────────────────────────────

describe("Rule 8 — Phase 5 markdown allowlist", () => {
  it("rules.list output includes markdownUri", async () => {
    const r = await rulesList.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("rules.evaluate output includes markdownUri", async () => {
    const r = await rulesEvaluate.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok("markdownUri" in (r.data as Record<string, unknown>));
  });

  it("rules.add output does NOT include markdownUri (not on allowlist)", async () => {
    const r = await rulesAdd.handle({
      sessionId,
      rule: { body: "test rule for allowlist check" },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.data as Record<string, unknown>)["markdownUri"], undefined);
  });
});

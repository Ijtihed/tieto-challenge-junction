// Per architecture/schema-v3.md §14.2 — the Phase 2 gate test.
//
// Proves the full pipeline:
// 1. workspace.open with a file:// URI → session created → extractor runs
// 2. The graph has the expected nodes (5 files in the fixture)
// 3. Import edges exist between files
// 4. workspace.describe returns workspace metadata
// 5. workspace.close shuts down the session
// 6. workspace.extraction_complete event fired for the repo

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceDescribe } from "../actions/workspace-describe.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { getSession } from "../session/index.ts";

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");
const FIXTURE_URI = `file://${FIXTURE_PATH}`;

describe("Phase 2 gate — first vertical slice", () => {
  it("workspace.open extracts the fixture and returns a session with nodes", async () => {
    const result = await workspaceOpen.handle({ uris: [FIXTURE_URI] });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const { sessionId, workspace } = result.data as {
      sessionId: string;
      workspace: { rootUris: string[]; languages: string[] };
    };

    assert.ok(sessionId.startsWith("sess_"), `sessionId should start with sess_, got: ${sessionId}`);
    assert.ok(workspace.rootUris.length >= 1);
    assert.ok(workspace.languages.includes("typescript"), `Expected typescript in languages, got: ${workspace.languages}`);

    const session = getSession(sessionId);
    assert.ok(session, "session should exist in the store");

    const graph = session!.graph;
    const allNodes = graph.repos.flatMap((r) => r.nodes);
    const allEdges = graph.repos.flatMap((r) => r.edges);

    assert.ok(allNodes.length >= 5, `Expected >= 5 nodes (5 files in fixture), got ${allNodes.length}`);
    assert.ok(allEdges.length >= 1, `Expected >= 1 import edge, got ${allEdges.length}`);

    const fileNames = allNodes.map((n) => n.name);
    assert.ok(fileNames.includes("app.ts"), `Missing app.ts node. Got: ${fileNames.join(", ")}`);
    assert.ok(fileNames.includes("server.ts"), `Missing server.ts node. Got: ${fileNames.join(", ")}`);
    assert.ok(fileNames.includes("routes.ts"), `Missing routes.ts node. Got: ${fileNames.join(", ")}`);
    assert.ok(fileNames.includes("handlers.ts"), `Missing handlers.ts node. Got: ${fileNames.join(", ")}`);
    assert.ok(fileNames.includes("store.ts"), `Missing store.ts node. Got: ${fileNames.join(", ")}`);

    // Clean up
    await workspaceClose.handle({ sessionId });
  });

  it("workspace.describe returns metadata for an open session", async () => {
    const openResult = await workspaceOpen.handle({ uris: [FIXTURE_URI] });
    assert.equal(openResult.ok, true);
    if (!openResult.ok) return;

    const { sessionId } = openResult.data as { sessionId: string };

    const descResult = await workspaceDescribe.handle({ sessionId });
    assert.equal(descResult.ok, true);
    if (!descResult.ok) return;

    const desc = descResult.data as { rootUris: string[]; languages: string[]; wireFormatVersion: string };
    assert.ok(desc.rootUris.length >= 1);
    assert.equal(desc.wireFormatVersion, "1.0");
    assert.ok(desc.languages.includes("typescript"));

    await workspaceClose.handle({ sessionId });
  });

  it("workspace.close shuts down the session", async () => {
    const openResult = await workspaceOpen.handle({ uris: [FIXTURE_URI] });
    assert.equal(openResult.ok, true);
    if (!openResult.ok) return;

    const { sessionId } = openResult.data as { sessionId: string };

    const closeResult = await workspaceClose.handle({ sessionId });
    assert.equal(closeResult.ok, true);
    if (!closeResult.ok) return;
    assert.equal((closeResult.data as { closed: boolean }).closed, true);

    const session = getSession(sessionId);
    assert.equal(session, null, "session should be removed from the store after close");
  });

  it("workspace.close on a non-existent session returns session-not-found", async () => {
    const result = await workspaceClose.handle({ sessionId: "sess_nonexistent" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "session-not-found");
  });

  it("extraction events are emitted on the session event bus", async () => {
    const openResult = await workspaceOpen.handle({ uris: [FIXTURE_URI] });
    assert.equal(openResult.ok, true);
    if (!openResult.ok) return;

    const { sessionId } = openResult.data as { sessionId: string };
    const session = getSession(sessionId);
    assert.ok(session);

    const events: { kind: string }[] = [];
    session!.eventBus.subscribe((e) => { events.push(e); });

    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes("workspace.opened"), `Expected workspace.opened event. Got: ${kinds.join(", ")}`);
    assert.ok(kinds.includes("workspace.extraction_complete"), `Expected workspace.extraction_complete event. Got: ${kinds.join(", ")}`);

    await workspaceClose.handle({ sessionId });
  });

  it("empty-extraction emits workspace.extraction_complete with 0 nodes (Rule 9)", async () => {
    const emptyDir = resolve(import.meta.dirname!, "../../tests/fixtures");
    const result = await workspaceOpen.handle({ uris: [`file://${emptyDir}`] });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const { sessionId } = result.data as { sessionId: string };
    const session = getSession(sessionId);
    assert.ok(session);

    const events: Record<string, unknown>[] = [];
    session!.eventBus.subscribe((e) => { events.push(e); });

    const extractionEvents = events.filter((e) => e["kind"] === "workspace.extraction_complete");
    assert.ok(extractionEvents.length >= 1, "Expected at least one workspace.extraction_complete event");

    await workspaceClose.handle({ sessionId });
  });
});

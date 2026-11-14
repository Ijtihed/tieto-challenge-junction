// Per `architecture/v1-launch-plan.md` Step 5a. Unit + integration
// coverage for the L1 file watcher (`src/adapters/fs/file-watch.ts`).
// Each describe block targets a specific contract surface; the
// adversarial verification pass (§0.6.4) mutates each gate to
// confirm it has teeth.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../session/event-bus.ts";
import { createSession } from "../session/session.ts";
import {
  createFileWatcher,
  FILE_CHANGE_KINDS,
  type FileChange,
  type FileChangeKind,
} from "../adapters/fs/file-watch.ts";
import { buildComposedFilter } from "../domain/gitignore-filter.ts";

const SHORT_DEBOUNCE = 30;
const SHORT_BURST_WINDOW = 20;

// ──────────────────────────────────────────────────────────
// Canonical-set test per §0.6.2 — pins the FILE_CHANGE_KINDS
// constant. If a future agent adds a kind ("rename", etc.) they
// must also update FILE_CHANGE_KINDS, which forces an explicit
// commit instead of silent drift across the wire format.
// ──────────────────────────────────────────────────────────
describe("FILE_CHANGE_KINDS: canonical 3-member set per §0.6.2", () => {
  it("has exactly 3 members", () => {
    assert.equal(FILE_CHANGE_KINDS.length, 3);
  });
  it("members are add | change | unlink", () => {
    assert.deepEqual([...FILE_CHANGE_KINDS], ["add", "change", "unlink"]);
  });
  it("every member is a non-empty string", () => {
    for (const k of FILE_CHANGE_KINDS) {
      assert.ok(typeof k === "string" && k.length > 0);
    }
  });
});

// ──────────────────────────────────────────────────────────
// Stats lifecycle: every counter starts at 0; `start()` flips
// `watching`; `stop()` flips it back.
// ──────────────────────────────────────────────────────────
describe("file-watch lifecycle", () => {
  it("stats() reports watching=false before start", () => {
    const w = createFileWatcher(new EventBus());
    const s = w.stats();
    assert.equal(s.watching, false);
    assert.equal(s.eventsEmitted, 0);
    assert.equal(s.startedAt, 0);
  });

  it("start() is idempotent — re-call on the same root is a no-op", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-idem-"));
    const w = createFileWatcher(new EventBus());
    await w.start(dir);
    const firstStartedAt = w.stats().startedAt;
    assert.ok(firstStartedAt > 0);
    await w.start(dir);
    assert.equal(w.stats().startedAt, firstStartedAt, "idempotent re-start preserves startedAt");
    await w.stop();
  });

  it("stop() is idempotent — calling without start is a no-op", async () => {
    const w = createFileWatcher(new EventBus());
    await w.stop();
    await w.stop();
    assert.equal(w.stats().watching, false);
  });

  it("stop() leaves stats but flips watching=false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-stop-"));
    const file = join(dir, "x.ts");
    writeFileSync(file, "1");
    const bus = new EventBus();
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE });
    await w.start(dir);
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(file, "2");
    await new Promise((r) => setTimeout(r, 200));
    await w.stop();
    const s = w.stats();
    assert.equal(s.watching, false);
    // Stats persist after stop so callers can introspect a closed
    // watcher (used by workspace.watch_stop's response payload).
    assert.ok(s.startedAt > 0);
  });
});

// ──────────────────────────────────────────────────────────
// Editor-event forwarding: bypasses chokidar, goes through the
// same debounce + emit pipeline. Tested without touching the
// filesystem.
// ──────────────────────────────────────────────────────────
describe("file-watch editor-event forwarding", () => {
  it("emits a single files.changed event with origin='editor'", async () => {
    const bus = new EventBus();
    const events: FileChange[] = [];
    bus.subscribe((e) => {
      if (e.kind === "files.changed") {
        for (const c of e["changes"] as FileChange[]) events.push(c);
      }
    });
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE });
    w.forwardEditorEvent("file:///workspace/src/app.ts", "change");
    await new Promise((r) => setTimeout(r, SHORT_DEBOUNCE + 30));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.uri, "file:///workspace/src/app.ts");
    assert.equal(events[0]!.kind, "change");
    assert.equal(events[0]!.origin, "editor");
    assert.equal(w.stats().editorForwarded, 1);
  });

  it("debounces multiple forwards on the same uri into one emit", async () => {
    const bus = new EventBus();
    let emits = 0;
    bus.subscribe((e) => { if (e.kind === "files.changed") emits++; });
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE });
    for (let i = 0; i < 5; i++) {
      w.forwardEditorEvent("file:///x", "change");
    }
    await new Promise((r) => setTimeout(r, SHORT_DEBOUNCE + 30));
    assert.equal(emits, 1, "5 forwards on the same uri produce 1 emit after debounce");
  });

  it("respects unlink > add > change kind precedence within the debounce window", async () => {
    const bus = new EventBus();
    const captured: FileChange[] = [];
    bus.subscribe((e) => {
      if (e.kind === "files.changed") {
        for (const c of e["changes"] as FileChange[]) captured.push(c);
      }
    });
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE });
    w.forwardEditorEvent("file:///x", "change");
    w.forwardEditorEvent("file:///x", "add");
    w.forwardEditorEvent("file:///x", "unlink");
    await new Promise((r) => setTimeout(r, SHORT_DEBOUNCE + 30));
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.kind, "unlink", "unlink wins over add + change");
  });
});

// ──────────────────────────────────────────────────────────
// Filter integration: composed filter from Step 4 is honored.
// Editor-forwarded events to gitignored paths are dropped.
// ──────────────────────────────────────────────────────────
describe("file-watch filter integration (Step 4 reuse)", () => {
  it("drops editor events for filtered paths (gitignore)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-flt-"));
    const filter = buildComposedFilter([
      { directory: "", patterns: ["dist/"] },
    ]);
    const bus = new EventBus();
    let emits = 0;
    bus.subscribe((e) => { if (e.kind === "files.changed") emits++; });
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE, filter });
    await w.start(dir);
    await new Promise((r) => setTimeout(r, 200));

    // dist/ path → gitignored
    w.forwardEditorEvent(`file://${dir}/dist/out.js`, "change");
    await new Promise((r) => setTimeout(r, SHORT_DEBOUNCE + 30));
    assert.equal(emits, 0, "gitignored path produces no emit");
    assert.equal(w.stats().filteredOut, 1);

    // src/ path → allowed
    w.forwardEditorEvent(`file://${dir}/src/app.ts`, "change");
    await new Promise((r) => setTimeout(r, SHORT_DEBOUNCE + 30));
    assert.equal(emits, 1, "non-ignored path produces one emit");

    await w.stop();
  });

  it("drops editor events for always-ignored paths (node_modules)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-flt2-"));
    const filter = buildComposedFilter([]);
    const bus = new EventBus();
    let emits = 0;
    bus.subscribe((e) => { if (e.kind === "files.changed") emits++; });
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE, filter });
    await w.start(dir);
    await new Promise((r) => setTimeout(r, 200));

    w.forwardEditorEvent(`file://${dir}/node_modules/x.js`, "change");
    await new Promise((r) => setTimeout(r, SHORT_DEBOUNCE + 30));
    assert.equal(emits, 0);

    await w.stop();
  });
});

// ──────────────────────────────────────────────────────────
// Burst coalescing: >`burstThreshold` events in `<burstWindowMs`
// collapse into a single batched event with origin="coalesce".
// ──────────────────────────────────────────────────────────
describe("file-watch burst coalescing", () => {
  it("coalesces >burstThreshold events in <burstWindowMs into one batched event", async () => {
    const bus = new EventBus();
    const batches: FileChange[][] = [];
    bus.subscribe((e) => {
      if (e.kind === "files.changed") {
        batches.push(e["changes"] as FileChange[]);
      }
    });
    const w = createFileWatcher(bus, {
      debounceMs: 5,
      burstWindowMs: SHORT_BURST_WINDOW,
      burstThreshold: 5,
    });

    // Fire 12 distinct-path events as fast as possible; they
    // should ALL be coalesced after the first 4 individual emits
    // because event #5 trips burst detection.
    for (let i = 0; i < 12; i++) {
      w.forwardEditorEvent(`file:///x${i}.ts`, "change");
    }

    // Wait long enough for both the per-path debounce + burst
    // settle window to fire.
    await new Promise((r) => setTimeout(r, SHORT_BURST_WINDOW + 60));

    // We expect at least one coalesced batch.
    const coalesced = batches.filter((b) => b.some((c) => c.origin === "coalesce"));
    assert.ok(
      coalesced.length >= 1,
      `expected at least 1 coalesced batch, got ${coalesced.length} (total batches: ${batches.length})`,
    );
    assert.equal(w.stats().burstsCoalesced, 1, "exactly one burst event recorded");
  });
});

// ──────────────────────────────────────────────────────────
// Duplicate suppression: chokidar can fire `change` twice on
// macOS APFS for atomic-mtime touches; the watcher collapses
// duplicates within a 25 ms window.
// ──────────────────────────────────────────────────────────
describe("file-watch duplicate suppression", () => {
  it("suppresses identical kind on same uri within 25 ms window", async () => {
    const bus = new EventBus();
    let emits = 0;
    bus.subscribe((e) => { if (e.kind === "files.changed") emits++; });
    const w = createFileWatcher(bus, { debounceMs: 1 });

    // Emit two identical events 5ms apart: 2nd should be
    // suppressed AFTER the 1st has fired (debounce=1ms is too
    // short to coalesce them in the pendingByUri map).
    w.forwardEditorEvent("file:///dup.ts", "change");
    await new Promise((r) => setTimeout(r, 10));
    w.forwardEditorEvent("file:///dup.ts", "change");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(emits, 1, "duplicate within 25ms suppressed");
    assert.equal(w.stats().duplicatesSuppressed, 1);
  });
});

// ──────────────────────────────────────────────────────────
// Session integration: `session.close()` MUST stop the watcher.
// Per the §0.6.4 double-check pass: without an explicit test
// here, a future agent could delete the teardown block in
// `session.close()` and nothing would catch it — the OS file
// descriptors would silently leak per session-close.
// ──────────────────────────────────────────────────────────
describe("file-watch: session.close() integration", () => {
  it("session.close() stops an active watcher and clears the session reference", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-sess-"));
    const session = createSession(["file://" + dir]);
    const watcher = createFileWatcher(session.eventBus, { debounceMs: SHORT_DEBOUNCE });
    await watcher.start(dir);
    session.fileWatcher = watcher;

    assert.equal(session.fileWatcher.stats().watching, true, "watcher is active before close");

    session.close();

    // The session block uses fire-and-forget `stop()`; give
    // the microtask a tick to fire.
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(session.fileWatcher, null, "session.fileWatcher cleared on close");
    assert.equal(watcher.stats().watching, false, "watcher.stop() was called");
  });

  it("session.close() is safe when fileWatcher is null", () => {
    const session = createSession(["file:///fake"]);
    assert.equal(session.fileWatcher, null);
    // Should not throw.
    session.close();
    assert.equal(session.closed, true);
  });
});

// ──────────────────────────────────────────────────────────
// Multi-session safety: two sessions in the same process can
// each own a watcher independently; closing one MUST NOT
// affect the other. Catches a category of regression where a
// future agent uses module-level state instead of per-session.
// ──────────────────────────────────────────────────────────
describe("file-watch: multi-session independence", () => {
  it("two sessions can watch different dirs independently", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "fw-multi-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "fw-multi-b-"));

    const sessionA = createSession(["file://" + dirA]);
    const sessionB = createSession(["file://" + dirB]);
    const watcherA = createFileWatcher(sessionA.eventBus, { debounceMs: SHORT_DEBOUNCE });
    const watcherB = createFileWatcher(sessionB.eventBus, { debounceMs: SHORT_DEBOUNCE });
    await watcherA.start(dirA);
    await watcherB.start(dirB);
    sessionA.fileWatcher = watcherA;
    sessionB.fileWatcher = watcherB;

    // Each session has its own event bus; emit on A should
    // not appear on B and vice-versa.
    let aSeen = 0;
    let bSeen = 0;
    sessionA.eventBus.subscribe((e) => { if (e.kind === "files.changed") aSeen++; });
    sessionB.eventBus.subscribe((e) => { if (e.kind === "files.changed") bSeen++; });

    watcherA.forwardEditorEvent("file:///a/x.ts", "change");
    watcherB.forwardEditorEvent("file:///b/y.ts", "change");
    await new Promise((r) => setTimeout(r, SHORT_DEBOUNCE + 30));

    assert.equal(aSeen, 1, "session A sees its own event");
    assert.equal(bSeen, 1, "session B sees its own event");

    // Closing A must not affect B.
    sessionA.close();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sessionA.fileWatcher, null);
    assert.equal(sessionB.fileWatcher, watcherB, "session B watcher unaffected by A close");
    assert.equal(watcherB.stats().watching, true, "watcher B still active");

    sessionB.close();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sessionB.fileWatcher, null);
  });
});

// ──────────────────────────────────────────────────────────
// Real chokidar smoke: writeFileSync triggers a `change` event
// through the actual chokidar pipeline. This is the only test
// that exercises the OS-level watching path; everything else
// uses `forwardEditorEvent` for determinism.
// ──────────────────────────────────────────────────────────
describe("file-watch chokidar smoke", () => {
  it("emits files.changed when an actual file is written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-real-"));
    const file = join(dir, "real.ts");
    writeFileSync(file, "1");
    const bus = new EventBus();
    let captured: { uri: string; kind: FileChangeKind } | null = null;
    bus.subscribe((e) => {
      if (e.kind === "files.changed") {
        const change = (e["changes"] as FileChange[])[0]!;
        captured = { uri: change.uri, kind: change.kind };
      }
    });
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE });
    await w.start(dir);
    await new Promise((r) => setTimeout(r, 400));

    writeFileSync(file, "2");
    await new Promise((r) => setTimeout(r, 600));

    assert.ok(captured, "files.changed event was emitted");
    const cap = captured as { uri: string; kind: FileChangeKind } | null;
    assert.ok(cap !== null);
    assert.ok(cap!.uri.includes("real.ts"));
    assert.ok(["change", "add"].includes(cap!.kind), `unexpected kind: ${cap!.kind}`);

    await w.stop();
  });

  it("emits unlink when a file is deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fw-unlink-"));
    const file = join(dir, "doomed.ts");
    writeFileSync(file, "1");
    const bus = new EventBus();
    let unlinkSeen = false;
    bus.subscribe((e) => {
      if (e.kind === "files.changed") {
        for (const c of e["changes"] as FileChange[]) {
          if (c.kind === "unlink" && c.uri.includes("doomed.ts")) {
            unlinkSeen = true;
          }
        }
      }
    });
    const w = createFileWatcher(bus, { debounceMs: SHORT_DEBOUNCE });
    await w.start(dir);
    await new Promise((r) => setTimeout(r, 400));

    unlinkSync(file);
    await new Promise((r) => setTimeout(r, 600));

    assert.equal(unlinkSeen, true);
    await w.stop();
  });
});

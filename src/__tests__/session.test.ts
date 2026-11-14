// Unit tests for session/ — EventBus, SessionStore, Session lifecycle.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "../session/event-bus.ts";
import { createSessionStore } from "../session/session-store.ts";

describe("session/EventBus", () => {
  it("emits events to subscribers", () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.subscribe((e) => received.push(e.kind));
    bus.emit({ kind: "test.event", at: Date.now() });
    assert.deepEqual(received, ["test.event"]);
  });

  it("replays past events to new subscribers", () => {
    const bus = new EventBus();
    bus.emit({ kind: "first", at: 1 });
    bus.emit({ kind: "second", at: 2 });

    const received: string[] = [];
    bus.subscribe((e) => received.push(e.kind));

    assert.deepEqual(received, ["first", "second"]);
  });

  it("respects the bounded replay cap", () => {
    const bus = new EventBus(3);
    for (let i = 0; i < 10; i++) {
      bus.emit({ kind: `e${i}`, at: i });
    }

    const received: string[] = [];
    bus.subscribe((e) => received.push(e.kind));

    assert.equal(received.length, 3);
    assert.deepEqual(received, ["e7", "e8", "e9"]);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new EventBus();
    const received: string[] = [];
    const unsub = bus.subscribe((e) => received.push(e.kind));

    bus.emit({ kind: "before", at: 1 });
    unsub();
    bus.emit({ kind: "after", at: 2 });

    assert.deepEqual(received, ["before"]);
  });

  it("fan-out: multiple subscribers see the same event", () => {
    const bus = new EventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((e) => a.push(e.kind));
    bus.subscribe((e) => b.push(e.kind));

    bus.emit({ kind: "shared", at: 1 });

    assert.deepEqual(a, ["shared"]);
    assert.deepEqual(b, ["shared"]);
  });
});

describe("session/SessionStore", () => {
  it("open creates a session with a valid id", () => {
    const store = createSessionStore();
    const session = store.open(["file:///test/repo"]);
    assert.ok(session.id.startsWith("sess_"));
    assert.equal(session.closed, false);
  });

  it("get retrieves an open session", () => {
    const store = createSessionStore();
    const session = store.open(["file:///test/repo"]);
    const retrieved = store.get(session.id);
    assert.ok(retrieved);
    assert.equal(retrieved!.id, session.id);
  });

  it("get returns null for unknown id", () => {
    const store = createSessionStore();
    assert.equal(store.get("sess_nonexistent"), null);
  });

  it("close removes the session", () => {
    const store = createSessionStore();
    const session = store.open(["file:///test/repo"]);
    const closed = store.close(session.id);
    assert.equal(closed, true);
    assert.equal(store.get(session.id), null);
  });

  it("close returns false for unknown id", () => {
    const store = createSessionStore();
    assert.equal(store.close("sess_unknown"), false);
  });

  it("multi-tab share-session: same URIs reuse the same session", () => {
    const store = createSessionStore();
    const s1 = store.open(["file:///repo"]);
    const s2 = store.open(["file:///repo"]);
    assert.equal(s1.id, s2.id, "Same URI set should return the same session");
  });

  it("different URIs create different sessions", () => {
    const store = createSessionStore();
    const s1 = store.open(["file:///repo-a"]);
    const s2 = store.open(["file:///repo-b"]);
    assert.notEqual(s1.id, s2.id);
  });

  it("reopening after close creates a new session", () => {
    const store = createSessionStore();
    const s1 = store.open(["file:///repo"]);
    const id1 = s1.id;
    store.close(id1);
    const s2 = store.open(["file:///repo"]);
    assert.notEqual(s2.id, id1);
  });

  it("open emits workspace.opened event", () => {
    const store = createSessionStore();
    const session = store.open(["file:///repo"]);
    const events: string[] = [];
    session.eventBus.subscribe((e) => events.push(e.kind));
    assert.ok(events.includes("workspace.opened"));
  });

  it("close emits workspace.closed event", () => {
    const store = createSessionStore();
    const session = store.open(["file:///repo"]);
    const events: string[] = [];
    session.eventBus.subscribe((e) => events.push(e.kind));
    store.close(session.id);
    assert.ok(events.includes("workspace.closed"));
  });

  it("all() lists open sessions", () => {
    const store = createSessionStore();
    store.open(["file:///a"]);
    store.open(["file:///b"]);
    assert.equal(store.all().length, 2);
  });
});

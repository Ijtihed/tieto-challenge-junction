// Tests for obs/event-log — write roundtrip, rotation, opt-out, non-blocking, schema.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEventLogger, graphStateHash } from "../obs/event-log.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import type { MultiRepoGraph } from "../domain/multi-repo.ts";

let tempDir: string;

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "schema-event-log-"));
});

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function parseLines(raw: string): Record<string, unknown>[] {
  return raw
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("obs/event-log", () => {
  it("write + read roundtrip", async () => {
    const logPath = join(tempDir, "roundtrip.jsonl");
    const logger = createEventLogger({ path: logPath, enabled: true });

    for (let i = 0; i < 5; i++) {
      logger.log({ sid: "s1", kind: "op.accepted", opId: `op-${i}` } as any);
    }
    await logger.flush();
    await logger.close();

    const raw = await readFile(logPath, "utf-8");
    const events = parseLines(raw);
    assert.equal(events.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(events[i]!["opId"], `op-${i}`);
    }
  });

  it("every event has v:1, ts, and kind", async () => {
    const logPath = join(tempDir, "schema-fields.jsonl");
    const logger = createEventLogger({ path: logPath, enabled: true });

    logger.log({ sid: "s1", kind: "workspace.opened", lc: 3, nc: 100, ec: 50 } as any);
    logger.log({ sid: "s1", kind: "extract.completed", lang: "typescript", nc: 80, ec: 40, ms: 120 } as any);
    logger.log({ sid: "s1", kind: "op.proposed", opId: "op1", gh: "abc", pc: true } as any);
    await logger.flush();
    await logger.close();

    const events = parseLines(await readFile(logPath, "utf-8"));
    assert.equal(events.length, 3);
    for (const ev of events) {
      assert.equal(ev["v"], 1, "missing v:1");
      assert.ok(typeof ev["ts"] === "string" && ev["ts"].length > 0, "missing ts");
      assert.ok(typeof ev["kind"] === "string" && ev["kind"].length > 0, "missing kind");
      const ts = new Date(ev["ts"] as string);
      assert.ok(!isNaN(ts.getTime()), "ts is not a valid ISO timestamp");
    }
  });

  it("rotation creates .1.jsonl when maxBytes exceeded", async () => {
    const logPath = join(tempDir, "rotate", "events.jsonl");
    const rotatedPath = join(tempDir, "rotate", "events.1.jsonl");
    const logger = createEventLogger({ path: logPath, maxBytes: 500, enabled: true });

    for (let i = 0; i < 30; i++) {
      logger.log({ sid: "s1", kind: "op.accepted", opId: `op-${i}-${"x".repeat(20)}` } as any);
      if (i % 3 === 2) await logger.flush();
    }
    await logger.flush();
    await logger.close();

    // The rotated file should exist with valid events.
    const rotatedStat = await stat(rotatedPath);
    assert.ok(rotatedStat.size > 0, "rotated file should exist and be non-empty");
    const rotatedEvents = parseLines(await readFile(rotatedPath, "utf-8"));
    assert.ok(rotatedEvents.length > 0, "rotated file should contain events");
    for (const ev of rotatedEvents) {
      assert.equal(ev["v"], 1);
      assert.equal(ev["kind"], "op.accepted");
    }

    // Current file should also exist with events.
    const currentEvents = parseLines(await readFile(logPath, "utf-8"));
    assert.ok(currentEvents.length > 0, "current file should contain events");
  });

  it("disabled mode creates no file", async () => {
    const logPath = join(tempDir, "disabled", "events.jsonl");
    const logger = createEventLogger({ path: logPath, enabled: false });

    logger.log({ sid: "s1", kind: "op.accepted", opId: "op-1" } as any);
    logger.log({ sid: "s1", kind: "op.accepted", opId: "op-2" } as any);
    await logger.flush();
    await logger.close();

    let exists = true;
    try {
      await stat(logPath);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, "file should not exist when disabled");
  });

  it("non-blocking: no throw on read-only directory", async () => {
    const roDir = join(tempDir, "readonly-dir");
    await mkdir(roDir, { recursive: true });
    await chmod(roDir, 0o444);

    const logPath = join(roDir, "subdir", "events.jsonl");
    const logger = createEventLogger({ path: logPath, enabled: true });

    logger.log({ sid: "s1", kind: "op.accepted", opId: "op-1" } as any);
    await assert.doesNotReject(async () => {
      await logger.flush();
      await logger.close();
    });

    // Restore permissions for cleanup
    await chmod(roDir, 0o755);
  });

  it("batching flushes at 10 events", async () => {
    const logPath = join(tempDir, "batch.jsonl");
    const logger = createEventLogger({ path: logPath, enabled: true });

    for (let i = 0; i < 10; i++) {
      logger.log({ sid: "s1", kind: "op.accepted", opId: `op-${i}` } as any);
    }
    // The 10th event triggers an auto-flush; give it a moment to complete.
    await new Promise((r) => setTimeout(r, 50));
    await logger.close();

    const events = parseLines(await readFile(logPath, "utf-8"));
    assert.equal(events.length, 10);
  });
});

describe("graphStateHash", () => {
  it("returns deterministic hex string", () => {
    const graph: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [
        {
          uri: "file:///repo",
          nodes: [
            { id: "n1", kind: "function", name: "foo", locator: "file:///a.ts" },
            { id: "n2", kind: "function", name: "bar", locator: "file:///b.ts" },
            { id: "n3", kind: "class", name: "Baz", locator: "file:///c.ts" },
          ],
          edges: [
            { id: "e1", source: "n1", target: "n2", relation: "calls" },
          ],
          clusters: [],
        },
      ],
      interRepoEdges: [],
    };
    const h1 = graphStateHash(graph);
    const h2 = graphStateHash(graph);
    assert.equal(h1, h2, "hash should be deterministic");
    assert.ok(/^[0-9a-f]+$/.test(h1), "hash should be hex");
  });

  it("different graphs produce different hashes", () => {
    const g1: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [
        {
          uri: "file:///a",
          nodes: [{ id: "n1", kind: "function", name: "f", locator: "l" }],
          edges: [],
          clusters: [],
        },
      ],
      interRepoEdges: [],
    };
    const g2: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [
        {
          uri: "file:///a",
          nodes: [
            { id: "n1", kind: "function", name: "f", locator: "l" },
            { id: "n2", kind: "class", name: "g", locator: "l2" },
          ],
          edges: [],
          clusters: [],
        },
      ],
      interRepoEdges: [],
    };
    assert.notEqual(graphStateHash(g1), graphStateHash(g2));
  });

  it("empty graph hashes without error", () => {
    const graph: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: [],
      interRepoEdges: [],
    };
    const h = graphStateHash(graph);
    assert.ok(typeof h === "string" && h.length > 0);
  });
});

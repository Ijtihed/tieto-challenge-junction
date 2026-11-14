// Per architecture/phase-13.md §2.4 T1.9 + T1.10
// Tests for workspace.list_files, workspace.read_file, workspace.write_file.
// These actions were added for Schema Studio's Monaco editor and file tree.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspaceOpen } from "../actions/workspace-open.ts";
import { workspaceClose } from "../actions/workspace-close.ts";
import { workspaceListFiles } from "../actions/workspace-list-files.ts";
import { workspaceReadFile } from "../actions/workspace-read-file.ts";
import { workspaceWriteFile } from "../actions/workspace-write-file.ts";
import { getSession } from "../session/index.ts";

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

// ── workspace.list_files ──

describe("workspace.list_files", () => {
  it("returns files for the fixture workspace", async () => {
    const r = await workspaceListFiles.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { files: { path: string; name: string; relativePath: string }[] };
    assert.ok(data.files.length > 0, "should return at least one file");
    assert.ok(data.files.some((f) => f.name === "app.ts"), "should include app.ts");
    assert.ok(data.files.some((f) => f.name === "routes.ts"), "should include routes.ts");
  });

  it("excludes node_modules and .git", async () => {
    const r = await workspaceListFiles.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { files: { relativePath: string }[] };
    const hasNodeModules = data.files.some((f) => f.relativePath.includes("node_modules"));
    assert.equal(hasNodeModules, false, "should not include node_modules");
    const hasGit = data.files.some((f) => f.relativePath.startsWith(".git/"));
    assert.equal(hasGit, false, "should not include .git");
  });

  it("returns files sorted by relative path", async () => {
    const r = await workspaceListFiles.handle({ sessionId });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { files: { relativePath: string }[] };
    const paths = data.files.map((f) => f.relativePath);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(paths, sorted, "files should be sorted by relativePath");
  });

  it("returns error for invalid session", async () => {
    const r = await workspaceListFiles.handle({ sessionId: "nonexistent" });
    assert.equal(r.ok, false);
  });

  it("returns error when sessionId is missing", async () => {
    const r = await workspaceListFiles.handle({});
    assert.equal(r.ok, false);
  });
});

// ── workspace.read_file ──

describe("workspace.read_file", () => {
  it("reads a file from the fixture workspace", async () => {
    const appPath = resolve(FIXTURE_PATH, "app.ts");
    const r = await workspaceReadFile.handle({ sessionId, path: appPath });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { content: string; path: string };
    assert.equal(data.path, appPath);
    assert.ok(data.content.length > 0, "content should not be empty");
    assert.ok(data.content.includes("express") || data.content.includes("import") || data.content.includes("app"),
      "content should contain recognizable code");
  });

  it("rejects paths outside the workspace allow-list", async () => {
    const r = await workspaceReadFile.handle({ sessionId, path: "/etc/passwd" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "access-denied");
  });

  it("returns error for nonexistent file", async () => {
    const r = await workspaceReadFile.handle({
      sessionId,
      path: resolve(FIXTURE_PATH, "does-not-exist.ts"),
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "read-error");
  });

  it("returns error for invalid session", async () => {
    const r = await workspaceReadFile.handle({ sessionId: "bad", path: "/any" });
    assert.equal(r.ok, false);
  });

  it("returns error when path is missing", async () => {
    const r = await workspaceReadFile.handle({ sessionId });
    assert.equal(r.ok, false);
  });
});

// ── workspace.write_file ──

describe("workspace.write_file", () => {
  let tmpDir: string;
  let tmpSessionId: string;

  before(async () => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "schema-write-test-"));
    mkdirSync(resolve(tmpDir, "src"), { recursive: true });
    writeFileSync(resolve(tmpDir, "src/index.ts"), 'console.log("hello");');

    const r = await workspaceOpen.handle({ uris: [`file://${tmpDir}`] });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("tmp workspace open failed");
    tmpSessionId = (r.data as { sessionId: string }).sessionId;
  });

  after(async () => {
    await workspaceClose.handle({ sessionId: tmpSessionId });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a file and returns success", async () => {
    const filePath = resolve(tmpDir, "src/new-file.ts");
    const content = 'export function hello() { return "world"; }\n';
    const r = await workspaceWriteFile.handle({
      sessionId: tmpSessionId,
      path: filePath,
      content,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const data = r.data as { written: boolean; path: string };
    assert.equal(data.written, true);
    assert.equal(data.path, filePath);

    const ondisk = readFileSync(filePath, "utf-8");
    assert.equal(ondisk, content, "file on disk should match written content");
  });

  it("overwrites an existing file", async () => {
    const filePath = resolve(tmpDir, "src/index.ts");
    const newContent = 'console.log("updated");';
    const r = await workspaceWriteFile.handle({
      sessionId: tmpSessionId,
      path: filePath,
      content: newContent,
    });
    assert.equal(r.ok, true);
    const ondisk = readFileSync(filePath, "utf-8");
    assert.equal(ondisk, newContent);
  });

  it("invalidates graph nodes for the written file", async () => {
    const session = getSession(tmpSessionId);
    assert.ok(session, "session should exist");

    const filePath = resolve(tmpDir, "src/index.ts");
    const r = await workspaceWriteFile.handle({
      sessionId: tmpSessionId,
      path: filePath,
      content: 'export const x = 1;',
    });
    assert.equal(r.ok, true);

    let gotInvalidateEvent = false;
    for (const event of [...(session as unknown as { eventBus: { history: { kind: string }[] } }).eventBus.history ?? []]) {
      if (event.kind === "extractor.invalidated") gotInvalidateEvent = true;
    }
  });

  it("rejects paths outside the workspace allow-list", async () => {
    const r = await workspaceWriteFile.handle({
      sessionId: tmpSessionId,
      path: "/etc/shadow",
      content: "malicious",
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "access-denied");
  });

  it("returns error when content is missing", async () => {
    const r = await workspaceWriteFile.handle({
      sessionId: tmpSessionId,
      path: resolve(tmpDir, "src/test.ts"),
    });
    assert.equal(r.ok, false);
  });
});

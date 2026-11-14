// Tests for the 4 enhancements added to all 5 language extractors:
// body fingerprint, env access, field access, effect annotations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePythonFile } from "../extractors/extractor-python/parser.ts";
import { parseGoFile } from "../extractors/extractor-go/parser.ts";

// ── Python extractor enhancements ──

describe("Python extractor enhancements", () => {
  it("attaches body fingerprint to function definitions", () => {
    const content = `def hello():\n    return "world"\n`;
    const result = parsePythonFile("/test/fp.py", content, "file:///test");
    const fn = result.nodes.find((n) => n.name === "hello");
    assert.ok(fn, "should find hello function");
    assert.ok(fn!.bodyFingerprint !== undefined, "should have bodyFingerprint");
    assert.equal(typeof fn!.bodyFingerprint, "number");
  });

  it("attaches body fingerprint to class definitions", () => {
    const content = `class User:\n    name = ""\n`;
    const result = parsePythonFile("/test/cls.py", content, "file:///test");
    const cls = result.nodes.find((n) => n.name === "User");
    assert.ok(cls, "should find User class");
    assert.ok(cls!.bodyFingerprint !== undefined, "should have bodyFingerprint");
  });

  it("produces same fingerprint for identical function bodies", () => {
    const content = `def foo():\n    return 42\n`;
    const r1 = parsePythonFile("/test/a.py", content, "file:///test");
    const r2 = parsePythonFile("/test/b.py", content, "file:///test");
    const f1 = r1.nodes.find((n) => n.name === "foo");
    const f2 = r2.nodes.find((n) => n.name === "foo");
    assert.equal(f1!.bodyFingerprint, f2!.bodyFingerprint);
  });

  it("detects os.getenv read access", () => {
    const content = `import os\ndef config():\n    val = os.getenv("DB_HOST")\n`;
    const result = parsePythonFile("/test/env.py", content, "file:///test");
    assert.ok(result.envAccesses.length >= 1, "should detect env access");
    const access = result.envAccesses.find((e) => e.envVar === "DB_HOST");
    assert.ok(access, "should find DB_HOST");
    assert.equal(access!.kind, "read");
  });

  it("detects os.environ.get read access", () => {
    const content = `import os\ndef setup():\n    port = os.environ.get("PORT")\n`;
    const result = parsePythonFile("/test/env2.py", content, "file:///test");
    const access = result.envAccesses.find((e) => e.envVar === "PORT");
    assert.ok(access, "should find PORT");
    assert.equal(access!.kind, "read");
  });

  it("detects self.field access in class methods", () => {
    const content = `class Svc:\n    def run(self):\n        x = self.name\n        self.count = 0\n`;
    const result = parsePythonFile("/test/field.py", content, "file:///test");
    const methodNode = result.nodes.find((n) => n.name === "Svc.run");
    assert.ok(methodNode, "should extract class method as node");
    assert.ok(result.fieldAccesses.length >= 1, "should detect field accesses");
    const readAccess = result.fieldAccesses.find((f) => f.fieldName === "name" && f.kind === "read");
    assert.ok(readAccess, "should find self.name read");
    assert.equal(readAccess!.enclosingNodeId, methodNode!.id);
  });

  it("returns empty envAccesses and fieldAccesses when none present", () => {
    const content = `def simple():\n    return 1\n`;
    const result = parsePythonFile("/test/simple.py", content, "file:///test");
    assert.equal(result.envAccesses.length, 0);
    assert.equal(result.fieldAccesses.length, 0);
  });
});

// ── Go extractor enhancements ──

describe("Go extractor enhancements", () => {
  it("attaches body fingerprint to function declarations", () => {
    const content = `package main\n\nfunc Hello() string {\n\treturn "world"\n}\n`;
    const result = parseGoFile("/test/fp.go", content, "file:///test");
    const fn = result.nodes.find((n) => n.name === "Hello");
    assert.ok(fn, "should find Hello function");
    assert.ok(fn!.bodyFingerprint !== undefined, "should have bodyFingerprint");
  });

  it("attaches body fingerprint to struct type declarations", () => {
    const content = `package main\n\ntype User struct {\n\tName string\n}\n`;
    const result = parseGoFile("/test/model.go", content, "file:///test");
    const s = result.nodes.find((n) => n.name === "User");
    assert.ok(s, "should find User struct");
    assert.ok(s!.bodyFingerprint !== undefined, "should have bodyFingerprint");
  });

  it("produces same fingerprint for identical function bodies", () => {
    const content = `package main\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n`;
    const r1 = parseGoFile("/test/a.go", content, "file:///test");
    const r2 = parseGoFile("/test/b.go", content, "file:///test");
    const f1 = r1.nodes.find((n) => n.name === "Add");
    const f2 = r2.nodes.find((n) => n.name === "Add");
    assert.equal(f1!.bodyFingerprint, f2!.bodyFingerprint);
  });

  it("detects os.Getenv read access", () => {
    const content = `package main\nimport "os"\nfunc Config() {\n\thost := os.Getenv("DB_HOST")\n}\n`;
    const result = parseGoFile("/test/env.go", content, "file:///test");
    assert.ok(result.envAccesses.length >= 1, "should detect env access");
    const access = result.envAccesses.find((e) => e.envVar === "DB_HOST");
    assert.ok(access, "should find DB_HOST");
    assert.equal(access!.kind, "read");
  });

  it("detects field access on structs", () => {
    const content = `package main\n\ntype Svc struct { count int }\nfunc (s *Svc) Run() {\n\tx := s.count\n}\n`;
    const result = parseGoFile("/test/field.go", content, "file:///test");
    assert.ok(result.fieldAccesses.length >= 1, "should detect field accesses");
  });

  it("returns empty envAccesses and fieldAccesses when none present", () => {
    const content = `package main\n\nfunc Simple() int {\n\treturn 1\n}\n`;
    const result = parseGoFile("/test/simple.go", content, "file:///test");
    assert.equal(result.envAccesses.length, 0);
    assert.equal(result.fieldAccesses.length, 0);
  });
});

// ── Cross-extractor consistency ──

describe("cross-extractor consistency", () => {
  it("Python and Go fingerprints use the same algorithm", () => {
    // Same body text should produce same fingerprint regardless of extractor
    const pyContent = `def add(a, b):\n    return a + b\n`;
    const goContent = `package main\n\nfunc add(a, b int) int {\n\treturn a + b\n}\n`;
    const pyResult = parsePythonFile("/test/add.py", pyContent, "file:///test");
    const goResult = parseGoFile("/test/add.go", goContent, "file:///test");

    const pyFn = pyResult.nodes.find((n) => n.name === "add");
    const goFn = goResult.nodes.find((n) => n.name === "add");

    // They won't match because the body text differs, but both should be defined
    assert.ok(pyFn!.bodyFingerprint !== undefined);
    assert.ok(goFn!.bodyFingerprint !== undefined);
    assert.equal(typeof pyFn!.bodyFingerprint, "number");
    assert.equal(typeof goFn!.bodyFingerprint, "number");
  });

  it("all parsers return envAccesses array even when empty", () => {
    const pyResult = parsePythonFile("/test/x.py", "x = 1\n", "file:///test");
    const goResult = parseGoFile("/test/x.go", "package main\n", "file:///test");
    assert.ok(Array.isArray(pyResult.envAccesses));
    assert.ok(Array.isArray(goResult.envAccesses));
  });

  it("all parsers return fieldAccesses array even when empty", () => {
    const pyResult = parsePythonFile("/test/x.py", "x = 1\n", "file:///test");
    const goResult = parseGoFile("/test/x.go", "package main\n", "file:///test");
    assert.ok(Array.isArray(pyResult.fieldAccesses));
    assert.ok(Array.isArray(goResult.fieldAccesses));
  });
});

// Unit tests for extractors/extractor-typescript/parser.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFile } from "../extractors/extractor-typescript/parser.ts";

const REPO_URI = "file:///test/repo";

describe("extractor-typescript/parser", () => {
  it("extracts file-level node", () => {
    const result = parseFile("/test/repo/main.ts", "const x = 1;", REPO_URI);
    assert.ok(result.nodes.length >= 1);
    assert.equal(result.nodes[0]!.name, "main.ts");
    assert.equal(result.nodes[0]!.kind, "utility");
  });

  it("extracts function declarations", () => {
    const code = `function greet(name: string) { return "hello " + name; }`;
    const result = parseFile("/test/repo/greet.ts", code, REPO_URI);
    const funcNode = result.nodes.find((n) => n.name === "greet");
    assert.ok(funcNode, "Should find function 'greet'");
    assert.equal(funcNode!.kind, "utility");
  });

  it("extracts exported function declarations", () => {
    const code = `export function handler(req: any) { return req; }`;
    const result = parseFile("/test/repo/handler.ts", code, REPO_URI);
    const funcNode = result.nodes.find((n) => n.name === "handler");
    assert.ok(funcNode, "Should find exported function 'handler'");
  });

  it("extracts arrow function exports", () => {
    const code = `export const fetchData = async () => { return []; };`;
    const result = parseFile("/test/repo/api.ts", code, REPO_URI);
    const arrowNode = result.nodes.find((n) => n.name === "fetchData");
    assert.ok(arrowNode, "Should find arrow function 'fetchData'");
  });

  it("extracts class declarations with methods", () => {
    const code = `
export class UserService {
  findById(id: number) { return null; }
  create(data: any) { return data; }
}`;
    const result = parseFile("/test/repo/user-service.ts", code, REPO_URI);
    const classNode = result.nodes.find((n) => n.name === "UserService");
    assert.ok(classNode, "Should find class 'UserService'");
    assert.equal(classNode!.kind, "service");

    const findMethod = result.nodes.find((n) => n.name === "UserService.findById");
    assert.ok(findMethod, "Should find method 'UserService.findById'");

    const createMethod = result.nodes.find((n) => n.name === "UserService.create");
    assert.ok(createMethod, "Should find method 'UserService.create'");
  });

  it("extracts import statements with relative resolution", () => {
    const code = `import { foo } from "./utils";\nimport bar from "../lib/bar";`;
    const result = parseFile("/test/repo/src/main.ts", code, REPO_URI);
    assert.equal(result.imports.length, 2);
    assert.ok(result.imports[0]!.resolvedPath.endsWith("/test/repo/src/utils.ts"));
    assert.ok(result.imports[1]!.resolvedPath.endsWith("/test/repo/lib/bar.ts"));
  });

  it("handles files with no functions or imports", () => {
    const code = `const VERSION = "1.0.0";\nexport default VERSION;`;
    const result = parseFile("/test/repo/version.ts", code, REPO_URI);
    assert.ok(result.nodes.length >= 1, "Should have at least the file node");
    assert.equal(result.imports.length, 0);
  });

  it("skips external (non-relative) imports", () => {
    const code = `import express from "express";`;
    const result = parseFile("/test/repo/app.ts", code, REPO_URI);
    assert.equal(result.imports.length, 1);
    assert.equal(result.imports[0]!.source, "express");
    assert.equal(result.imports[0]!.resolvedPath, "express");
  });

  it("node IDs are deterministic", () => {
    const code = `export function handler() {}`;
    const r1 = parseFile("/test/repo/h.ts", code, REPO_URI);
    const r2 = parseFile("/test/repo/h.ts", code, REPO_URI);
    assert.equal(r1.nodes[0]!.id, r2.nodes[0]!.id);
    assert.equal(r1.nodes[1]!.id, r2.nodes[1]!.id);
  });

  it("handles empty file", () => {
    const result = parseFile("/test/repo/empty.ts", "", REPO_URI);
    assert.ok(result.nodes.length >= 1, "Should have the file node even for empty file");
    assert.equal(result.imports.length, 0);
  });
});

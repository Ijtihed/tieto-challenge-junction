// Phase 8 — unit tests for Java/Kotlin, Ruby, Rust extractors + generic-config.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Directly test the parsers by feeding them source code strings.
// The extractors use tree-sitter which is already verified to load.

import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import Ruby from "tree-sitter-ruby";
import Rust from "tree-sitter-rust";

const jp = new Parser(); jp.setLanguage(Java);
const rp = new Parser(); rp.setLanguage(Ruby);
const rs = new Parser(); rs.setLanguage(Rust);

describe("tree-sitter Java parser", () => {
  it("parses a class declaration", () => {
    const tree = jp.parse("public class Foo { void bar() {} }");
    assert.equal(tree.rootNode.type, "program");
    assert.ok(tree.rootNode.childCount >= 1);
  });

  it("parses Spring-annotated methods", () => {
    const code = `import org.springframework.web.bind.annotation.*;
@RestController
public class TodoController {
  @GetMapping("/api/todos")
  public List<Todo> list() { return List.of(); }
}`;
    const tree = jp.parse(code);
    assert.equal(tree.rootNode.type, "program");
    const classNode = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "class_declaration");
    assert.ok(classNode, "Expected class_declaration");
  });

  it("parses interfaces", () => {
    const tree = jp.parse("public interface UserService { User findById(long id); }");
    assert.equal(tree.rootNode.type, "program");
    const intf = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "interface_declaration");
    assert.ok(intf, "Expected interface_declaration");
  });
});

describe("tree-sitter Ruby parser", () => {
  it("parses a class", () => {
    const tree = rp.parse("class TodosController < ApplicationController\n  def index\n  end\nend");
    assert.equal(tree.rootNode.type, "program");
    assert.ok(tree.rootNode.childCount >= 1);
  });

  it("parses methods", () => {
    const tree = rp.parse("def hello\n  puts 'hi'\nend");
    const method = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "method");
    assert.ok(method, "Expected method node");
  });

  it("parses modules", () => {
    const tree = rp.parse("module Auth\nend");
    const mod = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "module");
    assert.ok(mod, "Expected module node");
  });
});

describe("tree-sitter Rust parser", () => {
  it("parses a function", () => {
    const tree = rs.parse("fn main() { println!(\"hello\"); }");
    assert.equal(tree.rootNode.type, "source_file");
    const fn_item = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "function_item");
    assert.ok(fn_item, "Expected function_item");
  });

  it("parses structs", () => {
    const tree = rs.parse("struct Todo { id: u64, title: String }");
    const st = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "struct_item");
    assert.ok(st, "Expected struct_item");
  });

  it("parses impl blocks", () => {
    const tree = rs.parse("struct Svc {}\nimpl Svc { fn handle(&self) {} }");
    const impl = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "impl_item");
    assert.ok(impl, "Expected impl_item");
  });

  it("parses traits as contracts", () => {
    const tree = rs.parse("trait Repository { fn find(&self, id: u64); }");
    const tr = tree.rootNode.children.find((c: Parser.SyntaxNode) => c.type === "trait_item");
    assert.ok(tr, "Expected trait_item");
  });
});

describe("generic-config parser — protobuf", () => {
  it("extracts service and rpc nodes from .proto", async () => {
    const { extractorGenericConfig } = await import("../extractors/extractor-generic-config/index.ts");
    const mockFs = {
      readFile: async () => `syntax = "proto3";\nservice TodoService {\n  rpc Create (CreateReq) returns (CreateRes);\n  rpc List (ListReq) returns (ListRes);\n}\nmessage CreateReq { string title = 1; }`,
      listDir: async () => ["todo.proto"],
      writeFile: async () => {},
      exists: async () => true,
      resolveAllowed: () => true,
    };

    const events: unknown[] = [];
    for await (const e of extractorGenericConfig.extract({ repoUri: "file:///test", fs: mockFs })) {
      events.push(e);
    }
    const done = events.find((e: any) => e.kind === "done") as any;
    assert.ok(done?.data);
    const nodes = done.data.nodes;
    assert.ok(nodes.some((n: any) => n.name === "proto:TodoService"), "Expected service node");
    assert.ok(nodes.some((n: any) => n.name === "proto:rpc:Create"), "Expected rpc node");
    assert.ok(nodes.some((n: any) => n.name === "proto:msg:CreateReq"), "Expected message node");
  });
});

describe("generic-config parser — SQL DDL", () => {
  it("extracts table nodes from SQL", async () => {
    const { extractorGenericConfig } = await import("../extractors/extractor-generic-config/index.ts");
    const mockFs = {
      readFile: async () => `CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);\nCREATE TABLE IF NOT EXISTS todos (id SERIAL, title TEXT);`,
      listDir: async () => ["schema.sql"],
      writeFile: async () => {},
      exists: async () => true,
      resolveAllowed: () => true,
    };

    const events: unknown[] = [];
    for await (const e of extractorGenericConfig.extract({ repoUri: "file:///test", fs: mockFs })) {
      events.push(e);
    }
    const done = events.find((e: any) => e.kind === "done") as any;
    assert.ok(done?.data);
    assert.ok(done.data.nodes.some((n: any) => n.name === "sql:table:users"));
    assert.ok(done.data.nodes.some((n: any) => n.name === "sql:table:todos"));
  });
});

describe("generic-config parser — empty repo", () => {
  it("returns empty nodes for repo with no config files", async () => {
    const { extractorGenericConfig } = await import("../extractors/extractor-generic-config/index.ts");
    const mockFs = {
      readFile: async () => "",
      listDir: async () => ["main.ts", "index.js"],
      writeFile: async () => {},
      exists: async () => true,
      resolveAllowed: () => true,
    };

    const events: unknown[] = [];
    for await (const e of extractorGenericConfig.extract({ repoUri: "file:///test", fs: mockFs })) {
      events.push(e);
    }
    const done = events.find((e: any) => e.kind === "done") as any;
    assert.ok(done?.data);
    assert.equal(done.data.nodes.length, 0);
  });
});

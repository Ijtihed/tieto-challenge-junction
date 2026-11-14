// Per `architecture/v1-launch-plan.md` Step 1 — proves that every
// bundled extractor parses files of realistic real-repo size without
// the pre-fix "Invalid argument" silent-drop bug.
//
// The shape mirrors the plan's spec: 5 sizes × 7 extractors = 35
// individual stress tests. Each builds a synthetic source file with
// roughly the target line count and asserts:
//   1. parse does not throw
//   2. at least the file node is emitted
//   3. at least one top-level function/class node is emitted
//
// Sizes are 800 / 1500 / 2500 / 5000 / 10000 lines, all of which
// blow past the 32 KB default tree-sitter buffer that previously
// dropped them.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFile } from "../extractors/extractor-typescript/parser.ts";
import { parsePythonFile } from "../extractors/extractor-python/parser.ts";
import { parseGoFile } from "../extractors/extractor-go/parser.ts";
import { extractorJavaKotlin } from "../extractors/extractor-java-kotlin/index.ts";
import { extractorRuby } from "../extractors/extractor-ruby/index.ts";
import { extractorRust } from "../extractors/extractor-rust/index.ts";
import { extractorGenericConfig } from "../extractors/extractor-generic-config/index.ts";
import type { FsAdapter } from "../adapters/index.ts";

const SIZES: readonly number[] = [800, 1500, 2500, 5000, 10000];

const REPO_PATH = "/synthetic/repo";
const REPO_URI = `file://${REPO_PATH}`;

/** Generate synthetic source by repeating `blockGen` until both the
 *  target line count and the 32 KB (default tree-sitter buffer)
 *  threshold are crossed. This guarantees every fixture exercises the
 *  bufferSize fix even when the language under test has very short
 *  lines (e.g. Ruby, Rust, proto). */
function repeatBlock(blockGen: (i: number) => string, minLines: number): string {
  const blocks = [] as string[];
  let totalLines = 0;
  let i = 0;
  let joined = "";
  const MIN_BYTES = 33 * 1024;
  while (totalLines < minLines || joined.length < MIN_BYTES) {
    const b = blockGen(i);
    blocks.push(b);
    totalLines += b.split("\n").length;
    joined = blocks.join("\n");
    i += 1;
  }
  return joined;
}

function tsSource(lines: number): string {
  return repeatBlock(
    (i) =>
      `export function fn${i}(a: number, b: number): number {\n` +
      `  const sum = a + b;\n` +
      `  const prod = a * b;\n` +
      `  return sum + prod;\n` +
      `}\n`,
    lines,
  );
}

function pythonSource(lines: number): string {
  return repeatBlock(
    (i) =>
      `def fn_${i}(a, b):\n` +
      `    s = a + b\n` +
      `    p = a * b\n` +
      `    return s + p\n`,
    lines,
  );
}

function goSource(lines: number): string {
  const body = repeatBlock(
    (i) =>
      `func Fn${i}(a, b int) int {\n` +
      `    s := a + b\n` +
      `    p := a * b\n` +
      `    return s + p\n` +
      `}\n`,
    Math.max(lines - 2, 1),
  );
  return `package main\n\n${body}`;
}

function javaSource(lines: number): string {
  const methods = repeatBlock(
    (i) =>
      `    public int fn${i}(int a, int b) {\n` +
      `        int s = a + b;\n` +
      `        int p = a * b;\n` +
      `        return s + p;\n` +
      `    }\n`,
    Math.max(lines - 4, 1),
  );
  return `package syn;\n\npublic class Big {\n${methods}}\n`;
}

function rubySource(lines: number): string {
  return repeatBlock(
    (i) =>
      `def fn_${i}(a, b)\n` +
      `  s = a + b\n` +
      `  p = a * b\n` +
      `  s + p\n` +
      `end\n`,
    lines,
  );
}

function rustSource(lines: number): string {
  return repeatBlock(
    (i) =>
      `pub fn fn_${i}(a: i64, b: i64) -> i64 {\n` +
      `    let s = a + b;\n` +
      `    let p = a * b;\n` +
      `    s + p\n` +
      `}\n`,
    lines,
  );
}

function protoSource(lines: number): string {
  const services = repeatBlock(
    (i) =>
      `message Msg${i}WithLongerNameForByteFootprint {\n` +
      `  int32 alpha_field_${i} = 1;\n` +
      `  int32 beta_field_${i} = 2;\n` +
      `  string description_field_${i} = 3;\n` +
      `  string identifier_field_${i} = 4;\n` +
      `  repeated int64 history_${i} = 5;\n` +
      `}\n`,
    lines,
  );
  return `syntax = "proto3";\n\n${services}`;
}

function makeFsAdapter(filePath: string, content: string): FsAdapter {
  return {
    readFile: async (p) => {
      if (p === filePath) return content;
      throw new Error(`unexpected read: ${p}`);
    },
    writeFile: async () => { throw new Error("not implemented"); },
    listDir: async () => [filePath],
    exists: async () => true,
    resolveAllowed: () => true,
  };
}

async function runExtractorOnce(
  extractor: { extract(ctx: { repoUri: string; fs: FsAdapter }): AsyncGenerator<{ kind: string; data?: { nodes?: readonly unknown[] } }> },
  filePath: string,
  content: string,
): Promise<{ nodes: readonly unknown[] }> {
  const fs = makeFsAdapter(filePath, content);
  let collected: { nodes: readonly unknown[] } = { nodes: [] };
  for await (const event of extractor.extract({ repoUri: REPO_URI, fs })) {
    if (event.kind === "done" && event.data) {
      collected = { nodes: event.data.nodes ?? [] };
    }
  }
  return collected;
}

describe("extractor-typescript: large files do not silently drop (bufferSize fix)", () => {
  for (const size of SIZES) {
    it(`parses a ${size}-line synthetic TS file`, () => {
      const code = tsSource(size);
      assert.ok(code.length > 32 * 1024, `precondition: source must exceed 32KB (got ${code.length})`);
      const result = parseFile(`${REPO_PATH}/big-${size}.ts`, code, REPO_URI);
      assert.ok(result.nodes.length >= 2, `expected file + at least one function node, got ${result.nodes.length}`);
      const fileNode = result.nodes.find((n) => n.name === `big-${size}.ts`);
      assert.ok(fileNode, "file node present");
      const funcs = result.nodes.filter((n) => n.name.startsWith("fn"));
      assert.ok(funcs.length > 0, "at least one function node");
    });
  }
});

describe("extractor-python: large files do not silently drop (bufferSize fix)", () => {
  for (const size of SIZES) {
    it(`parses a ${size}-line synthetic Python file`, () => {
      const code = pythonSource(size);
      assert.ok(code.length > 32 * 1024, `precondition: source must exceed 32KB (got ${code.length})`);
      const result = parsePythonFile(`${REPO_PATH}/big_${size}.py`, code, REPO_URI);
      assert.ok(result.nodes.length >= 2);
      const funcs = result.nodes.filter((n) => n.name.startsWith("fn_"));
      assert.ok(funcs.length > 0, "at least one function node");
    });
  }
});

describe("extractor-go: large files do not silently drop (bufferSize fix)", () => {
  for (const size of SIZES) {
    it(`parses a ${size}-line synthetic Go file`, () => {
      const code = goSource(size);
      assert.ok(code.length > 32 * 1024, `precondition: source must exceed 32KB (got ${code.length})`);
      const result = parseGoFile(`${REPO_PATH}/big_${size}.go`, code, REPO_URI);
      assert.ok(result.nodes.length >= 2);
      const funcs = result.nodes.filter((n) => n.name.startsWith("Fn"));
      assert.ok(funcs.length > 0, "at least one function node");
    });
  }
});

describe("extractor-java-kotlin: large files do not silently drop (bufferSize fix)", () => {
  for (const size of SIZES) {
    it(`parses a ${size}-line synthetic Java file`, async () => {
      const code = javaSource(size);
      assert.ok(code.length > 32 * 1024, `precondition: source must exceed 32KB (got ${code.length})`);
      const result = await runExtractorOnce(extractorJavaKotlin, `${REPO_PATH}/Big${size}.java`, code);
      assert.ok(result.nodes.length >= 2, `expected file + class/method nodes, got ${result.nodes.length}`);
    });
  }
});

describe("extractor-ruby: large files do not silently drop (bufferSize fix)", () => {
  for (const size of SIZES) {
    it(`parses a ${size}-line synthetic Ruby file`, async () => {
      const code = rubySource(size);
      assert.ok(code.length > 32 * 1024, `precondition: source must exceed 32KB (got ${code.length})`);
      const result = await runExtractorOnce(extractorRuby, `${REPO_PATH}/big_${size}.rb`, code);
      assert.ok(result.nodes.length >= 2, `expected file + method nodes, got ${result.nodes.length}`);
    });
  }
});

describe("extractor-rust: large files do not silently drop (bufferSize fix)", () => {
  for (const size of SIZES) {
    it(`parses a ${size}-line synthetic Rust file`, async () => {
      const code = rustSource(size);
      assert.ok(code.length > 32 * 1024, `precondition: source must exceed 32KB (got ${code.length})`);
      const result = await runExtractorOnce(extractorRust, `${REPO_PATH}/big_${size}.rs`, code);
      assert.ok(result.nodes.length >= 2, `expected file + function nodes, got ${result.nodes.length}`);
    });
  }
});

describe("extractor-generic-config: large config files do not silently drop", () => {
  for (const size of SIZES) {
    it(`parses a ${size}-line synthetic proto file`, async () => {
      const code = protoSource(size);
      assert.ok(code.length > 32 * 1024, `precondition: source must exceed 32KB (got ${code.length})`);
      const result = await runExtractorOnce(extractorGenericConfig, `${REPO_PATH}/big_${size}.proto`, code);
      assert.ok(result.nodes.length > 0, `expected contract nodes from proto, got ${result.nodes.length}`);
    });
  }
});

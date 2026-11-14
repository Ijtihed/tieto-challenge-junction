// Tests that all bundled .dl files parse without errors.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDatalog } from "../domain/datalog/index.ts";
import type { DlProgram } from "../domain/datalog/index.ts";

const BUNDLED_DIR = join(import.meta.dirname!, "../domain/rules/bundled");

describe("bundled Datalog rules", () => {
  let files: string[];
  try {
    files = readdirSync(BUNDLED_DIR).filter((f) => f.endsWith(".dl"));
  } catch {
    files = [];
  }

  it("bundled rules directory exists with .dl files", () => {
    assert.ok(files.length > 0, "expected .dl files in bundled rules directory");
  });

  for (const file of files) {
    it(`${file} parses without errors`, () => {
      const src = readFileSync(join(BUNDLED_DIR, file), "utf-8");
      const result = parseDatalog(src, file);
      if ("message" in result) {
        assert.fail(`Parse error in ${file}: ${result.message} at line ${result.line}:${result.column}`);
      }
      const prog = result as DlProgram;
      assert.ok(prog.rules.length > 0, `${file} should contain at least one rule`);
      assert.ok(prog.metadata.id, `${file} should have an id in metadata`);
    });
  }

  it("all bundled rules produce violation/2 heads", () => {
    for (const file of files) {
      const src = readFileSync(join(BUNDLED_DIR, file), "utf-8");
      const result = parseDatalog(src, file);
      if ("message" in result) continue;
      const prog = result as DlProgram;
      const violationRules = prog.rules.filter((r) => r.head.predicate === "violation");
      assert.ok(violationRules.length > 0, `${file} should have at least one violation rule`);
    }
  });
});

// Per `architecture/v1-launch-plan.md` Step 4 + Hora et al. 2026
// (arXiv:2605.16701): the 95.3% of repos with a .gitignore must
// be honoured at workspace.open. Five canonical fixtures cover:
//   1. gitignore-only filtering (no codegen, no binary)
//   2. codegen-only filtering (no .gitignore present)
//   3. both layers stacking
//   4. neither — every file allowed through
//   5. deep-nested .gitignore at a subdirectory

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildComposedFilter,
  emptyComposedFilter,
  type GitignoreSource,
} from "../domain/gitignore-filter.ts";
import { isIgnoredPath } from "../domain/path-ignore.ts";

describe("gitignore filter: 5 canonical fixtures", () => {
  it("1. gitignore-only: root .gitignore excludes dist/", () => {
    const sources: GitignoreSource[] = [
      { directory: "", patterns: ["dist/", "*.log"] },
    ];
    const f = buildComposedFilter(sources);
    assert.equal(f.check("src/app.ts").allowed, true);
    assert.equal(f.check("dist/bundle.js").allowed, false);
    assert.equal(f.check("dist/bundle.js").reason, "gitignore");
    assert.equal(f.check("debug.log").allowed, false);
    assert.equal(f.check("debug.log").reason, "gitignore");
  });

  it("2. codegen-only: no .gitignore + always-list catches node_modules", () => {
    const f = emptyComposedFilter();
    // No .gitignore patterns; the always-list catches the
    // canonical opt-outs every repo agrees on.
    assert.equal(f.check("node_modules/lib/index.js").allowed, false);
    assert.equal(f.check("node_modules/lib/index.js").reason, "always");
    assert.equal(f.check("src/app.ts").allowed, true);
  });

  it("3. both: gitignore + always-list stack", () => {
    const sources: GitignoreSource[] = [
      { directory: "", patterns: ["build/", "coverage/"] },
    ];
    const f = buildComposedFilter(sources);
    // build/ matches the gitignore
    assert.equal(f.check("build/output.js").allowed, false);
    assert.equal(f.check("build/output.js").reason, "gitignore");
    // node_modules matches the always-list
    assert.equal(f.check("node_modules/pkg/file.js").allowed, false);
    assert.equal(f.check("node_modules/pkg/file.js").reason, "always");
    // src/ passes through
    assert.equal(f.check("src/index.ts").allowed, true);
  });

  it("4. neither: empty filter, no always-match → allowed", () => {
    const f = emptyComposedFilter();
    assert.equal(f.check("src/app.ts").allowed, true);
    assert.equal(f.check("README.md").allowed, true);
    assert.equal(f.check("docs/intro.md").allowed, true);
  });

  it("5. deep-nested .gitignore: subdir patterns scope to that subdir", () => {
    // Use `*.tmp` + `cache.dat` (not always-ignored words) so the
    // gitignore-scoping check isn't shadowed by the hardcoded list.
    const sources: GitignoreSource[] = [
      { directory: "", patterns: ["dist/"] },
      { directory: "packages/foo", patterns: ["*.tmp", "cache.dat"] },
    ];
    const f = buildComposedFilter(sources);
    // foo's gitignore scopes to foo
    assert.equal(f.check("packages/foo/cache.tmp").allowed, false);
    assert.equal(f.check("packages/foo/cache.tmp").reason, "gitignore");
    assert.equal(f.check("packages/foo/cache.dat").allowed, false);
    // But packages/bar/cache.tmp is NOT affected by foo's gitignore
    assert.equal(f.check("packages/bar/cache.tmp").allowed, true);
    // Root dist/ still applies everywhere
    assert.equal(f.check("dist/bundle.js").allowed, false);
  });
});

describe("isIgnoredPath: always-ignored hardcoded list", () => {
  it("catches node_modules at any depth", () => {
    assert.equal(isIgnoredPath("/repo/node_modules/lib/index.js"), true);
    assert.equal(isIgnoredPath("/repo/pkg/node_modules/lib/x.js"), true);
  });

  it("catches build / dist / target / vendor", () => {
    assert.equal(isIgnoredPath("/r/dist/x.js"), true);
    assert.equal(isIgnoredPath("/r/build/x.js"), true);
    assert.equal(isIgnoredPath("/r/target/release/bin"), true);
    assert.equal(isIgnoredPath("/r/vendor/lib.go"), true);
  });

  it("catches lock files at root", () => {
    assert.equal(isIgnoredPath("/r/package-lock.json"), true);
    assert.equal(isIgnoredPath("/r/yarn.lock"), true);
    assert.equal(isIgnoredPath("/r/pnpm-lock.yaml"), true);
    assert.equal(isIgnoredPath("/r/Cargo.lock"), true);
  });

  it("DOES NOT catch authored src files", () => {
    assert.equal(isIgnoredPath("/r/src/app.ts"), false);
    assert.equal(isIgnoredPath("/r/lib/utils.go"), false);
    assert.equal(isIgnoredPath("/r/README.md"), false);
  });

  it("Windows path separators normalize correctly", () => {
    assert.equal(isIgnoredPath("C:\\repo\\node_modules\\x.js"), true);
    assert.equal(isIgnoredPath("C:\\repo\\src\\app.ts"), false);
  });
});

describe("buildComposedFilter: edge cases", () => {
  it("treats `!` negations correctly per gitignore semantics", () => {
    // Per the `ignore` package, `!foo` re-includes foo even
    // if matched by a previous pattern.
    const f = buildComposedFilter([
      { directory: "", patterns: ["*.log", "!important.log"] },
    ]);
    assert.equal(f.check("debug.log").allowed, false);
    assert.equal(f.check("important.log").allowed, true);
  });

  it("ignores empty pattern lists silently", () => {
    const f = buildComposedFilter([
      { directory: "", patterns: [] },
      { directory: "subdir", patterns: ["*.tmp"] },
    ]);
    assert.equal(f.check("subdir/a.tmp").allowed, false);
    assert.equal(f.check("a.tmp").allowed, true);
  });

  it("handles empty rootless path gracefully", () => {
    const f = emptyComposedFilter();
    assert.equal(f.check("").allowed, true);
    assert.equal(f.check("/").allowed, true);
  });
});

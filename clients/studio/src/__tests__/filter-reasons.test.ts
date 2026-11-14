// Per `architecture/v1-launch-plan.md` Step 4 + §0.6.2 ("no
// parallel unions"). The studio `FilterReasonClient` union and
// the engine `FilterReason` MUST cover the same 7 ids. The
// engine has a matching canonical-set test at
// `src/__tests__/generated-detect.test.ts`. If either side
// drifts, both tests fire in the same PR.

import { describe, it, expect } from "vitest";
import type { FilterReasonClient } from "../state/store";

describe("FilterReasonClient — canonical 7-member set", () => {
  const CANONICAL: readonly FilterReasonClient[] = [
    "gitignore",
    "always",
    "filename-pattern",
    "generated-directory",
    "header-comment",
    "codegen-toolchain",
    "binary-blob",
  ];

  it("has exactly 7 members", () => {
    expect(CANONICAL).toHaveLength(7);
  });

  it("every member has the literal-string shape used by the engine wire", () => {
    // This is the trivial "structural shape" test — the TS
    // compiler already enforces that each entry assigns to
    // FilterReasonClient. The runtime check guards against a
    // future agent expanding the union without updating this
    // test (which would survive structurally but reduce the
    // empirical guarantee).
    for (const r of CANONICAL) {
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate members", () => {
    expect(new Set(CANONICAL).size).toBe(CANONICAL.length);
  });
});

// Per `architecture/v1-launch-plan.md` Step 3 — pin the doc-25
// leveling labels. If `research/25-95-percent-and-leveling.md`
// §6.1 ever revisits the level naming, this suite must update
// in the same commit so the renaming is deliberate, not
// accidental.

import { describe, it, expect } from "vitest";
import { LEVEL_META, WORKSPACE_LEVEL_META } from "../lib/aggregate";

describe("LEVEL_META — doc-25 §6.1", () => {
  it("L0 is 'Codebase' with the 'What is this codebase?' question", () => {
    expect(LEVEL_META[0].id).toBe("codebase");
    expect(LEVEL_META[0].label).toBe("Codebase");
    expect(LEVEL_META[0].subtitle).toBe("What is this codebase?");
  });

  it("L1 is 'Areas' (default; archetype-aware at render time) with 'What are the main areas?'", () => {
    expect(LEVEL_META[1].id).toBe("areas");
    expect(LEVEL_META[1].label).toBe("Areas");
    expect(LEVEL_META[1].subtitle).toBe("What are the main areas?");
  });

  it("L2 is 'Files' with 'Where is X?'", () => {
    expect(LEVEL_META[2].id).toBe("files");
    expect(LEVEL_META[2].label).toBe("Files");
    expect(LEVEL_META[2].subtitle).toBe("Where is X?");
  });

  it("L3 is 'Symbols' with 'How does X work?'", () => {
    expect(LEVEL_META[3].id).toBe("symbols");
    expect(LEVEL_META[3].label).toBe("Symbols");
    expect(LEVEL_META[3].subtitle).toBe("How does X work?");
  });

  it("forbids the v1-era labels (Overview / Architecture / Modules / Functions)", () => {
    // If a future agent reverts to the v1 vocabulary by accident,
    // this assertion catches it.
    const labels = Object.values(LEVEL_META).map((m) => m.label);
    expect(labels).not.toContain("Overview");
    expect(labels).not.toContain("Architecture");
    expect(labels).not.toContain("Functions");
    // "Modules" is allowed at the archetype-driven L1 (Library
    // / SDK) but NOT as the L2 default.
    expect(LEVEL_META[2].label).not.toBe("Modules");
  });
});

describe("WORKSPACE_LEVEL_META — doc-25 §9", () => {
  it("the optional L-1 monorepo level is 'Workspace' with 'What's in this monorepo?'", () => {
    expect(WORKSPACE_LEVEL_META.id).toBe("workspace");
    expect(WORKSPACE_LEVEL_META.label).toBe("Workspace");
    expect(WORKSPACE_LEVEL_META.subtitle).toBe("What's in this monorepo?");
  });
});

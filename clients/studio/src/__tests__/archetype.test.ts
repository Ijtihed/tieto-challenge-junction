// Per `architecture/v1-launch-plan.md` Step 3 — pin the client-side
// archetype-label table. If `research/25-95-percent-and-leveling.md`
// §8.1 ever changes the per-archetype L1 word (Services / Modules
// / Commands / …), this suite must be updated in the same commit.

import { describe, it, expect } from "vitest";
import { archetypeL1Label, archetypeDisplayName } from "../lib/archetype";
import type { ArchetypeIdClient } from "../state/store";

describe("archetypeL1Label — per doc-25 §8.1", () => {
  it("web-app-service → Services", () => {
    expect(archetypeL1Label("web-app-service")).toBe("Services");
  });
  it("library-sdk → Modules", () => {
    expect(archetypeL1Label("library-sdk")).toBe("Modules");
  });
  it("cli-tool → Commands", () => {
    expect(archetypeL1Label("cli-tool")).toBe("Commands");
  });
  it("ai-ml-project → Notebooks", () => {
    expect(archetypeL1Label("ai-ml-project")).toBe("Notebooks");
  });
  it("data-pipeline → Pipelines", () => {
    expect(archetypeL1Label("data-pipeline")).toBe("Pipelines");
  });
  it("infrastructure-devops → Resources", () => {
    expect(archetypeL1Label("infrastructure-devops")).toBe("Resources");
  });
  it("documentation-site → Sections", () => {
    expect(archetypeL1Label("documentation-site")).toBe("Sections");
  });
  it("mobile-desktop → Areas", () => {
    expect(archetypeL1Label("mobile-desktop")).toBe("Areas");
  });
  it("unclassified → Areas (the fallback)", () => {
    expect(archetypeL1Label("unclassified")).toBe("Areas");
  });
  it("null → Areas (no archetype yet)", () => {
    expect(archetypeL1Label(null)).toBe("Areas");
    expect(archetypeL1Label(undefined)).toBe("Areas");
  });
});

describe("archetypeDisplayName", () => {
  it("renders human-readable names", () => {
    expect(archetypeDisplayName("ai-ml-project")).toBe("AI / ML project");
    expect(archetypeDisplayName("library-sdk")).toBe("Library / SDK");
  });
  it("returns empty string for null/undefined", () => {
    expect(archetypeDisplayName(null)).toBe("");
    expect(archetypeDisplayName(undefined)).toBe("");
  });
});

// Added during Step 3's double-check pass — the wire type and the
// store type are now structurally linked (both reference
// `ArchetypeIdClient`). This test pins the canonical 9-id set so
// any addition / removal triggers a deliberate update on both
// sides + matching engine update. Reads the engine canonical list
// from a string-array literal here (cannot import across the
// DAG); the engine's own test at `src/__tests__/archetype-detect.test.ts`
// asserts the engine `ARCHETYPES` array has the same 8 ids.
describe("archetype id set — engine ↔ studio canonical union", () => {
  const CANONICAL_IDS: readonly ArchetypeIdClient[] = [
    "web-app-service",
    "library-sdk",
    "cli-tool",
    "ai-ml-project",
    "data-pipeline",
    "infrastructure-devops",
    "documentation-site",
    "mobile-desktop",
    "unclassified",
  ];

  it("the label table covers every canonical id with a non-empty label", () => {
    for (const id of CANONICAL_IDS) {
      expect(archetypeL1Label(id)).toBeTruthy();
    }
  });

  it("the canonical set has exactly 9 ids (8 archetypes + unclassified)", () => {
    expect(CANONICAL_IDS).toHaveLength(9);
  });

  it("each canonical id renders a unique display name", () => {
    const names = new Set(CANONICAL_IDS.map((id) => archetypeDisplayName(id)));
    expect(names.size).toBe(CANONICAL_IDS.length);
  });

  // Step 10a DC: explicit three-way pin. Before 10a there were
  // two consumers of the archetype union (engine.ArchetypeId +
  // store.ArchetypeIdClient). Step 10a added a third
  // (WelcomeHero.ARCHETYPE_META / ARCHETYPE_IDS). Per §0.6.2
  // "no parallel unions" + the Step 8a §0.6.4 (f) cross-step
  // drift lesson, ALL THREE consumers must agree on the same
  // 9-member set. WelcomeHero.test.tsx pins WelcomeHero ↔ store;
  // archetype-detect.test.ts pins engine ↔ canonical; THIS
  // test now closes the loop by also checking WelcomeHero's
  // surface against the same canonical literal.
  it("§0.6.2 three-way pin: WelcomeHero.ARCHETYPE_IDS matches the canonical union", async () => {
    const { ARCHETYPE_IDS } = await import("../components/workspace/WelcomeHero");
    expect([...ARCHETYPE_IDS].sort()).toEqual([...CANONICAL_IDS].sort());
  });

  it("§0.6.2 three-way pin: WelcomeHero.ARCHETYPE_META covers exactly the canonical set", async () => {
    const { ARCHETYPE_META } = await import("../components/workspace/WelcomeHero");
    const metaKeys = Object.keys(ARCHETYPE_META).sort();
    const canonical = [...CANONICAL_IDS].sort();
    expect(metaKeys).toEqual(canonical);
  });
});

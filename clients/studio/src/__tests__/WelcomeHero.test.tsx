// Per `architecture/v1-launch-plan.md` Step 10a-5 + §0.6.4
// adversarial verification (a-g) from day-1.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  WelcomeHero,
  ARCHETYPE_META,
  ARCHETYPE_IDS,
  buildWelcomeSummary,
  collectLanguages,
} from "../components/workspace/WelcomeHero";
import type { ArchetypeIdClient } from "../state/store";

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical-set pinning
// ──────────────────────────────────────────────────────────
describe("ARCHETYPE_IDS / ARCHETYPE_META canonical set", () => {
  it("exhaustively covers every ArchetypeIdClient", () => {
    // Compile-time check: if a new archetype is added to the
    // union without updating META, this would not compile —
    // but vitest only sees runtime, so we also check the
    // intersection runtime.
    const ids = Object.keys(ARCHETYPE_META) as ArchetypeIdClient[];
    expect(ids.sort()).toEqual([...ARCHETYPE_IDS].sort());
  });

  it("has exactly 9 archetypes (8 + unclassified fallback)", () => {
    expect(ARCHETYPE_IDS.length).toBe(9);
  });

  it("every entry has a label + icon + oneLiner", () => {
    for (const id of ARCHETYPE_IDS) {
      const meta = ARCHETYPE_META[id];
      expect(meta.label).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.oneLiner).toBeTruthy();
      expect(meta.oneLiner.length).toBeGreaterThan(20);
    }
  });

  it("unclassified is in the union (fallback safety)", () => {
    expect(ARCHETYPE_IDS).toContain("unclassified");
  });
});

// ──────────────────────────────────────────────────────────
// buildWelcomeSummary — pure helper (§0.6.4 (a))
// ──────────────────────────────────────────────────────────
describe("buildWelcomeSummary", () => {
  it("emits exactly 5 sentences", () => {
    const sentences = buildWelcomeSummary({
      archetype: { primary: "web-app-service", secondaries: [], confidence: 0.85, scores: [], monorepo: false },
      nodeCount: 42,
      edgeCount: 89,
      clusterCount: 4,
      languages: ["TypeScript"],
      workspaceName: "my-app",
    });
    expect(sentences).toHaveLength(5);
  });

  it("workspace name + archetype label in sentence 1", () => {
    const sentences = buildWelcomeSummary({
      archetype: { primary: "library-sdk", secondaries: [], confidence: 0.7, scores: [], monorepo: false },
      nodeCount: 100,
      edgeCount: 200,
      clusterCount: 5,
      languages: ["Python"],
      workspaceName: "my-lib",
    });
    expect(sentences[0]).toContain("my-lib");
    expect(sentences[0]).toContain("library / sdk");
  });

  it("monorepo flag appears in sentence 1 when set", () => {
    const sentences = buildWelcomeSummary({
      archetype: { primary: "web-app-service", secondaries: [], confidence: 0.8, scores: [], monorepo: true },
      nodeCount: 1000,
      edgeCount: 2000,
      clusterCount: 50,
      languages: ["TypeScript"],
      workspaceName: "mono",
    });
    expect(sentences[0]).toContain("(monorepo)");
  });

  it("empty graph: sentence 4 carries the empty-extraction line", () => {
    const sentences = buildWelcomeSummary({
      archetype: { primary: "cli-tool", secondaries: [], confidence: 0.65, scores: [], monorepo: false },
      nodeCount: 0,
      edgeCount: 0,
      clusterCount: 0,
      languages: [],
      workspaceName: "test",
    });
    expect(sentences[3]).toMatch(/empty/i);
  });

  it("§0.6.4 (c) boundary: low confidence triggers the 'not certain' nudge", () => {
    const lowConfidence = buildWelcomeSummary({
      archetype: { primary: "unclassified", secondaries: [], confidence: 0.4, scores: [], monorepo: false },
      nodeCount: 10,
      edgeCount: 20,
      clusterCount: 1,
      languages: ["JavaScript"],
      workspaceName: "low",
    });
    // 0.4 < 0.6 threshold → "isn't certain"
    expect(lowConfidence[4]).toMatch(/isn't certain/i);
  });

  it("§0.6.4 (c) boundary: 0.6 confidence is at the threshold (inclusive)", () => {
    const atThreshold = buildWelcomeSummary({
      archetype: { primary: "web-app-service", secondaries: [], confidence: 0.6, scores: [], monorepo: false },
      nodeCount: 10,
      edgeCount: 20,
      clusterCount: 1,
      languages: ["TypeScript"],
      workspaceName: "ok",
    });
    expect(atThreshold[4]).toMatch(/% confident/);
  });

  it("§0.6.4 (c) boundary: 0.59 just below threshold renders the nudge", () => {
    const justBelow = buildWelcomeSummary({
      archetype: { primary: "web-app-service", secondaries: [], confidence: 0.59, scores: [], monorepo: false },
      nodeCount: 10,
      edgeCount: 20,
      clusterCount: 1,
      languages: ["TypeScript"],
      workspaceName: "bord",
    });
    expect(justBelow[4]).toMatch(/isn't certain/i);
  });

  it("language list grammar: 1 → '<lang>', 2 → '<a> and <b>', 3+ → Oxford comma", () => {
    const one = buildWelcomeSummary({
      archetype: { primary: "library-sdk", secondaries: [], confidence: 0.8, scores: [], monorepo: false },
      nodeCount: 1, edgeCount: 0, clusterCount: 0, languages: ["Go"], workspaceName: "x",
    });
    expect(one[2]).toBe("Schema reads Go.");

    const two = buildWelcomeSummary({
      archetype: { primary: "library-sdk", secondaries: [], confidence: 0.8, scores: [], monorepo: false },
      nodeCount: 1, edgeCount: 0, clusterCount: 0, languages: ["Go", "Rust"], workspaceName: "x",
    });
    expect(two[2]).toBe("Schema reads Go and Rust.");

    const three = buildWelcomeSummary({
      archetype: { primary: "library-sdk", secondaries: [], confidence: 0.8, scores: [], monorepo: false },
      nodeCount: 1, edgeCount: 0, clusterCount: 0, languages: ["Go", "Rust", "Python"], workspaceName: "x",
    });
    expect(three[2]).toBe("Schema reads Go, Rust, and Python.");

    const zero = buildWelcomeSummary({
      archetype: { primary: "library-sdk", secondaries: [], confidence: 0.8, scores: [], monorepo: false },
      nodeCount: 0, edgeCount: 0, clusterCount: 0, languages: [], workspaceName: "x",
    });
    expect(zero[2]).toBe("Schema reads no recognised language.");
  });

  it("deterministic: same input → same output (snapshot-safe)", () => {
    const input = {
      archetype: { primary: "web-app-service" as const, secondaries: [], confidence: 0.85, scores: [], monorepo: false },
      nodeCount: 42, edgeCount: 89, clusterCount: 4, languages: ["TypeScript"], workspaceName: "my-app",
    };
    const a = buildWelcomeSummary(input);
    const b = buildWelcomeSummary(input);
    expect(a).toEqual(b);
  });

  it("singular vs plural: 1 node + 1 edge + 1 area get singular forms", () => {
    const sentences = buildWelcomeSummary({
      archetype: { primary: "library-sdk", secondaries: [], confidence: 0.8, scores: [], monorepo: false },
      nodeCount: 1, edgeCount: 1, clusterCount: 1, languages: ["Python"], workspaceName: "tiny",
    });
    expect(sentences[3]).toMatch(/1 node and 1 edge.*1 area\./);
  });

  it("comma-formats large counts", () => {
    const sentences = buildWelcomeSummary({
      archetype: { primary: "library-sdk", secondaries: [], confidence: 0.8, scores: [], monorepo: false },
      nodeCount: 12345, edgeCount: 67890, clusterCount: 100, languages: ["TypeScript"], workspaceName: "big",
    });
    expect(sentences[3]).toContain("12,345");
    expect(sentences[3]).toContain("67,890");
  });
});

// ──────────────────────────────────────────────────────────
// collectLanguages helper (§0.6.4 (a))
// ──────────────────────────────────────────────────────────
describe("collectLanguages", () => {
  it("maps extensions to canonical language names", () => {
    expect(collectLanguages([
      { file: "src/a.ts" },
      { file: "src/b.py" },
      { file: "src/c.go" },
    ])).toEqual(["Go", "Python", "TypeScript"]);
  });

  it("deduplicates languages across extensions (.ts + .tsx)", () => {
    expect(collectLanguages([
      { file: "a.ts" },
      { file: "b.tsx" },
      { file: "c.ts" },
    ])).toEqual(["TypeScript"]);
  });

  it("sorts alphabetically for deterministic output", () => {
    const result = collectLanguages([
      { file: "z.go" },
      { file: "a.py" },
      { file: "m.ts" },
    ]);
    expect(result).toEqual(["Go", "Python", "TypeScript"]);
  });

  it("empty input → empty output", () => {
    expect(collectLanguages([])).toEqual([]);
  });

  it("unknown extensions are ignored", () => {
    expect(collectLanguages([
      { file: "README.md" },
      { file: "Makefile" },
      { file: ".gitignore" },
    ])).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────
// <WelcomeHero/> integration
// ──────────────────────────────────────────────────────────
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

describe("<WelcomeHero/>", () => {
  afterEach(() => cleanup());

  it("renders with override workspace name", () => {
    render(<WelcomeHero workspaceNameOverride="test-repo" />);
    expect(screen.getByTestId("welcome-hero")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-hero-archetype")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-hero-summary")).toBeInTheDocument();
  });

  it("shows the canonical headline", () => {
    render(<WelcomeHero workspaceNameOverride="anything" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome to your codebase atlas.",
    );
  });
});

// Step 10a DC §0.6.4 (b) firing test for the App-level
// gating threshold. The component renders unconditionally
// when invoked directly, but App.tsx gates it on
// `repoOpened && workingGraph.nodes.length < 5`. The
// threshold of 5 is a tunable per research/25 §9 ("fewer
// than 5 nodes = not a real codebase yet"). If a future
// agent shifts the threshold to 0 (effectively disabling
// the hero), or to 1000 (always showing it), the user
// experience degrades silently.
//
// This test pins the threshold by importing it as a
// constant. To make that possible, we extract the gating
// logic into a pure helper that the App can reuse + the
// test can pin directly.
describe("§0.6.4 (b): WelcomeHero gating threshold (5 nodes)", () => {
  it("shouldShowWelcomeHero(true, 0) === true (empty graph)", async () => {
    const { shouldShowWelcomeHero } = await import(
      "../components/workspace/WelcomeHero"
    );
    expect(shouldShowWelcomeHero(true, 0)).toBe(true);
  });

  it("shouldShowWelcomeHero(true, 4) === true (just below threshold)", async () => {
    const { shouldShowWelcomeHero } = await import(
      "../components/workspace/WelcomeHero"
    );
    expect(shouldShowWelcomeHero(true, 4)).toBe(true);
  });

  it("shouldShowWelcomeHero(true, 5) === false (at threshold)", async () => {
    const { shouldShowWelcomeHero } = await import(
      "../components/workspace/WelcomeHero"
    );
    expect(shouldShowWelcomeHero(true, 5)).toBe(false);
  });

  it("shouldShowWelcomeHero(true, 100) === false (large graph)", async () => {
    const { shouldShowWelcomeHero } = await import(
      "../components/workspace/WelcomeHero"
    );
    expect(shouldShowWelcomeHero(true, 100)).toBe(false);
  });

  it("shouldShowWelcomeHero(false, 0) === false (workspace not open yet)", async () => {
    const { shouldShowWelcomeHero } = await import(
      "../components/workspace/WelcomeHero"
    );
    expect(shouldShowWelcomeHero(false, 0)).toBe(false);
  });

  it("WELCOME_HERO_NODE_THRESHOLD canonical value", async () => {
    const { WELCOME_HERO_NODE_THRESHOLD } = await import(
      "../components/workspace/WelcomeHero"
    );
    expect(WELCOME_HERO_NODE_THRESHOLD).toBe(5);
  });
});

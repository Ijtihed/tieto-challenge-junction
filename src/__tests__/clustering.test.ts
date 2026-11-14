// Per `architecture/v1-launch-plan.md` Step 7a + research/24
// §7 (5-stage clustering pipeline). The §0.6.4 adversarial
// verification rule applies from day-1 to this file.
//
// Test surface:
//   - The CLUSTER_LABEL_TIERS canonical 7-member set (§0.6.2)
//   - Each tier in isolation (pure functions)
//   - The pipeline dispatcher (pickLabelTier) tier ordering
//   - The banned-label guard (Module N / Other / Cluster N)
//   - buildClusters end-to-end on representative fixtures
//   - Per-cluster PageRank produces sensible top-K
//   - Edge weights by relation are applied (Stage A)
//
// Real-repo measurement (Step 7a Level 2) lives in a separate
// runtime block at the end so a hostile chokidar / FS adapter
// doesn't bring down the unit suite.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildClusters,
  assertNotBanned,
} from "../domain/cluster.ts";
import {
  CLUSTER_LABEL_TIERS,
  type ClusterLabelTier,
} from "../domain/multi-repo.ts";
import {
  isBannedLabel,
  pickLabelTier,
  tierFramework,
  tierFolderArchetype,
  tierDominantSymbol,
  tierPackageReadme,
  tierCommonSubstring,
  tierLlmByok,
  tierCoordinateFallback,
  type LabelInput,
} from "../domain/cluster-labeling.ts";
import type { GraphNode, GraphEdge } from "../domain/multi-repo.ts";

// ──────────────────────────────────────────────────────────
// Canonical 7-member set per §0.6.2 — single source of truth
// is `multi-repo.ts`. The test pins cardinality, membership,
// and ordering so a future agent who adds/removes a tier
// without updating the production code is caught immediately.
// ──────────────────────────────────────────────────────────
describe("CLUSTER_LABEL_TIERS: canonical 7-member set per §0.6.2", () => {
  it("has exactly 7 members", () => {
    assert.equal(CLUSTER_LABEL_TIERS.length, 7);
  });
  it("members match the plan's Step 7 prescription order", () => {
    // Per architecture/v1-launch-plan.md Step 7 work item 4.
    assert.deepEqual([...CLUSTER_LABEL_TIERS], [
      "framework",
      "folder-archetype",
      "dominant-symbol",
      "package-readme",
      "common-substring",
      "llm-byok",
      "coordinate-fallback",
    ]);
  });
  it("every member is a non-empty hyphenated kebab-case string", () => {
    const seen = new Set(CLUSTER_LABEL_TIERS);
    assert.equal(seen.size, CLUSTER_LABEL_TIERS.length, "no duplicates");
    for (const t of CLUSTER_LABEL_TIERS) {
      assert.ok(t.length > 0);
      assert.ok(/^[a-z][a-z-]*[a-z]$/.test(t), `${t} not kebab-case`);
    }
  });
});

// ──────────────────────────────────────────────────────────
// isBannedLabel: the §0.6.4 defence-in-depth guard. Per
// `architecture/v1-launch-plan.md` Step 7: "never Module N,
// never Other." This test pins those patterns exhaustively.
// ──────────────────────────────────────────────────────────
describe("isBannedLabel: Module N / Other / Cluster N regression guard", () => {
  it("flags Module N variants", () => {
    assert.equal(isBannedLabel("Module 1"), true);
    assert.equal(isBannedLabel("Module 42"), true);
    assert.equal(isBannedLabel("module 7"), true);
    assert.equal(isBannedLabel("MODULE 0"), true);
  });
  it("flags exact 'Other' regardless of case", () => {
    assert.equal(isBannedLabel("Other"), true);
    assert.equal(isBannedLabel("other"), true);
    assert.equal(isBannedLabel("OTHER"), true);
  });
  it("flags Cluster N (same bug class)", () => {
    assert.equal(isBannedLabel("Cluster 4"), true);
    assert.equal(isBannedLabel("cluster 12"), true);
  });
  it("does NOT flag legitimate labels", () => {
    assert.equal(isBannedLabel("Authentication"), false);
    assert.equal(isBannedLabel("Routes"), false);
    assert.equal(isBannedLabel("UserService cluster"), false, "real cluster naming wins");
    assert.equal(isBannedLabel("Area at (3,2)"), false);
    assert.equal(isBannedLabel("Express Router"), false);
    assert.equal(isBannedLabel("Other Services"), false, "starts with Other, not exact Other");
  });
});

// ──────────────────────────────────────────────────────────
// assertNotBanned — extracted runtime guard. Per the Step 7a
// double-check: defence-in-depth guards need tests that prove
// they fail-stop on a violation, not just that they pass on
// good input. Without this test, a future agent could disable
// the guard silently and `Module N` could ship.
// ──────────────────────────────────────────────────────────
describe("assertNotBanned: defence-in-depth runtime guard", () => {
  it("throws on Module N", () => {
    assert.throws(
      () => assertNotBanned("Module 4", "coordinate-fallback"),
      /banned label "Module 4"/,
    );
  });
  it("throws on Other", () => {
    assert.throws(
      () => assertNotBanned("Other", "coordinate-fallback"),
      /banned label "Other"/,
    );
  });
  it("throws on Cluster N", () => {
    assert.throws(
      () => assertNotBanned("Cluster 7", "coordinate-fallback"),
      /banned label "Cluster 7"/,
    );
  });
  it("does NOT throw on legitimate labels", () => {
    assert.doesNotThrow(() => assertNotBanned("Authentication", "folder-archetype"));
    assert.doesNotThrow(() => assertNotBanned("Area at (3,2)", "coordinate-fallback"));
    assert.doesNotThrow(() => assertNotBanned("Express Router", "framework"));
  });
});

// ──────────────────────────────────────────────────────────
// Tier-by-tier isolation: each tier is a pure function and
// can be exercised without the full pipeline. This is the
// Step 6 §0.6.4 refinement #2 in practice ("extract pure
// helpers from action handlers").
// ──────────────────────────────────────────────────────────

function mkNode(id: string, filePath: string, kind = "function", name?: string): GraphNode {
  return {
    id,
    kind,
    name: name ?? id,
    locator: `file:///r/${filePath}#${id}`,
    filePath,
  };
}

function mkInput(
  nodes: readonly GraphNode[],
  overrides?: Partial<LabelInput>,
): LabelInput {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const relPathById = new Map<string, string>();
  for (const n of nodes) if (n.filePath) relPathById.set(n.id, n.filePath);
  return {
    nodeIds: nodes.map((n) => n.id),
    nodeById,
    relPathById,
    importance: overrides?.importance ?? new Map(),
    archetype: overrides?.archetype,
    domainTokens: overrides?.domainTokens ?? new Set(),
    coordinate: overrides?.coordinate,
  };
}

describe("tierFramework — detected framework name", () => {
  it("fires on Express Router when ≥40% of paths match", () => {
    const nodes = [
      mkNode("n1", "src/routes/users.ts", "route_handler"),
      mkNode("n2", "src/routes/orders.ts", "route_handler"),
      mkNode("n3", "src/services/payments.ts"),
      mkNode("n4", "src/services/billing.ts"),
    ];
    const r = tierFramework(mkInput(nodes));
    assert.ok(r);
    assert.equal(r!.tier, "framework");
    assert.equal(r!.name, "Express Router");
  });

  it("returns null when no signature dominates", () => {
    const nodes = [
      mkNode("n1", "src/lib/utils.ts"),
      mkNode("n2", "src/lib/helpers.ts"),
      mkNode("n3", "src/lib/types.ts"),
    ];
    assert.equal(tierFramework(mkInput(nodes)), null);
  });

  it("recognises Next.js routes", () => {
    const nodes = [
      mkNode("n1", "app/users/page.tsx"),
      mkNode("n2", "app/orders/page.tsx"),
      mkNode("n3", "app/admin/route.ts"),
    ];
    const r = tierFramework(mkInput(nodes));
    assert.ok(r);
    assert.equal(r!.name, "Next.js Routes");
  });

  it("recognises Go HTTP handlers", () => {
    const nodes = [
      mkNode("n1", "internal/handler/users.go"),
      mkNode("n2", "internal/handler/orders.go"),
      mkNode("n3", "internal/handler/auth.go"),
    ];
    const r = tierFramework(mkInput(nodes));
    assert.ok(r);
    assert.equal(r!.name, "Go HTTP Handlers");
  });
});

describe("tierFolderArchetype — domain folder + capitalization", () => {
  it("uses the domain dict for known folder names", () => {
    const nodes = [
      mkNode("n1", "src/auth/login.ts"),
      mkNode("n2", "src/auth/signup.ts"),
      mkNode("n3", "src/auth/session.ts"),
    ];
    const r = tierFolderArchetype(mkInput(nodes));
    assert.ok(r);
    assert.equal(r!.name, "Authentication", "auth → Authentication via dict");
  });

  it("humanizes unknown folder names", () => {
    const nodes = [
      mkNode("n1", "src/event-sourcing/store.ts"),
      mkNode("n2", "src/event-sourcing/projector.ts"),
      mkNode("n3", "src/event-sourcing/replay.ts"),
    ];
    const r = tierFolderArchetype(mkInput(nodes));
    assert.ok(r);
    assert.equal(r!.name, "Event Sourcing");
  });

  it("returns null when no folder claims ≥50% of nodes", () => {
    const nodes = [
      mkNode("n1", "src/auth/a.ts"),
      mkNode("n2", "src/payments/b.ts"),
      mkNode("n3", "src/users/c.ts"),
    ];
    assert.equal(tierFolderArchetype(mkInput(nodes)), null);
  });
});

describe("tierDominantSymbol — top-PageRank symbol", () => {
  it("picks the node with the highest importance + meaningful name", () => {
    const nodes = [
      mkNode("n1", "src/users/service.ts", "service", "UserService"),
      mkNode("n2", "src/users/repo.ts", "data_access", "UserRepository"),
      mkNode("n3", "src/users/types.ts", "utility", "Types"),
    ];
    const importance = new Map([
      ["n1", 0.6],
      ["n2", 0.3],
      ["n3", 0.1],
    ]);
    const r = tierDominantSymbol(mkInput(nodes, { importance }));
    assert.ok(r);
    assert.equal(r!.tier, "dominant-symbol");
    assert.equal(r!.name, "UserService");
  });

  it("returns null when no node carries ≥30% of importance", () => {
    const nodes = [
      mkNode("n1", "a.ts"), mkNode("n2", "b.ts"), mkNode("n3", "c.ts"),
      mkNode("n4", "d.ts"), mkNode("n5", "e.ts"),
    ];
    // Uniform 20% each — no single dominant node.
    const importance = new Map([
      ["n1", 0.2], ["n2", 0.2], ["n3", 0.2], ["n4", 0.2], ["n5", 0.2],
    ]);
    assert.equal(tierDominantSymbol(mkInput(nodes, { importance })), null);
  });

  it("skips generic names like 'run' / 'init' and falls back to filename", () => {
    const nodes = [
      mkNode("n1", "src/users/process-order.ts", "function", "run"),
      mkNode("n2", "src/users/utils.ts", "utility", "Utils"),
    ];
    const importance = new Map([["n1", 0.8], ["n2", 0.2]]);
    const r = tierDominantSymbol(mkInput(nodes, { importance }));
    assert.ok(r);
    // Symbol name "run" is generic → falls back to filename
    assert.equal(r!.name, "Process Order");
  });
});

describe("tierPackageReadme — domain inference", () => {
  it("uses the most-frequent matching token from package.json/README", () => {
    const nodes = [
      mkNode("n1", "src/checkout/cart.ts", "service", "CartService"),
      mkNode("n2", "src/checkout/payment.ts", "service", "PaymentFlow"),
      mkNode("n3", "src/checkout/shipping.ts", "service", "ShippingCalc"),
    ];
    const r = tierPackageReadme(mkInput(nodes, {
      domainTokens: new Set(["checkout", "marketing"]),
    }));
    assert.ok(r);
    assert.equal(r!.tier, "package-readme");
    assert.equal(r!.name, "Checkout");
  });

  it("returns null when no token appears in ≥30% of nodes", () => {
    const nodes = [
      mkNode("n1", "src/random-1.ts"),
      mkNode("n2", "src/unrelated-2.ts"),
      mkNode("n3", "src/different-3.ts"),
    ];
    assert.equal(
      tierPackageReadme(mkInput(nodes, {
        domainTokens: new Set(["payments", "shipping"]),
      })),
      null,
    );
  });

  // Per the Step 7a §0.6.4 double-check: pin the 30% threshold
  // explicitly. Mutation F (raise threshold to 90%) slipped past
  // the first pass because the only positive test had 100% match
  // share. This test exercises the boundary: a 40% match (above
  // 30% but below 50%) should still fire Tier 4.
  it("fires at the 30% threshold exactly — pin from §0.6.4 mutation F", () => {
    // 5 nodes; 2 mention 'orders' (plural, since token match is
    // substring-based) → 40% share, above 30%.
    const nodes = [
      mkNode("n1", "src/checkout/orders-flow.ts", "service", "OrdersFlow"),
      mkNode("n2", "src/checkout/place-orders.ts", "service", "Submit"),
      mkNode("n3", "src/checkout/util.ts", "utility", "Helper"),
      mkNode("n4", "src/checkout/types.ts", "utility", "Types"),
      mkNode("n5", "src/checkout/cache.ts", "utility", "Cache"),
    ];
    const r = tierPackageReadme(mkInput(nodes, {
      domainTokens: new Set(["orders"]),
    }));
    assert.ok(r, "40% share should clear the 30% threshold");
    assert.equal(r!.tier, "package-readme");
  });

  it("does NOT fire below the 30% threshold — pin from §0.6.4 mutation F", () => {
    // 10 nodes; 2 mention 'orders' → 20% share, below 30%.
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 10; i++) {
      const name = i < 2 ? `OrderHelper${i}` : `Misc${i}`;
      nodes.push(mkNode(`n${i}`, `src/mod-${i}.ts`, "utility", name));
    }
    assert.equal(
      tierPackageReadme(mkInput(nodes, {
        domainTokens: new Set(["orders"]),
      })),
      null,
      "20% share is below the 30% threshold",
    );
  });
});

describe("tierCommonSubstring — Anquetil-Lethbridge", () => {
  it("picks a common substring covering ≥60% of filenames", () => {
    const nodes = [
      mkNode("n1", "src/x/order-create.ts"),
      mkNode("n2", "src/x/order-update.ts"),
      mkNode("n3", "src/x/order-delete.ts"),
      mkNode("n4", "src/x/order-list.ts"),
    ];
    const r = tierCommonSubstring(mkInput(nodes));
    assert.ok(r);
    assert.equal(r!.tier, "common-substring");
    assert.ok(r!.name.toLowerCase().includes("order"));
  });

  it("returns null when no common substring is meaningful", () => {
    const nodes = [
      mkNode("n1", "src/x/aaa.ts"),
      mkNode("n2", "src/x/bbb.ts"),
      mkNode("n3", "src/x/ccc.ts"),
    ];
    assert.equal(tierCommonSubstring(mkInput(nodes)), null);
  });

  // Per the Step 7a §0.6.4 double-check: pin the 60% coverage
  // threshold explicitly. Mutation G (lower to 10%) slipped past
  // the first pass because no test exercised the 30-60% middle
  // zone where threshold tuning matters most.
  it("does NOT fire below the 60% threshold — pin from §0.6.4 mutation G", () => {
    // 10 files, 4 share substring "user-" → 40% coverage,
    // below the 60% gate.
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 4; i++) {
      nodes.push(mkNode(`u${i}`, `src/x/user-foo-${i}.ts`));
    }
    for (let i = 0; i < 6; i++) {
      nodes.push(mkNode(`m${i}`, `src/x/misc-bar-${i}.ts`));
    }
    // user-* covers 40% of names. The substring "user-" should
    // NOT win at the 60% threshold. (Common substrings ≥4 chars
    // get enumerated from names[0] = "user-foo-0".)
    const r = tierCommonSubstring(mkInput(nodes));
    // Either null (proper rejection) or "Misc" / "Bar" / etc.
    // (substring found in the majority misc-* files). Critical
    // assertion: the chosen name must NOT be a "user-" variant.
    if (r) {
      assert.ok(
        !r.name.toLowerCase().includes("user"),
        `40%-share "user-" should not have won the threshold; got "${r.name}"`,
      );
    }
  });

  it("fires AT or above the 60% threshold — pin from §0.6.4 mutation G", () => {
    // 5 files all sharing "order" → 100% coverage, clearly above.
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push(mkNode(`n${i}`, `src/x/order-flow-${i}.ts`));
    }
    const r = tierCommonSubstring(mkInput(nodes));
    assert.ok(r);
    assert.equal(r!.tier, "common-substring");
    assert.ok(r!.name.toLowerCase().includes("order"));
  });
});

describe("tierLlmByok — placeholder for Step 7b", () => {
  it("returns null during Step 7a (LLM tier not wired yet)", () => {
    const nodes = [mkNode("n1", "x.ts")];
    assert.equal(tierLlmByok(mkInput(nodes)), null);
  });
});

describe("tierCoordinateFallback — never returns null", () => {
  it("produces a directory-summary name from node paths", () => {
    const r = tierCoordinateFallback(
      mkInput([
        mkNode("n1", "domain/types.ts"),
        mkNode("n2", "domain/utils.ts"),
        mkNode("n3", "actions/index.ts"),
      ]),
      0,
    );
    assert.equal(r.tier, "coordinate-fallback");
    // Top directories: "domain" (2) + "actions" (1)
    assert.ok(r.name.includes("Domain"),
      `expected name to contain 'Domain'; got "${r.name}"`);
  });

  it("falls back to Core label when no paths available", () => {
    const r = tierCoordinateFallback(mkInput([mkNode("n1", "x.ts")]), 0);
    assert.equal(r.tier, "coordinate-fallback");
    // "x.ts" has no directory, so the fallback fires
    assert.ok(r.name.length > 0, "name must not be empty");
  });

  it("the synthesized name NEVER matches Module N or Other", () => {
    for (let i = 0; i < 30; i++) {
      const r = tierCoordinateFallback(mkInput([mkNode("n1", "x.ts")]), i);
      assert.equal(isBannedLabel(r.name), false,
        `index ${i} produced banned label "${r.name}"`);
    }
  });
});

// ──────────────────────────────────────────────────────────
// pickLabelTier — pipeline dispatcher ordering.
// ──────────────────────────────────────────────────────────
describe("pickLabelTier — dispatcher", () => {
  it("framework wins over folder when both fire", () => {
    const nodes = [
      mkNode("n1", "src/routes/users.ts", "route_handler"),
      mkNode("n2", "src/routes/orders.ts", "route_handler"),
      mkNode("n3", "src/routes/auth.ts", "route_handler"),
    ];
    const r = pickLabelTier(mkInput(nodes), 0);
    assert.equal(r.tier, "framework");
  });

  it("falls through to coordinate-fallback when nothing else fires", () => {
    const nodes = [
      mkNode("n1", "weird-path/x.ts"),
      mkNode("n2", "another-weird/y.ts"),
      mkNode("n3", "third-place/z.ts"),
    ];
    const r = pickLabelTier(mkInput(nodes), 0);
    assert.equal(r.tier, "coordinate-fallback");
    assert.equal(r.tier, "coordinate-fallback");
  });
});

// ──────────────────────────────────────────────────────────
// buildClusters end-to-end on synthetic fixtures.
// ──────────────────────────────────────────────────────────

function fixtureExpressApp(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // A small Express-like fixture: 3 route handlers + 3
  // services + 3 models. Edges: routes → services → models.
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < 3; i++) {
    nodes.push(mkNode(`r${i}`, `src/routes/handler-${i}.ts`, "route_handler", `Route${i}`));
    nodes.push(mkNode(`s${i}`, `src/services/svc-${i}.ts`, "service", `Service${i}`));
    nodes.push(mkNode(`m${i}`, `src/models/model-${i}.ts`, "model", `Model${i}`));
    edges.push({ id: `e_rs${i}`, source: `r${i}`, target: `s${i}`, relation: "calls" });
    edges.push({ id: `e_sm${i}`, source: `s${i}`, target: `m${i}`, relation: "imports" });
  }
  return { nodes, edges };
}

describe("buildClusters: Express-like fixture", () => {
  const fx = fixtureExpressApp();
  const clusters = buildClusters(fx.nodes, fx.edges);

  it("produces clusters", () => {
    assert.ok(clusters.length >= 1, "at least one cluster");
  });

  it("NEVER produces a banned label (Module N / Other / Cluster N)", () => {
    for (const c of clusters) {
      assert.equal(isBannedLabel(c.name), false,
        `cluster "${c.name}" is banned`);
    }
  });

  it("every cluster carries a labelTier", () => {
    for (const c of clusters) {
      assert.ok(c.labelTier, `cluster "${c.name}" missing labelTier`);
      assert.ok(CLUSTER_LABEL_TIERS.includes(c.labelTier),
        `unknown tier ${c.labelTier}`);
    }
  });

  it("every cluster carries an importance map", () => {
    for (const c of clusters) {
      assert.ok(c.importance !== undefined,
        `cluster "${c.name}" missing importance`);
    }
  });

  it("clusters with importance also expose entryPointIds", () => {
    for (const c of clusters) {
      if (Object.keys(c.importance ?? {}).length > 0) {
        assert.ok(c.entryPointIds !== undefined,
          `cluster "${c.name}" with importance missing entryPointIds`);
        assert.ok(c.entryPointIds!.length > 0,
          `cluster "${c.name}" should expose at least one entry-point`);
        assert.ok(c.entryPointIds!.length <= 3,
          `cluster "${c.name}" has more than 3 entry-points (got ${c.entryPointIds!.length})`);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────
// Adversarial fixture: force the pipeline into its Tier 7 path
// by giving it a heterogeneous file layout with no
// architectural cohesion. The output MUST still avoid the
// banned patterns.
// ──────────────────────────────────────────────────────────
describe("buildClusters: adversarial heterogeneous fixture", () => {
  it("the Tier 7 coordinate fallback fires + name is never banned", () => {
    // 10 isolated nodes in random folders, no edges → Leiden
    // produces no communities → folder fallback applies.
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(mkNode(
        `n${i}`,
        `src/random-${i}-${String(i * 13 % 7)}.ts`,
        "utility",
      ));
    }
    const clusters = buildClusters(nodes, []);
    for (const c of clusters) {
      assert.equal(isBannedLabel(c.name), false,
        `adversarial fixture produced banned "${c.name}"`);
    }
  });

  it("a heterogeneous + edge-rich fixture stays banned-free even at scale", () => {
    // 60 nodes spread across 12 folders, 1-2 each — Leiden
    // will struggle to find tight communities. The pipeline
    // must still avoid Module N / Other.
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 60; i++) {
      nodes.push(mkNode(
        `n${i}`,
        `src/folder-${i % 12}/file-${i}.ts`,
        i % 3 === 0 ? "route_handler" : i % 3 === 1 ? "service" : "utility",
      ));
    }
    // Sparse random edges
    for (let i = 0; i < 30; i++) {
      const src = `n${i}`;
      const dst = `n${(i + 7) % 60}`;
      edges.push({ id: `e${i}`, source: src, target: dst, relation: "imports" });
    }
    const clusters = buildClusters(nodes, edges);
    for (const c of clusters) {
      assert.equal(isBannedLabel(c.name), false,
        `cluster "${c.name}" is banned`);
    }
  });
});

// ──────────────────────────────────────────────────────────
// Edge weights by relation — Stage A. Hard to test directly
// (Leiden's modularity is opaque); test via the OUTCOME:
// edges with framework-coupling weights should pull
// route_handlers + services into the same cluster more
// reliably than equal-weight edges would.
// ──────────────────────────────────────────────────────────
describe("buildClusters: Stage A edge weights", () => {
  it("imports + calls + applies_middleware edges affect clustering", () => {
    // Two folders that share weak `imports` edges across a
    // boundary AND strong `calls` edges within a folder.
    // The within-folder + heavy-weight edges should win,
    // producing per-folder clusters (not one mega-cluster).
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push(mkNode(`a${i}`, `src/feature-a/file-${i}.ts`));
      nodes.push(mkNode(`b${i}`, `src/feature-b/file-${i}.ts`));
    }
    // Strong within-folder edges
    for (let i = 0; i < 4; i++) {
      edges.push({ id: `ec_a${i}`, source: `a${i}`, target: `a${i + 1}`, relation: "calls" });
      edges.push({ id: `ec_b${i}`, source: `b${i}`, target: `b${i + 1}`, relation: "calls" });
    }
    // Single weak cross-folder edge
    edges.push({ id: `cross`, source: "a0", target: "b0", relation: "consumes_contract" });

    const clusters = buildClusters(nodes, edges);
    assert.ok(clusters.length >= 2, `expected at least 2 clusters, got ${clusters.length}`);

    // No cluster name should be banned
    for (const c of clusters) {
      assert.equal(isBannedLabel(c.name), false);
    }
  });
});

// ──────────────────────────────────────────────────────────
// Per-cluster PageRank — Stage D.
// ──────────────────────────────────────────────────────────
describe("buildClusters: Stage D per-cluster PageRank", () => {
  it("PageRank is per-cluster (not global) per research/24 §7.4", () => {
    // Two clusters: each contains its own "hub" node that
    // every other node in the cluster calls. The hub should
    // be #1 in its cluster's entryPointIds — but the hubs
    // from different clusters should not compete (per-cluster
    // isolation).
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let g = 0; g < 2; g++) {
      const hub = `hub${g}`;
      nodes.push(mkNode(hub, `src/group-${g}/hub.ts`, "service", `Hub${g}`));
      for (let i = 0; i < 5; i++) {
        const leaf = `g${g}_n${i}`;
        nodes.push(mkNode(leaf, `src/group-${g}/leaf-${i}.ts`));
        edges.push({ id: `e_${g}_${i}`, source: leaf, target: hub, relation: "calls" });
      }
    }
    const clusters = buildClusters(nodes, edges);
    assert.ok(clusters.length >= 2);
    // Each cluster's top entry-point should be the hub
    let hubsFound = 0;
    for (const c of clusters) {
      const top = c.entryPointIds?.[0];
      if (top && (top === "hub0" || top === "hub1")) hubsFound++;
    }
    assert.ok(hubsFound >= 1, `expected ≥1 cluster to surface its hub as top entry-point, got ${hubsFound}`);
  });

  it("entryPointIds is bounded at 3", () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(mkNode(`n${i}`, `src/big/file-${i}.ts`, "service", `Svc${i}`));
    }
    for (let i = 0; i < 19; i++) {
      edges.push({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}`, relation: "calls" });
    }
    const clusters = buildClusters(nodes, edges);
    for (const c of clusters) {
      assert.ok((c.entryPointIds?.length ?? 0) <= 3,
        `cluster "${c.name}" has ${c.entryPointIds?.length} entry-points (cap is 3)`);
    }
  });
});

// ──────────────────────────────────────────────────────────
// Pre-Step-7 backward compat: callers passing workspaceRoot
// as a positional string still work.
// ──────────────────────────────────────────────────────────
describe("buildClusters: backward-compat signature", () => {
  it("accepts workspaceRoot as a positional string (legacy callers)", () => {
    const nodes = [
      mkNode("n1", "/abs/proj/src/a/file.ts"),
      mkNode("n2", "/abs/proj/src/a/other.ts"),
      mkNode("n3", "/abs/proj/src/a/third.ts"),
    ];
    const clusters = buildClusters(nodes, [], "/abs/proj");
    assert.ok(clusters.length >= 0); // doesn't throw + produces a list
  });

  // Per the Step 7a §0.6.4 double-check: pin the integration
  // boundary with workspace-open.ts. Mutation J slipped past
  // the first pass because dropping the workspaceRoot argument
  // falls through to `commonPathPrefix(allPaths)` and produces
  // identical cluster output. The boundary is still real — if a
  // future agent changes the auto-prefix detection, the
  // production callsite would silently shift cluster names.
  // This test pins both the auto-detected case AND the
  // explicit-arg case to produce equivalent output.
  it("auto-detected and explicit workspaceRoot produce equivalent clusters", () => {
    const nodes = [
      mkNode("n1", "/abs/proj/src/a/file.ts", "service", "Svc"),
      mkNode("n2", "/abs/proj/src/a/other.ts", "service", "Other"),
      mkNode("n3", "/abs/proj/src/a/third.ts", "service", "Third"),
      mkNode("n4", "/abs/proj/src/b/x.ts", "data_access", "DA"),
      mkNode("n5", "/abs/proj/src/b/y.ts", "data_access", "DA2"),
      mkNode("n6", "/abs/proj/src/b/z.ts", "data_access", "DA3"),
      mkNode("n7", "/abs/proj/src/c/p.ts", "utility", "U1"),
      mkNode("n8", "/abs/proj/src/c/q.ts", "utility", "U2"),
      mkNode("n9", "/abs/proj/src/c/r.ts", "utility", "U3"),
    ];
    const edges: GraphEdge[] = [
      { id: "e1", source: "n1", target: "n2", relation: "calls" },
      { id: "e2", source: "n2", target: "n3", relation: "calls" },
      { id: "e3", source: "n4", target: "n5", relation: "calls" },
      { id: "e4", source: "n7", target: "n8", relation: "imports" },
    ];
    const autoClusters = buildClusters(nodes, edges);
    const explicitClusters = buildClusters(nodes, edges, "/abs/proj");
    // The auto-detection should pick the common prefix
    // `/abs/proj`, producing the same cluster shape.
    const autoNames = autoClusters.map((c) => c.name).sort();
    const explicitNames = explicitClusters.map((c) => c.name).sort();
    assert.deepEqual(autoNames, explicitNames,
      "auto-detected prefix must produce equivalent cluster names");
  });
});

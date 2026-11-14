// Per `architecture/v1-launch-plan.md` Step 2 — unit tests for the
// leveling math that drives the canvas at L0 / L1 / L2 / L3.
//
// `aggregate.ts` is the load-bearing function for every canvas zoom
// transition. Step 3 will rename the level labels (doc-25 leveling:
// Codebase / Areas / Files / Symbols) and add archetype-aware L1
// labels; those changes will touch `aggregateClusters` and the
// `LEVEL_META` table directly. This suite locks down the current
// behaviour so Step 3 either breaks the test (intentional, then
// updates) or leaves it alone (unintentional regression caught).

import { describe, it, expect } from "vitest";
import {
  aggregateEnglish,
  aggregateClusters,
  aggregateModules,
  asDisplay,
  buildDisplayGraph,
  bucketIdFor,
  filterByDrill,
  LEVEL_META,
  type Level,
} from "../lib/aggregate";
import type { Graph, GraphNode, GraphEdge, Cluster } from "../lib/types";

function mkNode(
  id: string,
  name: string,
  kind: GraphNode["kind"],
  file: string,
  cluster: string | undefined = undefined,
): GraphNode {
  const base: GraphNode = { id, name, kind, file };
  if (cluster) base.cluster = cluster;
  return base;
}

function mkEdge(id: string, source: string, target: string, relation: GraphEdge["relation"]): GraphEdge {
  return { id, source, target, relation };
}

function mkGraph(nodes: GraphNode[], edges: GraphEdge[], clusters: Cluster[]): Graph {
  return { nodes, edges, clusters, rootDir: "/repo" };
}

const SAMPLE_GRAPH = (): Graph => mkGraph(
  [
    mkNode("fn:a", "createUser", "route_handler", "/repo/src/auth/handlers.ts", "cluster:auth"),
    mkNode("fn:b", "validateToken", "middleware", "/repo/src/auth/middleware.ts", "cluster:auth"),
    mkNode("fn:c", "UserService", "service", "/repo/src/services/user.ts", "cluster:services"),
    mkNode("fn:d", "UserRepository", "data_access", "/repo/src/services/user.ts", "cluster:services"),
    mkNode("fn:e", "stripeClient", "external", "/repo/src/integrations/stripe.ts", "cluster:integrations"),
  ],
  [
    mkEdge("e1", "fn:a", "fn:b", "applies_middleware"),
    mkEdge("e2", "fn:a", "fn:c", "calls"),
    mkEdge("e3", "fn:c", "fn:d", "calls"),
    mkEdge("e4", "fn:c", "fn:e", "calls"),
  ],
  [
    { id: "cluster:auth", name: "Auth", nodeIds: ["fn:a", "fn:b"] },
    { id: "cluster:services", name: "Services", nodeIds: ["fn:c", "fn:d"] },
    { id: "cluster:integrations", name: "Integrations", nodeIds: ["fn:e"] },
  ],
);

describe("LEVEL_META", () => {
  it("exposes all four levels with id/label/subtitle/icon", () => {
    for (const level of [0, 1, 2, 3] as Level[]) {
      const meta = LEVEL_META[level];
      expect(meta).toBeDefined();
      expect(meta.id).toBeTruthy();
      expect(meta.label).toBeTruthy();
      expect(meta.subtitle).toBeTruthy();
      expect(meta.icon).toBeTruthy();
    }
  });
});

describe("aggregateEnglish (L0)", () => {
  it("collapses every node to its cluster", () => {
    const display = aggregateEnglish(SAMPLE_GRAPH());
    expect(display.nodes).toHaveLength(3);
    const ids = new Set(display.nodes.map((n) => n.id));
    expect(ids).toContain("cluster:auth");
    expect(ids).toContain("cluster:services");
    expect(ids).toContain("cluster:integrations");
  });

  it("each cluster node carries its inner ids", () => {
    const display = aggregateEnglish(SAMPLE_GRAPH());
    const auth = display.nodes.find((n) => n.id === "cluster:auth")!;
    expect(auth.innerIds).toEqual(expect.arrayContaining(["fn:a", "fn:b"]));
    expect(auth.kind).toBe("english");
  });

  it("aggregates inter-cluster edges (route -> service, service -> integration)", () => {
    const display = aggregateEnglish(SAMPLE_GRAPH());
    // auth -> services, services -> integrations are real inter-cluster edges
    const sources = new Set(display.edges.map((e) => e.source));
    expect(sources).toContain("cluster:auth");
    expect(sources).toContain("cluster:services");
  });

  it("nodes with no cluster fall into cluster:misc", () => {
    const g = mkGraph(
      [mkNode("fn:x", "orphan", "utility", "/repo/x.ts")],
      [],
      [],
    );
    const display = aggregateEnglish(g);
    expect(display.nodes).toHaveLength(1);
    expect(display.nodes[0]!.id).toBe("cluster:misc");
  });
});

describe("aggregateClusters (L1)", () => {
  it("returns one bucket per cluster", () => {
    const display = aggregateClusters(SAMPLE_GRAPH());
    expect(display.nodes).toHaveLength(3);
    expect(display.nodes.every((n) => n.kind === "cluster")).toBe(true);
  });

  it("uses the cluster name from the cluster table, not the id", () => {
    const display = aggregateClusters(SAMPLE_GRAPH());
    const labels = display.nodes.map((n) => n.label).sort();
    expect(labels).toEqual(["Auth", "Integrations", "Services"]);
  });
});

describe("aggregateModules (L2)", () => {
  it("collapses to one bucket per file", () => {
    const display = aggregateModules(SAMPLE_GRAPH());
    // 4 distinct files in SAMPLE_GRAPH
    expect(display.nodes.length).toBeGreaterThanOrEqual(4);
    expect(display.nodes.every((n) => n.kind === "module")).toBe(true);
  });

  it("module buckets carry their inner ids", () => {
    const display = aggregateModules(SAMPLE_GRAPH());
    const userTs = display.nodes.find((n) => n.id === "module:/repo/src/services/user.ts");
    expect(userTs).toBeDefined();
    expect(userTs!.innerIds).toEqual(expect.arrayContaining(["fn:c", "fn:d"]));
  });
});

describe("asDisplay (L3)", () => {
  it("returns one node per source node (1:1)", () => {
    const g = SAMPLE_GRAPH();
    const display = asDisplay(g);
    expect(display.nodes).toHaveLength(g.nodes.length);
  });

  it("strips imports edges at L3 (call graph only)", () => {
    const g = mkGraph(
      [
        mkNode("fn:a", "a", "utility", "/repo/a.ts"),
        mkNode("fn:b", "b", "utility", "/repo/b.ts"),
      ],
      [
        mkEdge("e1", "fn:a", "fn:b", "imports"),
        mkEdge("e2", "fn:a", "fn:b", "calls"),
      ],
      [],
    );
    const display = asDisplay(g);
    expect(display.edges).toHaveLength(1);
    expect(display.edges[0]!.relation).toBe("calls");
  });
});

describe("buildDisplayGraph", () => {
  it("dispatches to the right aggregator per level", () => {
    const g = SAMPLE_GRAPH();
    expect(buildDisplayGraph(g, 0).nodes[0]!.kind).toBe("english");
    expect(buildDisplayGraph(g, 1).nodes[0]!.kind).toBe("cluster");
    expect(buildDisplayGraph(g, 2).nodes[0]!.kind).toBe("module");
    expect(buildDisplayGraph(g, 3).nodes.length).toBe(g.nodes.length);
  });

  it("applies the drill filter before aggregating", () => {
    const g = SAMPLE_GRAPH();
    // Drill into Auth at L1 → only the auth cluster bucket should remain.
    const display = buildDisplayGraph(g, 1, [{ id: "cluster:auth" }]);
    expect(display.nodes).toHaveLength(1);
    expect(display.nodes[0]!.id).toBe("cluster:auth");
  });
});

describe("filterByDrill", () => {
  it("keeps only nodes inside the drilled cluster", () => {
    const g = SAMPLE_GRAPH();
    const filtered = filterByDrill(g, [{ id: "cluster:auth" }]);
    expect(filtered.nodes).toHaveLength(2);
    expect(filtered.nodes.every((n) => n.cluster === "cluster:auth")).toBe(true);
  });

  it("returns the graph untouched when drillPath is empty", () => {
    const g = SAMPLE_GRAPH();
    expect(filterByDrill(g, []).nodes).toHaveLength(g.nodes.length);
  });
});

describe("bucketIdFor", () => {
  it("maps an inner fn id to its cluster at L0/L1", () => {
    const g = SAMPLE_GRAPH();
    expect(bucketIdFor(g, "fn:a", 0)).toBe("cluster:auth");
    expect(bucketIdFor(g, "fn:a", 1)).toBe("cluster:auth");
  });

  it("maps an inner fn id to its module at L2", () => {
    const g = SAMPLE_GRAPH();
    expect(bucketIdFor(g, "fn:a", 2)).toBe("module:/repo/src/auth/handlers.ts");
  });

  it("at L3 returns the id unchanged", () => {
    const g = SAMPLE_GRAPH();
    expect(bucketIdFor(g, "fn:a", 3)).toBe("fn:a");
  });
});

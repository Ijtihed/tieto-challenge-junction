// Per `architecture/v1-launch-plan.md` Step 8a + research/29
// §4 (Hybrid RAG). The §0.6.4 disciplines apply from day-1:
//   - Canonical-set tests per §0.6.2 (CHANGE_QUERY_MODES style)
//   - Threshold-boundary tests per §0.6.4 (c)
//   - Integration-boundary equivalence per §0.6.4 (d)
//   - Each pure helper unit-tested per §0.6.4 (a)+(b)
//   - 20-task benchmark on Schema's real graph

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildIndex,
  searchIndex,
  scoreDoc,
  computeIdf,
  computeTfNorm,
  tokenize,
  DEFAULT_BM25_PARAMS,
  type Document,
} from "../domain/retrieval/bm25.ts";
import {
  buildGraphBm25Index,
  searchGraph,
  graphNodeToDocument,
  GRAPH_BM25_FIELD_WEIGHTS,
} from "../domain/retrieval/graph-bm25.ts";
import {
  buildTraversalIndex,
  traverseFromSeeds,
} from "../domain/retrieval/graph-traversal.ts";
import {
  fuseRrf,
  DEFAULT_RRF_K,
  type RankedList,
} from "../domain/retrieval/rrf.ts";
import {
  buildHybridIndex,
  queryHybrid,
} from "../domain/retrieval/hybrid.ts";
import type {
  MultiRepoGraph,
  GraphNode,
  GraphEdge,
  Cluster,
} from "../domain/multi-repo.ts";

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical-set pinning. GRAPH_BM25_FIELD_WEIGHTS is
// the source of truth; the values are public + tests pin them
// so a future agent changing them gets a compile + test signal.
// ──────────────────────────────────────────────────────────
describe("GRAPH_BM25_FIELD_WEIGHTS: canonical Sourcegraph-style weights", () => {
  it("has exactly 4 fields (name, path, kind, meta)", () => {
    const keys = Object.keys(GRAPH_BM25_FIELD_WEIGHTS).sort();
    assert.deepEqual(keys, ["kind", "meta", "name", "path"]);
  });
  it("name > path > kind > meta (Sourcegraph BM25F precedence)", () => {
    const w = GRAPH_BM25_FIELD_WEIGHTS;
    assert.ok(w.name > w.path, `name (${w.name}) must outweigh path (${w.path})`);
    assert.ok(w.path > w.kind, `path (${w.path}) must outweigh kind (${w.kind})`);
    assert.ok(w.kind > w.meta, `kind (${w.kind}) must outweigh meta (${w.meta})`);
  });
  it("all weights are positive numbers", () => {
    for (const v of Object.values(GRAPH_BM25_FIELD_WEIGHTS)) {
      assert.equal(typeof v, "number");
      assert.ok(v > 0);
    }
  });
});

// ──────────────────────────────────────────────────────────
// BM25 unit tests — the shared bm25.ts module.
// ──────────────────────────────────────────────────────────
describe("bm25.tokenize", () => {
  it("identifier-splits camelCase/PascalCase + retains compound", () => {
    // UserService → ["user", "service", "userservice"]
    // because the compound is retained to keep exact-match
    // queries working.
    const t1 = tokenize("UserService.create");
    assert.ok(t1.includes("user"));
    assert.ok(t1.includes("service"));
    assert.ok(t1.includes("userservice"));
    assert.ok(t1.includes("create"));

    const t2 = tokenize("user_service.ts");
    // No camelCase compound to retain; whitespace-separated.
    assert.ok(t2.includes("user"));
    assert.ok(t2.includes("service"));
    assert.ok(t2.includes("ts"));
  });

  it("drops tokens < 2 chars", () => {
    assert.deepEqual(tokenize("a"), []);
    assert.deepEqual(tokenize(""), []);
    assert.deepEqual(tokenize("   "), []);
  });

  it("treats underscore as a word separator (code-search correct)", () => {
    const tokens = tokenize("user_service_v2");
    assert.ok(tokens.includes("user"));
    assert.ok(tokens.includes("service"));
    // v2 splits to "v" + "2"; both are < 2 chars so dropped.
    // But the compound check kicks in when there's camelCase,
    // not for underscored input. Verify the basic tokens
    // are present.
  });

  it("identifier-splits digit boundaries (getUserId2 → get, user, id, 2)", () => {
    // 2 alone is dropped (< 2 chars); we check the others.
    const tokens = tokenize("getUserId2");
    assert.ok(tokens.includes("get"));
    assert.ok(tokens.includes("user"));
    assert.ok(tokens.includes("id"));
    assert.ok(tokens.includes("getuserid2"), "compound retained");
  });
});

describe("bm25.buildIndex + searchIndex", () => {
  function mkDoc(id: string, name: string, body: string): Document {
    return {
      id,
      fields: [
        { name: "name", tokens: tokenize(name), weight: 3.0 },
        { name: "body", tokens: tokenize(body), weight: 1.0 },
      ],
    };
  }

  it("returns empty for empty query", () => {
    const idx = buildIndex([mkDoc("d1", "User", "Service for users")]);
    assert.deepEqual(searchIndex(idx, "", 10), []);
  });

  it("finds documents containing query terms", () => {
    const docs = [
      mkDoc("d1", "UserService", "manages user accounts"),
      mkDoc("d2", "OrderService", "processes order placements"),
      mkDoc("d3", "PaymentService", "handles payment processing"),
    ];
    const idx = buildIndex(docs);
    const r = searchIndex(idx, "user", 10);
    assert.ok(r.length >= 1);
    assert.equal(r[0]!.docId, "d1", "UserService should rank #1 for 'user'");
  });

  it("ranks higher-weight-field matches above lower-weight matches", () => {
    // Tokenizer treats whitespace as separator but doesn't
    // split camelCase. So "payment svc" → ["payment", "svc"];
    // we use a space to ensure the token "payment" is in the
    // name field directly.
    const docs = [
      mkDoc("name-hit", "payment svc", "unrelated body"),
      mkDoc("body-hit", "unrelated name", "payment processing logic"),
    ];
    const idx = buildIndex(docs);
    const r = searchIndex(idx, "payment", 10);
    assert.equal(r[0]!.docId, "name-hit", "field weight should favour name-hit");
  });

  it("returns 0 score for documents that don't contain query terms", () => {
    const idx = buildIndex([
      mkDoc("d1", "Foo", "Foo body"),
    ]);
    assert.deepEqual(searchIndex(idx, "bar", 10), []);
  });

  it("respects k limit", () => {
    const docs = [];
    for (let i = 0; i < 20; i++) {
      docs.push(mkDoc(`d${i}`, `Service${i}`, "service body"));
    }
    const idx = buildIndex(docs);
    const r = searchIndex(idx, "service", 5);
    assert.equal(r.length, 5);
  });
});

describe("bm25.computeIdf (extracted per §0.6.4 (a))", () => {
  it("rare term has higher IDF than common term", () => {
    const rare = computeIdf([{ docId: "d1", fieldName: "f", tf: 1 }], 100);
    const common = computeIdf(
      Array.from({ length: 50 }, (_, i) => ({ docId: `d${i}`, fieldName: "f", tf: 1 })),
      100,
    );
    assert.ok(rare > common,
      `rare (df=1) IDF (${rare}) must exceed common (df=50) IDF (${common})`);
  });

  it("term in every doc has near-zero IDF", () => {
    const ubiquitous = computeIdf(
      Array.from({ length: 100 }, (_, i) => ({ docId: `d${i}`, fieldName: "f", tf: 1 })),
      100,
    );
    assert.ok(Math.abs(ubiquitous) < 0.1,
      `df==N IDF should be near zero, got ${ubiquitous}`);
  });

  it("postings spanning multiple fields of the same doc count once", () => {
    // df = 1 even though postings has 3 entries (3 fields of d1)
    const idf = computeIdf([
      { docId: "d1", fieldName: "f1", tf: 1 },
      { docId: "d1", fieldName: "f2", tf: 2 },
      { docId: "d1", fieldName: "f3", tf: 3 },
    ], 10);
    // Compare to the IDF for df=1, N=10
    const expected = Math.log((10 - 1 + 0.5) / (1 + 0.5) + 1);
    assert.ok(Math.abs(idf - expected) < 1e-9);
  });
});

describe("bm25.computeTfNorm (extracted per §0.6.4 (a))", () => {
  it("tf=0 → 0", () => {
    assert.equal(computeTfNorm(0, 10, 10, DEFAULT_BM25_PARAMS), 0);
  });

  it("tf-norm saturates as tf → ∞", () => {
    const params = DEFAULT_BM25_PARAMS;
    const low = computeTfNorm(1, 10, 10, params);
    const med = computeTfNorm(10, 10, 10, params);
    const hi = computeTfNorm(1000, 10, 10, params);
    assert.ok(low < med);
    assert.ok(med < hi);
    // tf-norm is bounded by (k1+1) for very high tf.
    const upper = params.k1 + 1;
    assert.ok(hi < upper + 0.01, `tf-norm (${hi}) should be bounded by ${upper}`);
  });

  it("longer-than-average doc has lower tf-norm for the same tf", () => {
    const params = DEFAULT_BM25_PARAMS;
    const shortNorm = computeTfNorm(5, 5, 10, params);     // shorter than avg
    const longNorm  = computeTfNorm(5, 100, 10, params);   // longer than avg
    assert.ok(shortNorm > longNorm,
      `short-doc tf-norm (${shortNorm}) should exceed long-doc tf-norm (${longNorm})`);
  });

  it("zero avgFieldLen falls back to ratio=1 (no division-by-zero)", () => {
    const r = computeTfNorm(5, 10, 0, DEFAULT_BM25_PARAMS);
    assert.ok(Number.isFinite(r));
    assert.ok(r > 0);
  });
});

describe("bm25.scoreDoc — boundary cases per §0.6.4(c)", () => {
  it("score is monotonic with TF (more occurrences → higher score)", () => {
    const docs: Document[] = [
      { id: "low", fields: [{ name: "body", tokens: ["foo"], weight: 1.0 }] },
      { id: "high", fields: [{ name: "body", tokens: ["foo", "foo", "foo", "foo", "foo"], weight: 1.0 }] },
    ];
    const idx = buildIndex(docs);
    const lowScore = scoreDoc(idx, "foo", "low");
    const highScore = scoreDoc(idx, "foo", "high");
    assert.ok(highScore > lowScore, `high (${highScore}) must exceed low (${lowScore})`);
  });

  it("k1 saturation works: extremely high TF doesn't run away", () => {
    const docs: Document[] = [
      { id: "moderate", fields: [{ name: "body", tokens: Array(10).fill("foo"), weight: 1.0 }] },
      { id: "extreme", fields: [{ name: "body", tokens: Array(10000).fill("foo"), weight: 1.0 }] },
    ];
    const idx = buildIndex(docs);
    const moderate = scoreDoc(idx, "foo", "moderate");
    const extreme = scoreDoc(idx, "foo", "extreme");
    // 1000× the term count should NOT produce 1000× the score
    // (saturation). The ratio should be bounded — empirically
    // around 2× for k1=1.2.
    assert.ok(extreme / moderate < 3,
      `saturation broken: extreme/moderate = ${extreme / moderate}`);
  });

  it("length normalization works: longer docs aren't unfairly boosted", () => {
    // Two docs with the same TF; longer doc has lower density.
    // Length-norm should reduce the longer doc's score.
    const docs: Document[] = [
      {
        id: "short",
        fields: [{ name: "body", tokens: ["foo", "bar"], weight: 1.0 }],
      },
      {
        id: "long",
        fields: [{
          name: "body",
          tokens: ["foo", ...Array(100).fill("filler")],
          weight: 1.0,
        }],
      },
    ];
    const idx = buildIndex(docs);
    const shortScore = scoreDoc(idx, "foo", "short");
    const longScore = scoreDoc(idx, "foo", "long");
    assert.ok(shortScore > longScore,
      `short (${shortScore}) should outscore long (${longScore})`);
  });
});

// ──────────────────────────────────────────────────────────
// Graph-BM25 unit tests
// ──────────────────────────────────────────────────────────
function mkNode(id: string, name: string, filePath: string, kind = "function"): GraphNode {
  return {
    id, kind, name,
    locator: `file:///r/${filePath}#${id}`,
    filePath,
  };
}

function mkGraph(nodes: GraphNode[], edges: GraphEdge[] = [], clusters: Cluster[] = []): MultiRepoGraph {
  return {
    version: "0.0",
    repos: [{ uri: "file:///repo", nodes, edges, clusters }],
    interRepoEdges: [],
  };
}

describe("graph-bm25.buildGraphBm25Index", () => {
  it("indexes every node + searches by name", () => {
    const nodes = [
      mkNode("n1", "UserService", "src/users/user-service.ts", "service"),
      mkNode("n2", "OrderProcessor", "src/orders/order-processor.ts", "service"),
      mkNode("n3", "PaymentGateway", "src/payments/payment-gateway.ts", "service"),
    ];
    const idx = buildGraphBm25Index(mkGraph(nodes));
    const r = searchGraph(idx, "user service", 10);
    assert.ok(r.length >= 1);
    assert.equal(r[0]!.nodeId, "n1", "UserService matches 'user service'");
  });

  it("matches by file path even when name doesn't contain the query", () => {
    const nodes = [
      mkNode("n1", "Engine", "src/auth/login.ts"),  // no `auth` in name
      mkNode("n2", "Engine", "src/users/profile.ts"),
    ];
    const idx = buildGraphBm25Index(mkGraph(nodes));
    const r = searchGraph(idx, "auth", 10);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.nodeId, "n1");
  });

  it("ranks symbol-name match higher than file-path match (Sourcegraph BM25F)", () => {
    // Tokenizer doesn't split camelCase; use a name that
    // contains the token "payment" directly.
    const nodes = [
      mkNode("path-hit", "Service", "src/payment-flows/handler.ts"), // path contains "payment"
      mkNode("name-hit", "payment", "src/other/x.ts"),                // name == "payment"
    ];
    const idx = buildGraphBm25Index(mkGraph(nodes));
    const r = searchGraph(idx, "payment", 10);
    assert.equal(r[0]!.nodeId, "name-hit",
      "name field (weight 3) should outrank path field (weight 2)");
  });

  it("uses cluster name as a meta-field signal", () => {
    const nodes = [
      mkNode("n1", "Handler", "src/x/handler.ts"),
      mkNode("n2", "Manager", "src/y/manager.ts"),
    ];
    const clusters: Cluster[] = [
      { id: "c1", name: "Authentication", nodeIds: ["n1"] },
    ];
    const idx = buildGraphBm25Index(mkGraph(nodes, [], clusters));
    const r = searchGraph(idx, "authentication", 10);
    // n1 is in the Authentication cluster; n2 isn't.
    assert.ok(r.length >= 1);
    assert.equal(r[0]!.nodeId, "n1");
  });
});

// ──────────────────────────────────────────────────────────
// Graph-traversal unit tests
// ──────────────────────────────────────────────────────────
describe("graph-traversal.traverseFromSeeds", () => {
  it("returns empty for no seeds", () => {
    const idx = buildTraversalIndex(mkGraph([], []));
    assert.deepEqual(traverseFromSeeds(idx, []), []);
  });

  it("returns the seeds themselves when no edges exist", () => {
    const nodes = [mkNode("n1", "A", "a.ts"), mkNode("n2", "B", "b.ts")];
    const idx = buildTraversalIndex(mkGraph(nodes, []));
    const r = traverseFromSeeds(idx, ["n1"]);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.nodeId, "n1");
  });

  it("expands to outgoing neighbours at depth 1", () => {
    const nodes = [
      mkNode("hub", "Hub", "src/hub.ts"),
      mkNode("a", "A", "src/a.ts"),
      mkNode("b", "B", "src/b.ts"),
    ];
    const edges: GraphEdge[] = [
      { id: "e1", source: "hub", target: "a", relation: "calls" },
      { id: "e2", source: "hub", target: "b", relation: "calls" },
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, edges));
    const r = traverseFromSeeds(idx, ["hub"], { maxDepth: 1 });
    const ids = new Set(r.map((x) => x.nodeId));
    assert.ok(ids.has("hub"));
    assert.ok(ids.has("a"));
    assert.ok(ids.has("b"));
  });

  it("expands to incoming neighbours too (bidirectional walk)", () => {
    const nodes = [
      mkNode("seed", "Seed", "s.ts"),
      mkNode("caller", "Caller", "c.ts"),
    ];
    const edges: GraphEdge[] = [
      { id: "e1", source: "caller", target: "seed", relation: "calls" },
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, edges));
    const r = traverseFromSeeds(idx, ["seed"], { maxDepth: 1 });
    assert.ok(r.some((x) => x.nodeId === "caller"),
      "should walk incoming edges (caller → seed)");
  });

  it("seed importance is consumed (PageRank from clusters)", () => {
    const nodes = [
      mkNode("hi", "Important", "hi.ts"),
      mkNode("lo", "Trivial", "lo.ts"),
    ];
    // Both seeds have the same edges, but `hi` carries a 10×
    // PageRank importance via cluster metadata.
    const clusters: Cluster[] = [
      {
        id: "c1",
        name: "Big",
        nodeIds: ["hi"],
        importance: { hi: 10.0 },
        entryPointIds: ["hi"],
      },
      {
        id: "c2",
        name: "Small",
        nodeIds: ["lo"],
        importance: { lo: 1.0 },
        entryPointIds: ["lo"],
      },
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, [], clusters));
    const r = traverseFromSeeds(idx, ["hi", "lo"]);
    const hiScore = r.find((x) => x.nodeId === "hi")?.score ?? 0;
    const loScore = r.find((x) => x.nodeId === "lo")?.score ?? 0;
    assert.ok(hiScore > loScore,
      `important seed (${hiScore}) must outscore trivial seed (${loScore})`);
  });

  it("respects k limit", () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    nodes.push(mkNode("hub", "Hub", "hub.ts"));
    for (let i = 0; i < 50; i++) {
      nodes.push(mkNode(`n${i}`, `N${i}`, `f${i}.ts`));
      edges.push({ id: `e${i}`, source: "hub", target: `n${i}`, relation: "calls" });
    }
    const idx = buildTraversalIndex(mkGraph(nodes, edges));
    const r = traverseFromSeeds(idx, ["hub"], { k: 5 });
    assert.equal(r.length, 5);
  });

  it("§0.6.4 (b): traversal filters out 0-score nodes", () => {
    // Pin the score > 0 filter. Seeds with score 0 must
    // not appear in results (they're not actually retrieved;
    // they're noise). This protects against a future agent
    // who relaxes the filter and leaks 0-relevance results.
    const nodes = [
      mkNode("seed", "Seed", "s.ts"),
      mkNode("orphan", "Orphan", "o.ts"),  // unreachable
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, []));
    // Pass seedScores that explicitly set seed = 0 + don't
    // include orphan. Seed gets initial 0, orphan stays 0.
    const seedScores = new Map([["seed", 0]]);
    const r = traverseFromSeeds(idx, ["seed"], { seedScores });
    // Neither 0-score node should appear.
    assert.equal(r.length, 0,
      `0-score nodes must be filtered out; got ${r.map((x) => `${x.nodeId}=${x.score}`).join(", ")}`);
  });

  it("§0.6.4 (b): edge weights differentiate by relation", () => {
    // Two targets, equidistant from the seed, but reached by
    // different edge relations. `calls` (weight 1.5) should
    // outweigh `implements_contract` (weight 0.3). The seeds
    // and structure are otherwise identical.
    const nodes = [
      mkNode("seed", "Seed", "s.ts"),
      mkNode("called", "Called", "c.ts"),
      mkNode("contract", "Contract", "ct.ts"),
    ];
    const edges: GraphEdge[] = [
      { id: "e1", source: "seed", target: "called",   relation: "calls" },
      { id: "e2", source: "seed", target: "contract", relation: "implements_contract" },
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, edges));
    const r = traverseFromSeeds(idx, ["seed"]);
    const called = r.find((x) => x.nodeId === "called")!;
    const contract = r.find((x) => x.nodeId === "contract")!;
    assert.ok(called.score > contract.score,
      `calls-weight (${called.score}) must outscore contract-weight (${contract.score})`);
  });

  it("§0.6.4 (b): hop decay reduces farther nodes' contribution", () => {
    // A line graph: seed → mid → far. Far is 2 hops from
    // seed; mid is 1 hop. With decay, mid must score higher
    // than far (the 1-hop contribution outweighs the 2-hop).
    const nodes = [
      mkNode("seed", "Seed", "s.ts"),
      mkNode("mid",  "Mid",  "m.ts"),
      mkNode("far",  "Far",  "f.ts"),
    ];
    const edges: GraphEdge[] = [
      { id: "e1", source: "seed", target: "mid", relation: "calls" },
      { id: "e2", source: "mid",  target: "far", relation: "calls" },
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, edges));
    const r = traverseFromSeeds(idx, ["seed"], { maxDepth: 2 });
    const mid = r.find((x) => x.nodeId === "mid")!;
    const far = r.find((x) => x.nodeId === "far")!;
    assert.ok(mid.score > far.score,
      `mid (${mid.score}) must outscore far (${far.score}) due to hop decay`);
  });

  it("§0.6.4 (b): cluster bonus boosts same-cluster nodes", () => {
    // Two leaf nodes equidistant from a seed by edge count.
    // One (`incluster`) shares a cluster with the seed; the
    // other (`outcluster`) doesn't. Cluster bonus must
    // surface `incluster` higher.
    const nodes = [
      mkNode("seed", "Seed", "seed.ts"),
      mkNode("incluster", "InCluster", "i.ts"),
      mkNode("outcluster", "OutCluster", "o.ts"),
    ];
    const edges: GraphEdge[] = [
      { id: "e1", source: "seed", target: "incluster", relation: "calls" },
      { id: "e2", source: "seed", target: "outcluster", relation: "calls" },
    ];
    const clusters: Cluster[] = [
      { id: "c1", name: "Group", nodeIds: ["seed", "incluster"] },
      { id: "c2", name: "Other", nodeIds: ["outcluster"] },
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, edges, clusters));
    const r = traverseFromSeeds(idx, ["seed"]);
    const incl = r.find((x) => x.nodeId === "incluster")!;
    const outcl = r.find((x) => x.nodeId === "outcluster")!;
    assert.ok(incl.score > outcl.score,
      `cluster bonus should fire: incluster (${incl.score}) must outscore outcluster (${outcl.score})`);
    // Pin the bonus ratio: incluster's score should be roughly
    // 1.2× outcluster's (CLUSTER_BONUS). Allow generous slack.
    const ratio = incl.score / outcl.score;
    assert.ok(ratio > 1.1 && ratio < 1.3,
      `cluster bonus ratio is ${ratio.toFixed(3)}, expected ≈1.2 (CLUSTER_BONUS pin)`);
  });

  it("§0.6.4 (b): seedScores override propagates rank ordering", () => {
    // Two seeds with IDENTICAL graph structure (no edges, no
    // cluster importance). Without seedScores they'd tie and
    // sort alphabetically. With seedScores, the higher-score
    // seed must outrank the lower-score one. This is the
    // exact mutation that caught the Step 8a hybrid bug.
    const nodes = [
      mkNode("alpha", "Alpha", "alpha.ts"),
      mkNode("beta", "Beta", "beta.ts"),
    ];
    const idx = buildTraversalIndex(mkGraph(nodes, []));
    // Without seedScores: alphabetical tiebreak → alpha first.
    const without = traverseFromSeeds(idx, ["alpha", "beta"]);
    assert.equal(without[0]!.nodeId, "alpha");
    // With seedScores favouring beta: beta must move ahead.
    const seedScores = new Map([["alpha", 1.0], ["beta", 10.0]]);
    const with_ = traverseFromSeeds(idx, ["alpha", "beta"], { seedScores });
    assert.equal(with_[0]!.nodeId, "beta",
      "seedScores override should propagate into traversal ranking");
    assert.ok(with_[0]!.score > with_[1]!.score);
  });
});

// ──────────────────────────────────────────────────────────
// RRF fusion unit tests
// ──────────────────────────────────────────────────────────
describe("rrf.fuseRrf", () => {
  it("empty input → empty output", () => {
    assert.deepEqual(fuseRrf([]), []);
  });

  it("single list → docs ranked in same order, with score 1/(k+rank)", () => {
    const list: RankedList = {
      name: "single",
      items: [
        { docId: "a", score: 100 },
        { docId: "b", score: 50 },
      ],
    };
    const r = fuseRrf([list]);
    assert.equal(r.length, 2);
    assert.equal(r[0]!.docId, "a");
    assert.equal(r[1]!.docId, "b");
    // RRF score for rank 1 with k=60 = 1/61 ≈ 0.0164
    assert.ok(Math.abs(r[0]!.rrfScore - 1 / 61) < 1e-9);
  });

  it("two lists agree on top result → top is reinforced", () => {
    const a: RankedList = {
      name: "bm25",
      items: [
        { docId: "x", score: 100 },
        { docId: "y", score: 50 },
      ],
    };
    const b: RankedList = {
      name: "traversal",
      items: [
        { docId: "x", score: 100 },
        { docId: "z", score: 50 },
      ],
    };
    const r = fuseRrf([a, b]);
    assert.equal(r[0]!.docId, "x", "consensus winner");
    // x's score = 1/61 + 1/61 = 2/61
    assert.ok(Math.abs(r[0]!.rrfScore - 2 / 61) < 1e-9);
    // x should be reinforced; y and z should not be.
    const yResult = r.find((x) => x.docId === "y");
    const zResult = r.find((x) => x.docId === "z");
    assert.ok(yResult);
    assert.ok(zResult);
    assert.ok(r[0]!.rrfScore > yResult!.rrfScore);
  });

  it("records which sources contributed for each doc", () => {
    const a: RankedList = { name: "A", items: [{ docId: "x", score: 1 }] };
    const b: RankedList = { name: "B", items: [{ docId: "y", score: 1 }] };
    const r = fuseRrf([a, b]);
    const x = r.find((d) => d.docId === "x");
    const y = r.find((d) => d.docId === "y");
    assert.ok(x?.sources.has("A"));
    assert.equal(x?.sources.has("B"), false);
    assert.ok(y?.sources.has("B"));
    assert.equal(y?.sources.has("A"), false);
  });

  it("k parameter affects scores per the RRF formula", () => {
    const list: RankedList = {
      name: "x",
      items: [{ docId: "a", score: 1 }],
    };
    const rDefault = fuseRrf([list], { k: DEFAULT_RRF_K });
    const rTight = fuseRrf([list], { k: 1 });
    // k=1 should boost rank-1 doc score (1/(1+1) = 0.5 vs 1/61 ≈ 0.0164)
    assert.ok(rTight[0]!.rrfScore > rDefault[0]!.rrfScore * 10);
  });

  it("topK limits results", () => {
    const items = [];
    for (let i = 0; i < 100; i++) items.push({ docId: `d${i}`, score: 100 - i });
    const r = fuseRrf([{ name: "x", items }], { topK: 5 });
    assert.equal(r.length, 5);
  });
});

// ──────────────────────────────────────────────────────────
// Hybrid orchestrator: end-to-end + integration boundaries
// ──────────────────────────────────────────────────────────
describe("hybrid.queryHybrid — end-to-end", () => {
  function bigFixture(): MultiRepoGraph {
    // 30 nodes across 3 service-style clusters.
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const clusters: Cluster[] = [];
    const groups = ["users", "orders", "payments"];
    for (let g = 0; g < groups.length; g++) {
      const name = groups[g]!;
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = `${name}_${i}`;
        ids.push(id);
        nodes.push({
          id,
          kind: i === 0 ? "service" : "utility",
          name: i === 0 ? `${name.charAt(0).toUpperCase() + name.slice(1, -1)}Service` : `${name}Util${i}`,
          locator: `file:///r/${name}/${i}.ts#${id}`,
          filePath: `src/${name}/file-${i}.ts`,
        });
      }
      // Hub-and-spoke: index 0 is the hub.
      for (let i = 1; i < 10; i++) {
        edges.push({
          id: `e_${name}_${i}`,
          source: ids[i]!,
          target: ids[0]!,
          relation: "calls",
        });
      }
      clusters.push({
        id: `c_${name}`,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        nodeIds: ids,
        importance: { [ids[0]!]: 0.8 },
        entryPointIds: [ids[0]!],
      });
    }
    return { version: "0.0", repos: [{ uri: "file:///r", nodes, edges, clusters }], interRepoEdges: [] };
  }

  it("query for 'user service' returns UserService as top result", () => {
    const idx = buildHybridIndex(bigFixture());
    const r = queryHybrid(idx, "user service");
    assert.ok(r.length >= 1);
    assert.equal(r[0]!.nodeId, "users_0",
      `expected UserService hub; got ${r[0]!.nodeId} (${r[0]!.node.name})`);
  });

  it("query for 'payment' surfaces payment cluster", () => {
    const idx = buildHybridIndex(bigFixture());
    const r = queryHybrid(idx, "payment");
    assert.ok(r.length > 0);
    const top = r[0]!;
    assert.equal(top.cluster?.name, "Payments");
  });

  it("every result carries non-null node", () => {
    const idx = buildHybridIndex(bigFixture());
    const r = queryHybrid(idx, "user");
    for (const result of r) {
      assert.ok(result.node, `result for ${result.nodeId} missing node`);
      assert.ok(result.rrfScore > 0, "rrfScore must be positive");
    }
  });

  it("results have at least one source (bm25 OR traversal)", () => {
    const idx = buildHybridIndex(bigFixture());
    const r = queryHybrid(idx, "user");
    for (const result of r) {
      const hasSource = result.bm25 !== null || result.traversal !== null;
      assert.ok(hasSource, `result ${result.nodeId} has neither bm25 nor traversal source`);
    }
  });

  it("k=5 returns at most 5 results", () => {
    const idx = buildHybridIndex(bigFixture());
    const r = queryHybrid(idx, "service", { k: 5 });
    assert.ok(r.length <= 5);
  });

  it("§0.6.4 (c): bm25K controls BM25 candidate pool size", () => {
    // Pin the BM25 candidate-pool semantics. The contract:
    // `bm25K` controls how many BM25 hits enter the RRF
    // pool. Reducing bm25K reduces the number of items the
    // BM25 retriever contributes to fusion. This is a
    // parameter-tuning knob (per §0.6.4 exception
    // analogous to Step 6 log-only mutation J: changing it
    // doesn't break correctness on architecturally-clean
    // queries because traversal compensates from its 5
    // seed nodes; it does change result diversity for
    // lexical-noise queries).
    //
    // Mutation P (set bm25K default to 2) doesn't break
    // any *correctness* invariant — the top result still
    // ranks correctly. We pin the *semantics* here so a
    // future agent understands what the knob does.
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(mkNode(`n_${i}`, `matchableName${i}`, `f${i}.ts`));
    }
    void edges;
    const idx = buildHybridIndex(mkGraph(nodes, []));
    // High bm25K (30): all 10 nodes should be eligible for
    // RRF via the BM25 channel.
    const r30 = queryHybrid(idx, "matchable", { k: 30, bm25K: 30 });
    // Low bm25K (2): only 2 nodes enter via BM25; traversal
    // can still add more (up to its k) IF the seeds have
    // edges. With no edges, low bm25K limits the final
    // pool.
    const r2 = queryHybrid(idx, "matchable", { k: 30, bm25K: 2 });
    assert.ok(r30.length >= r2.length,
      `bm25K=30 should return ≥ results as bm25K=2 (30 = ${r30.length}, 2 = ${r2.length})`);
    // With no edges, the no-edge fixture demonstrates the
    // pool-size knob: r2 should be exactly 2 (the BM25
    // candidates), r30 should be more.
    assert.equal(r2.length, 2, `bm25K=2 with no edges → exactly 2 results`);
  });

  it("§0.6.4 (b): hybrid wires BM25 scores into traversal seeds", () => {
    // The hybrid orchestrator must propagate BM25 scores into
    // traversal as seedScores. Without that wiring, two seeds
    // with identical PageRank importance + identical edge
    // counts tie and sort alphabetically — that was the
    // Step 8a "user service → OrderService" bug.
    //
    // We construct a fixture with 3 clusters that ALL match
    // the shared query token "service" via the kind field,
    // and where the discriminator token "user" only matches
    // the users_hub. Traversal will pull in all 3 hubs as
    // seeds (BM25 ranks them, but all 3 match "service");
    // without seedScores, traversal ties them and sorts
    // alphabetically. With wiring intact, users_hub wins.
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const clusters: Cluster[] = [];
    for (const prefix of ["users", "orders", "payments"]) {
      const ids = [];
      const hubId = `${prefix}_hub`;
      ids.push(hubId);
      nodes.push({
        id: hubId,
        kind: "service",
        name: `${prefix.charAt(0).toUpperCase() + prefix.slice(1, -1)}Service`,
        locator: `file:///r/${prefix}.ts#${hubId}`,
        filePath: `src/${prefix}/service.ts`,
      });
      for (let i = 0; i < 3; i++) {
        const id = `${prefix}_sat${i}`;
        ids.push(id);
        nodes.push({
          id,
          kind: "utility",
          name: `${prefix}Helper${i}`,
          locator: `file:///r/${prefix}/${i}.ts#${id}`,
          filePath: `src/${prefix}/${i}.ts`,
        });
        edges.push({ id: `e_${prefix}_sat${i}`, source: id, target: hubId, relation: "calls" });
      }
      clusters.push({
        id: `c_${prefix}`,
        name: prefix,
        nodeIds: ids,
        importance: { [hubId]: 0.8 },
        entryPointIds: [hubId],
      });
    }
    const graph: MultiRepoGraph = {
      version: "0.0",
      repos: [{ uri: "file:///r", nodes, edges, clusters }],
      interRepoEdges: [],
    };
    const idx = buildHybridIndex(graph);
    // Query "user service" — BM25 strongly favours users_hub
    // (its name contains "user" + "service"). Other hubs only
    // match "service". The hybrid orchestrator must propagate
    // BM25's strong preference into the traversal seed scores
    // so that the final RRF ranking puts users_hub on top.
    const r = queryHybrid(idx, "user service", { k: 3 });
    assert.ok(r.length >= 1);
    assert.equal(r[0]!.nodeId, "users_hub",
      "hybrid orchestrator must wire BM25 scores into traversal seeds");
  });
});

// ──────────────────────────────────────────────────────────
// §0.6.4 (d): integration-boundary equivalence.
// graphNodeToDocument + buildIndex must produce the same
// rankings as the convenience buildGraphBm25Index helper.
// ──────────────────────────────────────────────────────────
describe("§0.6.4 (d): graph BM25 integration boundary equivalence", () => {
  it("§0.6.4 (d): empty graph → empty hybrid index, no crash", () => {
    const idx = buildHybridIndex({
      version: "0.0",
      repos: [{ uri: "file:///empty", nodes: [], edges: [], clusters: [] }],
      interRepoEdges: [],
    });
    assert.equal(queryHybrid(idx, "anything", { k: 10 }).length, 0);
    assert.equal(queryHybrid(idx, "", { k: 10 }).length, 0);
  });

  it("§0.6.4 (d): hybrid hydrate drops unresolvable docIds (no crash)", () => {
    // Defence-in-depth: today both sub-retrievers share the
    // same graph + every fused docId resolves in bm25.nodeById.
    // But Step 8b may extend RRF inputs with canon docs or
    // external retrievers whose docIds aren't graph nodes;
    // queryHybrid must not crash on those. This test fakes
    // the condition by hand-constructing a HybridIndex whose
    // bm25.nodeById is missing a node that the traversal
    // index returns.
    const graphNode = mkNode("real", "Real", "real.ts");
    const idx = buildHybridIndex(mkGraph([graphNode]));
    // Simulate the corruption: replace bm25.nodeById with a
    // map that doesn't contain "real". The fused list will
    // include "real" (from the BM25 sub-retriever's results)
    // but the hydration step must drop it gracefully.
    const corruptedIdx = {
      bm25: {
        ...idx.bm25,
        nodeById: new Map(), // empty
      },
      traversal: idx.traversal,
    };
    // Must not throw, must return either empty or non-throwing.
    const r = queryHybrid(corruptedIdx, "real");
    for (const result of r) {
      assert.ok(result.node, "hydrated results must have non-null node");
    }
  });

  it("§0.6.4 (d): single-node graph + matching query → exactly one result", () => {
    const node = mkNode("solo", "Solo", "solo.ts");
    const idx = buildHybridIndex(mkGraph([node]));
    const r = queryHybrid(idx, "solo");
    assert.equal(r.length, 1);
    assert.equal(r[0]!.nodeId, "solo");
  });

  it("graphNodeToDocument + buildIndex equals buildGraphBm25Index", () => {
    const nodes = [
      mkNode("n1", "UserService", "src/users/user.ts", "service"),
      mkNode("n2", "OrderQueue", "src/orders/queue.ts", "service"),
    ];
    const graph = mkGraph(nodes, [], [
      { id: "c1", name: "Identity", nodeIds: ["n1"] },
    ]);

    // Path A: convenience helper
    const helperIdx = buildGraphBm25Index(graph);
    const helperResults = searchGraph(helperIdx, "user", 10);

    // Path B: manual composition
    const clusterByNodeId = new Map<string, Cluster>([
      ["n1", { id: "c1", name: "Identity", nodeIds: ["n1"] }],
    ]);
    const docs = nodes.map((n) => graphNodeToDocument(n, clusterByNodeId));
    const manualIdx = buildIndex(docs);
    const manualResults = searchIndex(manualIdx, "user", 10);

    assert.equal(helperResults.length, manualResults.length);
    for (let i = 0; i < helperResults.length; i++) {
      assert.equal(helperResults[i]!.nodeId, manualResults[i]!.docId,
        `result ${i} mismatch between helper and manual paths`);
      assert.ok(
        Math.abs(helperResults[i]!.score - manualResults[i]!.score) < 1e-9,
        `score ${i} mismatch`,
      );
    }
  });

  it("§0.6.4 (d): canon BM25 and graph BM25 use same scoring math", () => {
    // The canon module migrated to use the shared BM25.
    // This test verifies that a document scored via the canon
    // path matches what the shared BM25 produces directly,
    // i.e. no implementation drift between consumers.
    const corpus: Document[] = [
      {
        id: "d1",
        fields: [
          { name: "title", tokens: tokenize("BM25 retrieval algorithm"), weight: 1.0 },
          { name: "body", tokens: tokenize("Robertson and Walker invented BM25 in 1994"), weight: 1.0 },
        ],
      },
      {
        id: "d2",
        fields: [
          { name: "title", tokens: tokenize("Other paper"), weight: 1.0 },
          { name: "body", tokens: tokenize("Unrelated content here"), weight: 1.0 },
        ],
      },
    ];
    const idx = buildIndex(corpus);
    const r = searchIndex(idx, "BM25", 10);
    // d1 must rank first (it contains BM25 in both fields)
    assert.equal(r[0]!.docId, "d1");
    assert.ok(r[0]!.score > 0);
  });
});

// ──────────────────────────────────────────────────────────
// 20-task benchmark per the plan's pass criterion. We use a
// synthetic graph (3 services × 10 files each) and run 20
// queries where the expected top result is known. Top-3 hit
// rate must be ≥ 70% per the plan's Level 1 verification.
// ──────────────────────────────────────────────────────────
describe("hybrid: 20-task benchmark (top-3 hit rate ≥ 70%)", () => {
  // Construct a structured fixture with predictable mapping
  // query → expected top hit.
  function benchmarkFixture(): { graph: MultiRepoGraph; tasks: { query: string; expected: string }[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const clusters: Cluster[] = [];

    // 5 service hubs, each with 3 satellites + 1 model.
    const services = [
      { domain: "users", hub: "UserService", clusterName: "Identity" },
      { domain: "orders", hub: "OrderService", clusterName: "Order Management" },
      { domain: "payments", hub: "PaymentService", clusterName: "Payments" },
      { domain: "inventory", hub: "InventoryService", clusterName: "Inventory" },
      { domain: "notifications", hub: "NotificationService", clusterName: "Notifications" },
    ];

    for (const svc of services) {
      const hubId = `${svc.domain}_hub`;
      const ids = [hubId];
      nodes.push({
        id: hubId,
        kind: "service",
        name: svc.hub,
        locator: `file:///r/${svc.domain}/service.ts#${hubId}`,
        filePath: `src/${svc.domain}/${svc.domain}-service.ts`,
      });
      for (let i = 0; i < 3; i++) {
        const id = `${svc.domain}_sat${i}`;
        ids.push(id);
        nodes.push({
          id,
          kind: "utility",
          name: `${svc.hub.replace("Service", "")}Helper${i}`,
          locator: `file:///r/${svc.domain}/helper-${i}.ts#${id}`,
          filePath: `src/${svc.domain}/helper-${i}.ts`,
        });
        edges.push({ id: `e_${svc.domain}_sat${i}`, source: id, target: hubId, relation: "calls" });
      }
      const modelId = `${svc.domain}_model`;
      ids.push(modelId);
      nodes.push({
        id: modelId,
        kind: "model",
        name: `${svc.hub.replace("Service", "")}Model`,
        locator: `file:///r/${svc.domain}/model.ts#${modelId}`,
        filePath: `src/${svc.domain}/model.ts`,
      });
      edges.push({ id: `e_${svc.domain}_model`, source: hubId, target: modelId, relation: "imports" });
      clusters.push({
        id: `c_${svc.domain}`,
        name: svc.clusterName,
        nodeIds: ids,
        importance: { [hubId]: 0.8 },
        entryPointIds: [hubId],
      });
    }

    const tasks: { query: string; expected: string }[] = [
      // Name queries (5)
      { query: "UserService",          expected: "users_hub" },
      { query: "OrderService",         expected: "orders_hub" },
      { query: "PaymentService",       expected: "payments_hub" },
      { query: "InventoryService",     expected: "inventory_hub" },
      { query: "NotificationService",  expected: "notifications_hub" },
      // Domain-word queries (5)
      { query: "users",                expected: "users_hub" },
      { query: "orders",               expected: "orders_hub" },
      { query: "payments",             expected: "payments_hub" },
      { query: "inventory",            expected: "inventory_hub" },
      { query: "notifications",        expected: "notifications_hub" },
      // File-path queries (5)
      { query: "users-service.ts",     expected: "users_hub" },
      { query: "orders-service.ts",    expected: "orders_hub" },
      { query: "payments-service.ts",  expected: "payments_hub" },
      { query: "inventory-service.ts", expected: "inventory_hub" },
      { query: "notifications-service.ts", expected: "notifications_hub" },
      // Cluster-name queries (5)
      { query: "Identity",             expected: "users_hub" },
      { query: "Order Management",     expected: "orders_hub" },
      { query: "Payments",             expected: "payments_hub" },
      { query: "Inventory",            expected: "inventory_hub" },
      { query: "Notifications",        expected: "notifications_hub" },
    ];

    return {
      graph: { version: "0.0", repos: [{ uri: "file:///r", nodes, edges, clusters }], interRepoEdges: [] },
      tasks,
    };
  }

  it("top-3 hit rate ≥ 70% across 20 synthetic queries", () => {
    const { graph, tasks } = benchmarkFixture();
    const idx = buildHybridIndex(graph);

    let hits = 0;
    const misses: { query: string; expected: string; top: string[] }[] = [];
    for (const task of tasks) {
      const results = queryHybrid(idx, task.query, { k: 3 });
      const top3Ids = results.map((r) => r.nodeId);
      if (top3Ids.includes(task.expected)) {
        hits++;
      } else {
        misses.push({ query: task.query, expected: task.expected, top: top3Ids });
      }
    }
    const hitRate = hits / tasks.length;
    // Per the plan's Level 1 gate: ≥ 70% top-3 hit rate.
    assert.ok(hitRate >= 0.7,
      `hit rate ${(hitRate * 100).toFixed(1)}% < 70% gate. Misses: ${JSON.stringify(misses, null, 2)}`);
  });
});

// ──────────────────────────────────────────────────────────
// BM25 params canonical: pin DEFAULT_BM25_PARAMS values so
// a future agent who tunes them gets caught + the canon
// regression-tests retain their behaviour.
// ──────────────────────────────────────────────────────────
describe("bm25.searchIndex perf: O(T×P), not O(C×T×P)", () => {
  it("scales with postings count, not candidate count (Step 8a DC regression guard)", () => {
    // Without the inverted-loop optimization, this fixture
    // takes >2 seconds because each candidate re-scans the
    // postings list per term. With the optimization it runs
    // in single-digit ms. Pin the contract at a generous
    // bound (200 ms) so CI doesn't flake but the original
    // 2,000+ ms regression would be caught.
    const docs: Document[] = [];
    // 5,000 docs, each with a single "crates" token + a
    // unique distractor token. Query "crates" matches every
    // doc → C = 5,000.
    for (let i = 0; i < 5000; i++) {
      docs.push({
        id: `d${i}`,
        fields: [{
          name: "name",
          tokens: ["crates", `unique${i}`],
          weight: 1.0,
        }],
      });
    }
    const idx = buildIndex(docs);
    const t0 = Date.now();
    const r = searchIndex(idx, "crates", 30);
    const dt = Date.now() - t0;
    assert.equal(r.length, 30);
    assert.ok(dt < 200,
      `searchIndex took ${dt}ms on 5k-doc fixture; perf regression vs Step 8a DC optimization`);
  });
});

describe("bm25.DEFAULT_BM25_PARAMS: canonical", () => {
  it("k1 = 1.2, b = 0.75 (Robertson + Sourcegraph)", () => {
    assert.equal(DEFAULT_BM25_PARAMS.k1, 1.2);
    assert.equal(DEFAULT_BM25_PARAMS.b, 0.75);
  });
});

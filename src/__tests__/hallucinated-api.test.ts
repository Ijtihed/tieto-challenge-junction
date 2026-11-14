// Per `architecture/v1-launch-plan.md` Step 8b work item 2 +
// §0.6.4 adversarial verification with refinements (a-j) from
// day-1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectHallucinatedApis,
  collectKnownNodeIds,
  nameFromNodeId,
  MIN_NEAREST_MATCH_SCORE,
  MAX_HALLUCINATIONS_REPORTED,
  type HallucinatedApi,
} from "../domain/retrieval/hallucinated-api.ts";
import { buildGraphBm25Index } from "../domain/retrieval/graph-bm25.ts";
import type { GraphNode, GraphEdge, MultiRepoGraph } from "../domain/multi-repo.ts";

// ──────────────────────────────────────────────────────────
// §0.6.2 canonical thresholds
// ──────────────────────────────────────────────────────────
describe("hallucinated-api canonical constants", () => {
  it("MIN_NEAREST_MATCH_SCORE = 0.5 (noise-floor for suggestions)", () => {
    assert.equal(MIN_NEAREST_MATCH_SCORE, 0.5);
  });

  it("MAX_HALLUCINATIONS_REPORTED = 20 (per-PR cap)", () => {
    assert.equal(MAX_HALLUCINATIONS_REPORTED, 20);
  });
});

// ──────────────────────────────────────────────────────────
// Pure helpers (§0.6.4 (a) extracted)
// ──────────────────────────────────────────────────────────
describe("collectKnownNodeIds", () => {
  it("returns a Set of every node id across repos", () => {
    const g: MultiRepoGraph = {
      version: "0.0",
      repos: [
        {
          uri: "file:///r1",
          nodes: [mkNode("a"), mkNode("b")],
          edges: [],
          clusters: [],
        },
        {
          uri: "file:///r2",
          nodes: [mkNode("c")],
          edges: [],
          clusters: [],
        },
      ],
      interRepoEdges: [],
    };
    const known = collectKnownNodeIds(g);
    assert.equal(known.size, 3);
    assert.ok(known.has("a"));
    assert.ok(known.has("c"));
  });

  it("empty graph → empty set", () => {
    const g: MultiRepoGraph = {
      version: "0.0",
      repos: [{ uri: "file:///r", nodes: [], edges: [], clusters: [] }],
      interRepoEdges: [],
    };
    assert.equal(collectKnownNodeIds(g).size, 0);
  });
});

describe("nameFromNodeId", () => {
  it("Schema locator-style id → last :slug", () => {
    assert.equal(
      nameFromNodeId("fn:src/middleware/auth.ts:requireAuth"),
      "requireAuth",
    );
  });

  it("simple id → whole id", () => {
    assert.equal(nameFromNodeId("simpleId"), "simpleId");
  });

  it("id with trailing colon → empty string", () => {
    assert.equal(nameFromNodeId("foo:"), "");
  });
});

// ──────────────────────────────────────────────────────────
// detectHallucinatedApis end-to-end
// ──────────────────────────────────────────────────────────
function mkNode(id: string, name: string = id, filePath?: string): GraphNode {
  return {
    id,
    kind: "function",
    name,
    locator: `file:///r/${id}#${id}`,
    ...(filePath !== undefined ? { filePath } : {}),
  };
}

function mkEdge(id: string, source: string, target: string, relation = "calls"): GraphEdge {
  return { id, source, target, relation };
}

function mkGraph(nodes: GraphNode[], edges: GraphEdge[] = []): MultiRepoGraph {
  return {
    version: "0.0",
    repos: [{ uri: "file:///r", nodes, edges, clusters: [] }],
    interRepoEdges: [],
  };
}

describe("detectHallucinatedApis", () => {
  it("empty diff → no hallucinations", () => {
    const graph = mkGraph([mkNode("a"), mkNode("b")]);
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: { addedNodes: [], addedEdges: [] },
      headGraph: graph,
      hybridIndex: index,
    });
    assert.deepEqual([...out], []);
  });

  it("all calls resolve in head graph → no hallucinations", () => {
    const graph = mkGraph(
      [mkNode("caller"), mkNode("callee")],
      [mkEdge("e1", "caller", "callee")],
    );
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: {
        addedNodes: [mkNode("caller")],
        addedEdges: [mkEdge("e1", "caller", "callee")],
      },
      headGraph: graph,
      hybridIndex: index,
    });
    assert.deepEqual([...out], []);
  });

  it("call to non-existent target → flagged as hallucinated", () => {
    const graph = mkGraph(
      [mkNode("caller")],
      [mkEdge("e1", "caller", "ghostFunc")],
    );
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: {
        addedNodes: [mkNode("caller")],
        addedEdges: [mkEdge("e1", "caller", "ghostFunc")],
      },
      headGraph: graph,
      hybridIndex: index,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.call, "ghostFunc");
    assert.equal(out[0]!.callerId, "caller");
  });

  it("non-calls relations are ignored (only calls edges are candidates)", () => {
    const graph = mkGraph(
      [mkNode("caller"), mkNode("model")],
      [mkEdge("e1", "caller", "ghostFunc", "imports")],
    );
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: {
        addedNodes: [mkNode("caller")],
        addedEdges: [mkEdge("e1", "caller", "ghostFunc", "imports")],
      },
      headGraph: graph,
      hybridIndex: index,
    });
    assert.deepEqual([...out], []);
  });

  it("§0.6.4 (b): suggests a near-miss via BM25 when the score is ≥ threshold", () => {
    // Graph contains `validateUser`. Diff adds a call to
    // `validateUserr` (typo). BM25 should suggest the real one.
    const graph = mkGraph(
      [
        mkNode("caller"),
        mkNode("validateUser", "validateUser", "src/users.ts"),
      ],
      [mkEdge("e1", "caller", "validateUserr")],
    );
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: {
        addedNodes: [mkNode("caller")],
        addedEdges: [mkEdge("e1", "caller", "validateUserr")],
      },
      headGraph: graph,
      hybridIndex: index,
    });
    assert.equal(out.length, 1);
    // BM25 with identifier splits should find "validateUser"
    // as the nearest match (tokens "validate" + "user" both
    // present in caller-target name).
    assert.equal(out[0]!.nearestMatch, "validateUser");
    assert.ok(
      (out[0]!.nearestMatchScore ?? 0) >= MIN_NEAREST_MATCH_SCORE,
      `nearest match score ${out[0]!.nearestMatchScore} below threshold ${MIN_NEAREST_MATCH_SCORE}`,
    );
  });

  it("§0.6.4 (g) deterministic sort: callerId asc, then call asc", () => {
    const graph = mkGraph([mkNode("z_caller"), mkNode("a_caller")]);
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: {
        addedNodes: [mkNode("z_caller"), mkNode("a_caller")],
        addedEdges: [
          mkEdge("e1", "z_caller", "ghostB"),
          mkEdge("e2", "a_caller", "ghostZ"),
          mkEdge("e3", "a_caller", "ghostA"),
        ],
      },
      headGraph: graph,
      hybridIndex: index,
    });
    assert.equal(out.length, 3);
    // a_caller's edges precede z_caller's
    assert.equal(out[0]!.callerId, "a_caller");
    // Within a_caller, ghostA precedes ghostZ
    assert.equal(out[0]!.call, "ghostA");
    assert.equal(out[1]!.call, "ghostZ");
    assert.equal(out[2]!.callerId, "z_caller");
  });

  it("§0.6.4 (c) cap: more than 20 hallucinations are truncated", () => {
    const nodes = [mkNode("caller")];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 30; i++) {
      edges.push(mkEdge(`e${i}`, "caller", `ghost${i.toString().padStart(2, "0")}`));
    }
    const graph = mkGraph(nodes, edges);
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: { addedNodes: nodes, addedEdges: edges },
      headGraph: graph,
      hybridIndex: index,
    });
    assert.equal(out.length, MAX_HALLUCINATIONS_REPORTED,
      `expected at most ${MAX_HALLUCINATIONS_REPORTED} findings; got ${out.length}`);
  });

  it("low-confidence BM25 hits don't get surfaced as nearestMatch", () => {
    // Graph has only an unrelated node. Diff adds a call to
    // something totally different. BM25 will return *some*
    // hit but score < 0.5, so nearestMatch should be omitted.
    const graph = mkGraph([mkNode("unrelated", "unrelated")]);
    const index = buildGraphBm25Index(graph);
    const out = detectHallucinatedApis({
      diff: {
        addedNodes: [],
        addedEdges: [mkEdge("e1", "unknown_caller", "xyz_qrs_no_match")],
      },
      headGraph: graph,
      hybridIndex: index,
    });
    if (out.length > 0) {
      // If anything surfaces, ensure no low-confidence match is suggested.
      const finding = out[0]!;
      if (finding.nearestMatch) {
        assert.ok(
          (finding.nearestMatchScore ?? 0) >= MIN_NEAREST_MATCH_SCORE,
          "low-confidence nearestMatch leaked through threshold",
        );
      }
    }
  });

  it("§0.6.4 DC mutation-I FIRING: nearestMatch threshold is INCLUSIVE (>= 0.5, not > 0.5)", async () => {
    // §0.6.4 (c) threshold-pinning: test the boundary exactly.
    // A mutation that flips `>= MIN_NEAREST_MATCH_SCORE` to
    // `> MIN_NEAREST_MATCH_SCORE` would drop hits that score
    // exactly 0.5 — silently raising the noise floor.
    //
    // Pinning approach: source inspection. Constructing an
    // empirical index whose top hit scores _exactly_ 0.5 is
    // brittle (BM25 is corpus-dependent). Source inspection
    // is robust to refactors but catches the bare-arithmetic
    // mutation we care about.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../domain/retrieval/hallucinated-api.ts", import.meta.url),
      "utf-8",
    );
    assert.match(
      src,
      />=\s*MIN_NEAREST_MATCH_SCORE/,
      "hallucinated-api.ts MUST use `>= MIN_NEAREST_MATCH_SCORE` (inclusive); strict `>` would drop boundary hits at exactly 0.5",
    );
    assert.doesNotMatch(
      src,
      /\s>\s*MIN_NEAREST_MATCH_SCORE(?!=)/,
      "hallucinated-api.ts MUST NOT use strict `> MIN_NEAREST_MATCH_SCORE` — inclusive threshold per §0.6.4 (c)",
    );
  });

  it("type signature: HallucinatedApi shape", () => {
    const h: HallucinatedApi = {
      call: "ghostFunc",
      callerId: "caller",
      nearestMatch: "realFunc",
      nearestMatchScore: 0.8,
    };
    assert.equal(typeof h.call, "string");
    assert.equal(typeof h.callerId, "string");
  });
});

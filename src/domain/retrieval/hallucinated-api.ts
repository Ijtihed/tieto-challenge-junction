// Per `architecture/v1-launch-plan.md` Step 8b work item 2 +
// research/26 §6 (hybrid-strict empirical case).
//
// Hallucinated-API detector. Given a graph diff's "added"
// nodes/edges + the workspace's hybrid index, identify any
// outbound call whose target doesn't resolve in the graph —
// the classic LLM hallucination failure mode where the model
// invents an API that doesn't exist.
//
// **Why this is a hybrid-strict feature.** Per research/26
// §6 + Q11 (hybrid-strict): Schema is the verifier, not the
// authority. When a PR's diff includes a call to a function
// the graph doesn't know, the answer isn't "block the PR"
// (that's authority); it's "flag for human review" — exactly
// what `pr.review` already does for rule violations.
//
// **Detection algorithm.**
//   1. From the diff, collect every `calls` edge whose
//      source is in the head graph (i.e. the PR added /
//      modified a caller).
//   2. For each such edge, the *target* is the callee. If
//      the target exists in the head graph, it's resolved
//      — no hallucination.
//   3. If the target does NOT exist in the head graph, it's
//      a potential hallucination. Use Step 8a's hybrid
//      index to find the nearest existing node (top-1 BM25
//      hit on the callee's name) so the report can say
//      "did you mean `realName`?".
//
// **Pure domain.** No IO. The caller passes the diff +
// the hybrid index + the head graph; this module computes
// the report.

import type { GraphEdge, GraphNode, MultiRepoGraph } from "../multi-repo.ts";
import { searchGraph, type GraphBm25Index } from "./graph-bm25.ts";
import { EDGE_RELATIONS } from "../vocabulary.ts";

/** A single hallucination finding. */
export interface HallucinatedApi {
  /** The textual call (typically the target node id or a
   *  function-like name). What the diff added. */
  readonly call: string;
  /** Nearest existing graph node by BM25, if any with
   *  score ≥ `MIN_NEAREST_MATCH_SCORE`. */
  readonly nearestMatch?: string;
  /** Score of the nearest match. Caller can use this to
   *  filter low-confidence suggestions. */
  readonly nearestMatchScore?: number;
  /** The caller node id (the node that contains the
   *  invented call). Lets the report point the reviewer
   *  at the exact location. */
  readonly callerId: string;
}

/** Threshold below which BM25 scores aren't surfaced as
 *  "did you mean". A floor of 0.5 keeps the report clean —
 *  random-character "nearest matches" don't help reviewers. */
export const MIN_NEAREST_MATCH_SCORE = 0.5;

/** Max hallucinations to report per PR. The plan calls this
 *  out as a noise-floor consideration: 10+ hallucinations
 *  in one PR suggests the reviewer should look at the diff
 *  whole-hog rather than triaging each one. */
export const MAX_HALLUCINATIONS_REPORTED = 20;

/** The diff shape the detector consumes. A subset of
 *  `graph.diff_against`'s output — only the fields needed
 *  for hallucination detection. */
export interface HallucinationDiffInput {
  /** Nodes added in the head (PR) graph. */
  readonly addedNodes: readonly GraphNode[];
  /** Edges added in the head (PR) graph. Every `calls` edge
   *  here is a candidate. */
  readonly addedEdges: readonly GraphEdge[];
}

export interface HallucinationDetectorInput {
  readonly diff: HallucinationDiffInput;
  readonly headGraph: MultiRepoGraph;
  readonly hybridIndex: GraphBm25Index;
}

/** Build a Set of every node id present in the head graph.
 *  Pure helper (§0.6.4 (a)). Exported for testing. */
export function collectKnownNodeIds(graph: MultiRepoGraph): Set<string> {
  const out = new Set<string>();
  for (const repo of graph.repos) {
    for (const n of repo.nodes) out.add(n.id);
  }
  return out;
}

/** Extract the textual name from a node id. For Schema's
 *  locator-style ids (`fn:src/path/file.ts:funcName`) the
 *  last `:` slice is the function name. For shorter ids,
 *  the whole id is returned. Pure (§0.6.4 (a)). */
export function nameFromNodeId(nodeId: string): string {
  const lastColon = nodeId.lastIndexOf(":");
  if (lastColon === -1) return nodeId;
  return nodeId.slice(lastColon + 1);
}

/** Detect hallucinated APIs in a diff. Returns the up-to
 *  `MAX_HALLUCINATIONS_REPORTED` findings, sorted by caller
 *  id for deterministic output. */
export function detectHallucinatedApis(
  input: HallucinationDetectorInput,
): readonly HallucinatedApi[] {
  const known = collectKnownNodeIds(input.headGraph);
  const callsEdges = input.diff.addedEdges.filter(
    (e) => e.relation === EDGE_RELATIONS.calls,
  );

  // For each added `calls` edge whose target isn't a known
  // node id, the target is invented.
  const findings: HallucinatedApi[] = [];
  for (const edge of callsEdges) {
    if (known.has(edge.target)) continue;
    // Probe the hybrid BM25 index for the nearest existing
    // node by callee name. Top-1 hit is the suggestion.
    const candidate = nameFromNodeId(edge.target);
    const probes = searchGraph(input.hybridIndex, candidate, 1);
    const top = probes[0];
    const finding: HallucinatedApi = {
      call: edge.target,
      callerId: edge.source,
      ...(top && top.score >= MIN_NEAREST_MATCH_SCORE
        ? { nearestMatch: top.nodeId, nearestMatchScore: top.score }
        : {}),
    };
    findings.push(finding);
    if (findings.length >= MAX_HALLUCINATIONS_REPORTED) break;
  }

  // Deterministic ordering: by callerId, then by call. This
  // makes the pr.review markdown reproducible (§0.6.4 (g)
  // sort-order rule applied — even though there's no
  // "right" ordering here, alphabetic is stable + cheap).
  findings.sort(
    (a, b) =>
      a.callerId.localeCompare(b.callerId) ||
      a.call.localeCompare(b.call),
  );

  return findings;
}

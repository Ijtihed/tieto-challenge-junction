// Per architecture/specs/semantic-diff.md
// Orchestrates refactoring detection → impact scoring → semantic summary.

import type { MultiRepoGraph } from "./multi-repo.ts";
import type { GraphDelta } from "./delta.ts";
import { computeDelta } from "./delta.ts";
import { detectRefactorings } from "./refactoring-detect.ts";
import { computeImpactScores } from "./impact-score.ts";
import { computeSemanticSummary } from "./semantic-summary.ts";

export function computeSemanticDiff(
  base: MultiRepoGraph,
  head: MultiRepoGraph,
  totalLinesChanged?: number,
): GraphDelta {
  const rawDelta = computeDelta(base, head);

  // Pass 1: refactoring detection
  const { enrichedNodes: refactoredNodes, matches } = detectRefactorings(base, head, rawDelta.nodes);

  // Pass 2: impact scoring (on the head graph — that's the current state)
  const { enrichedNodes: impactNodes, impactSummary } = computeImpactScores(head, refactoredNodes);

  // Pass 3: semantic summary
  const semanticSummary = computeSemanticSummary(impactNodes, impactSummary, totalLinesChanged ?? 0);

  return {
    ...rawDelta,
    nodes: impactNodes,
    impactSummary,
    semanticSummary,
  };
}

export { detectRefactorings } from "./refactoring-detect.ts";
export { computeImpactScores } from "./impact-score.ts";
export { computeSemanticSummary } from "./semantic-summary.ts";

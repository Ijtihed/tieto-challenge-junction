import type { Graph, Insight, Rule, Violation } from "./types";
import { fixtureGraph, fixtureInsights, fixtureRules, fixtureViolations } from "./fixture";

export const continueExtractGraph: Graph = fixtureGraph;
export const continueExtractInsights: Insight[] = fixtureInsights;
export const continueExtractRules: Rule[] = fixtureRules;
export const continueExtractViolations = fixtureViolations;
export const continueExtractStats = {
  totalNodes: fixtureGraph.nodes.length,
  totalEdges: fixtureGraph.edges.length,
  keptNodes: fixtureGraph.nodes.length,
  keptEdges: fixtureGraph.edges.length,
};

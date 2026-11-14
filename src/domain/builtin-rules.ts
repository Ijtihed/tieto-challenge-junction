// Per architecture/schema-v3.md §14.5 — 4 built-in structural rules.
// Stack-neutral per Rule 10: they operate on NodeKind + EdgeRelation,
// not framework-specific patterns.

import type { MultiRepoGraph, GraphNode, GraphEdge } from "./multi-repo.ts";
import type { Rule, Violation } from "./types.ts";
import { NODE_KINDS } from "./vocabulary.ts";

export interface BuiltinRule extends Rule {
  readonly evaluate: (graph: MultiRepoGraph) => Violation[];
}

function noCycle(graph: MultiRepoGraph): Violation[] {
  const violations: Violation[] = [];
  const allNodes = graph.repos.flatMap((r) => r.nodes);
  const allEdges = graph.repos.flatMap((r) => r.edges);

  const adj = new Map<string, string[]>();
  for (const e of allEdges) {
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of allNodes) color.set(n.id, WHITE);

  const pathSet = new Set<string>();

  function dfs(nodeId: string, path: string[]): void {
    color.set(nodeId, GRAY);
    pathSet.add(nodeId);
    for (const neighbor of adj.get(nodeId) ?? []) {
      if (color.get(neighbor) === GRAY && pathSet.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart);
          violations.push({
            ruleId: "builtin:no-cycle",
            severity: "error",
            message: `Cycle detected: ${cycle.map((id) => allNodes.find((n) => n.id === id)?.name ?? id).join(" → ")} → ${allNodes.find((n) => n.id === neighbor)?.name ?? neighbor}`,
            nodeIds: cycle,
          });
        }
      }
      if (color.get(neighbor) === WHITE) {
        dfs(neighbor, [...path, neighbor]);
      }
    }
    pathSet.delete(nodeId);
    color.set(nodeId, BLACK);
  }

  for (const n of allNodes) {
    if (color.get(n.id) === WHITE) {
      dfs(n.id, [n.id]);
    }
  }

  return violations;
}

function mustHaveHandler(graph: MultiRepoGraph): Violation[] {
  const violations: Violation[] = [];
  const allNodes = graph.repos.flatMap((r) => r.nodes);
  const allEdges = graph.repos.flatMap((r) => r.edges);
  const targets = new Set(allEdges.map((e) => e.target));

  for (const node of allNodes) {
    if (node.kind === NODE_KINDS.route_handler && !targets.has(node.id)) {
      violations.push({
        ruleId: "builtin:must-have-handler",
        severity: "warn",
        message: `Route handler "${node.name}" has no incoming edges — it may be unregistered`,
        nodeIds: [node.id],
      });
    }
  }

  return violations;
}

function mustHaveInbound(graph: MultiRepoGraph): Violation[] {
  const violations: Violation[] = [];
  const allEdges = graph.repos.flatMap((r) => r.edges);
  const targets = new Set(allEdges.map((e) => e.target));
  const sources = new Set(allEdges.map((e) => e.source));

  for (const repo of graph.repos) {
    const fileNodes = repo.nodes.filter((n) => n.locator.startsWith("file://") && !n.locator.includes("#"));
    for (const node of fileNodes) {
      if (!targets.has(node.id) && sources.has(node.id)) {
        violations.push({
          ruleId: "builtin:must-have-inbound",
          severity: "info",
          message: `File "${node.name}" has outgoing edges but no incoming — possible entry point or unreferenced module`,
          nodeIds: [node.id],
        });
      }
    }
  }

  return violations;
}

function mustHaveOutbound(graph: MultiRepoGraph): Violation[] {
  const violations: Violation[] = [];
  const allEdges = graph.repos.flatMap((r) => r.edges);
  const targets = new Set(allEdges.map((e) => e.target));
  const sources = new Set(allEdges.map((e) => e.source));

  for (const repo of graph.repos) {
    const fileNodes = repo.nodes.filter((n) => n.locator.startsWith("file://") && !n.locator.includes("#"));
    for (const node of fileNodes) {
      if (targets.has(node.id) && !sources.has(node.id)) {
        violations.push({
          ruleId: "builtin:must-have-outbound",
          severity: "info",
          message: `File "${node.name}" is imported but imports nothing — leaf module`,
          nodeIds: [node.id],
        });
      }
    }
  }

  return violations;
}

export const BUILTIN_RULES: readonly BuiltinRule[] = [
  {
    id: "builtin:no-cycle",
    kind: "structural",
    body: "No directed cycles in the edge graph (circular dependencies)",
    severity: "error",
    evaluation: "deterministic",
    evaluate: noCycle,
  },
  {
    id: "builtin:must-have-handler",
    kind: "structural",
    body: "Every route_handler node must be registered (have at least one incoming edge)",
    severity: "warn",
    evaluation: "deterministic",
    evaluate: mustHaveHandler,
  },
  {
    id: "builtin:must-have-inbound",
    kind: "structural",
    body: "File nodes with outgoing edges should have at least one incoming edge",
    severity: "info",
    evaluation: "deterministic",
    evaluate: mustHaveInbound,
  },
  {
    id: "builtin:must-have-outbound",
    kind: "structural",
    body: "File nodes with incoming edges should have at least one outgoing edge",
    severity: "info",
    evaluation: "deterministic",
    evaluate: mustHaveOutbound,
  },
];

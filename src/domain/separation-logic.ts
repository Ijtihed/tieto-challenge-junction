// Bi-abductive separation logic for graph operations.
//
// Models the graph as a "heap" of resources (nodes + edges). Each op has a
// footprint: the set of resources it reads, writes, creates, or destroys.
// Bi-abduction computes:
//   - Frame: resources untouched by the op (the "rest of the heap")
//   - Anti-frame: resources the op needs but which are missing
//
// Interference detection checks whether two ops' footprints overlap,
// indicating they cannot safely execute concurrently.

import type { MultiRepoGraph, GraphNode, GraphEdge } from "./multi-repo.ts";
import type { OpSignature, Effect } from "./op-signatures.ts";
import { getSignature } from "./op-signatures.ts";

// ── Resource model ──

export type ResourceKind = "node" | "edge";

export interface Resource {
  readonly kind: ResourceKind;
  readonly id: string;
  /** For edges: the relation type. For nodes: the node kind. */
  readonly type: string;
  /** For edges: source/target. For nodes: node id. */
  readonly refs: readonly string[];
}

export interface Footprint {
  readonly reads: readonly Resource[];
  readonly writes: readonly Resource[];
  readonly creates: readonly Resource[];
  readonly destroys: readonly Resource[];
}

export interface BiAbductionResult {
  readonly frame: readonly Resource[];
  readonly antiFrame: readonly Resource[];
  readonly footprint: Footprint;
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface InterferenceResult {
  readonly interferes: boolean;
  readonly sharedReads: readonly Resource[];
  readonly conflicts: readonly InterferenceConflict[];
}

export interface InterferenceConflict {
  readonly resource: Resource;
  readonly reason: string;
  readonly opA: string;
  readonly opB: string;
}

// ── Footprint computation ──

/**
 * Compute the footprint of an op on a specific node in the graph.
 * The footprint describes which resources the op reads, writes, creates, destroys.
 */
export function computeFootprint(
  graph: MultiRepoGraph,
  opId: string,
  nodeId: string,
): Footprint | null {
  const sig = getSignature(opId);
  if (!sig) return null;

  const reads: Resource[] = [];
  const writes: Resource[] = [];
  const creates: Resource[] = [];
  const destroys: Resource[] = [];

  // The target node is always read
  const targetNode = findNode(graph, nodeId);
  if (!targetNode) return null;
  reads.push({ kind: "node", id: nodeId, type: targetNode.kind as string, refs: [nodeId] });

  // Collect edges connected to the target
  const edges = findEdgesFor(graph, nodeId);
  for (const edge of edges) {
    reads.push({ kind: "edge", id: edge.id, type: edge.relation, refs: [edge.source, edge.target] });
  }

  for (const effect of sig.postconditions) {
    switch (effect.kind) {
      case "modifies_body":
        writes.push({ kind: "node", id: nodeId, type: targetNode.kind as string, refs: [nodeId] });
        break;
      case "adds_node":
        creates.push({ kind: "node", id: `new_${opId}_${nodeId}`, type: effect.nodeKind, refs: [] });
        break;
      case "adds_edge":
        creates.push({ kind: "edge", id: `new_edge_${opId}_${effect.relation}`, type: effect.relation, refs: [nodeId] });
        break;
      case "removes_edge": {
        const victimEdge = edges.find((e) => e.relation === effect.relation);
        if (victimEdge) {
          destroys.push({ kind: "edge", id: victimEdge.id, type: victimEdge.relation, refs: [victimEdge.source, victimEdge.target] });
        }
        break;
      }
      case "removes_node":
        destroys.push({ kind: "node", id: nodeId, type: targetNode.kind as string, refs: [nodeId] });
        for (const edge of edges) {
          destroys.push({ kind: "edge", id: edge.id, type: edge.relation, refs: [edge.source, edge.target] });
        }
        break;
      case "changes_kind":
        writes.push({ kind: "node", id: nodeId, type: effect.to, refs: [nodeId] });
        break;
    }
  }

  // Check preconditions for required edges (anti-frame candidates)
  for (const pre of sig.preconditions) {
    if (pre.kind === "has_edge_in") {
      const found = edges.some((e) => e.target === nodeId && e.relation === pre.relation);
      if (!found) {
        reads.push({ kind: "edge", id: `required_in_${pre.relation}`, type: pre.relation, refs: ["__required__", nodeId] });
      }
    }
    if (pre.kind === "has_edge_out") {
      const found = edges.some((e) => e.source === nodeId && e.relation === pre.relation);
      if (!found) {
        reads.push({ kind: "edge", id: `required_out_${pre.relation}`, type: pre.relation, refs: [nodeId, "__required__"] });
      }
    }
  }

  return { reads, writes, creates, destroys };
}

// ── Bi-abduction ──

/**
 * Given the current heap (the graph) and an op's footprint,
 * compute the frame (untouched resources) and anti-frame (missing required resources).
 */
export function biAbduce(graph: MultiRepoGraph, footprint: Footprint): BiAbductionResult {
  const errors: string[] = [];
  const heapResources = collectHeapResources(graph);
  const heapIds = new Set(heapResources.map((r) => r.id));

  // Anti-frame: resources the footprint reads but aren't in the heap
  const antiFrame: Resource[] = [];
  for (const read of footprint.reads) {
    if (!heapIds.has(read.id) && !read.id.startsWith("required_")) {
      antiFrame.push(read);
    }
    if (read.id.startsWith("required_")) {
      antiFrame.push(read);
      errors.push(`Missing required resource: ${read.type} edge (${read.id})`);
    }
  }

  // Resources that will be destroyed must exist
  for (const d of footprint.destroys) {
    if (!heapIds.has(d.id)) {
      errors.push(`Cannot destroy non-existent resource: ${d.kind} "${d.id}"`);
    }
  }

  // Frame: everything in the heap that isn't read, written, or destroyed
  const touchedIds = new Set<string>();
  for (const r of footprint.reads) touchedIds.add(r.id);
  for (const r of footprint.writes) touchedIds.add(r.id);
  for (const r of footprint.destroys) touchedIds.add(r.id);

  const frame = heapResources.filter((r) => !touchedIds.has(r.id));

  return {
    frame,
    antiFrame,
    footprint,
    valid: errors.length === 0 && antiFrame.length === 0,
    errors,
  };
}

// ── Interference detection ──

/**
 * Check whether two ops on potentially different nodes interfere.
 * Interference occurs when:
 * - One writes/destroys a resource the other reads/writes/destroys
 * - Both write the same resource (write-write conflict)
 */
export function checkInterference(
  graph: MultiRepoGraph,
  opA: { opId: string; nodeId: string },
  opB: { opId: string; nodeId: string },
): InterferenceResult {
  const fpA = computeFootprint(graph, opA.opId, opA.nodeId);
  const fpB = computeFootprint(graph, opB.opId, opB.nodeId);

  if (!fpA || !fpB) {
    return { interferes: false, sharedReads: [], conflicts: [] };
  }

  const conflicts: InterferenceConflict[] = [];
  const sharedReads: Resource[] = [];

  const aReadIds = new Set(fpA.reads.map((r) => r.id));
  const bReadIds = new Set(fpB.reads.map((r) => r.id));
  const aWriteIds = new Set([...fpA.writes, ...fpA.destroys].map((r) => r.id));
  const bWriteIds = new Set([...fpB.writes, ...fpB.destroys].map((r) => r.id));

  // Read-read is safe, track for information
  for (const r of fpA.reads) {
    if (bReadIds.has(r.id)) sharedReads.push(r);
  }

  // Write-read conflict: A writes, B reads
  for (const w of [...fpA.writes, ...fpA.destroys]) {
    if (bReadIds.has(w.id)) {
      conflicts.push({
        resource: w,
        reason: `${opA.opId} modifies "${w.id}" which ${opB.opId} reads`,
        opA: opA.opId, opB: opB.opId,
      });
    }
  }

  // Read-write conflict: A reads, B writes
  for (const w of [...fpB.writes, ...fpB.destroys]) {
    if (aReadIds.has(w.id)) {
      conflicts.push({
        resource: w,
        reason: `${opB.opId} modifies "${w.id}" which ${opA.opId} reads`,
        opA: opA.opId, opB: opB.opId,
      });
    }
  }

  // Write-write conflict
  for (const wA of [...fpA.writes, ...fpA.destroys]) {
    if (bWriteIds.has(wA.id)) {
      conflicts.push({
        resource: wA,
        reason: `Both ${opA.opId} and ${opB.opId} modify "${wA.id}"`,
        opA: opA.opId, opB: opB.opId,
      });
    }
  }

  // Deduplicate conflicts by resource id
  const seen = new Set<string>();
  const deduped = conflicts.filter((c) => {
    const key = `${c.resource.id}:${c.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { interferes: deduped.length > 0, sharedReads, conflicts: deduped };
}

/**
 * Analyze a full plan for interference between all step pairs.
 */
export function analyzePlanInterference(
  graph: MultiRepoGraph,
  steps: readonly { opId: string; nodeId: string }[],
): { pairResults: { stepA: number; stepB: number; result: InterferenceResult }[]; hasInterference: boolean } {
  const pairResults: { stepA: number; stepB: number; result: InterferenceResult }[] = [];

  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      const result = checkInterference(graph, steps[i]!, steps[j]!);
      if (result.interferes || result.sharedReads.length > 0) {
        pairResults.push({ stepA: i, stepB: j, result });
      }
    }
  }

  return { pairResults, hasInterference: pairResults.some((p) => p.result.interferes) };
}

// ── Helpers ──

function findNode(graph: MultiRepoGraph, nodeId: string): GraphNode | undefined {
  for (const repo of graph.repos) {
    for (const node of repo.nodes) {
      if (node.id === nodeId) return node;
    }
  }
  return undefined;
}

function findEdgesFor(graph: MultiRepoGraph, nodeId: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const repo of graph.repos) {
    for (const edge of repo.edges) {
      if (edge.source === nodeId || edge.target === nodeId) edges.push(edge);
    }
  }
  return edges;
}

function collectHeapResources(graph: MultiRepoGraph): Resource[] {
  const resources: Resource[] = [];
  for (const repo of graph.repos) {
    for (const node of repo.nodes) {
      resources.push({ kind: "node", id: node.id, type: node.kind as string, refs: [node.id] });
    }
    for (const edge of repo.edges) {
      resources.push({ kind: "edge", id: edge.id, type: edge.relation, refs: [edge.source, edge.target] });
    }
  }
  return resources;
}

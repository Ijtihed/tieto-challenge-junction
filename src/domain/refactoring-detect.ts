// Per architecture/specs/semantic-diff.md §2.1
// Classifies node-level changes as renames, moves, extractions, inlines,
// or signature changes by matching body fingerprints across a delta.

import type { MultiRepoGraph, GraphNode } from "./multi-repo.ts";
import type { NodeDelta, RefactoringClassification } from "./delta.ts";
import { EDGE_RELATIONS } from "./vocabulary.ts";

export interface RefactoringMatch {
  readonly baseNodeId: string;
  readonly headNodeId: string;
  readonly classification: RefactoringClassification;
  readonly baseName: string;
  readonly headName: string;
  readonly baseFile?: string | undefined;
  readonly headFile?: string | undefined;
}

export interface RefactoringResult {
  readonly matches: readonly RefactoringMatch[];
  readonly enrichedNodes: readonly NodeDelta[];
}

export function detectRefactorings(
  baseGraph: MultiRepoGraph,
  headGraph: MultiRepoGraph,
  rawDeltas: readonly NodeDelta[],
): RefactoringResult {
  const baseNodes = new Map(baseGraph.repos.flatMap((r) => r.nodes.map((n) => [n.id, n] as const)));
  const headNodes = new Map(headGraph.repos.flatMap((r) => r.nodes.map((n) => [n.id, n] as const)));

  const removed = rawDeltas.filter((d) => d.status === "removed");
  const added = rawDeltas.filter((d) => d.status === "added");
  const modified = rawDeltas.filter((d) => d.status === "modified");

  // Index removed nodes by body fingerprint
  const removedByFp = new Map<number, { delta: NodeDelta; node: GraphNode }[]>();
  for (const d of removed) {
    const node = baseNodes.get(d.id);
    if (!node || node.bodyFingerprint === undefined) continue;
    const list = removedByFp.get(node.bodyFingerprint);
    if (list) list.push({ delta: d, node });
    else removedByFp.set(node.bodyFingerprint, [{ delta: d, node }]);
  }

  // Index added nodes by body fingerprint
  const addedByFp = new Map<number, { delta: NodeDelta; node: GraphNode }[]>();
  for (const d of added) {
    const node = headNodes.get(d.id);
    if (!node || node.bodyFingerprint === undefined) continue;
    const list = addedByFp.get(node.bodyFingerprint);
    if (list) list.push({ delta: d, node });
    else addedByFp.set(node.bodyFingerprint, [{ delta: d, node }]);
  }

  const matches: RefactoringMatch[] = [];
  const classifiedRemoved = new Set<string>();
  const classifiedAdded = new Set<string>();
  const nodeOverrides = new Map<string, Partial<NodeDelta>>();

  // Pass 1: exact fingerprint matches (renames + moves)
  for (const [fp, removedList] of removedByFp) {
    const addedList = addedByFp.get(fp);
    if (!addedList) continue;

    for (const rem of removedList) {
      if (classifiedRemoved.has(rem.delta.id)) continue;

      for (const add of addedList) {
        if (classifiedAdded.has(add.delta.id)) continue;

        if (rem.node.name !== add.node.name && rem.node.filePath === add.node.filePath) {
          // Same file, different name → renamed
          matches.push({
            baseNodeId: rem.delta.id,
            headNodeId: add.delta.id,
            classification: "renamed",
            baseName: rem.node.name,
            headName: add.node.name,
            baseFile: rem.node.filePath,
            headFile: add.node.filePath,
          });
          nodeOverrides.set(rem.delta.id, { classification: "renamed", renamedTo: add.delta.id });
          nodeOverrides.set(add.delta.id, { classification: "renamed", renamedFrom: rem.delta.id });
          classifiedRemoved.add(rem.delta.id);
          classifiedAdded.add(add.delta.id);
          break;
        }

        if (rem.node.filePath !== add.node.filePath) {
          // Different file → moved. If name also changed, store both renamedFrom/To AND movedFrom/To.
          const alsoRenamed = rem.node.name !== add.node.name;
          matches.push({
            baseNodeId: rem.delta.id,
            headNodeId: add.delta.id,
            classification: "moved",
            baseName: rem.node.name,
            headName: add.node.name,
            baseFile: rem.node.filePath,
            headFile: add.node.filePath,
          });
          nodeOverrides.set(rem.delta.id, {
            classification: "moved",
            movedTo: add.node.filePath,
            ...(alsoRenamed ? { renamedTo: add.delta.id } : {}),
          });
          nodeOverrides.set(add.delta.id, {
            classification: "moved",
            movedFrom: rem.node.filePath,
            ...(alsoRenamed ? { renamedFrom: rem.delta.id } : {}),
          });
          classifiedRemoved.add(rem.delta.id);
          classifiedAdded.add(add.delta.id);
          break;
        }
      }
    }
  }

  // Pass 2: extraction detection — look for added nodes whose fingerprint
  // partially matches a modified node's base fingerprint (simplified:
  // check if an added node's name appears as a new call edge from a modified node)
  const headEdges = headGraph.repos.flatMap((r) => r.edges);
  const baseEdges = baseGraph.repos.flatMap((r) => r.edges);
  const baseCallTargets = new Set(baseEdges.filter((e) => e.relation === EDGE_RELATIONS.calls).map((e) => `${e.source}→${e.target}`));

  for (const mod of modified) {
    const newCallsFromMod = headEdges.filter(
      (e) => e.source === mod.id && e.relation === EDGE_RELATIONS.calls && !baseCallTargets.has(`${e.source}→${e.target}`),
    );

    for (const call of newCallsFromMod) {
      const addDelta = added.find((a) => a.id === call.target && !classifiedAdded.has(a.id));
      if (!addDelta) continue;

      const addedNode = headNodes.get(addDelta.id);
      const modBaseNode = baseNodes.get(mod.id);
      if (!addedNode || !modBaseNode) continue;

      matches.push({
        baseNodeId: mod.id,
        headNodeId: addDelta.id,
        classification: "extracted",
        baseName: modBaseNode.name,
        headName: addedNode.name,
        baseFile: modBaseNode.filePath,
        headFile: addedNode.filePath,
      });
      nodeOverrides.set(addDelta.id, { classification: "extracted", extractedFrom: mod.id });
      classifiedAdded.add(addDelta.id);
    }
  }

  // Pass 3: inline detection — removed nodes whose caller is modified
  // and no longer calls them
  const headCallTargets = new Set(headEdges.filter((e) => e.relation === EDGE_RELATIONS.calls).map((e) => `${e.source}→${e.target}`));

  for (const rem of removed) {
    if (classifiedRemoved.has(rem.id)) continue;

    const callersInBase = baseEdges.filter((e) => e.target === rem.id && e.relation === EDGE_RELATIONS.calls);
    for (const callerEdge of callersInBase) {
      const callerMod = modified.find((m) => m.id === callerEdge.source);
      if (!callerMod) continue;

      const stillCalled = headCallTargets.has(`${callerEdge.source}→${rem.id}`);
      if (!stillCalled) {
        const remNode = baseNodes.get(rem.id);
        const callerNode = baseNodes.get(callerMod.id);
        if (!remNode || !callerNode) continue;

        matches.push({
          baseNodeId: rem.id,
          headNodeId: callerMod.id,
          classification: "inlined",
          baseName: remNode.name,
          headName: callerNode.name,
          baseFile: remNode.filePath,
          headFile: callerNode.filePath,
        });
        nodeOverrides.set(rem.id, { classification: "inlined", inlinedInto: callerMod.id });
        classifiedRemoved.add(rem.id);
        break;
      }
    }
  }

  // Pass 4: signature change — modified nodes with unchanged body fingerprint
  for (const mod of modified) {
    if (nodeOverrides.has(mod.id)) continue;
    const baseNode = baseNodes.get(mod.id);
    const headNode = headNodes.get(mod.id);
    if (!baseNode || !headNode) continue;
    if (baseNode.bodyFingerprint !== undefined && headNode.bodyFingerprint !== undefined
        && baseNode.bodyFingerprint === headNode.bodyFingerprint
        && (baseNode.name !== headNode.name || baseNode.startLine !== headNode.startLine || baseNode.endLine !== headNode.endLine)) {
      nodeOverrides.set(mod.id, { classification: "signature_changed" });
    }
  }

  // Build enriched node deltas
  const enrichedNodes: NodeDelta[] = rawDeltas.map((d) => {
    const override = nodeOverrides.get(d.id);
    if (!override) {
      if (d.status === "modified") return { ...d, classification: "modified" as const };
      return d;
    }
    return { ...d, ...override };
  });

  return { matches, enrichedNodes };
}

// Per architecture/schema-v3.md §4.7 + specs/semantic-diff.md +
// Step 6 of architecture/v1-launch-plan.md (Iceberg/Delta CDC
// vocabulary, research/27 §8).
import type { MultiRepoGraph } from "./multi-repo.ts";

// ──────────────────────────────────────────────────────────
// Step 6: Iceberg / Delta-Lake "change-query" canonical 4 forms.
// Per research/27 §8 + verification report. The single source of
// truth for the union; the wire layer + tests import this same
// constant (§0.6.2 single-source-union pattern). Engine-only —
// Studio doesn't carry a parallel union.
// ──────────────────────────────────────────────────────────

export type ChangeQueryMode = "append" | "upsert" | "min-delta" | "full-delta";

export const CHANGE_QUERY_MODES: readonly ChangeQueryMode[] = [
  "append",
  "upsert",
  "min-delta",
  "full-delta",
] as const;

export type RefactoringClassification =
  | "renamed"
  | "moved"
  | "extracted"
  | "inlined"
  | "signature_changed"
  | "modified";

export interface NodeDelta {
  readonly id: string;
  readonly status: "added" | "removed" | "modified" | "unchanged";
  readonly classification?: RefactoringClassification | undefined;
  readonly renamedFrom?: string | undefined;
  readonly renamedTo?: string | undefined;
  readonly movedFrom?: string | undefined;
  readonly movedTo?: string | undefined;
  readonly extractedFrom?: string | undefined;
  readonly inlinedInto?: string | undefined;
  readonly impactedUpstream?: number | undefined;
  readonly impactedDownstream?: number | undefined;
  readonly impactedContracts?: readonly string[] | undefined;
  readonly reasons?: string[] | undefined;
}

export interface ImpactSummary {
  readonly totalImpactedNodes: number;
  readonly totalImpactedContracts: number;
  readonly highestImpactNode?: { id: string; name: string; impact: number } | undefined;
}

export interface SemanticDiffSummary {
  readonly classification: "semantic_noop" | "low_impact" | "high_impact" | "mixed";
  readonly headline: string;
  readonly substantiveChanges: number;
  readonly mechanicalChanges: number;
  readonly totalLinesChanged: number;
}

export interface GraphDelta {
  readonly nodes: readonly NodeDelta[];
  readonly edges: readonly { id: string; source: string; target: string; relation: string; status: "added" | "removed" | "unchanged" }[];
  readonly interRepoEdges: readonly { id: string; status: "added" | "removed" | "unchanged" }[];
  readonly counts: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesModified: number;
    edgesAdded: number;
    edgesRemoved: number;
  };
  readonly impactSummary?: ImpactSummary;
  readonly semanticSummary?: SemanticDiffSummary;
}

export function computeDelta(base: MultiRepoGraph, head: MultiRepoGraph): GraphDelta {
  const baseNodes = new Map(base.repos.flatMap((r) => r.nodes.map((n) => [n.id, n] as const)));
  const headNodes = new Map(head.repos.flatMap((r) => r.nodes.map((n) => [n.id, n] as const)));
  const baseEdges = new Map(base.repos.flatMap((r) => r.edges.map((e) => [e.id, e] as const)));
  const headEdges = new Map(head.repos.flatMap((r) => r.edges.map((e) => [e.id, e] as const)));

  const nodes: GraphDelta["nodes"][number][] = [];
  let nodesAdded = 0, nodesRemoved = 0, nodesModified = 0;

  for (const [id, node] of headNodes) {
    if (!baseNodes.has(id)) { nodes.push({ id, status: "added" }); nodesAdded++; }
    else {
      const baseNode = baseNodes.get(id)!;
      const reasons: string[] = [];
      if (node.name !== baseNode.name) reasons.push("name");
      if (node.kind !== baseNode.kind) reasons.push("kind");
      if (node.locator !== baseNode.locator) reasons.push("locator");
      if (node.filePath !== baseNode.filePath) reasons.push("filePath");
      if (node.startLine !== baseNode.startLine) reasons.push("startLine");
      if (node.endLine !== baseNode.endLine) reasons.push("endLine");
      if (node.bodyFingerprint !== undefined && baseNode.bodyFingerprint !== undefined && node.bodyFingerprint !== baseNode.bodyFingerprint) reasons.push("body");
      if (reasons.length > 0) {
        nodes.push({ id, status: "modified", reasons });
        nodesModified++;
      } else {
        nodes.push({ id, status: "unchanged" });
      }
    }
  }
  for (const [id] of baseNodes) {
    if (!headNodes.has(id)) { nodes.push({ id, status: "removed" }); nodesRemoved++; }
  }

  const edges: GraphDelta["edges"][number][] = [];
  let edgesAdded = 0, edgesRemoved = 0;

  for (const [id, edge] of headEdges) {
    if (!baseEdges.has(id)) { edges.push({ id, source: edge.source, target: edge.target, relation: edge.relation, status: "added" }); edgesAdded++; }
    else { edges.push({ id, source: edge.source, target: edge.target, relation: edge.relation, status: "unchanged" }); }
  }
  for (const [id, edge] of baseEdges) {
    if (!headEdges.has(id)) { edges.push({ id, source: edge.source, target: edge.target, relation: edge.relation, status: "removed" }); edgesRemoved++; }
  }

  const baseInterRepo = new Map(base.interRepoEdges.map((e) => [e.id, e] as const));
  const headInterRepo = new Map(head.interRepoEdges.map((e) => [e.id, e] as const));
  const interRepoEdges: GraphDelta["interRepoEdges"][number][] = [];

  for (const [id] of headInterRepo) {
    if (!baseInterRepo.has(id)) interRepoEdges.push({ id, status: "added" });
    else interRepoEdges.push({ id, status: "unchanged" });
  }
  for (const [id] of baseInterRepo) {
    if (!headInterRepo.has(id)) interRepoEdges.push({ id, status: "removed" });
  }

  return {
    nodes, edges,
    interRepoEdges,
    counts: { nodesAdded, nodesRemoved, nodesModified, edgesAdded, edgesRemoved },
  };
}

/** Per `architecture/v1-launch-plan.md` Step 6 + research/27 §8.
 *
 *  Filter a `full-delta` `GraphDelta` to one of the 4 Iceberg/Delta
 *  canonical CDC forms.
 *
 *  - **`append`**: only newly-inserted rows. Drops removed +
 *    modified entries.
 *  - **`upsert`**: inserts + modifications. No "removed" entries
 *    so the caller can simply apply the result to refresh its
 *    view.
 *  - **`min-delta`** (default): added + removed + modified, but
 *    `unchanged` entries are stripped. The smallest payload that
 *    fully describes the change.
 *  - **`full-delta`**: pass-through — adds + removes + modifies
 *    + unchanged, full CDC stream with redundancy.
 *
 *  Counts are NOT recomputed — they reflect the underlying delta
 *  (so a caller can always show "12 modified" even when running
 *  in `append` mode where the array only carries adds). The
 *  filter applies to the `nodes` + `edges` + `interRepoEdges`
 *  arrays only.
 *
 *  Backward-compat: when `mode === "min-delta"` AND the input
 *  delta is already in min-delta shape (no unchanged entries),
 *  the returned object is structurally equal to the input. */
export function applyChangeQueryMode(
  delta: GraphDelta,
  mode: ChangeQueryMode,
): GraphDelta {
  if (mode === "full-delta") return delta;

  const nodeFilter = (n: NodeDelta): boolean => {
    switch (mode) {
      case "append":
        return n.status === "added";
      case "upsert":
        return n.status === "added" || n.status === "modified";
      case "min-delta":
        return n.status !== "unchanged";
    }
  };

  const edgeFilter = (e: GraphDelta["edges"][number]): boolean => {
    switch (mode) {
      case "append":
        return e.status === "added";
      case "upsert":
        return e.status === "added";
      case "min-delta":
        return e.status !== "unchanged";
    }
  };

  const interRepoFilter = (e: GraphDelta["interRepoEdges"][number]): boolean => {
    switch (mode) {
      case "append":
        return e.status === "added";
      case "upsert":
        return e.status === "added";
      case "min-delta":
        return e.status !== "unchanged";
    }
  };

  return {
    ...delta,
    nodes: delta.nodes.filter(nodeFilter),
    edges: delta.edges.filter(edgeFilter),
    interRepoEdges: delta.interRepoEdges.filter(interRepoFilter),
  };
}

// Per `architecture/v1-launch-plan.md` Step 7a + research/24
// §7 (pass 2's 5-stage clustering pipeline).
//
// The pipeline (Step 7a; recursive depth + canonical-shape
// detection land in Step 7b):
//
//   Stage A · Edge weighting by relation type
//   Stage B · Leiden community detection
//   Stage C · Merge same-directory + density split
//   Stage D · Per-cluster PageRank → importance + entryPointIds
//   Stage E · 7-tier label pipeline (cluster-labeling.ts)
//
// Per the founder's instruction, the 7 tiers follow the plan's
// Step 7 prescription (framework / folder-archetype / dominant-
// symbol / package-readme / common-substring / llm-byok /
// coordinate-fallback) — NOT doc 24/25's variant. See Step 7a
// receipts for the rationale.

import createGraph from "ngraph.graph";
import { detectClusters } from "ngraph.leiden";
import pageRank from "ngraph.pagerank";
import type { GraphNode, GraphEdge, Cluster, CanonicalShape } from "./multi-repo.ts";
import { detectCanonicalShape } from "./canonical-shape.ts";
import { EDGE_RELATIONS } from "./vocabulary.ts";
import {
  pickLabelTier,
  isBannedLabel,
  type LabelInput,
} from "./cluster-labeling.ts";

const MIN_CLUSTER_SIZE = 3;
const MIN_NODES_FOR_LEIDEN = 8;

/** Per `architecture/v1-launch-plan.md` Step 7 + the Step 6
 *  §0.6.4 lesson "optimizations need firing tests": extracted
 *  defence-in-depth guard. Throws if a label tier ever returns
 *  a banned pattern (`Module N` / `Other` / `Cluster N`).
 *  Exported so tests can pin the guard's behaviour
 *  independently of the full pipeline. */
export function assertNotBanned(name: string, tier: string): void {
  if (isBannedLabel(name)) {
    throw new Error(
      `cluster-labeling produced banned label "${name}" (tier ${tier}) — per architecture/v1-launch-plan.md Step 7 these patterns are forbidden`,
    );
  }
}

/** Top-K entry-points to surface per cluster. The user-facing
 *  surface (`graph.entry_points` action in Step 7b) takes
 *  these directly. */
const TOP_ENTRY_POINTS_PER_CLUSTER = 3;

/** Stage A: edge weights by relation type per research/24 §7.1
 *  + the plan's Step 7 work item 6 ("calls > imports >
 *  consumes_contract"). Uses the canonical EDGE_RELATIONS
 *  constants (Rule 6 — schema/no-vocabulary-string-literal).
 *  Same-folder edges get a +0.5 bonus; this captures the
 *  intuition that intra-folder coupling represents real
 *  architectural cohesion.
 *
 *  Note: research/24 §7.1 lists `extends` / `implements` /
 *  `tests` edge weights. Schema's vocabulary doesn't emit
 *  those relations yet — they'd be added when the
 *  inheritance extractor lands (a Step 8b moat slice per
 *  schema-v3.md §17). Falling back to DEFAULT_EDGE_WEIGHT
 *  for unknown relations is safe; the weighting just won't
 *  bias toward inheritance until those edges exist. */
const EDGE_WEIGHTS: ReadonlyMap<string, number> = new Map([
  // Cross-language bridges: light coupling to avoid dominating
  // intra-language structure (the bridge already pulled them
  // into one workspace).
  [EDGE_RELATIONS.consumes_contract, 0.3],
  [EDGE_RELATIONS.implements_contract, 0.3],
  // Module imports: base unit.
  [EDGE_RELATIONS.imports, 1.0],
  // Calls: stronger than imports.
  [EDGE_RELATIONS.calls, 1.5],
  // Framework couplings.
  [EDGE_RELATIONS.applies_middleware, 2.0],
  [EDGE_RELATIONS.registers_route, 2.0],
]);
const SAME_FOLDER_BONUS = 0.5;
const DEFAULT_EDGE_WEIGHT = 1.0;

const ROOT_FOLDERS = new Set([
  "src", "lib", "app", "packages", "pkg",
  "internal", "cmd", "modules",
]);

function commonPathPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) =>
    p.replace(/^file:\/\//, "").split("/").filter((s) => s.length > 0),
  );
  if (split.length === 1) {
    return split[0]!.slice(0, -1).join("/");
  }
  const minLen = Math.min(...split.map((s) => s.length));
  const out: string[] = [];
  for (let i = 0; i < minLen - 1; i++) {
    const first = split[0]![i];
    if (split.every((s) => s[i] === first)) out.push(first!);
    else break;
  }
  return out.join("/");
}

function stripPrefix(path: string, prefix: string): string {
  const clean = path.replace(/^file:\/\//, "").replace(/^\/+/, "");
  const p = prefix.replace(/^\/+/, "");
  if (p && clean.startsWith(p)) return clean.slice(p.length).replace(/^\/+/, "");
  return clean;
}

function meaningfulSegments(relPath: string): string[] {
  const parts = relPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return [];
  let i = 0;
  while (i < parts.length - 1 && ROOT_FOLDERS.has(parts[i]!.toLowerCase())) {
    i++;
  }
  return parts.slice(i);
}

function immediateFolder(relPath: string): string | null {
  const parts = relPath.split("/");
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join("/");
}

/** Stage A: compute the weighted edge between two nodes. The
 *  resulting weight is used both by Leiden (Stage B) and the
 *  per-cluster PageRank (Stage D). */
function weightForEdge(
  edge: GraphEdge,
  relPathById: ReadonlyMap<string, string>,
): number {
  const base = EDGE_WEIGHTS.get(edge.relation) ?? DEFAULT_EDGE_WEIGHT;
  const srcRel = relPathById.get(edge.source);
  const dstRel = relPathById.get(edge.target);
  const srcFolder = srcRel ? immediateFolder(srcRel) : null;
  const dstFolder = dstRel ? immediateFolder(dstRel) : null;
  if (srcFolder !== null && srcFolder === dstFolder) {
    return base + SAME_FOLDER_BONUS;
  }
  return base;
}

interface LeidenCommunity {
  readonly id: number;
  readonly nodeIds: readonly string[];
}

/** Per research/24 §7.2: target range for significant clusters
 *  at L1. Leiden resolution is auto-tuned until the community
 *  count lands in this band (or the resolution bounds are hit). */
const TARGET_MIN_COMMUNITIES = 3;
const TARGET_MAX_COMMUNITIES = 6;
const RESOLUTION_MIN = 0.5;
const RESOLUTION_MAX = 2.0;
const RESOLUTION_STEP = 0.1;

/** Stage B: Leiden community detection on the weighted graph.
 *  Per research/24 §7.2: `quality: "modularity"`, `directed:
 *  true`, `randomSeed: 42` for stability.
 *
 *  Resolution auto-tune: starts at 1.0, sweeps [0.5, 2.0] in
 *  0.1 increments, picks the resolution whose significant-
 *  community count is closest to the [3, 7] target band. This
 *  is the single most important parameter for the L1 visual. */
function leidenCommunities(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  relPathById: ReadonlyMap<string, string>,
): LeidenCommunity[] {
  if (nodes.length < MIN_NODES_FOR_LEIDEN) return [];

  const g = createGraph();
  const nodeIdSet = new Set<string>();
  for (const node of nodes) {
    g.addNode(node.id);
    nodeIdSet.add(node.id);
  }
  for (const edge of edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const weight = weightForEdge(edge, relPathById);
    g.addLink(edge.source, edge.target, { weight });
  }

  function runLeiden(resolution: number): LeidenCommunity[] {
    try {
      const result = detectClusters(g, {
        quality: "modularity",
        directed: true,
        randomSeed: 42,
        resolution,
      });
      const out: LeidenCommunity[] = [];
      const map = result.getCommunities();
      for (const [id, nodeIds] of map.entries()) {
        if (nodeIds.length === 0) continue;
        out.push({ id, nodeIds: [...nodeIds] });
      }
      return out;
    } catch {
      return [];
    }
  }

  function significantCount(communities: LeidenCommunity[]): number {
    return communities.filter((c) => c.nodeIds.length >= MIN_CLUSTER_SIZE).length;
  }

  // First try default resolution (1.0).
  let best = runLeiden(1.0);
  let bestSig = significantCount(best);

  // If already in target range, done.
  if (bestSig >= TARGET_MIN_COMMUNITIES && bestSig <= TARGET_MAX_COMMUNITIES) {
    return best;
  }

  // Auto-tune: sweep resolutions, pick closest to target band.
  let bestDistance = bestSig < TARGET_MIN_COMMUNITIES
    ? TARGET_MIN_COMMUNITIES - bestSig
    : bestSig - TARGET_MAX_COMMUNITIES;

  for (let res = RESOLUTION_MIN; res <= RESOLUTION_MAX + 0.001; res += RESOLUTION_STEP) {
    if (Math.abs(res - 1.0) < 0.01) continue; // already tried
    const communities = runLeiden(res);
    const sig = significantCount(communities);
    if (sig >= TARGET_MIN_COMMUNITIES && sig <= TARGET_MAX_COMMUNITIES) {
      return communities; // perfect hit
    }
    const distance = sig < TARGET_MIN_COMMUNITIES
      ? TARGET_MIN_COMMUNITIES - sig
      : sig - TARGET_MAX_COMMUNITIES;
    if (distance < bestDistance) {
      best = communities;
      bestSig = sig;
      bestDistance = distance;
    }
  }

  // Accept closest result per doc 24 §7.2.
  return best;
}


/** Stage D: per-cluster PageRank. Per research/24 §7.4 the
 *  ranking is computed inside each cluster (not globally) so
 *  Aider's "monorepo-blindness" failure mode doesn't apply
 *  — every cluster gets its own importance distribution. */
function computeClusterImportance(
  cluster: LeidenCommunity,
  edges: readonly GraphEdge[],
  relPathById: ReadonlyMap<string, string>,
): Map<string, number> {
  if (cluster.nodeIds.length < 2) {
    // Trivially-small clusters: distribute importance uniformly.
    const out = new Map<string, number>();
    if (cluster.nodeIds.length === 1) out.set(cluster.nodeIds[0]!, 1);
    return out;
  }

  const memberSet = new Set(cluster.nodeIds);
  const subgraph = createGraph();
  for (const id of cluster.nodeIds) subgraph.addNode(id);

  let hasAnyEdge = false;
  for (const edge of edges) {
    if (!memberSet.has(edge.source) || !memberSet.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const weight = weightForEdge(edge, relPathById);
    // ngraph.pagerank uses uniform edge contributions; we
    // approximate weighted PageRank by duplicating links
    // proportional to their weight (rounded). Doc 24 §7.4
    // accepts this as a pragmatic v1.x choice.
    const reps = Math.max(1, Math.round(weight));
    for (let i = 0; i < reps; i++) subgraph.addLink(edge.source, edge.target);
    hasAnyEdge = true;
  }

  if (!hasAnyEdge) {
    // No internal edges (cluster of isolated nodes); uniform.
    const out = new Map<string, number>();
    const uniform = 1 / cluster.nodeIds.length;
    for (const id of cluster.nodeIds) out.set(id, uniform);
    return out;
  }

  const ranks = pageRank(subgraph, 0.85, 0.005);
  const out = new Map<string, number>();
  for (const id of cluster.nodeIds) {
    out.set(id, ranks[id] ?? 0);
  }
  return out;
}

function topKEntryPoints(
  importance: ReadonlyMap<string, number>,
  k: number,
): string[] {
  const entries = [...importance.entries()];
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, k).map(([id]) => id);
}

/** Stage C primitives. */
interface TentativeCluster {
  readonly communityId: number;
  readonly nodeIds: readonly string[];
  readonly dominantDir: string | null;
  readonly dominantDirFraction: number;
}

function dominantDirectory(
  nodeIds: readonly string[],
  relPathById: ReadonlyMap<string, string>,
): { dir: string; fraction: number } | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const id of nodeIds) {
    const rel = relPathById.get(id);
    if (!rel) continue;
    const segments = meaningfulSegments(rel);
    if (segments.length === 0) continue;
    const key = segments[0]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  if (total === 0) return null;
  let best: { dir: string; count: number } | null = null;
  for (const [dir, count] of counts) {
    if (!best || count > best.count) best = { dir, count };
  }
  if (!best) return null;
  return { dir: best.dir, fraction: best.count / total };
}

function describeCommunity(
  community: LeidenCommunity,
  relPathById: ReadonlyMap<string, string>,
): TentativeCluster {
  const dir = dominantDirectory(community.nodeIds, relPathById);
  return {
    communityId: community.id,
    nodeIds: community.nodeIds,
    dominantDir: dir?.dir ?? null,
    dominantDirFraction: dir?.fraction ?? 0,
  };
}

/** Stage C.5: after same-directory merge, if we still have more
 *  than TARGET_MAX_COMMUNITIES clusters, keep the top-K largest
 *  and merge every smaller cluster into its most-connected
 *  neighbour. This is the "let merge/split compensate" fallback
 *  from doc 24 §7.2.
 *
 *  Algorithm: sort clusters by size desc. Keep the top
 *  TARGET_MAX_COMMUNITIES clusters. For each remaining small
 *  cluster, count edges connecting it to each large cluster;
 *  merge into the one with the most connections. If no edges
 *  connect, merge into the largest cluster in the same parent
 *  directory (or the globally largest if no directory match). */
function mergeToTargetCount(
  tentatives: TentativeCluster[],
  targetMax: number,
  edges: readonly GraphEdge[],
): TentativeCluster[] {
  if (tentatives.length <= targetMax) return tentatives;

  // Sort by size descending.
  const sorted = [...tentatives].sort(
    (a, b) => b.nodeIds.length - a.nodeIds.length,
  );

  // The top-K are the "anchor" clusters.
  const anchors = sorted.slice(0, targetMax);
  const smalls = sorted.slice(targetMax);

  // Build a node → anchor-index map for edge counting.
  const nodeToAnchor = new Map<string, number>();
  for (let i = 0; i < anchors.length; i++) {
    for (const id of anchors[i]!.nodeIds) {
      nodeToAnchor.set(id, i);
    }
  }

  // For each small cluster, find the anchor it's most connected to.
  for (const small of smalls) {
    const smallSet = new Set(small.nodeIds);
    const connectionCounts = new Array<number>(anchors.length).fill(0);

    for (const edge of edges) {
      const srcSmall = smallSet.has(edge.source);
      const tgtSmall = smallSet.has(edge.target);
      if (srcSmall && !tgtSmall) {
        const anchorIdx = nodeToAnchor.get(edge.target);
        if (anchorIdx !== undefined) connectionCounts[anchorIdx]!++;
      } else if (!srcSmall && tgtSmall) {
        const anchorIdx = nodeToAnchor.get(edge.source);
        if (anchorIdx !== undefined) connectionCounts[anchorIdx]!++;
      }
    }

    // Pick the anchor with most connections; fallback to the
    // one with matching directory; last resort: largest anchor.
    let bestIdx = 0;
    let bestCount = connectionCounts[0]!;
    for (let i = 1; i < connectionCounts.length; i++) {
      if (connectionCounts[i]! > bestCount) {
        bestCount = connectionCounts[i]!;
        bestIdx = i;
      }
    }

    // If no edges connected, try matching by directory.
    if (bestCount === 0 && small.dominantDir) {
      for (let i = 0; i < anchors.length; i++) {
        if (anchors[i]!.dominantDir === small.dominantDir) {
          bestIdx = i;
          break;
        }
      }
    }

    // Merge into the best anchor.
    const anchor = anchors[bestIdx]!;
    anchors[bestIdx] = {
      ...anchor,
      nodeIds: [...anchor.nodeIds, ...small.nodeIds],
    };
    // Update the node → anchor map for subsequent smalls.
    for (const id of small.nodeIds) {
      nodeToAnchor.set(id, bestIdx);
    }
  }

  return anchors;
}

/** Stage C: merge small same-directory communities together. */
function mergeSameDirectory(
  tentatives: readonly TentativeCluster[],
  mergeThreshold: number,
): TentativeCluster[] {
  const byDir = new Map<string, TentativeCluster[]>();
  const crossCutting: TentativeCluster[] = [];

  for (const t of tentatives) {
    if (t.dominantDir && t.dominantDirFraction >= 0.5) {
      const arr = byDir.get(t.dominantDir) ?? [];
      arr.push(t);
      byDir.set(t.dominantDir, arr);
    } else {
      crossCutting.push(t);
    }
  }

  const out: TentativeCluster[] = [];
  for (const [dir, group] of byDir) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    const total = group.reduce((sum, g) => sum + g.nodeIds.length, 0);
    if (total <= mergeThreshold) {
      const allIds = group.flatMap((g) => g.nodeIds);
      out.push({
        communityId: group[0]!.communityId,
        nodeIds: allIds,
        dominantDir: dir,
        dominantDirFraction: 1,
      });
    } else {
      group.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
      const biggest = group[0]!;
      const smallIds: string[] = [];
      const survivors: TentativeCluster[] = [biggest];
      for (let i = 1; i < group.length; i++) {
        const g = group[i]!;
        if (g.nodeIds.length < 8) {
          smallIds.push(...g.nodeIds);
        } else {
          survivors.push(g);
        }
      }
      if (smallIds.length > 0) {
        out.push({
          ...biggest,
          nodeIds: [...biggest.nodeIds, ...smallIds],
        });
        for (const s of survivors.slice(1)) out.push(s);
      } else {
        for (const s of survivors) out.push(s);
      }
    }
  }
  out.push(...crossCutting);
  return out;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stages C, D, E for the full pipeline. */
function pipelineStagesCDE(
  communities: readonly LeidenCommunity[],
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  relPathById: ReadonlyMap<string, string>,
  options: BuildClustersOptions,
): Cluster[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));

  // Stage C: tentatives + merge.
  const tentatives = communities
    .filter((c) => c.nodeIds.length >= MIN_CLUSTER_SIZE)
    .map((c) => describeCommunity(c, relPathById));
  const totalNodes = nodes.length;
  const mergeThreshold = Math.max(50, Math.floor(totalNodes / 6));
  const sameDirMerged = mergeSameDirectory(tentatives, mergeThreshold);
  // Stage C.5: merge small clusters into their most-connected
  // anchor to hit the 3-7 target per doc 24 §7.2.
  const merged = mergeToTargetCount(sameDirMerged, TARGET_MAX_COMMUNITIES, edges);

  // Stage D + E for each merged community.
  const out: Cluster[] = [];
  const usedIds = new Set<string>();

  function uniqueId(base: string): string {
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let n = 2;
    let candidate = `${base}-${n}`;
    while (usedIds.has(candidate)) candidate = `${base}-${++n}`;
    usedIds.add(candidate);
    return candidate;
  }

  merged.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
  for (let i = 0; i < merged.length; i++) {
    const t = merged[i]!;
    // Stage D: PageRank within this cluster.
    const importance = computeClusterImportance(
      { id: t.communityId, nodeIds: t.nodeIds },
      edges,
      relPathById,
    );
    const entryPointIds = topKEntryPoints(importance, TOP_ENTRY_POINTS_PER_CLUSTER);

    // Stage E: 7-tier labelling.
    const labelInput: LabelInput = {
      nodeIds: t.nodeIds,
      nodeById,
      relPathById,
      importance,
      archetype: options.archetype,
      domainTokens: options.domainTokens ?? new Set(),
    };
    const decision = pickLabelTier(labelInput, i);

    // Defence-in-depth: the banned-pattern guard. If any tier
    // ever produces "Module N" / "Other" / "Cluster N", throw
    // — better to crash than silently ship the bug. The guard
    // is extracted to `assertNotBanned` so a unit test can pin
    // its behaviour independently of the full pipeline (per
    // the Step 6 §0.6.4 "optimizations need firing tests"
    // lesson).
    assertNotBanned(decision.name, decision.tier);

    const id = uniqueId(`cluster:${slug(decision.name)}`);
    out.push({
      id,
      name: decision.name,
      nodeIds: [...t.nodeIds],
      importance: Object.fromEntries(importance),
      entryPointIds,
      labelTier: decision.tier,
    });
  }

  // Step 7a: leftover nodes (not in any large community) go
  // into their own folder-grouped clusters if they form a
  // viable group; truly orphan nodes (<MIN_CLUSTER_SIZE per
  // folder) get a SINGLE "Area at (∞, leftover-N)" coordinate-
  // fallback cluster per folder — this satisfies the
  // never-`Other` rule by using the same Tier-7 surface as
  // genuinely unlabelable clusters.
  const assigned = new Set<string>();
  for (const c of out) for (const id of c.nodeIds) assigned.add(id);
  const leftover: string[] = [];
  for (const n of nodes) if (!assigned.has(n.id)) leftover.push(n.id);
  if (leftover.length > 0) {
    const leftoverByDir = new Map<string, string[]>();
    for (const id of leftover) {
      const rel = relPathById.get(id);
      const segments = rel ? meaningfulSegments(rel) : [];
      const key = segments.length > 0 ? segments[0]! : "__orphan__";
      const arr = leftoverByDir.get(key) ?? [];
      arr.push(id);
      leftoverByDir.set(key, arr);
    }
    for (const [dir, ids] of leftoverByDir) {
      if (ids.length < MIN_CLUSTER_SIZE) continue;
      // Run the same label pipeline on the leftover group;
      // skip PageRank for these (cheap path — they're already
      // by definition not architecturally cohesive).
      const labelInput: LabelInput = {
        nodeIds: ids,
        nodeById,
        relPathById,
        importance: new Map(),
        archetype: options.archetype,
        domainTokens: options.domainTokens ?? new Set(),
      };
      const decision = pickLabelTier(labelInput, out.length);
      assertNotBanned(decision.name, decision.tier);
      const id = uniqueId(`cluster:${slug(decision.name)}`);
      out.push({
        id,
        name: decision.name,
        nodeIds: ids,
        importance: {},
        entryPointIds: [],
        labelTier: decision.tier,
      });
    }
  }

  // Final gate: if the pipeline (including leftover handling)
  // produced more than the target count, merge small clusters
  // into their most-connected anchor one more time. This
  // guarantees the L1 view shows at most TARGET_MAX_COMMUNITIES
  // areas regardless of how many folders or orphan groups exist.
  if (out.length > TARGET_MAX_COMMUNITIES) {
    const finalTentatives: TentativeCluster[] = out.map((c, i) => ({
      communityId: i,
      nodeIds: [...c.nodeIds],
      dominantDir: null,
      dominantDirFraction: 0,
    }));
    const finalMerged = mergeToTargetCount(finalTentatives, TARGET_MAX_COMMUNITIES, edges);

    // Re-run Stage D + E on the merged tentatives to get fresh
    // labels + importance for the combined clusters.
    const finalOut: Cluster[] = [];
    const finalUsedIds = new Set<string>();
    function finalUniqueId(base: string): string {
      if (!finalUsedIds.has(base)) { finalUsedIds.add(base); return base; }
      let n = 2;
      let c = `${base}-${n}`;
      while (finalUsedIds.has(c)) c = `${base}-${++n}`;
      finalUsedIds.add(c);
      return c;
    }
    for (let i = 0; i < finalMerged.length; i++) {
      const t = finalMerged[i]!;
      const importance = computeClusterImportance(
        { id: t.communityId, nodeIds: t.nodeIds },
        edges,
        relPathById,
      );
      const entryPointIds = topKEntryPoints(importance, TOP_ENTRY_POINTS_PER_CLUSTER);
      const labelInput: LabelInput = {
        nodeIds: t.nodeIds,
        nodeById,
        relPathById,
        importance,
        archetype: options.archetype,
        domainTokens: options.domainTokens ?? new Set(),
      };
      const decision = pickLabelTier(labelInput, i);
      assertNotBanned(decision.name, decision.tier);
      const id = finalUniqueId(`cluster:${slug(decision.name)}`);
      finalOut.push({
        id,
        name: decision.name,
        nodeIds: [...t.nodeIds],
        importance: Object.fromEntries(importance),
        entryPointIds,
        labelTier: decision.tier,
      });
    }
    return finalOut;
  }

  return out;
}

export interface BuildClustersOptions {
  /** Workspace prefix to strip from file paths before
   *  extracting meaningful segments. If absent, computed
   *  automatically. */
  readonly workspaceRoot?: string;
  /** Step 3 archetype primary. Drives Tier 2 capitalization
   *  + future shape-based layout (Step 7b). */
  readonly archetype?: string;
  /** Domain tokens from `package.json.keywords` + README
   *  headings. Step 7a's Tier 4 consumes these. Empty when
   *  no workspace metadata is available. */
  readonly domainTokens?: ReadonlySet<string>;
  /** Step 7b: enable HERCULES-style recursive clustering.
   *  Each top-level cluster with > `MAX_TOP_LEVEL_CLUSTER_SIZE`
   *  nodes is recursively sub-clustered up to `maxDepth`. */
  readonly recursive?: boolean;
  /** Step 7b: maximum recursive depth. Default 3 (top →
   *  sub-cluster → sub-sub-cluster). Only used when
   *  `recursive: true`. */
  readonly maxDepth?: number;
}

/** Step 7b: canonical max depth for recursive clustering. */
export const DEFAULT_MAX_RECURSIVE_DEPTH = 3;

/** Step 7b: top-level clusters above this size get
 *  recursively sub-clustered. Per the plan: "top level cap 20". */
export const MAX_TOP_LEVEL_CLUSTER_SIZE = 20;

/** Build architectural clusters per `architecture/v1-launch-plan.md`
 *  Step 7a (flat) + Step 7b (recursive + canonical shape). */
export function buildClusters(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: BuildClustersOptions | string = {},
): Cluster[] {
  const opts: BuildClustersOptions = typeof options === "string"
    ? { workspaceRoot: options }
    : options;

  if (nodes.length === 0) return [];

  const allPaths = nodes
    .map((n) => n.filePath ?? "")
    .filter((p) => p.length > 0);
  const prefix = opts.workspaceRoot ?? commonPathPrefix(allPaths);
  const relPathById = new Map<string, string>();
  for (const node of nodes) {
    if (node.filePath) {
      relPathById.set(node.id, stripPrefix(node.filePath, prefix));
    }
  }

  let flat: Cluster[];
  if (nodes.length < MIN_NODES_FOR_LEIDEN) {
    flat = folderFallback(nodes, relPathById, opts);
  } else {
    const communities = leidenCommunities(nodes, edges, relPathById);
    flat = communities.length === 0
      ? folderFallback(nodes, relPathById, opts)
      : pipelineStagesCDE(communities, nodes, edges, relPathById, opts);
  }

  // Step 7b: annotate with canonical shape.
  const shaped: Cluster[] = flat.map((c): Cluster => ({
    ...c,
    canonicalShape: detectCanonicalShape(c, edges),
  }));

  // Deduplicate cluster display names. When two clusters share
  // the same name (e.g. both are "Clients" from different
  // subdirectories), append the distinguishing sub-directory.
  // Two-pass name deduplication:
  // Pass 1: append the top subdirectory to disambiguate.
  // Pass 2: if still duplicate, append the node count.
  const nameCount = new Map<string, number>();
  for (const c of shaped) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);

  let deduped = shaped.map((c): Cluster => {
    if ((nameCount.get(c.name) ?? 1) <= 1) return c;
    const subDirs = new Map<string, number>();
    for (const nid of c.nodeIds) {
      const rel = relPathById.get(nid);
      if (!rel) continue;
      const parts = rel.split("/").filter((s) => s.length > 0);
      if (parts.length >= 2) {
        subDirs.set(parts[1]!, (subDirs.get(parts[1]!) ?? 0) + 1);
      }
    }
    const topSub = [...subDirs.entries()].sort((a, b) => b[1] - a[1])[0];
    const suffix = topSub
      ? topSub[0].charAt(0).toUpperCase() + topSub[0].slice(1)
      : String(c.nodeIds.length);
    return { ...c, name: `${c.name} · ${suffix}` };
  });

  // Pass 2: if names are STILL duplicate, append node count
  // (but only if the name doesn't already end with a count).
  const nameCount2 = new Map<string, number>();
  for (const c of deduped) nameCount2.set(c.name, (nameCount2.get(c.name) ?? 0) + 1);
  deduped = deduped.map((c): Cluster => {
    if ((nameCount2.get(c.name) ?? 1) <= 1) return c;
    if (/\(\d+\)$/.test(c.name)) return c;
    return { ...c, name: `${c.name} (${c.nodeIds.length})` };
  });

  // Final merge: if we're over the target, keep merging the
  // smallest cluster into its most-connected neighbor until
  // we're within the target. Simple greedy approach.
  let finalClusters = deduped;
  while (finalClusters.length > TARGET_MAX_COMMUNITIES) {
    // Find the smallest cluster
    const sortedBySize = [...finalClusters].sort((a, b) => a.nodeIds.length - b.nodeIds.length);
    const smallest = sortedBySize[0]!;
    const rest = sortedBySize.slice(1);
    
    // Count edges from smallest to each other cluster
    const smallSet = new Set(smallest.nodeIds);
    const edgeCounts = rest.map((target) => {
      const targetSet = new Set(target.nodeIds);
      let count = 0;
      for (const e of edges) {
        if ((smallSet.has(e.source) && targetSet.has(e.target)) ||
            (smallSet.has(e.target) && targetSet.has(e.source))) {
          count++;
        }
      }
      return count;
    });
    
    // Merge into the most-connected neighbor (or the largest if no edges)
    let bestIdx = 0;
    let bestCount = edgeCounts[0]!;
    for (let i = 1; i < edgeCounts.length; i++) {
      if (edgeCounts[i]! > bestCount) {
        bestCount = edgeCounts[i]!;
        bestIdx = i;
      }
    }
    if (bestCount === 0) {
      // No edges connect — merge into the largest cluster
      bestIdx = rest.length - 1; // sorted ascending, last is largest
    }
    
    // Merge
    const target = rest[bestIdx]!;
    const merged: Cluster = {
      ...target,
      nodeIds: [...target.nodeIds, ...smallest.nodeIds],
    };
    rest[bestIdx] = merged;
    finalClusters = rest;
  }


  // Step 7b: recursive sub-clustering when requested.
  if (!opts.recursive) return finalClusters;

  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_RECURSIVE_DEPTH;
  return recursiveSubCluster(finalClusters, nodes, edges, relPathById, opts, 0, maxDepth);
}

/** Step 7b HERCULES: recursively sub-cluster any cluster above
 *  MAX_TOP_LEVEL_CLUSTER_SIZE nodes, up to maxDepth. */
function recursiveSubCluster(
  clusters: readonly Cluster[],
  allNodes: readonly GraphNode[],
  allEdges: readonly GraphEdge[],
  relPathById: ReadonlyMap<string, string>,
  opts: BuildClustersOptions,
  currentDepth: number,
  maxDepth: number,
): Cluster[] {
  if (currentDepth >= maxDepth) return [...clusters];

  const nodeById = new Map(allNodes.map((n) => [n.id, n]));
  return clusters.map((cluster) => {
    if (cluster.nodeIds.length <= MAX_TOP_LEVEL_CLUSTER_SIZE) {
      return { ...cluster, depth: currentDepth };
    }

    // Sub-cluster: extract the nodes + edges for this cluster
    // and run buildClusters non-recursively (one level at a
    // time to control depth).
    const memberSet = new Set(cluster.nodeIds);
    const subNodes = cluster.nodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => n !== undefined);
    const subEdges = allEdges.filter(
      (e) => memberSet.has(e.source) && memberSet.has(e.target),
    );

    if (subNodes.length < MIN_NODES_FOR_LEIDEN) {
      return { ...cluster, depth: currentDepth };
    }

    const subCommunities = leidenCommunities(subNodes, subEdges, relPathById);
    if (subCommunities.length <= 1) {
      return { ...cluster, depth: currentDepth };
    }

    let children: Cluster[] = pipelineStagesCDE(
      subCommunities, subNodes, subEdges, relPathById, opts,
    ).map((child): Cluster => ({
      ...child,
      id: `${cluster.id}/${child.id.replace(/^cluster:/, "")}`,
      parentId: cluster.id,
      canonicalShape: detectCanonicalShape(child, subEdges),
      depth: currentDepth + 1,
    }));

    children = recursiveSubCluster(
      children, allNodes, allEdges, relPathById,
      opts, currentDepth + 1, maxDepth,
    );

    return {
      ...cluster,
      depth: currentDepth,
      children,
    };
  });
}

/** Folder-fallback path when Leiden produces nothing usable. */
function folderFallback(
  nodes: readonly GraphNode[],
  relPathById: ReadonlyMap<string, string>,
  opts: BuildClustersOptions,
): Cluster[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const dirs = new Map<string, string[]>();
  for (const n of nodes) {
    const rel = relPathById.get(n.id);
    if (!rel) continue;
    const segments = meaningfulSegments(rel);
    if (segments.length === 0) continue;
    const key = segments[0]!;
    const arr = dirs.get(key) ?? [];
    arr.push(n.id);
    dirs.set(key, arr);
  }

  const out: Cluster[] = [];
  const usedIds = new Set<string>();
  const sortedDirs = [...dirs.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (let i = 0; i < sortedDirs.length; i++) {
    const [, ids] = sortedDirs[i]!;
    if (ids.length === 0) continue;
    const labelInput: LabelInput = {
      nodeIds: ids,
      nodeById,
      relPathById,
      importance: new Map(),
      archetype: opts.archetype,
      domainTokens: opts.domainTokens ?? new Set(),
    };
    const decision = pickLabelTier(labelInput, i);
    assertNotBanned(decision.name, decision.tier);
    let id = `cluster:${slug(decision.name)}`;
    let n = 2;
    while (usedIds.has(id)) id = `cluster:${slug(decision.name)}-${n++}`;
    usedIds.add(id);
    out.push({
      id,
      name: decision.name,
      nodeIds: ids,
      importance: {},
      entryPointIds: [],
      labelTier: decision.tier,
    });
  }
  return out;
}

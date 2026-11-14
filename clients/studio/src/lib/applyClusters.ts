// Client-side wrapper around the same Leiden + directory clustering used
// for real repo extractions on the server. We use it for demo fixtures so
// the canvas never relies on hand-curated cluster metadata -- the
// algorithm is the algorithm, demos and real repos look the same.
//
// Mirrors src/domain/cluster.ts (server) but uses the Studio Graph types
// (n.file instead of n.filePath). Same algorithm, no DAG violation.

import createGraph from "ngraph.graph";
import { detectClusters } from "ngraph.leiden";
import type { Cluster, Graph, GraphEdge, GraphNode } from "./types";

const MIN_CLUSTER_SIZE = 3;
const MIN_NODES_FOR_LEIDEN = 8;

const ROOT_FOLDERS = new Set([
  "src", "lib", "app", "packages", "pkg",
  "internal", "cmd", "modules", "crates", "internals",
]);

function commonPathPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) =>
    p.replace(/^file:\/\//, "").split("/").filter((s) => s.length > 0),
  );
  if (split.length === 1) return split[0]!.slice(0, -1).join("/");
  const minLen = Math.min(...split.map((s) => s.length));
  const out: string[] = [];
  for (let i = 0; i < minLen - 1; i++) {
    const first = split[0]![i];
    if (split.every((s) => s[i] === first)) out.push(first!);
    else break;
  }
  return out.join("/");
}

function stripPrefix(filePath: string, prefix: string): string {
  const clean = filePath.replace(/^file:\/\//, "").replace(/^\/+/, "");
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

interface LeidenCommunity {
  readonly id: number;
  readonly nodeIds: readonly string[];
}

function leidenCommunities(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): LeidenCommunity[] {
  if (nodes.length < MIN_NODES_FOR_LEIDEN) return [];
  const g = createGraph();
  const seen = new Set<string>();
  for (const n of nodes) { g.addNode(n.id); seen.add(n.id); }
  for (const e of edges) {
    if (!seen.has(e.source) || !seen.has(e.target)) continue;
    if (e.source === e.target) continue;
    g.addLink(e.source, e.target);
  }
  try {
    const result = detectClusters(g, {
      quality: "modularity",
      directed: true,
      randomSeed: 42,
    });
    const communities: LeidenCommunity[] = [];
    for (const [id, nodeIds] of result.getCommunities()) {
      if (nodeIds.length === 0) continue;
      communities.push({ id, nodeIds: [...nodeIds] });
    }
    return communities;
  } catch {
    return [];
  }
}

function humanizeLabel(seg: string): string {
  return seg
    .split(/[-_]/)
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    counts.set(segments[0]!, (counts.get(segments[0]!) ?? 0) + 1);
    total++;
  }
  if (total === 0) return null;
  let best: { dir: string; count: number } | null = null;
  for (const [dir, count] of counts) {
    if (!best || count > best.count) best = { dir, count };
  }
  return best ? { dir: best.dir, fraction: best.count / total } : null;
}

const KIND_LABELS: Record<string, string> = {
  route_handler: "Routes",
  service: "Services",
  data_access: "Data Access",
  middleware: "Middleware",
  model: "Models",
  utility: "Utilities",
  external: "External",
  contract: "Contracts",
};

function dominantKind(
  nodeIds: readonly string[],
  nodeById: ReadonlyMap<string, GraphNode>,
): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const id of nodeIds) {
    const n = nodeById.get(id);
    if (!n) continue;
    counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    total++;
  }
  if (total === 0) return null;
  let best: { kind: string; count: number } | null = null;
  for (const [kind, count] of counts) {
    if (!best || count > best.count) best = { kind, count };
  }
  if (!best || best.count / total < 0.5) return null;
  return best.kind;
}

/** Recompute clusters for any graph using the same algorithm the server
 *  uses for real repo extractions. Strips and replaces any existing
 *  `clusters` array and per-node `cluster` field. Used for demo fixtures
 *  so they go through the same pipeline as real repos. */
export function applyAlgorithmicClusters(input: Graph): Graph {
  const nodes = input.nodes;
  const edges = input.edges;

  if (nodes.length === 0) {
    return { ...input, clusters: [], nodes: [] };
  }

  // Compute longest common path prefix from node.file so cluster labels
  // come from architectural segments (auth, services, etc.) not the
  // workspace root.
  const allPaths = nodes.map((n) => n.file).filter(Boolean);
  const prefix = allPaths.length > 0 ? commonPathPrefix(allPaths) : "";
  const relPathById = new Map<string, string>();
  for (const node of nodes) {
    if (node.file) relPathById.set(node.id, stripPrefix(node.file, prefix));
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));

  const communities = leidenCommunities(nodes, edges);

  // For very small graphs Leiden gives unstable output -- fall back to
  // pure directory grouping.
  if (nodes.length < MIN_NODES_FOR_LEIDEN || communities.length === 0) {
    const dirGroups = new Map<string, string[]>();
    for (const n of nodes) {
      const rel = relPathById.get(n.id);
      if (!rel) continue;
      const segments = meaningfulSegments(rel);
      if (segments.length === 0) continue;
      const arr = dirGroups.get(segments[0]!) ?? [];
      arr.push(n.id);
      dirGroups.set(segments[0]!, arr);
    }
    const clusters: Cluster[] = [];
    for (const [dir, ids] of dirGroups) {
      if (ids.length < MIN_CLUSTER_SIZE) continue;
      clusters.push({
        id: `cluster:${slug(dir)}`,
        name: humanizeLabel(dir),
        nodeIds: ids,
      });
    }
    return projectClusters(input, clusters);
  }

  // Build labeled clusters from Leiden communities.
  const out: Cluster[] = [];
  const usedNames = new Map<string, number>();
  const usedIds = new Set<string>();
  function uniqueName(base: string): string {
    const ex = usedNames.get(base);
    if (!ex) { usedNames.set(base, 1); return base; }
    const next = ex + 1;
    usedNames.set(base, next);
    return `${base} (${next})`;
  }
  function uniqueId(base: string): string {
    if (!usedIds.has(base)) { usedIds.add(base); return base; }
    let n = 2;
    while (usedIds.has(`${base}-${n}`)) n++;
    const id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  }

  for (const community of communities) {
    if (community.nodeIds.length < MIN_CLUSTER_SIZE) continue;
    const dir = dominantDirectory(community.nodeIds, relPathById);
    const kind = dominantKind(community.nodeIds, nodeById);
    let label: string;
    if (dir && dir.fraction >= 0.7) {
      label = humanizeLabel(dir.dir);
    } else if (dir && dir.fraction >= 0.4) {
      const dirLabel = humanizeLabel(dir.dir);
      const kindL = kind ? (KIND_LABELS[kind] ?? humanizeLabel(kind)) : null;
      label = kindL && kindL.toLowerCase() !== dirLabel.toLowerCase()
        ? `${dirLabel} ${kindL}`
        : dirLabel;
    } else {
      label = kind ? (KIND_LABELS[kind] ?? humanizeLabel(kind)) : `Module ${community.id}`;
    }
    const name = uniqueName(label);
    out.push({
      id: uniqueId(`cluster:${slug(name)}`),
      name,
      nodeIds: [...community.nodeIds],
    });
  }

  // Catch leftover nodes (small communities, unconnected).
  const assigned = new Set<string>();
  for (const c of out) for (const id of c.nodeIds) assigned.add(id);
  const leftover = nodes.filter((n) => !assigned.has(n.id)).map((n) => n.id);
  if (leftover.length > 0) {
    const leftoverDirs = new Map<string, string[]>();
    for (const id of leftover) {
      const rel = relPathById.get(id);
      const segments = rel ? meaningfulSegments(rel) : [];
      const key = segments.length > 0 ? segments[0]! : "other";
      const arr = leftoverDirs.get(key) ?? [];
      arr.push(id);
      leftoverDirs.set(key, arr);
    }
    const stragglers: string[] = [];
    for (const [dir, ids] of leftoverDirs) {
      if (ids.length >= MIN_CLUSTER_SIZE) {
        const lbl = humanizeLabel(dir);
        const idx = out.findIndex((c) => c.name.toLowerCase() === lbl.toLowerCase());
        if (idx >= 0) {
          const existing = out[idx]!;
          out[idx] = { id: existing.id, name: existing.name, nodeIds: [...existing.nodeIds, ...ids] };
        } else {
          const name = uniqueName(lbl);
          out.push({ id: uniqueId(`cluster:${slug(name)}`), name, nodeIds: ids });
        }
      } else {
        stragglers.push(...ids);
      }
    }
    if (stragglers.length > 0) {
      out.push({ id: "cluster:other", name: "Other", nodeIds: stragglers });
    }
  }

  out.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
  return projectClusters(input, out);
}

/** Apply a freshly computed cluster list back onto the graph: set the
 *  graph.clusters array and stamp each node with its cluster id. */
function projectClusters(input: Graph, clusters: Cluster[]): Graph {
  const nodeToCluster = new Map<string, string>();
  for (const c of clusters) for (const id of c.nodeIds) nodeToCluster.set(id, c.id);
  return {
    ...input,
    clusters,
    nodes: input.nodes.map((n) => ({
      ...n,
      cluster: nodeToCluster.get(n.id) ?? "cluster:other",
    })),
  };
}

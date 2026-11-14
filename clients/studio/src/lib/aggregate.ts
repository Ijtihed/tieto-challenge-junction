import type { Cluster, EdgeRelation, Graph, GraphEdge, GraphNode, NodeKind } from "./types";
import { NODE_SIZES } from "./layout-constants";

// Per `research/25-95-percent-and-leveling.md` §6.1 + Step 3 of the
// launch plan: the canonical user-facing leveling system is
// `(Workspace?) Codebase / Areas / Files / Symbols`. The L-1
// `workspace` level is rendered conditionally when the open session
// is detected as a monorepo (see `session.monorepo` engine-side +
// `workspaceArchetype` store-side).
//
// IDs are stable internal keys (used by the breadcrumb to address
// segments + by `bucketIdFor` to map inner→bucket). User-facing
// labels live in `label`; the per-level user question lives in
// `subtitle`. Per doc 25 §8, the L1 label is rendered with an
// archetype-aware override at the call site — `LEVEL_META[1].label`
// is the default ("Areas") and Studio swaps it to `Services` /
// `Modules` / `Commands` / etc. based on
// `useStore().workspaceArchetype` at render time.
export type Level = 0 | 1 | 2 | 3;

export const LEVEL_META: Record<Level, { id: string; label: string; subtitle: string; icon: string }> = {
  0: { id: "codebase", label: "Codebase", subtitle: "What is this codebase?", icon: "language" },
  1: { id: "areas",    label: "Areas",    subtitle: "What are the main areas?", icon: "account_tree" },
  2: { id: "files",    label: "Files",    subtitle: "Where is X?", icon: "folder_open" },
  3: { id: "symbols",  label: "Symbols",  subtitle: "How does X work?", icon: "code" },
};

/** Per doc 25 §9 / Q3: the optional L-1 `Workspace` level for
 *  monorepo / multi-repo opens. The level id `-1` is excluded
 *  from the core `Level` union so existing call sites
 *  (`bucketIdFor`, aggregators) don't need a new case; Studio
 *  renders this conditionally as a separate top-of-stack entry
 *  in the level toggle + breadcrumb. */
export const WORKSPACE_LEVEL_META = {
  id: "workspace",
  label: "Workspace",
  subtitle: "What's in this monorepo?",
  icon: "workspaces",
} as const;

/** Synthetic node for an aggregated cluster (L1) or module/file (L2). */
export interface AggNode {
  id: string;
  label: string;
  sub: string;
  kind: "cluster" | "module" | "english";
  /** Dominant function kind inside this aggregate, used for color. */
  dominantKind: NodeKind;
  childIds: string[];
  /** node ids contained, for hover/focus mapping */
  innerIds: string[];
  /** Human-readable description shown in English (L0) view. */
  description?: string;
  width: number;
  height: number;
}

/** Longest common directory prefix of a list of file paths. Used at L2/L3
 *  to strip the workspace root from file labels so nodes don't overflow
 *  with "/Users/me/projects/.../" noise. */
function commonDirPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => p.split("/").filter((s) => s.length > 0));
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

export interface AggEdge {
  id: string;
  source: string;
  target: string;
  /** Relation flavor: applies_middleware shows purple/dashed even at higher levels. */
  relation: EdgeRelation;
  count: number;
}

export interface DisplayGraph {
  nodes: AggNode[];
  edges: AggEdge[];
}

const KIND_RANK: NodeKind[] = [
  "route_handler",
  "middleware",
  "service",
  "data_access",
  "model",
  "external",
  "utility",
];

function dominantKind(nodes: GraphNode[]): NodeKind {
  const counts: Partial<Record<NodeKind, number>> = {};
  for (const n of nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  let best: NodeKind = "utility";
  let bestN = -1;
  for (const k of KIND_RANK) {
    const v = counts[k] ?? 0;
    if (v > bestN) {
      bestN = v;
      best = k;
    }
  }
  return best;
}

/** When `collapseRelations` is true, all edges between the same pair
 *  are merged into one (picks the most "interesting" relation). Used at
 *  L0/L1 where 3 parallel lines between two clusters is visual noise. */
function aggregateEdges(
  edges: GraphEdge[],
  nodeToBucket: Map<string, string>,
  bucketIds: Set<string>,
  collapseRelations = false,
  includeImports = false,
): AggEdge[] {
  const map = new Map<string, AggEdge>();
  for (const e of edges) {
    // `imports` is normally noise (every file imports half the project),
    // but at cluster level it IS the dependency signal -- "this cluster
    // depends on that cluster". Pass includeImports=true at L0/L1.
    if (e.relation === "imports" && !includeImports) continue;
    const s = nodeToBucket.get(e.source);
    const t = nodeToBucket.get(e.target);
    if (!s || !t || s === t) continue;
    if (!bucketIds.has(s) || !bucketIds.has(t)) continue;
    const key = collapseRelations
      ? `${s}::${t}::calls`
      : `${s}::${t}::${e.relation}`;
    const cur = map.get(key);
    if (cur) {
      cur.count += 1;
    } else {
      map.set(key, {
        id: key,
        source: s,
        target: t,
        relation: collapseRelations ? "calls" : e.relation,
        count: 1,
      });
    }
  }
  return [...map.values()];
}

/** Build a plain-English description you'd give a new engineer joining
 *  the team. One sentence about purpose, one about shape. */
function describeCluster(
  name: string,
  members: GraphNode[],
  graph: Graph,
): string {
  const routes = members.filter(
    (m) => m.kind === "route_handler" && m.meta?.httpMethod,
  );
  const services = members.filter((m) => m.kind === "service");
  const middleware = members.filter((m) => m.kind === "middleware");
  const models = members.filter((m) => m.kind === "model");
  const externals = members.filter((m) => m.kind === "external");

  const lowerName = name.toLowerCase();
  const memberIds = new Set(members.map((m) => m.id));
  const outbound = graph.edges.filter(
    (e) => memberIds.has(e.source) && !memberIds.has(e.target),
  );

  // Feature cluster with HTTP routes
  if (routes.length > 0) {
    const hasMw = middleware.length > 0;
    const hasExt = externals.length > 0;
    const dep = outbound.length > 0
      ? ` Depends on ${outbound.length} other parts of the system.`
      : "";
    const guard = hasMw ? ` Protected by ${middleware.map((m) => m.name).join(" & ")}.` : "";
    const ext = hasExt ? ` Integrates with ${externals.map((e) => e.name).join(", ")}.` : "";
    return `Handles everything related to ${lowerName} — ${routes.length} API endpoints, ${services.length} service functions.${guard}${ext}${dep}`;
  }

  // Pure data / model layer
  if (models.length > 0 && services.length === 0) {
    return `Defines the data shapes (${models.map((m) => m.name).join(", ")}). Every other cluster reads from or writes to these models.`;
  }

  // Middleware-only cluster
  if (middleware.length > 0 && routes.length === 0) {
    return `Shared guards applied across the app: ${middleware.map((m) => m.name).join(", ")}. Other clusters depend on these to enforce access control.`;
  }

  // Service-only cluster
  if (services.length > 0) {
    return `Core logic for ${lowerName} — ${services.length} service functions that other clusters call into.`;
  }

  return `${members.length} symbols handling ${lowerName} concerns.`;
}

/** L0: English summary — narrative cards with human descriptions. */
export function aggregateEnglish(graph: Graph): DisplayGraph {
  const byCluster = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    const c = n.cluster ?? "cluster:misc";
    const arr = byCluster.get(c) ?? [];
    arr.push(n);
    byCluster.set(c, arr);
  }
  const clusterMeta = new Map(graph.clusters.map((c) => [c.id, c]));

  const nodes: AggNode[] = [];
  const nodeToBucket = new Map<string, string>();

  for (const [cid, members] of byCluster) {
    const cluster = clusterMeta.get(cid);
    const name = cluster?.name ?? "Misc";
    const dom = dominantKind(members);
    const desc = describeCluster(name, members, graph);

    nodes.push({
      id: cid,
      label: name,
      sub: `${members.length} ${members.length === 1 ? "symbol" : "symbols"}`,
      kind: "english",
      dominantKind: dom,
      childIds: members.map((m) => m.id),
      innerIds: members.map((m) => m.id),
      description: desc,
      width: NODE_SIZES[0].w,
      height: NODE_SIZES[0].h,
    });
    for (const m of members) nodeToBucket.set(m.id, cid);
  }

  const bucketIds = new Set(nodes.map((n) => n.id));
  // L0 (English): include imports -- cross-cluster imports are the
  // dependency story at this level.
  const edges = aggregateEdges(graph.edges, nodeToBucket, bucketIds, true, true);
  return { nodes, edges };
}

/** L1: collapse to clusters. */
export function aggregateClusters(graph: Graph): DisplayGraph {
  const byCluster = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    const c = n.cluster ?? "cluster:misc";
    const arr = byCluster.get(c) ?? [];
    arr.push(n);
    byCluster.set(c, arr);
  }

  const clusterMeta = new Map<string, Cluster>();
  for (const c of graph.clusters) clusterMeta.set(c.id, c);

  const nodes: AggNode[] = [];
  const nodeToBucket = new Map<string, string>();

  for (const [cid, members] of byCluster) {
    const cluster = clusterMeta.get(cid);
    const name = cluster?.name ?? "Misc";
    const dom = dominantKind(members);
    const desc = describeCluster(name, members, graph);
    nodes.push({
      id: cid,
      label: name,
      sub: `${members.length} ${members.length === 1 ? "symbol" : "symbols"}`,
      kind: "cluster",
      dominantKind: dom,
      childIds: members.map((m) => m.id),
      innerIds: members.map((m) => m.id),
      description: desc,
      width: NODE_SIZES[1].w,
      height: NODE_SIZES[1].h,
    });
    for (const m of members) nodeToBucket.set(m.id, cid);
  }

  const bucketIds = new Set(nodes.map((n) => n.id));
  // L1 (Architecture): include imports. Cross-cluster imports ARE the
  // architecture (the actual dependency graph between layers). Without
  // them this view has almost no edges on real TypeScript repos.
  let edges = aggregateEdges(graph.edges, nodeToBucket, bucketIds, true, true);

  // Cap edge density at L1: keep the heaviest edges so layout stays
  // legible on large repos. 5x node count is enough to convey
  // architectural shape without making ELK chew on a hairball.
  const maxEdges = nodes.length * 5;
  if (edges.length > maxEdges) {
    edges = [...edges].sort((a, b) => b.count - a.count).slice(0, maxEdges);
  }

  return { nodes, edges };
}

/** Maximum module nodes to render at L2. Beyond this we keep only the
 *  files with the most symbols (largest modules tend to be the most
 *  architecturally important). The user can drill in to see the rest. */
const L2_NODE_CAP = 250;

/** L2: collapse to files. */
export function aggregateModules(graph: Graph): DisplayGraph {
  const byFile = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    const arr = byFile.get(n.file) ?? [];
    arr.push(n);
    byFile.set(n.file, arr);
  }

  // Cap: keep the biggest files when the repo has too many to lay out.
  let fileEntries = [...byFile.entries()];
  if (fileEntries.length > L2_NODE_CAP) {
    fileEntries = fileEntries
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, L2_NODE_CAP);
  }

  const nodes: AggNode[] = [];
  const nodeToBucket = new Map<string, string>();

  // Workspace prefix to strip for readable labels.
  const allFiles = graph.nodes.map((n) => n.file).filter(Boolean);
  const prefix = allFiles.length > 0 ? commonDirPrefix(allFiles) : "";

  for (const [file, members] of fileEntries) {
    const id = `module:${file}`;
    const dom = dominantKind(members);
    let rel = file;
    if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length).replace(/^\/+/, "");
    rel = rel.replace(/^src\//, "").replace(/\.tsx?$/, "");
    const folder = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "";
    nodes.push({
      id,
      label: rel.split("/").pop() ?? file,
      sub: folder,
      kind: "module",
      dominantKind: dom,
      childIds: members.map((m) => m.id),
      innerIds: members.map((m) => m.id),
      width: NODE_SIZES[2].w,
      height: NODE_SIZES[2].h,
    });
    for (const m of members) nodeToBucket.set(m.id, id);
  }

  const bucketIds = new Set(nodes.map((n) => n.id));
  // L2 (Modules): include imports. Imports between files ARE the
  // dependency story at the file level. Without them the canvas
  // shows hundreds of disconnected boxes -- looks broken on every
  // real TypeScript repo. We collapse to one edge per file pair so
  // dense import sets don't overwhelm the layout.
  let edges = aggregateEdges(graph.edges, nodeToBucket, bucketIds, true, true);

  // Cap edge count for layout sanity -- keep highest-count edges
  const maxEdges = nodes.length * 4;
  if (edges.length > maxEdges) {
    edges = [...edges].sort((a, b) => b.count - a.count).slice(0, maxEdges);
  }

  return { nodes, edges };
}

/** Maximum nodes to render at L3 without drill. Beyond this the layout
 *  engines (ELK then dagre) bog down and the canvas becomes unreadable.
 *  We keep the highest-degree nodes ("hubs") so the user still sees the
 *  important parts of the architecture; the rest are reachable via drill. */
const L3_NODE_CAP = 120;

/** Convert a real (function-level) graph into the same display shape. */
export function asDisplay(graph: Graph): DisplayGraph {
  // Compute a short, repo-relative file label. Strips the workspace root
  // and common src/ prefixes so the path fits the node body.
  const allFiles = graph.nodes.map((n) => n.file).filter(Boolean);
  const prefix = allFiles.length > 0 ? commonDirPrefix(allFiles) : "";
  const stripFile = (file: string): string => {
    let f = file;
    if (prefix && f.startsWith(prefix)) f = f.slice(prefix.length).replace(/^\/+/, "");
    const parts = f.split("/").filter(Boolean);
    if (parts.length > 3) return ".../" + parts.slice(-3).join("/");
    return parts.join("/");
  };

  // Degree-based pruning: when the graph has more nodes than the layout
  // can handle, keep the highest-degree nodes (hubs + their immediate
  // neighbours) so the architecture remains visible.
  let nodes = graph.nodes;
  if (nodes.length > L3_NODE_CAP) {
    const degree = new Map<string, number>();
    for (const e of graph.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    nodes = [...nodes]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, L3_NODE_CAP);
  }
  const keepIds = new Set(nodes.map((n) => n.id));

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.meta?.httpPath ? `${n.meta.httpMethod} ${n.meta.httpPath}` : n.name,
      sub: n.file ? stripFile(n.file) : "",
      kind: "module",
      dominantKind: n.kind,
      childIds: [n.id],
      innerIds: [n.id],
      width: NODE_SIZES[3].w,
      height: NODE_SIZES[3].h,
    })),
    edges: (() => {
      const filtered = graph.edges
        .filter((e) => e.relation !== "imports")
        .filter((e) => keepIds.has(e.source) && keepIds.has(e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          relation: e.relation,
          count: 1,
        }));
      if (filtered.length > nodes.length * 4) {
        return filtered.slice(0, nodes.length * 4);
      }
      return filtered;
    })(),
  };
}

/**
 * Filter a graph to only nodes that fall under the deepest active drill
 * segment. Used by the canvas so that drilling into "Auth" and switching
 * to L2 shows only modules INSIDE Auth — not every module in the repo.
 *
 * Segment id formats:
 *   - "cluster:<id>"       — keep nodes whose .cluster matches
 *   - "module:<relPath>"   — keep nodes whose .file matches
 *   - "<fn:...>" / route   — keep only that node
 *
 * Edges are filtered to those whose endpoints both survive. Clusters
 * are filtered to those that still have at least one member surviving
 * (so the L2 view doesn't draw boundaries for empty clusters).
 */
export function filterByDrill(
  graph: Graph,
  drillPath: { id: string }[],
): Graph {
  if (!drillPath || drillPath.length === 0) return graph;
  const seg = drillPath[drillPath.length - 1];
  const keep = (n: GraphNode): boolean => {
    if (seg.id.startsWith("cluster:")) return (n.cluster ?? "cluster:misc") === seg.id;
    if (seg.id.startsWith("module:")) return `module:${n.file}` === seg.id;
    return n.id === seg.id;
  };
  const nodes = graph.nodes.filter(keep);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  // Clusters can still be displayed in case the user pops back up — but
  // we only need ones that match the surviving node set.
  const survivingClusters = new Set(nodes.map((n) => n.cluster).filter(Boolean) as string[]);
  const clusters: Cluster[] = graph.clusters
    .filter((c) => survivingClusters.has(c.id))
    .map((c) => ({ ...c, nodeIds: c.nodeIds.filter((id) => ids.has(id)) }));
  return { ...graph, nodes, edges, clusters };
}

export function buildDisplayGraph(
  graph: Graph,
  level: Level,
  drillPath: { id: string }[] = [],
): DisplayGraph {
  const filtered = filterByDrill(graph, drillPath);
  if (level === 0) return aggregateEnglish(filtered);
  if (level === 1) return aggregateClusters(filtered);
  if (level === 2) return aggregateModules(filtered);
  return asDisplay(filtered);
}

/** Map an inner node id (e.g. fn:...) to its bucket id at the given level. */
export function bucketIdFor(graph: Graph, innerId: string, level: Level): string {
  if (level === 3) return innerId;
  // Pre-aggregated ids (cluster:* / module:*) are already at the right level.
  if (innerId.startsWith("cluster:") && (level === 0 || level === 1)) return innerId;
  if (innerId.startsWith("module:") && level === 2) return innerId;
  if (level === 0 || level === 1) {
    const node = graph.nodes.find((n) => n.id === innerId);
    return node?.cluster ?? "cluster:misc";
  }
  const node = graph.nodes.find((n) => n.id === innerId);
  return node ? `module:${node.file}` : innerId;
}

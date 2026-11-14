// Loads the curated repo map into Schema's original canvas, and drives the canvas's
// built-in highlights (focus, flash, diff overlay) from agent activity.
import { useStore } from "@/state/store";
import type { RepoMap } from "@/state/trust";
import type { Graph, LocalDiff, NodeKind } from "@/lib/types";

function kindOf(kind: string, bucket?: boolean): NodeKind {
  if (bucket) return "external";
  if (kind === "struct" || kind === "record" || kind === "record struct" || kind === "enum" || kind === "attribute") return "model";
  if (kind === "interface") return "middleware";
  if (kind === "test") return "data_access";
  return "service";
}

/** Keep the canvas readable like the bundled demos: strongest links only, at most two per module pair. */
function canvasEdges(map: RepoMap): RepoMap["edges"] {
  const groupOf = new Map(map.nodes.map((n) => [n.id, n.group]));
  const perPair = new Map<string, number>();
  const out: RepoMap["edges"] = [];
  for (const e of [...map.edges].sort((a, b) => b.weight - a.weight)) {
    const ga = groupOf.get(e.source), gb = groupOf.get(e.target);
    const pair = [ga, gb].sort().join("|");
    const n = perPair.get(pair) ?? 0;
    if (n >= 2) continue;
    perPair.set(pair, n + 1);
    out.push(e);
    if (out.length >= 45) break;
  }
  return out;
}

export function toStudioGraph(map: RepoMap, rootDir: string): Graph {
  const groupName = new Map(map.groups.map((g) => [g.id, g.name]));
  return {
    rootDir,
    nodes: map.nodes.map((n) => ({
      id: n.id,
      name: n.bucket ? `+${n.count ?? 0} more` : n.label,
      kind: kindOf(n.kind, n.bucket),
      file: n.file || `${groupName.get(n.group)} (other types)`,
      cluster: `cluster:${n.group}`,
    })),
    edges: map.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, relation: "calls" as const })),
    clusters: map.groups.map((g) => ({
      id: `cluster:${g.id}`, name: g.name,
      nodeIds: map.nodes.filter((n) => n.group === g.id).map((n) => n.id),
    })),
  };
}

let loadedFor: string | null = null;
let current: RepoMap | null = null;

/** Description of a canvas edge, by display ids ("module:<file>" at Files level, cluster ids at Areas). */
export function describeCanvasEdge(sourceId: string, targetId: string): { title: string; description: string; examples: string[] } | null {
  const map = current;
  if (!map) return null;
  const nodeOf = (id: string) => {
    if (id.startsWith("module:")) { const f = id.slice(7); return map.nodes.filter((n) => (n.file || "") === f || (n.bucket && f.startsWith(map.groups.find((g) => g.id === n.group)?.name ?? "\u0000"))); }
    if (id.startsWith("cluster:")) return map.nodes.filter((n) => `cluster:${n.group}` === id);
    return map.nodes.filter((n) => n.id === id);
  };
  const a = new Set(nodeOf(sourceId).map((n) => n.id));
  const b = new Set(nodeOf(targetId).map((n) => n.id));
  const hits = map.edges.filter((e) => (a.has(e.source) && b.has(e.target)) || (a.has(e.target) && b.has(e.source)));
  if (!hits.length) return null;
  if (hits.length === 1) return { title: hits[0]!.description?.split(":")[0] ?? "", description: hits[0]!.description ?? "", examples: hits[0]!.examples ?? [] };
  const total = hits.reduce((n, e) => n + e.weight, 0);
  const groupName = (id: string) => map.groups.find((g) => `cluster:${g.id}` === id)?.name ?? id;
  return {
    title: `${groupName(sourceId)} ↔ ${groupName(targetId)}`,
    description: `${hits.length} component links, ${total} code references. Strongest: ${hits.slice(0, 3).map((e) => e.description?.split(";")[0]).join(" · ")}`,
    examples: hits.flatMap((e) => e.examples ?? []).slice(0, 4),
  };
}

/** Replace the canvas graph with the curated map, at the Files level (module boxes with cards). */
export function loadCurated(map: RepoMap, rootDir: string, label = map.title): void {
  current = map;
  const key = `${map.sha}:${rootDir}`;
  if (loadedFor === key) return;
  loadedFor = key;
  lastMarks = "";
  const st = useStore.getState();
  st.loadGraph(toStudioGraph(map, rootDir), {
    label, subtitle: `${map.nodes.length} components · ${map.groups.length} modules`, origin: "local", rootPath: rootDir,
  } as never, { rules: [], violations: [], insights: [] } as never);
  // Start on the view that shows every component inside its module.
  useStore.getState().goToLevel(2);
  for (const ms of [900, 2200, 4000]) setTimeout(() => window.dispatchEvent(new Event("schema:fit")), ms);
}

export interface CanvasMarks {
  current?: string | null;
  prev?: string | null;
  recent?: string[];
  changed?: Set<string>;
  added?: Set<string>;
  flagged?: Set<string>;
}

let lastMarks = "";

/** Agent path: the component being edited is focused, edited components stay marked. Nothing else moves. */
export function applyCanvasMarks(m: CanvasMarks): void {
  const changed = m.changed ?? new Set<string>();
  const added = m.added ?? new Set<string>();
  const key = JSON.stringify([m.current ?? null, [...changed].sort(), [...added].sort(), m.current ? [] : [...(m.flagged ?? [])].sort()]);
  if (key === lastMarks) return;
  lastMarks = key;
  const nodes = [
    ...[...changed].filter((id) => !added.has(id)).map((id) => ({ id, status: "modified", file: "", name: id, reasons: [] })),
    ...[...added].map((id) => ({ id, status: "added", file: "", name: id, reasons: [] })),
  ];
  const focus = new Set<string>(m.current ? [m.current] : [...(m.flagged ?? [])]);
  useStore.setState({
    focusTargetIds: focus,
    diffOverlayMode: nodes.length ? "on" : "off",
    diffOverlay: nodes.length ? ({
      baseSha: "", headSha: "", baseRef: "", baseBranch: "main", fetched: true, ahead: 1, behind: 0, workingTreeDirty: false,
      baseGraph: { nodes: [], edges: [], clusters: [], rootDir: "" }, headGraph: { nodes: [], edges: [], clusters: [], rootDir: "" },
      baseEval: { rules: [], violations: [], insights: [] }, headEval: { rules: [], violations: [], insights: [] },
      delta: { newViolations: [], resolvedViolations: [], newInsights: [], resolvedInsights: [] },
      fileStats: { filesChanged: [], added: added.size, modified: changed.size, deleted: 0 },
      graphDelta: { nodes, edges: [], counts: { nodesAdded: added.size, nodesRemoved: 0, nodesModified: changed.size, edgesAdded: 0, edgesRemoved: 0 } },
    } as unknown as LocalDiff) : null,
    ghostEdges: [],
  } as never);
}

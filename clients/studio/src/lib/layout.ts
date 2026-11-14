import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { CLUSTER_PAD, META_NODESEP, META_RANKSEP, NODE_SIZES } from "./layout-constants";

const DEFAULT_W: number = NODE_SIZES[3].w;
const DEFAULT_H: number = NODE_SIZES[3].h;

export interface ClusterMembership {
  parentOf: Record<string, string>;
  clusters: string[];
}

export interface HandleLayout {
  sourceHandles: number;
  targetHandles: number;
}

/**
 * Two-level hierarchical LR layout.
 *
 *   1. Cluster meta-graph: every node IS a cluster, every edge is a
 *      cross-cluster connection (weighted by count). Dagre LR places
 *      clusters in topological order — sources left, sinks right.
 *
 *   2. Per-cluster internal layout: dagre LR on just its members.
 *      Phantom "sink"/"source" nodes bias border nodes toward the
 *      cluster edge where cross-cluster connections enter/exit.
 *
 *   3. Post-layout overlap resolution pass ensures no two nodes
 *      share screen space even after CSS padding/borders are
 *      accounted for.
 *
 *  When there's no cluster membership (L0/L1) we run plain dagre LR.
 */
export function layoutLR(
  nodes: Node[],
  edges: Edge[],
  membership?: ClusterMembership,
): Node[] {
  if (!membership || membership.clusters.length === 0) {
    return resolveOverlaps(plainDagreLR(nodes, edges));
  }

  // Bug 4 fix: single cluster still gets cluster-aware padding
  // so the boundary frame wraps correctly.
  if (membership.clusters.length === 1) {
    const positioned = plainDagreLR(nodes, edges);
    const padded = positioned.map((n) => ({
      ...n,
      position: {
        x: n.position.x + CLUSTER_PAD.left,
        y: n.position.y + CLUSTER_PAD.top,
      },
    }));
    return resolveOverlaps(padded);
  }

  // ── 1. Group nodes by cluster ─────────────────────────────────
  const byCluster = new Map<string, Node[]>();
  for (const cid of membership.clusters) byCluster.set(cid, []);
  for (const n of nodes) {
    const cid = membership.parentOf[n.id];
    if (!cid) continue;
    if (!byCluster.has(cid)) byCluster.set(cid, []);
    byCluster.get(cid)!.push(n);
  }
  for (const [cid, ms] of [...byCluster]) {
    if (ms.length === 0) byCluster.delete(cid);
  }

  // ── 2. Cross-cluster edge counts for meta-graph ───────────────
  const crossEdges = new Map<string, Map<string, number>>();
  for (const e of edges) {
    const sc = membership.parentOf[e.source as string];
    const tc = membership.parentOf[e.target as string];
    if (!sc || !tc || sc === tc) continue;
    if (!byCluster.has(sc) || !byCluster.has(tc)) continue;
    if (!crossEdges.has(sc)) crossEdges.set(sc, new Map());
    crossEdges.get(sc)!.set(tc, (crossEdges.get(sc)!.get(tc) ?? 0) + 1);
  }

  // ── 3. Per-cluster internal layout with phantom border nodes ──
  const innerPositions = new Map<
    string,
    Map<string, { x: number; y: number; w: number; h: number }>
  >();
  const clusterSize = new Map<string, { w: number; h: number }>();

  for (const [cid, members] of byCluster) {
    const memberIds = new Set(members.map((m) => m.id));
    const innerEdges = edges.filter(
      (e) =>
        memberIds.has(e.source as string) &&
        memberIds.has(e.target as string),
    );

    // Identify border nodes with cross-cluster connections
    const rightBorder = new Set<string>();
    const leftBorder = new Set<string>();
    for (const e of edges) {
      if (
        memberIds.has(e.source as string) &&
        !memberIds.has(e.target as string)
      ) {
        rightBorder.add(e.source as string);
      }
      if (
        !memberIds.has(e.source as string) &&
        memberIds.has(e.target as string)
      ) {
        leftBorder.add(e.target as string);
      }
    }

    // Phantom nodes bias border nodes toward the cluster edge
    // where cross-cluster connections enter/exit.
    const phantomNodes: Node[] = [];
    const phantomEdges: Edge[] = [];
    for (const nid of rightBorder) {
      const pid = `__ph_r_${cid}_${nid}`;
      phantomNodes.push({
        id: pid,
        position: { x: 0, y: 0 },
        width: 1,
        height: 1,
        data: {},
      });
      phantomEdges.push({ id: `__pe_${pid}`, source: nid, target: pid });
    }
    for (const nid of leftBorder) {
      const pid = `__ph_l_${cid}_${nid}`;
      phantomNodes.push({
        id: pid,
        position: { x: 0, y: 0 },
        width: 1,
        height: 1,
        data: {},
      });
      phantomEdges.push({ id: `__pe_${pid}`, source: pid, target: nid });
    }

    const positioned = plainDagreLR(
      [...members, ...phantomNodes],
      [...innerEdges, ...phantomEdges],
    );

    // Remove phantoms; compute bounds from real nodes only
    const realPositioned = positioned.filter(
      (n) => !n.id.startsWith("__ph_"),
    );
    const bounds = boundsOf(realPositioned);

    const dx = CLUSTER_PAD.left - bounds.minX;
    const dy = CLUSTER_PAD.top - bounds.minY;

    const innerMap = new Map<
      string,
      { x: number; y: number; w: number; h: number }
    >();
    for (const p of realPositioned) {
      const w = typeof p.width === "number" ? p.width : DEFAULT_W;
      const h = typeof p.height === "number" ? p.height : DEFAULT_H;
      innerMap.set(p.id, {
        x: p.position.x + dx,
        y: p.position.y + dy,
        w,
        h,
      });
    }
    innerPositions.set(cid, innerMap);
    clusterSize.set(cid, {
      w: bounds.w + CLUSTER_PAD.left + CLUSTER_PAD.right,
      h: bounds.h + CLUSTER_PAD.top + CLUSTER_PAD.bottom,
    });
  }

  // ── 4. Meta-layout: position clusters ─────────────────────────
  const meta = new dagre.graphlib.Graph();
  meta.setDefaultEdgeLabel(() => ({}));
  meta.setGraph({
    rankdir: "LR",
    align: "UL",
    ranker: "network-simplex",
    nodesep: META_NODESEP,
    ranksep: META_RANKSEP,
    marginx: 0,
    marginy: 0,
  });
  for (const [cid, size] of clusterSize) {
    meta.setNode(cid, { width: size.w, height: size.h });
  }
  for (const [src, targets] of crossEdges) {
    for (const [dst, w] of targets) {
      meta.setEdge(src, dst, { weight: w });
    }
  }
  dagre.layout(meta);

  // ── 5. Combine: clusterOffset + innerPosition ─────────────────
  const clusterTopLeft = new Map<string, { x: number; y: number }>();
  for (const cid of clusterSize.keys()) {
    const m = meta.node(cid) as { x: number; y: number } | undefined;
    if (!m) continue;
    const size = clusterSize.get(cid)!;
    clusterTopLeft.set(cid, {
      x: m.x - size.w / 2,
      y: m.y - size.h / 2,
    });
  }

  const finalPos = new Map<string, { x: number; y: number }>();
  for (const [cid, innerMap] of innerPositions) {
    const offset = clusterTopLeft.get(cid);
    if (!offset) continue;
    for (const [nid, p] of innerMap) {
      finalPos.set(nid, { x: offset.x + p.x, y: offset.y + p.y });
    }
  }

  const result = nodes.map((n) => ({
    ...n,
    position: finalPos.get(n.id) ?? n.position,
  }));

  return resolveOverlaps(result);
}

/**
 * Assign source/target handle indices to edges based on endpoint Y.
 * Called after layout so positions are known. Returns updated edges
 * (with sourceHandle/targetHandle) + per-node handle counts for the
 * node components to render spread handles.
 */
export function assignHandles(
  nodes: Node[],
  edges: Edge[],
): { edges: Edge[]; handleMap: Map<string, HandleLayout> } {
  const nodeCenter = new Map(
    nodes.map((n) => [
      n.id,
      n.position.y +
        (typeof n.height === "number" ? n.height : DEFAULT_H) / 2,
    ]),
  );

  const srcEdges = new Map<string, { edge: Edge; idx: number }[]>();
  const tgtEdges = new Map<string, { edge: Edge; idx: number }[]>();

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const s = e.source as string;
    const t = e.target as string;
    if (!srcEdges.has(s)) srcEdges.set(s, []);
    srcEdges.get(s)!.push({ edge: e, idx: i });
    if (!tgtEdges.has(t)) tgtEdges.set(t, []);
    tgtEdges.get(t)!.push({ edge: e, idx: i });
  }

  const handleMap = new Map<string, HandleLayout>();
  const edgeHandles = new Map<
    number,
    { sourceHandle?: string; targetHandle?: string }
  >();

  for (const [nodeId, es] of srcEdges) {
    es.sort(
      (a, b) =>
        (nodeCenter.get(a.edge.target as string) ?? 0) -
        (nodeCenter.get(b.edge.target as string) ?? 0),
    );
    es.forEach(({ idx }, i) => {
      const existing = edgeHandles.get(idx) ?? {};
      existing.sourceHandle = `src-${i}`;
      edgeHandles.set(idx, existing);
    });
    handleMap.set(nodeId, { sourceHandles: es.length, targetHandles: 0 });
  }

  for (const [nodeId, es] of tgtEdges) {
    es.sort(
      (a, b) =>
        (nodeCenter.get(a.edge.source as string) ?? 0) -
        (nodeCenter.get(b.edge.source as string) ?? 0),
    );
    es.forEach(({ idx }, i) => {
      const existing = edgeHandles.get(idx) ?? {};
      existing.targetHandle = `tgt-${i}`;
      edgeHandles.set(idx, existing);
    });
    const existing = handleMap.get(nodeId);
    if (existing) {
      existing.targetHandles = es.length;
    } else {
      handleMap.set(nodeId, { sourceHandles: 0, targetHandles: es.length });
    }
  }

  for (const n of nodes) {
    if (!handleMap.has(n.id)) {
      handleMap.set(n.id, { sourceHandles: 0, targetHandles: 0 });
    }
  }

  const newEdges = edges.map((e, i) => {
    const h = edgeHandles.get(i);
    if (!h) return e;
    return { ...e, ...h };
  });

  return { edges: newEdges, handleMap };
}

// ─── Internal helpers ────────────────────────────────────────────

function plainDagreLR(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  const maxW = nodes.reduce(
    (m, n) =>
      Math.max(m, typeof n.width === "number" ? n.width : DEFAULT_W),
    DEFAULT_W,
  );
  const maxH = nodes.reduce(
    (m, n) =>
      Math.max(m, typeof n.height === "number" ? n.height : DEFAULT_H),
    DEFAULT_H,
  );

  const isBigNode = maxH >= 100 || maxW >= 280;
  const nodesep = isBigNode
    ? Math.max(120, Math.round(maxH * 1.0))
    : Math.max(60, Math.round(maxH * 0.7));
  const ranksep = isBigNode
    ? Math.max(180, Math.round(maxW * 0.65))
    : Math.max(95, Math.round(maxW * 0.45));

  g.setGraph({
    rankdir: "LR",
    align: "UL",
    ranker: "network-simplex",
    nodesep,
    ranksep,
    marginx: 0,
    marginy: 0,
  });

  for (const n of nodes) {
    g.setNode(n.id, {
      width: typeof n.width === "number" ? n.width : DEFAULT_W,
      height: typeof n.height === "number" ? n.height : DEFAULT_H,
    });
  }
  for (const e of edges) g.setEdge(e.source as string, e.target as string);

  dagre.layout(g);
  snapAxis(nodes, g, "y", nodesep * 0.25);
  snapAxis(nodes, g, "x", ranksep * 0.3);

  return nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    const w = typeof n.width === "number" ? n.width : DEFAULT_W;
    const h = typeof n.height === "number" ? n.height : DEFAULT_H;
    if (!pos) return n;
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}

function snapAxis(
  nodes: Node[],
  g: InstanceType<typeof dagre.graphlib.Graph>,
  axis: "x" | "y",
  gap: number,
) {
  const vals = nodes
    .map(
      (n) =>
        (g.node(n.id) as { x: number; y: number } | undefined)?.[axis],
    )
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  if (vals.length === 0) return;
  const groups: number[][] = [];
  let cur: number[] = [vals[0]];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] - vals[i - 1] > gap) {
      groups.push(cur);
      cur = [vals[i]];
    } else cur.push(vals[i]);
  }
  groups.push(cur);
  const lookup = new Map<number, number>();
  for (const grp of groups) {
    const sorted = [...grp].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const v of grp) lookup.set(v, median);
  }
  for (const n of nodes) {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    if (!pos) continue;
    const s = lookup.get(pos[axis]);
    if (s !== undefined) pos[axis] = s;
  }
}

/** Push overlapping nodes apart until separated by at least `gap` px. */
function resolveOverlaps(
  nodes: Node[],
  gap = 8,
  maxPasses = 10,
): Node[] {
  const out = nodes.map((n) => ({
    ...n,
    position: { ...n.position },
  }));

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i],
          b = out[j];
        const aw = typeof a.width === "number" ? a.width : DEFAULT_W;
        const ah = typeof a.height === "number" ? a.height : DEFAULT_H;
        const bw = typeof b.width === "number" ? b.width : DEFAULT_W;
        const bh = typeof b.height === "number" ? b.height : DEFAULT_H;

        const acx = a.position.x + aw / 2;
        const acy = a.position.y + ah / 2;
        const bcx = b.position.x + bw / 2;
        const bcy = b.position.y + bh / 2;
        const dx = acx - bcx;
        const dy = acy - bcy;

        const sepX = (aw + bw) / 2 + gap;
        const sepY = (ah + bh) / 2 + gap;
        const penX = sepX - Math.abs(dx);
        const penY = sepY - Math.abs(dy);

        if (penX > 0 && penY > 0) {
          if (penX < penY) {
            const push = penX / 2;
            if (dx >= 0) {
              a.position.x += push;
              b.position.x -= push;
            } else {
              a.position.x -= push;
              b.position.x += push;
            }
          } else {
            const push = penY / 2;
            if (dy >= 0) {
              a.position.y += push;
              b.position.y -= push;
            } else {
              a.position.y -= push;
              b.position.y += push;
            }
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

interface Bounds {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/** Alias for use as the dagre fallback in layout-elk.ts. */
export const layoutDagreLR = layoutLR;

function boundsOf(nodes: Node[]): Bounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, w: 0, h: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    const w = typeof n.width === "number" ? n.width : DEFAULT_W;
    const h = typeof n.height === "number" ? n.height : DEFAULT_H;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

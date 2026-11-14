/**
 * ELK-based layout engine — primary layout for Schema Studio.
 *
 * Replaces dagre's two-level workaround with ELK's native compound graph
 * support, orthogonal edge routing, and barycentric crossing minimization.
 *
 * Fallback chain: ELK → dagre (via layoutDagreLR) → the canvas stays blank
 * (should never happen but prevents a crash).
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";
import { assignHandles, type ClusterMembership, type HandleLayout } from "./layout";
import {
  ELK_BASE,
  ELK_BIG_NODE,
  ELK_COMPOUND_PARENT,
  NODE_SIZES,
} from "./layout-constants";

/* ── ELK types (local aliases to avoid import-path variance) ─────── */

interface ElkPoint {
  x: number;
  y: number;
}

interface ElkEdgeSection {
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
}

interface ElkExtendedEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: ElkEdgeSection[];
}

interface ElkGraphNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkGraphNode[];
  edges?: ElkExtendedEdge[];
  layoutOptions?: Record<string, string>;
}

/* ── Constants ───────────────────────────────────────────────────── */

const elk = new ELK();
const DEFAULT_W = NODE_SIZES[3].w;
const DEFAULT_H = NODE_SIZES[3].h;
const WORKER_THRESHOLD = 50;
// Layout timeout. Scales with graph size: 8s baseline, +1s per 50 nodes,
// capped at 30s. Big real-world graphs need it; the demo never does.
const LAYOUT_TIMEOUT_BASE_MS = 8_000;
const LAYOUT_TIMEOUT_PER_50_NODES_MS = 1_000;
const LAYOUT_TIMEOUT_CAP_MS = 30_000;

/* ── Public API ──────────────────────────────────────────────────── */

export interface ElkLayoutResult {
  nodes: Node[];
  edges: Edge[];
  handleMap: Map<string, HandleLayout>;
}

export async function layoutElk(
  nodes: Node[],
  edges: Edge[],
  membership?: ClusterMembership,
): Promise<ElkLayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], handleMap: new Map() };
  }

  const elkGraph =
    membership && membership.clusters.length > 0
      ? buildCompoundGraph(nodes, edges, membership)
      : buildFlatGraph(nodes, edges);

  const timeout = Math.min(
    LAYOUT_TIMEOUT_BASE_MS + Math.floor(nodes.length / 50) * LAYOUT_TIMEOUT_PER_50_NODES_MS,
    LAYOUT_TIMEOUT_CAP_MS,
  );
  const start = performance.now();
  try {
    const layouted = await runWithTimeout(elkGraph, timeout);
    const elapsed = Math.round(performance.now() - start);
    if (elapsed > 1500) {
      console.info(
        `schema/layout: ELK ok (${nodes.length} nodes, ${edges.length} edges, ${elapsed}ms)`,
      );
    }
    return extractResult(layouted, nodes, edges);
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    console.warn(
      `schema/layout: ELK failed after ${elapsed}ms on ${nodes.length} nodes / ${edges.length} edges -- falling back to dagre. Cause:`,
      err,
    );
    throw err;
  }
}

/* ── ELK runner with timeout ─────────────────────────────────────── */

let workerInstance: Worker | null = null;
let nextWorkerId = 0;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL("./studio-layout-worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return workerInstance;
}

async function runWithTimeout(
  graph: ElkGraphNode,
  timeoutMs: number,
): Promise<ElkGraphNode> {
  const nodeCount = countLeafNodes(graph);

  if (nodeCount < WORKER_THRESHOLD) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return raceTimeout(elk.layout(graph as any).then((r: any) => r as ElkGraphNode), timeoutMs);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMainThread = () => elk.layout(graph as any).then((r: any) => r as ElkGraphNode);
  return raceTimeout(workerBroken ? onMainThread() : runInWorker(graph).catch(() => { workerBroken = true; return onMainThread(); }), timeoutMs);
}

// Set when the layout worker fails to start (seen with elk.bundled in a module worker);
// later layouts go straight to the main thread.
let workerBroken = false;

function runInWorker(graph: ElkGraphNode): Promise<ElkGraphNode> {
  return new Promise((resolve, reject) => {
    const id = ++nextWorkerId;
    const worker = getWorker();

    const handler = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      worker.removeEventListener("message", handler);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result as ElkGraphNode);
    };

    worker.addEventListener("message", handler);
    worker.addEventListener("error", (ev) => { ev.preventDefault(); reject(new Error(ev.message || "layout worker failed")); }, { once: true });
    worker.postMessage({ id, elkGraph: graph });
  });
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ELK layout timed out")), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function countLeafNodes(node: ElkGraphNode): number {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + countLeafNodes(c), 0);
}

/* ── Graph builders ──────────────────────────────────────────────── */

function nodeW(n: Node): number {
  return typeof n.width === "number" ? n.width : DEFAULT_W;
}
function nodeH(n: Node): number {
  return typeof n.height === "number" ? n.height : DEFAULT_H;
}
function isBigNode(nodes: Node[]): boolean {
  return nodes.some((n) => nodeH(n) >= 100 || nodeW(n) >= 280);
}

function buildFlatGraph(nodes: Node[], edges: Edge[]): ElkGraphNode {
  const big = isBigNode(nodes);
  const opts = big ? { ...ELK_BIG_NODE } : { ...ELK_BASE };

  const density = nodes.length;
  if (density <= 4) {
    opts["elk.spacing.nodeNode"] = String(
      Math.round(Number(opts["elk.spacing.nodeNode"]) * 1.5),
    );
  } else if (density >= 10) {
    opts["elk.spacing.nodeNode"] = String(
      Math.round(Number(opts["elk.spacing.nodeNode"]) * 0.8),
    );
  }

  return {
    id: "root",
    layoutOptions: opts,
    children: nodes.map((n) => ({
      id: n.id,
      width: nodeW(n),
      height: nodeH(n),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source as string],
      targets: [e.target as string],
    })),
  };
}

function buildCompoundGraph(
  nodes: Node[],
  edges: Edge[],
  membership: ClusterMembership,
): ElkGraphNode {
  const byCluster = new Map<string, Node[]>();
  const unassigned: Node[] = [];

  for (const n of nodes) {
    const cid = membership.parentOf[n.id];
    if (cid) {
      if (!byCluster.has(cid)) byCluster.set(cid, []);
      byCluster.get(cid)!.push(n);
    } else {
      unassigned.push(n);
    }
  }
  for (const [cid, ms] of [...byCluster]) {
    if (ms.length === 0) byCluster.delete(cid);
  }

  const nodeToCluster = new Map<string, string>();
  for (const [cid, members] of byCluster) {
    for (const m of members) nodeToCluster.set(m.id, cid);
  }

  const intraEdges = new Map<string, ElkExtendedEdge[]>();
  const crossEdges: ElkExtendedEdge[] = [];

  for (const e of edges) {
    const sc = nodeToCluster.get(e.source as string);
    const tc = nodeToCluster.get(e.target as string);
    const elkEdge: ElkExtendedEdge = {
      id: e.id,
      sources: [e.source as string],
      targets: [e.target as string],
    };
    if (sc && tc && sc === tc) {
      if (!intraEdges.has(sc)) intraEdges.set(sc, []);
      intraEdges.get(sc)!.push(elkEdge);
    } else {
      crossEdges.push(elkEdge);
    }
  }

  const clusterChildren: ElkGraphNode[] = [];
  for (const [cid, members] of byCluster) {
    const d = members.length;
    const sepFactor = d <= 2 ? 1.5 : d >= 6 ? 0.8 : 1.0;

    clusterChildren.push({
      id: cid,
      layoutOptions: {
        ...ELK_COMPOUND_PARENT,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": String(Math.round(60 * sepFactor)),
        "elk.layered.spacing.nodeNodeBetweenLayers": "160",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.portConstraints": "FIXED_SIDE",
      },
      children: members.map((n) => ({
        id: n.id,
        width: nodeW(n),
        height: nodeH(n),
      })),
      edges: intraEdges.get(cid) ?? [],
    });
  }

  return {
    id: "root",
    layoutOptions: {
      ...ELK_BASE,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: [
      ...clusterChildren,
      ...unassigned.map((n) => ({
        id: n.id,
        width: nodeW(n),
        height: nodeH(n),
      })),
    ],
    edges: crossEdges,
  };
}

/* ── Result extraction ───────────────────────────────────────────── */

function extractResult(
  layouted: ElkGraphNode,
  originalNodes: Node[],
  originalEdges: Edge[],
): ElkLayoutResult {
  const positions = new Map<string, { x: number; y: number }>();

  function walkNodes(node: ElkGraphNode, ox: number, oy: number) {
    const absX = ox + (node.x ?? 0);
    const absY = oy + (node.y ?? 0);

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        walkNodes(child, absX, absY);
      }
    } else if (node.id !== "root") {
      positions.set(node.id, { x: absX, y: absY });
    }
  }

  if (layouted.children) {
    for (const child of layouted.children) {
      walkNodes(child, 0, 0);
    }
  }

  const positionedNodes = originalNodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? n.position,
  }));

  const edgeRoutes = new Map<string, ElkPoint[]>();

  function walkEdges(container: ElkGraphNode, ox: number, oy: number) {
    if (container.edges) {
      for (const edge of container.edges) {
        if (edge.sections && edge.sections.length > 0) {
          const sec = edge.sections[0];
          const pts: ElkPoint[] = [];
          pts.push({ x: sec.startPoint.x + ox, y: sec.startPoint.y + oy });
          if (sec.bendPoints) {
            for (const bp of sec.bendPoints) {
              pts.push({ x: bp.x + ox, y: bp.y + oy });
            }
          }
          pts.push({ x: sec.endPoint.x + ox, y: sec.endPoint.y + oy });
          edgeRoutes.set(edge.id, pts);
        }
      }
    }
    if (container.children) {
      for (const child of container.children) {
        if (child.children && child.children.length > 0) {
          walkEdges(child, ox + (child.x ?? 0), oy + (child.y ?? 0));
        }
      }
    }
  }

  walkEdges(layouted, 0, 0);

  const edgesWithRoutes = originalEdges.map((e) => {
    const route = edgeRoutes.get(e.id);
    if (route && route.length > 0) {
      return { ...e, data: { ...(e.data ?? {}), bendPoints: route } };
    }
    return e;
  });

  const { edges: handledEdges, handleMap } = assignHandles(
    positionedNodes,
    edgesWithRoutes,
  );

  return { nodes: positionedNodes, edges: handledEdges, handleMap };
}

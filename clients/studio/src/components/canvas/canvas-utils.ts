// Per `architecture/v1-launch-plan.md` Step 10a-2.
//
// Pure utility module extracted from `GraphCanvas.tsx` per
// §0.6.4 (a) (extract pure helpers). Holds:
//   - `EDGE_STROKE` / `EDGE_STROKE_HEAVY` colour tokens
//   - `RELATION_STYLE` (the dasharray/animation table keyed
//     by relation)
//   - `countStackedAtOrigin` (counts nodes still at ~(0,0))
//   - `applyGridFallback` (grid-pile recovery when layout
//     engines fall back)
//
// Why extracting first: the §0.6.4 (a) rule + the Step 7a
// "buried logic" lesson — these 4 surfaces are used by
// `CanvasInner` and tested *only* by snapshot e2e. Pulling
// them into a module lets us unit-test each + lets Step 10b's
// animation choreography modify the edge-style table in
// isolation. Keeps the React surface stable for the
// Step 10a pass.

import type { Node } from "@xyflow/react";
import type { EdgeRelation } from "@/lib/types";

// Edges are intentionally MONOCHROME. Relation is conveyed by
// line PATTERN (solid / dashed / dotted) and motion (streaming
// vs static), not colour, so the coloured nodes can stand out
// without competing with the wiring. Neutral gray (no blue
// tint) — between the previous muted and brighter tones.
export const EDGE_STROKE = "#3E4044" as const;
export const EDGE_STROKE_HEAVY = "#6A6C72" as const;

/** Per-relation edge style table. Keyed by `EdgeRelation`,
 *  every relation listed here gets a `stroke` colour + optional
 *  `strokeDasharray` + optional `animated` flag.
 *
 *  **Monochrome contract.** All entries use one of two stroke
 *  colours (`EDGE_STROKE` / `EDGE_STROKE_HEAVY`). The visual
 *  distinction comes from `strokeDasharray` (solid / dashed /
 *  dotted) and `animated` (motion vs static). Pinned by a
 *  canonical-set test in Step 10a so a future agent who adds
 *  a coloured stroke gets caught.
 *
 *  **Animated period contract.** Animated entries' dash
 *  patterns sum to 20 (the CSS animation period) so the
 *  stroke-dashoffset loops seamlessly with no jerky reset.
 *  Pinned by a per-relation test. */
export const RELATION_STYLE: Record<
  EdgeRelation,
  { stroke: string; strokeDasharray?: string; animated?: boolean; strokeWidth?: number }
> = {
  imports: { stroke: EDGE_STROKE, strokeWidth: 1.4 },
  calls: { stroke: EDGE_STROKE, strokeWidth: 1.4 },
  registers_route: { stroke: EDGE_STROKE_HEAVY, strokeWidth: 1.6 },
  // applies_middleware → streaming dashes (dynamic relation)
  applies_middleware: { stroke: EDGE_STROKE, strokeDasharray: "12 8", animated: true, strokeWidth: 1.4 },
  // data_flow → streaming long dashes (data movement)
  data_flow: { stroke: EDGE_STROKE, strokeWidth: 1.6, strokeDasharray: "14 6", animated: true },
  // control_flow → static dotted
  control_flow: { stroke: EDGE_STROKE, strokeWidth: 1.4, strokeDasharray: "2 10" },
  // rest/grpc contract → streaming dots
  rest_contract: { stroke: EDGE_STROKE_HEAVY, strokeWidth: 1.6, strokeDasharray: "4 16", animated: true },
  grpc_contract: { stroke: EDGE_STROKE_HEAVY, strokeWidth: 1.6, strokeDasharray: "4 16", animated: true },
  // sql_contract → static big dashes
  sql_contract: { stroke: EDGE_STROKE, strokeWidth: 1.4, strokeDasharray: "20 10" },
  reads_field: { stroke: EDGE_STROKE, strokeWidth: 1.4, strokeDasharray: "12 8" },
  writes_field: { stroke: EDGE_STROKE, strokeWidth: 1.4, strokeDasharray: "12 8" },
};

/** All relations in `RELATION_STYLE`, exported so canonical-set
 *  tests can pin cardinality. */
export const RELATION_STYLE_KEYS = Object.keys(RELATION_STYLE) as readonly EdgeRelation[];

/** Count nodes still stuck at (or near) (0,0) after layout.
 *  ELK and dagre both fall back to the initial (0,0) position
 *  when they can't place a node; if many do, the user sees a
 *  pile. The 1-unit tolerance lets legitimately-near-origin
 *  layouts through without false-positive recovery. */
export function countStackedAtOrigin(nodes: readonly Node[]): number {
  let count = 0;
  for (const n of nodes) {
    if (Math.abs(n.position.x) < 1 && Math.abs(n.position.y) < 1) count++;
  }
  return count;
}

/** Deterministic grid fallback for the "pile at origin" case.
 *  Lays nodes out in a grid sized to the largest node so boxes
 *  never overlap. Preserves nodes that already have real
 *  positions. Used only when ELK + dagre both fail to place
 *  enough of the graph. */
export function applyGridFallback(nodes: Node[]): Node[] {
  const stuck: number[] = [];
  let maxW = 240;
  let maxH = 80;
  nodes.forEach((n, i) => {
    if (Math.abs(n.position.x) < 1 && Math.abs(n.position.y) < 1) stuck.push(i);
    const w = typeof n.width === "number" ? n.width : 240;
    const h = typeof n.height === "number" ? n.height : 80;
    if (w > maxW) maxW = w;
    if (h > maxH) maxH = h;
  });
  if (stuck.length === 0) return nodes;

  const cols = Math.max(1, Math.ceil(Math.sqrt(stuck.length)));
  const gapX = maxW + 80;
  const gapY = maxH + 60;
  const out = nodes.slice();
  stuck.forEach((idx, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    out[idx] = {
      ...out[idx]!,
      position: { x: col * gapX, y: row * gapY },
    };
  });
  return out;
}

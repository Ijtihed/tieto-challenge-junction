/**
 * Layout constants — single source of truth.
 * Imported by aggregate.ts, layout.ts, GraphCanvas.tsx, and node components.
 */

/** Rendered pixel dimensions for each aggregation level.
 *  Tailwind `w-[Xpx]` in node components MUST match these values. */
export const NODE_SIZES = {
  0: { w: 360, h: 120 },
  1: { w: 300, h: 120 },
  2: { w: 260, h: 80 },
  3: { w: 240, h: 72 },
} as const;

/** Padding between cluster boundary frame and member nodes.
 *  Used by layout.ts (dagre sizing) AND GraphCanvas.tsx (visual frame). */
export const CLUSTER_PAD = {
  top: 48,
  bottom: 24,
  left: 28,
  right: 28,
} as const;

/** Gap between clusters in the two-level meta-layout. */
export const META_NODESEP = 130;
export const META_RANKSEP = 200;

/* ── ELK layout option presets ────────────────────────────────────── */

export const ELK_BASE: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "200",
  "elk.spacing.nodeNode": "60",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.considerModelOrder.strategy": "PREFER_EDGES",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.portConstraints": "FIXED_SIDE",
};

export const ELK_BIG_NODE: Record<string, string> = {
  ...ELK_BASE,
  "elk.layered.spacing.nodeNodeBetweenLayers": "280",
  "elk.spacing.nodeNode": "120",
};

export const ELK_COMPOUND_PARENT: Record<string, string> = {
  "elk.padding": `[top=${CLUSTER_PAD.top},left=${CLUSTER_PAD.left},bottom=${CLUSTER_PAD.bottom},right=${CLUSTER_PAD.right}]`,
};

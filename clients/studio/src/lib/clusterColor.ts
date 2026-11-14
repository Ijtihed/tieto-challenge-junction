import type { Graph } from "./types";

/**
 * 7-color OKLCH-derived palette for cluster identity on a #111111
 * dark canvas. Desaturated vs the old Tailwind defaults to avoid
 * neon bloom on dark backgrounds. Hues spaced ~50° apart on the
 * OKLCH wheel for maximum perceptual distance. Lightness pinned
 * at L=0.70-0.74 so no cluster looks "heavier" than another.
 *
 * Per the visual audit research: these avoid the kind palette
 * (route gold, service blue, etc.) so clusters and kinds never
 * visually merge.
 */
export const CLUSTER_PALETTE: { hex: string; varName: string; tw: string }[] = [
  { hex: "#D4845A", varName: "--color-cluster-0", tw: "text-cluster-0" }, // Coral
  { hex: "#5AB8B5", varName: "--color-cluster-1", tw: "text-cluster-1" }, // Teal
  { hex: "#C86A82", varName: "--color-cluster-2", tw: "text-cluster-2" }, // Rose
  { hex: "#9A8AC8", varName: "--color-cluster-3", tw: "text-cluster-3" }, // Lavender
  { hex: "#6AAF6E", varName: "--color-cluster-4", tw: "text-cluster-4" }, // Moss
  { hex: "#B8A45E", varName: "--color-cluster-5", tw: "text-cluster-5" }, // Gold
  { hex: "#7A92C0", varName: "--color-cluster-6", tw: "text-cluster-6" }, // Slate blue
];

const FALLBACK = { hex: "#94a3b8", varName: "--color-on-surface-variant", tw: "text-neutral-400" };

export function clusterColorFor(graph: Graph, clusterId: string | undefined | null) {
  if (!clusterId) return FALLBACK;
  const idx = graph.clusters.findIndex((c) => c.id === clusterId);
  if (idx < 0) return FALLBACK;
  return CLUSTER_PALETTE[idx % CLUSTER_PALETTE.length]!;
}

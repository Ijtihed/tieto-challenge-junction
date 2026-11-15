"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  MarkerType,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useStore } from "@/state/store";
import { layoutDagreLR, assignHandles, type ClusterMembership } from "@/lib/layout";
import { CHALLENGE_MODE } from "@/lib/challenge";
import type { HandleLayout } from "@/lib/layout";
import { layoutElk } from "@/lib/layout-elk";
import { CLUSTER_PAD } from "@/lib/layout-constants";
import AggNode from "./AggNode";
import EnglishNode from "./EnglishNode";
import ClusterBoundary from "./ClusterBoundary";
import OrthogonalEdge from "./OrthogonalEdge";
import NodeContextMenu from "./NodeContextMenu";
import {
  bucketIdFor,
  buildDisplayGraph,
  type AggNode as AggNodeT,
} from "@/lib/aggregate";
import { clusterColorFor } from "@/lib/clusterColor";
import type { EdgeRelation, GraphNode } from "@/lib/types";
import { usePersistedPositions } from "./usePersistedPositions";
import { deriveRepoKey } from "@/lib/repoKey";
import SchemaLogo from "@/components/SchemaLogo";
import {
  RELATION_STYLE,
  countStackedAtOrigin,
  applyGridFallback,
} from "./canvas-utils";

const nodeTypes = { agg: AggNode, english: EnglishNode, boundary: ClusterBoundary } as const;
const edgeTypes = { orthogonal: OrthogonalEdge } as const;

function CanvasInner() {
  const workingGraph = useStore((s) => s.workingGraph);
  const level = useStore((s) => s.level);
  const drillPath = useStore((s) => s.drillPath);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const hoverInsightTargets = useStore((s) => s.hoverInsightTargets);
  const hoverPreviewTargets = useStore((s) => s.hoverPreviewTargets);
  const hoverViolationTargets = useStore((s) => s.hoverViolationTargets);
  const focusTargetIds = useStore((s) => s.focusTargetIds);
  const recentlyAdded = useStore((s) => s.recentlyAdded);
  const ghostEdges = useStore((s) => s.ghostEdges);
  const violations = useStore((s) => s.violations);
  const pinnedNodeIds = useStore((s) => s.pinnedNodeIds);
  const bulkSelection = useStore((s) => s.bulkSelection);
  const diffOverlay = useStore((s) => s.diffOverlay);
  const diffOverlayMode = useStore((s) => s.diffOverlayMode);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const selectNode = useStore((s) => s.selectNode);
  const selectEdge = useStore((s) => s.selectEdge);
  const toggleInBulk = useStore((s) => s.toggleInBulk);
  const clearBulk = useStore((s) => s.clearBulk);
  const drillInto = useStore((s) => s.drillInto);

  /**
   * Per-node position overrides set by user drags. Hydrated from
   * /api/positions when the user is signed in and a real repo is
   * loaded; falls back to plain in-memory state for the demo /
   * fixture / unauth flows. The hook handles the debounced write-back
   * to the server.
   *
   * Repo-key derivation runs only when there's a `rootPath` — for
   * the bundled fixture there's no rootPath and we want positions to
   * stay session-only (matches the existing pre-auth behaviour
   * exactly).
   */
  const repo = useStore((s) => s.repo);
  const repoKeyPersisted = useMemo(() => {
    if (!repo.rootPath) return null;
    return deriveRepoKey({
      label: repo.label,
      rootPath: repo.rootPath,
    });
  }, [repo.label, repo.rootPath]);

  // Full-id structural key: includes all node + edge ids so two
  // structurally-different graphs with the same count don't collide.
  const structuralKey = useMemo(
    () =>
      `${level}::${workingGraph.nodes.map((n) => n.id).sort().join("|")}::${workingGraph.edges
        .map((e) => e.id)
        .sort()
        .join("|")}`,
    [level, workingGraph.nodes, workingGraph.edges],
  );

  const {
    overrides,
    setOverrides,
    resetOverrides,
  } = usePersistedPositions({
    repoKey: repoKeyPersisted,
    level,
    structuralKey,
  });
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; nodeId: string } | null
  >(null);
  const theme = useStore((s) => s.theme);

  // Theme-derived colors for the React Flow Background + MiniMap +
  // cluster boundaries. Recomputed when the theme preference changes.
  const themeColors = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        gridLine: "#18181b",
        miniMapMask: "rgba(0,0,0,0.7)",
        miniMapNode: "#171717",
        miniMapStroke: "#262626",
        edgeNew: "#32C48D",
        edgeDim: "#2A2A2A",
        edgeGhost: "#5A9BE6",
        clusterColors: [
          "#D4845A",
          "#5AB8B5",
          "#C86A82",
          "#9A8AC8",
          "#6AAF6E",
          "#B8A45E",
          "#7A92C0",
        ],
      };
    }
    const styles = getComputedStyle(document.documentElement);
    const cluster = (n: number) =>
      styles.getPropertyValue(`--color-cluster-${n}`).trim() || "#94a3b8";
    return {
      gridLine: styles.getPropertyValue("--schema-grid-line").trim() || "#18181b",
      miniMapMask:
        styles.getPropertyValue("--schema-rf-minimap-mask").trim() ||
        "rgba(0,0,0,0.7)",
      miniMapNode:
        styles.getPropertyValue("--schema-rf-minimap-node").trim() || "#171717",
      miniMapStroke:
        styles.getPropertyValue("--schema-rf-minimap-stroke").trim() ||
        "#262626",
      edgeNew: styles.getPropertyValue("--schema-edge-new").trim() || "#32C48D",
      edgeDim: styles.getPropertyValue("--schema-edge-dim").trim() || "#2A2A2A",
      edgeGhost: styles.getPropertyValue("--schema-edge-ghost").trim() || "#5A9BE6",
      clusterColors: [0, 1, 2, 3, 4, 5, 6].map(cluster),
    };
  }, [theme]);

  const violationTargets = useMemo(() => {
    const s = new Set<string>();
    for (const v of violations) for (const id of v.targetIds ?? []) s.add(id);
    return s;
  }, [violations]);

  const display = useMemo(
    () => buildDisplayGraph(workingGraph, level, drillPath),
    [workingGraph, level, drillPath],
  );

  const mapInner = useMemo(() => {
    function mapSet(ids: Iterable<string>): Set<string> {
      const out = new Set<string>();
      for (const id of ids) out.add(bucketIdFor(workingGraph, id, level));
      return out;
    }
    return mapSet;
  }, [workingGraph, level]);

  const focusBuckets = useMemo(() => mapInner(focusTargetIds), [mapInner, focusTargetIds]);
  const insightBuckets = useMemo(() => mapInner(hoverInsightTargets), [mapInner, hoverInsightTargets]);
  const previewBuckets = useMemo(() => mapInner(hoverPreviewTargets), [mapInner, hoverPreviewTargets]);
  const violationBucketsHover = useMemo(
    () => mapInner(hoverViolationTargets),
    [mapInner, hoverViolationTargets],
  );
  const recentlyAddedBuckets = useMemo(
    () => mapInner(recentlyAdded.nodeIds),
    [mapInner, recentlyAdded.nodeIds],
  );
  const pinnedBuckets = useMemo(
    () => mapInner(pinnedNodeIds),
    [mapInner, pinnedNodeIds],
  );
  const bulkBuckets = useMemo(
    () => mapInner(bulkSelection),
    [mapInner, bulkSelection],
  );
  const recentlyAddedEdgeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const e of recentlyAdded.edges) {
      const s = bucketIdFor(workingGraph, e.source, level);
      const t = bucketIdFor(workingGraph, e.target, level);
      keys.add(`${s}::${t}::${e.relation}`);
    }
    return keys;
  }, [recentlyAdded.edges, workingGraph, level]);
  const violationBuckets = useMemo(() => mapInner(violationTargets), [mapInner, violationTargets]);

  // Diff overlay buckets — empty when the overlay is off so paying for
  // them costs nothing in the normal-flow.
  const diffActive = diffOverlayMode === "on" && diffOverlay !== null;
  const diffAddedBuckets = useMemo(() => {
    if (!diffActive) return new Set<string>();
    const ids = diffOverlay!.graphDelta.nodes
      .filter((n) => n.status === "added")
      .map((n) => n.id);
    return mapInner(ids);
  }, [diffActive, diffOverlay, mapInner]);
  const diffModifiedBuckets = useMemo(() => {
    if (!diffActive) return new Set<string>();
    const ids = diffOverlay!.graphDelta.nodes
      .filter((n) => n.status === "modified")
      .map((n) => n.id);
    return mapInner(ids);
  }, [diffActive, diffOverlay, mapInner]);
  // Removed nodes don't appear on the canvas (they're not in the
  // working graph). Listed in the Changes panel; not needed here.
  // (Kept as a hook param target in case we add a "ghost removed
  // nodes on canvas" toggle later.)
  const diffAddedEdgeKeys = useMemo(() => {
    if (!diffActive) return new Set<string>();
    const out = new Set<string>();
    for (const e of diffOverlay!.graphDelta.edges) {
      if (e.status !== "added") continue;
      const s = bucketIdFor(workingGraph, e.source, level);
      const t = bucketIdFor(workingGraph, e.target, level);
      out.add(`${s}::${t}::${e.relation}`);
    }
    return out;
  }, [diffActive, diffOverlay, workingGraph, level]);
  const diffRemovedEdgeKeys = useMemo(() => {
    if (!diffActive) return new Set<string>();
    const out = new Set<string>();
    for (const e of diffOverlay!.graphDelta.edges) {
      if (e.status !== "removed") continue;
      // For removed edges we can't always bucket via workingGraph
      // because the source/target may also be removed. Use the raw
      // ids — the canvas only paints these when both buckets exist
      // (the bucket lookup falls back to the inner id, so they show
      // up if one endpoint survived).
      const s = bucketIdFor(workingGraph, e.source, level);
      const t = bucketIdFor(workingGraph, e.target, level);
      out.add(`${s}::${t}::${e.relation}`);
    }
    return out;
  }, [diffActive, diffOverlay, workingGraph, level]);

  const selectedBucket = useMemo(() => {
    if (!selectedNodeId) return null;
    return bucketIdFor(workingGraph, selectedNodeId, level);
  }, [workingGraph, selectedNodeId, level]);

  const ghostBucketEdges = useMemo(() => {
    return ghostEdges.map((g) => ({
      source: bucketIdFor(workingGraph, g.source, level),
      target: bucketIdFor(workingGraph, g.target, level),
      relation: g.relation,
    }));
  }, [ghostEdges, workingGraph, level]);

  const lastStructuralKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastStructuralKey.current !== structuralKey) {
      lastStructuralKey.current = structuralKey;
      // Preserve manually-dragged positions for nodes that still exist.
      // Only discard overrides for nodes that were removed from the graph.
      const currentNodeIds = new Set(workingGraph.nodes.map((n) => n.id));
      setOverrides((prev) => {
        const kept: Record<string, { x: number; y: number }> = {};
        for (const [id, pos] of Object.entries(prev)) {
          if (currentNodeIds.has(id)) kept[id] = pos;
        }
        return kept;
      });
    }
  }, [structuralKey]);

  /**
   * BASE GRAPH — builds React Flow nodes/edges + membership from the
   * display graph. No layout (positions are placeholder 0,0). Separated
   * from the layout step so we can run ELK asynchronously.
   */
  const base = useMemo(() => {
    const innerById = new Map(workingGraph.nodes.map((n) => [n.id, n] as const));

    const baseNodes: Node[] = display.nodes.map((agg: AggNodeT) => {
      const inner = level === 3 ? innerById.get(agg.id) : undefined;
      const nodeType = agg.kind === "english" ? "english" : "agg";
      return {
        id: agg.id,
        type: nodeType,
        position: { x: 0, y: 0 },
        data: { agg, inner, className: "", stripeColor: undefined, sourceHandles: 1, targetHandles: 1 },
        width: agg.width,
        height: agg.height,
        draggable: true,
        selectable: true,
      };
    });

    const visibleIds = new Set(display.nodes.map((n) => n.id));

    const filteredEdges = display.edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );

    // Edge bundling: compute vertical offset for parallel edges (L2/L3)
    const pairCounts = new Map<string, number>();
    const pairIndex = new Map<string, number>();
    if (level >= 2) {
      for (const e of filteredEdges) {
        const pk = `${e.source}::${e.target}`;
        pairCounts.set(pk, (pairCounts.get(pk) ?? 0) + 1);
      }
      for (const e of filteredEdges) {
        const pk = `${e.source}::${e.target}`;
        const idx = pairIndex.get(pk) ?? 0;
        pairIndex.set(pk, idx + 1);
      }
      pairIndex.clear();
    }

    const baseEdges: Edge[] = filteredEdges.map((e) => {
      const style = RELATION_STYLE[e.relation] ?? RELATION_STYLE.calls;
      const baseWidth = (style.strokeWidth ?? 1) + 0.4;

      let bundleOffset = 0;
      if (level >= 2) {
        const pk = `${e.source}::${e.target}`;
        const count = pairCounts.get(pk) ?? 1;
        const idx = pairIndex.get(pk) ?? 0;
        pairIndex.set(pk, idx + 1);
        if (count > 1) {
          const spacing = count > 2 ? 6 : 4;
          bundleOffset = (idx - (count - 1) / 2) * spacing;
        }
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "orthogonal",
        animated: !!style.animated,
        style: {
          stroke: style.stroke,
          strokeWidth: baseWidth,
          strokeDasharray: style.strokeDasharray,
          opacity: 0.9,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.stroke,
          width: level === 0 ? 14 : 11,
          height: level === 0 ? 14 : 11,
        },
        data: { relation: e.relation, bundleOffset },
      };
    });

    let membership: ClusterMembership | undefined;
    if (level === 3) {
      // Build per-cluster membership. When the user has drilled into a
      // single cluster (drillPath includes a cluster:... segment),
      // filterByDrill returns only that cluster's nodes -- if we still
      // wrap them in a 1-cluster compound, dagre's LR mode collapses
      // everything into a single rank/column. Skip membership in that
      // case so the inner DAG lays out properly.
      const distinctClusters = new Set<string>();
      for (const n of display.nodes) {
        for (const innerId of n.innerIds) {
          const inner = workingGraph.nodes.find((g) => g.id === innerId);
          if (inner) distinctClusters.add(inner.cluster ?? "cluster:misc");
        }
      }
      if (distinctClusters.size > 1) {
        membership = {
          parentOf: Object.fromEntries(
            workingGraph.nodes.map((n) => [n.id, n.cluster ?? "cluster:misc"]),
          ),
          clusters: workingGraph.clusters.map((c) => c.id),
        };
      }
    } else if (level === 2) {
      // Group L2 module nodes by their architectural cluster (from
      // Leiden + directory clustering on the server) rather than by raw
      // directory path. This makes the L2 view match the L1 architecture
      // and gives files belonging to the same logical concern a shared
      // boundary -- much more readable than grouping by absolute path.
      const parentOf: Record<string, string> = {};
      const clusterIds = new Set<string>();
      const fileToCluster = new Map<string, string>();
      for (const n of workingGraph.nodes) {
        const cid = n.cluster ?? "cluster:misc";
        if (!fileToCluster.has(n.file)) fileToCluster.set(n.file, cid);
      }
      for (const agg of display.nodes) {
        const file = agg.id.replace("module:", "");
        const cid = fileToCluster.get(file) ?? "cluster:misc";
        parentOf[agg.id] = cid;
        clusterIds.add(cid);
      }
      if (clusterIds.size > 1) {
        membership = {
          parentOf,
          clusters: [...clusterIds],
        };
      }
    }

    return { baseNodes, baseEdges, membership, innerById, visibleIds };
  }, [display, level, workingGraph]);

  /**
   * STRUCTURAL LAYER — async ELK layout with dagre fallback.
   *
   * ELK runs asynchronously (inline for <50 nodes, Web Worker for 50+).
   * The previous structural result stays visible until the new one
   * arrives, so graph mutations don't flash to blank. Level changes
   * use the hiddenForLevel mechanism to hide during re-layout.
   */
  interface StructuralResult {
    nodes: Node[];
    edges: Edge[];
    innerById: Map<string, GraphNode>;
    visibleIds: Set<string>;
  }
  const [structural, setStructural] = useState<StructuralResult | null>(null);
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let laidOutNodes: Node[];
      let handledEdges: Edge[];
      let handleMap: Map<string, HandleLayout>;

      if (CHALLENGE_MODE && level === 2 && base.membership) {
        // Challenge mode: modules on a fixed 4-column grid, components packed two per row inside.
        laidOutNodes = moduleGrid(base.baseNodes, base.membership, workingGraph.clusters.map((c) => c.id));
        const handled = assignHandles(laidOutNodes, base.baseEdges);
        handledEdges = handled.edges;
        handleMap = handled.handleMap;
      } else {
        try {
          const result = await layoutElk(
            base.baseNodes,
            base.baseEdges,
            base.membership,
          );
          laidOutNodes = result.nodes;
          handledEdges = result.edges;
          handleMap = result.handleMap;
        } catch {
          if (cancelled) return;
          laidOutNodes = layoutDagreLR(
            base.baseNodes,
            base.baseEdges,
            base.membership,
          );
          const result = assignHandles(laidOutNodes, base.baseEdges);
          handledEdges = result.edges;
          handleMap = result.handleMap;
        }
      }

      // Safety net: if any nodes are still at (0,0) after layout (which
      // happens when ELK or dagre fails to place certain nodes), assign
      // them deterministic grid positions so the user never sees a pile
      // at the origin. The grid spacing comes from the largest node so
      // boxes never visually overlap.
      const overlapCount = countStackedAtOrigin(laidOutNodes);
      if (overlapCount > 1) {
        console.warn(
          `schema/layout: ${overlapCount} nodes stuck at origin -- applying grid fallback`,
        );
        laidOutNodes = applyGridFallback(laidOutNodes);
      }

      if (cancelled) return;

      const nodesWithHandles = laidOutNodes.map((n) => {
        const h = handleMap.get(n.id);
        if (!h) return n;
        return {
          ...n,
          data: {
            ...n.data,
            sourceHandles: h.sourceHandles,
            targetHandles: h.targetHandles,
          },
        };
      });

      const newPositions = new Map(
        nodesWithHandles.map((n) => [n.id, n.position]),
      );

      const structResult: StructuralResult = {
        nodes: nodesWithHandles,
        edges: handledEdges,
        innerById: base.innerById,
        visibleIds: base.visibleIds,
      };

      // Smooth tween for same-level mutations (node add/remove/reorder).
      // Level changes use the hiddenForLevel fade instead.
      const oldPos = prevPositionsRef.current;
      if (oldPos.size > 0 && !hiddenForLevel) {
        let totalDelta = 0;
        let sharedCount = 0;
        for (const [id, np] of newPositions) {
          const op = oldPos.get(id);
          if (op) {
            totalDelta += Math.hypot(np.x - op.x, np.y - op.y);
            sharedCount++;
          }
        }
        const avgDelta = sharedCount > 0 ? totalDelta / sharedCount : 0;

        if (avgDelta > 5 && sharedCount > 0) {
          const duration = avgDelta > 50 ? 400 : 300;
          const start = performance.now();
          const from = oldPos;

          const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

          const step = () => {
            if (cancelled) return;
            const elapsed = performance.now() - start;
            const rawT = Math.min(1, elapsed / duration);
            const t = easeOut(rawT);

            const tweened = nodesWithHandles.map((n) => {
              const fp = from.get(n.id);
              if (!fp) return { ...n, style: { ...((n as { style?: object }).style ?? {}), opacity: t } };
              return {
                ...n,
                position: {
                  x: fp.x + (n.position.x - fp.x) * t,
                  y: fp.y + (n.position.y - fp.y) * t,
                },
              };
            });

            setStructural({ ...structResult, nodes: tweened });

            if (rawT < 1) {
              requestAnimationFrame(step);
            } else {
              prevPositionsRef.current = newPositions;
            }
          };

          requestAnimationFrame(step);
          return;
        }
      }

      prevPositionsRef.current = newPositions;
      setStructural(structResult);
    })();

    return () => { cancelled = true; };
  }, [base]);

  /**
   * VISUAL LAYER — cheap remap. Applies className + edge styling for the
   * current selection/hover/focus/pin/bulk/recently-added state. Never
   * re-runs layout, so hovering an insight or selecting a node doesn't
   * cost a layout pass.
   */
  const layoutPending = !structural && display.nodes.length > 0;

  const positionableNodes = useMemo(() => {
    if (!structural) {
      return {
        nodes: [] as Node[],
        edges: [] as Edge[],
        innerById: new Map() as Map<string, GraphNode>,
      };
    }
    const someThingHovered =
      insightBuckets.size + violationBucketsHover.size + previewBuckets.size > 0;
    const focusActive = focusBuckets.size > 0;
    // When a node is selected (inspector open), dim everything except the
    // selection and its direct neighbors, so the user can focus on the
    // selected element and its immediate connections.
    const selectionActive = !!selectedBucket;
    const selectionNeighbors = new Set<string>();
    if (selectionActive) {
      selectionNeighbors.add(selectedBucket!);
      for (const e of structural.edges) {
        if (e.source === selectedBucket) selectionNeighbors.add(e.target);
        if (e.target === selectedBucket) selectionNeighbors.add(e.source);
      }
    }

    const nodes: Node[] = structural.nodes.map((n) => {
      const id = n.id;
      const isSelected = id === selectedBucket;
      const isBulk = bulkBuckets.has(id);
      const isHover =
        insightBuckets.has(id) ||
        violationBucketsHover.has(id) ||
        previewBuckets.has(id);
      const isFocus = focusBuckets.has(id);
      const isNew = recentlyAddedBuckets.has(id);
      const isViolation = violationBuckets.has(id);
      const isPinned = pinnedBuckets.has(id);
      const isDiffAdded = diffAddedBuckets.has(id);
      const isDiffModified = diffModifiedBuckets.has(id);
      const dim =
        (someThingHovered && !isHover && !isPinned && !isBulk) ||
        (focusActive && !isFocus && !isNew && !isPinned && !isBulk) ||
        (selectionActive && !selectionNeighbors.has(id) && !isPinned && !isBulk);

      const cls = [
        isSelected || isBulk ? "schema-node-selected" : "",
        isFocus ? "schema-node-focus" : "",
        isNew && !dim ? "schema-node-new" : "",
        isHover ? "schema-node-hover-target" : "",
        isViolation && !isFocus && !dim ? "schema-node-violation" : "",
        isPinned && !isFocus && !isSelected && !isBulk && !dim
          ? "schema-node-pinned"
          : "",
        isDiffAdded && !dim ? "schema-node-diff-added" : "",
        isDiffModified && !isDiffAdded && !dim ? "schema-node-diff-modified" : "",
        dim && !isSelected && !isBulk ? "schema-node-dim" : "",
      ]
        .filter(Boolean)
        .join(" ");

      // Theme-dependent stripe color (moved from structural layer so
      // toggling dark/light doesn't re-run dagre).
      const agg = (n.data as Record<string, unknown>).agg as AggNodeT | undefined;
      let stripeColor: string | undefined;
      if (agg && (agg.kind === "cluster" || agg.kind === "english")) {
        const idx = workingGraph.clusters.findIndex((c) => c.id === agg.id);
        stripeColor =
          idx >= 0
            ? themeColors.clusterColors[idx % themeColors.clusterColors.length]
            : clusterColorFor(workingGraph, agg.id).hex;
      }

      const data = n.data as Record<string, unknown>;
      if (data.className === cls && data.stripeColor === stripeColor) return n;
      return { ...n, data: { ...data, className: cls, stripeColor } };
    });

    const edges: Edge[] = structural.edges.map((e) => {
      const sourceId = e.source as string;
      const targetId = e.target as string;
      const relation = (e.data as { relation?: EdgeRelation })?.relation;
      const isEdgeSelected = e.id === selectedEdgeId;
      const dimEdge =
        (someThingHovered &&
          !insightBuckets.has(sourceId) &&
          !insightBuckets.has(targetId) &&
          !previewBuckets.has(sourceId) &&
          !previewBuckets.has(targetId) &&
          !violationBucketsHover.has(sourceId) &&
          !violationBucketsHover.has(targetId)) ||
        (focusActive &&
          !focusBuckets.has(sourceId) &&
          !focusBuckets.has(targetId)) ||
        // Edge-selection focus: when an edge is selected, dim every
        // other edge. When a node is selected, dim edges that don't
        // touch the selection.
        (!!selectedEdgeId && !isEdgeSelected) ||
        (!!selectedBucket && sourceId !== selectedBucket && targetId !== selectedBucket);
      const isNew =
        relation !== undefined &&
        recentlyAddedEdgeKeys.has(`${sourceId}::${targetId}::${relation}`);
      const isDiffAdded =
        diffActive &&
        relation !== undefined &&
        diffAddedEdgeKeys.has(`${sourceId}::${targetId}::${relation}`);
      // When a node is selected, edges touching it should be highlighted
      // (almost white) so they pop against the dimmed background.
      const isSelectionEdge =
        !!selectedBucket && (sourceId === selectedBucket || targetId === selectedBucket);
      if (!dimEdge && !isNew && !isDiffAdded && !isEdgeSelected && !isSelectionEdge) return e;
      const baseStroke = (e.style?.stroke as string) ?? "#3D4D5A";
      const stroke = isEdgeSelected
        ? "#E5E2E1"
        : isSelectionEdge
          ? "#D4D2D1"
          : isNew || isDiffAdded
            ? themeColors.edgeNew
            : dimEdge
              ? themeColors.edgeDim
              : baseStroke;
      return {
        ...e,
        selected: isEdgeSelected,
        animated: e.animated || isNew || isDiffAdded,
        labelStyle: { ...e.labelStyle, fill: stroke },
        style: {
          ...e.style,
          stroke,
          strokeWidth: isEdgeSelected || isSelectionEdge ? 2.2 : isNew || isDiffAdded ? 1.8 : (e.style?.strokeWidth ?? 1),
          opacity:
            isEdgeSelected || isSelectionEdge
              ? 1
              : dimEdge && !isNew && !isDiffAdded
                ? 0.25
                : isNew || isDiffAdded
                  ? 1
                  : 0.85,
          filter: undefined,
        },
        markerEnd:
          e.markerEnd && typeof e.markerEnd === "object"
            ? { ...e.markerEnd, color: stroke }
            : e.markerEnd,
      };
    });

    // Removed edges (in base but not head). Add them as red dashed
    // ghosts to the canvas only when both endpoints are visible buckets.
    if (diffActive) {
      const presentKeys = new Set(
        edges.map((e) => {
          const r = (e.data as { relation?: EdgeRelation })?.relation;
          return `${e.source}::${e.target}::${r}`;
        }),
      );
      for (const k of diffRemovedEdgeKeys) {
        const [s, t, r] = k.split("::");
        if (!s || !t || !r) continue;
        if (!structural.visibleIds.has(s) || !structural.visibleIds.has(t))
          continue;
        if (presentKeys.has(k)) continue;
        edges.push({
          id: `diff-rm:${s}:${t}:${r}`,
          source: s,
          target: t,
          sourceHandle: "src-0",
          targetHandle: "tgt-0",
          type: "default",
          style: {
            stroke: "#E06060",
            strokeWidth: 1.5,
            strokeDasharray: "5 4",
            opacity: 0.6,
          },
          animated: false,
          data: { relation: r as EdgeRelation, isDiffRemoved: true },
        });
      }
    }

    // Append ghost edges for plan preview (pure visual — no structural impact)
    const ghostKeyset = new Set(edges.map((e) => `${e.source}::${e.target}`));
    for (const g of ghostBucketEdges) {
      if (g.source === g.target) continue;
      const k = `${g.source}::${g.target}`;
      if (ghostKeyset.has(k)) continue;
      if (!structural.visibleIds.has(g.source) || !structural.visibleIds.has(g.target))
        continue;
      edges.push({
        id: `ghost:${g.source}:${g.target}`,
        source: g.source,
        target: g.target,
        sourceHandle: "src-0",
        targetHandle: "tgt-0",
        type: "default",
        style: {
          stroke: themeColors.edgeGhost,
          strokeWidth: 1.8,
          strokeDasharray: "4 4",
          opacity: 0.9,
          filter: `drop-shadow(0 0 4px ${themeColors.edgeGhost}44)`,
        },
        animated: true,
      });
    }

    return { nodes, edges, innerById: structural.innerById };
  }, [
    structural,
    selectedBucket,
    selectedEdgeId,
    insightBuckets,
    previewBuckets,
    violationBucketsHover,
    focusBuckets,
    recentlyAddedBuckets,
    violationBuckets,
    recentlyAddedEdgeKeys,
    ghostBucketEdges,
    pinnedBuckets,
    bulkBuckets,
    diffAddedBuckets,
    diffModifiedBuckets,
    diffAddedEdgeKeys,
    diffRemovedEdgeKeys,
    themeColors,
  ]);

  /**
   * Final nodes = laid-out positions overridden by user drags + boundary
   * frames computed live from current member positions so the frame always
   * wraps its members, even mid-drag.
   */
  const { nodes, edges } = useMemo(() => {
    const overridden = positionableNodes.nodes.map((n) => {
      const ov = overrides[n.id];
      if (!ov) return n;
      const prevClass = (n.data as { className?: string })?.className ?? "";
      const lockClass = prevClass.includes("schema-node-locked") ? "" : " schema-node-locked";
      return {
        ...n,
        position: ov,
        data: { ...n.data, className: (prevClass + lockClass).trim() },
      };
    });

    const boundaryNodes: Node[] = [];
    if (level === 2 || level === 3) {
      const byCluster = new Map<string, Node[]>();
      // Track whether each cluster has at least one non-dimmed member so
      // boundary frames get the same monochrome treatment when a node is
      // selected / focused but isn't in this cluster.
      const clusterHasActiveMember = new Map<string, boolean>();
      for (const n of overridden) {
        let clusterId: string | undefined;
        if (level === 3) {
          clusterId = positionableNodes.innerById.get(n.id)?.cluster;
        } else {
          // L2: module nodes — find any inner node to get its cluster
          const inner = workingGraph.nodes.find((wn) => `module:${wn.file}` === n.id);
          clusterId = inner?.cluster;
        }
        if (!clusterId) continue;
        const arr = byCluster.get(clusterId) ?? [];
        arr.push(n);
        byCluster.set(clusterId, arr);
        const cls = (n.data as { className?: string })?.className ?? "";
        const isDim = cls.includes("schema-node-dim");
        if (!isDim) clusterHasActiveMember.set(clusterId, true);
      }
      for (const [cid, ns] of byCluster) {
        if (ns.length === 0) continue;
        if (ns.length === 1 && drillPath.length === 0 && level === 2) continue;
        const xs = ns.map((n) => n.position.x);
        const ys = ns.map((n) => n.position.y);
        const ws = ns.map((n) => (typeof n.width === "number" ? n.width : 240));
        const hs = ns.map((n) => (typeof n.height === "number" ? n.height : 72));
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs.map((x, i) => x + ws[i]));
        const maxY = Math.max(...ys.map((y, i) => y + hs[i]));
        const cluster = workingGraph.clusters.find((c) => c.id === cid);
        const cIdx = workingGraph.clusters.findIndex((c) => c.id === cid);
        const color =
          cIdx >= 0
            ? themeColors.clusterColors[cIdx % themeColors.clusterColors.length]
            : clusterColorFor(workingGraph, cid).hex;
        const w = maxX - minX + CLUSTER_PAD.left + CLUSTER_PAD.right;
        const h = maxY - minY + CLUSTER_PAD.top + CLUSTER_PAD.bottom;
        const anyFocusMode =
          !!selectedBucket ||
          focusBuckets.size > 0 ||
          insightBuckets.size + violationBucketsHover.size + previewBuckets.size > 0;
        const isClusterDimmed =
          anyFocusMode && !clusterHasActiveMember.get(cid);
        boundaryNodes.push({
          id: `boundary:${cid}`,
          type: "boundary",
          position: { x: minX - CLUSTER_PAD.left, y: minY - CLUSTER_PAD.top },
          data: {
            label: cluster?.name ?? "Cluster",
            color,
            count: ns.length,
            width: w,
            height: h,
            dimmed: isClusterDimmed,
            canonicalShape: cluster?.canonicalShape,
            entryPointCount: cluster?.entryPointIds?.length ?? 0,
          },
          width: w,
          height: h,
          selectable: false,
          draggable: false,
          focusable: false,
          style: { zIndex: -1, pointerEvents: "none" },
        });
      }
    }

    // Clear stale ELK bend points on edges connected to dragged nodes
    // so OrthogonalEdge falls back to dynamic L-shaped routing that
    // follows the handle positions React Flow computes from the actual
    // (overridden) node position.
    const draggedIds = new Set(Object.keys(overrides));
    const adjustedEdges =
      draggedIds.size === 0
        ? positionableNodes.edges
        : positionableNodes.edges.map((e) => {
            if (draggedIds.has(e.source) || draggedIds.has(e.target)) {
              const d = { ...(e.data as Record<string, unknown>) };
              delete d.bendPoints;
              return { ...e, data: d };
            }
            return e;
          });

    return {
      nodes: [...boundaryNodes, ...overridden],
      edges: adjustedEdges,
    };
  }, [positionableNodes, overrides, workingGraph, level, drillPath, themeColors]);

  // ── Undo / redo for node drags ─────────────────────────────────
  const undoStackRef = useRef<Record<string, { x: number; y: number }>[]>([]);
  const redoStackRef = useRef<Record<string, { x: number; y: number }>[]>([]);
  const dragSnapshotRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const overridesSnapRef = useRef(overrides);
  overridesSnapRef.current = overrides;

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type !== "position") continue;
      if ((c as { dragging?: boolean }).dragging && !dragSnapshotRef.current) {
        dragSnapshotRef.current = { ...overridesSnapRef.current };
      }
      if ((c as { dragging?: boolean }).dragging === false && dragSnapshotRef.current) {
        undoStackRef.current.push(dragSnapshotRef.current);
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        redoStackRef.current = [];
        dragSnapshotRef.current = null;
      }
    }

    setOverrides((prev) => {
      let next = prev;
      let mutated = false;
      for (const c of changes) {
        if (c.type === "position" && "position" in c && c.position) {
          if (!mutated) {
            next = { ...prev };
            mutated = true;
          }
          next[c.id] = { x: c.position.x, y: c.position.y };
        }
      }
      return mutated ? next : prev;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey) || e.key !== "z") return;

      e.preventDefault();
      if (e.shiftKey) {
        const state = redoStackRef.current.pop();
        if (state) {
          undoStackRef.current.push({ ...overridesSnapRef.current });
          setOverrides(state);
        }
      } else {
        const state = undoStackRef.current.pop();
        if (state) {
          redoStackRef.current.push({ ...overridesSnapRef.current });
          setOverrides(state);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOverrides]);

  const rf = useReactFlow();
  // External fit requests (e.g. after a programmatic graph swap).
  useEffect(() => {
    const h = () => rf.fitView({ duration: 300, padding: 0.12 });
    window.addEventListener("schema:fit", h);
    return () => window.removeEventListener("schema:fit", h);
  }, [rf]);

  // Level-change transition. The trick: track level via state and detect a
  // mismatch DURING render so the very first render after a level change
  // already has opacity:0 in its inline style. useEffect-only approaches
  // cause a 1-frame flash because nodes paint at wrong viewport positions
  // before the effect fires.
  //
  // Phases:
  //   1. Level changes → render with hiddenForLevel=true → paint at opacity:0
  //   2. useEffect fires → snap viewport with fitView({duration:0}) → schedule reveal
  //   3. After 80ms (gives React Flow time to commit viewport update),
  //      flip hiddenForLevel=false → paint fades opacity 0→1 over 400ms
  //   4. Edge draw animation starts 320ms into the fade-in (after nodes are
  //      visible), drawing each edge from source to target.
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [lastLevel, setLastLevel] = useState(level);
  const [hiddenForLevel, setHiddenForLevel] = useState(false);

  if (lastLevel !== level) {
    setLastLevel(level);
    setHiddenForLevel(true);
    setStructural(null);
  }

  useEffect(() => {
    if (!hiddenForLevel) return;
    if (!structural) return;
    const el = canvasWrapperRef.current;
    rf.fitView({ duration: 0, padding: level <= 1 ? 0.18 : level === 2 ? 0.14 : 0.10 });
    const revealT = setTimeout(() => {
      setHiddenForLevel(false);
      if (el) {
        el.classList.add("schema-view-entering");
        const cleanT = setTimeout(() => {
          el.classList.remove("schema-view-entering");
        }, 1400);
        cleanRef.current = cleanT;
      }
    }, 80);
    return () => clearTimeout(revealT);
  }, [hiddenForLevel, structural, level, rf]);

  const cleanRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cleanRef.current) clearTimeout(cleanRef.current); }, []);

  // Center + zoom on selected node when inspector opens
  useEffect(() => {
    if (!selectedNodeId || !selectedBucket) return;
    const node = nodes.find((n) => n.id === selectedBucket);
    if (!node) return;
    const w = typeof node.width === "number" ? node.width : 240;
    const h = typeof node.height === "number" ? node.height : 72;
    const cx = node.position.x + w / 2;
    const cy = node.position.y + h / 2;
    rf.setCenter(cx, cy, { zoom: 1.4, duration: 350 });
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the working graph mutates (e.g. after an undo wipes the selected
  // node), clear any stale selection AND close the inspector so the UI
  // doesn't get stuck showing "No node selected".
  useEffect(() => {
    if (!selectedNodeId) return;
    const stillExists =
      (selectedNodeId.startsWith("cluster:") &&
        workingGraph.clusters.some((c) => c.id === selectedNodeId)) ||
      (selectedNodeId.startsWith("module:") &&
        workingGraph.nodes.some(
          (n) => `module:${n.file}` === selectedNodeId,
        )) ||
      workingGraph.nodes.some((n) => n.id === selectedNodeId);
    if (!stillExists) {
      selectNode(null);
      const s = useStore.getState();
      if (s.sidePanelView === "inspector") {
        useStore.setState({ sidePanelView: null });
      }
    }
  }, [workingGraph, selectedNodeId, selectNode]);

  // Empty-graph state: render a friendly placeholder instead of an empty
  // canvas (which is just a black grid and feels broken).
  const isEmpty = display.nodes.length === 0;

  return (
    <div
      ref={canvasWrapperRef}
      className="w-full h-full"
      style={{
        opacity: hiddenForLevel ? 0 : 1,
        transition: hiddenForLevel ? "none" : "opacity 500ms cubic-bezier(0.2, 0, 0.2, 1)",
      }}
    >
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(e, n) => {
        // Boundaries are non-selectable; React Flow won't fire this for them.
        if (e.shiftKey || e.metaKey) {
          toggleInBulk(n.id);
        } else {
          clearBulk();
          selectNode(n.id);
        }
      }}
      onNodeDoubleClick={(_, n) => {
        if (level === 3) return;
        const aggNode = display.nodes.find((d) => d.id === n.id);
        if (!aggNode) return;
        if (level === 0) {
          // L0 (English) → skip L1 (also cluster-level) and land on
          // L2 (modules inside this cluster) so drilling is meaningful.
          const cur = useStore.getState();
          const closePanel =
            cur.sidePanelView === "inspector" || cur.sidePanelView === "edge";
          useStore.setState({
            level: 2,
            drillPath: [...cur.drillPath, { id: n.id, label: aggNode.label, level }],
            selectedNodeId: null,
            selectedEdgeId: null,
            focusTargetIds: new Set<string>(),
            hoverInsightTargets: new Set<string>(),
            hoverViolationTargets: new Set<string>(),
            hoverPreviewTargets: new Set<string>(),
            ...(closePanel ? { sidePanelView: null } : {}),
          });
        } else {
          drillInto({ id: n.id, label: aggNode.label, level });
        }
      }}
      onEdgeClick={(_, e) => {
        // Don't select ghost edges (preview-only) — let users click through.
        if (e.id.startsWith("ghost:")) return;
        selectEdge(e.id);
      }}
      onNodeContextMenu={(e, n) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: n.id });
      }}
      onPaneClick={() => {
        const s = useStore.getState();
        useStore.setState({
          selectedNodeId: null,
          selectedEdgeId: null,
          focusTargetIds: new Set<string>(),
          hoverInsightTargets: new Set<string>(),
          hoverViolationTargets: new Set<string>(),
          hoverPreviewTargets: new Set<string>(),
          bulkSelection: new Set<string>(),
          sidePanelView: s.sidePanelView === "inspector" || s.sidePanelView === "edge"
            ? null
            : s.sidePanelView,
        });
        setContextMenu(null);
      }}
      fitView
      fitViewOptions={{ padding: 0.22 }}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "orthogonal", interactionWidth: 20 }}
      nodesDraggable
      nodesConnectable={false}
      panOnScroll
      zoomOnPinch
      minZoom={0.18}
      maxZoom={1.6}
    >
      <Background gap={32} size={1} color={themeColors.gridLine} />
      <Controls
        showInteractive={false}
        position="bottom-left"
        className="!bg-surface/80 !backdrop-blur !shadow-none !border !border-outline-variant [&_button]:!w-8 [&_button]:!h-8 [&_button]:!border-b-outline-variant"
      >
        <ControlButton
          onClick={() => setMiniMapOpen((v) => !v)}
          title={miniMapOpen ? "Hide mini-map" : "Show mini-map"}
          aria-label="Toggle mini-map"
          data-testid="canvas-minimap-toggle"
          data-active={miniMapOpen ? "true" : "false"}
        >
          <span className="material-symbols-outlined text-[14px] leading-none">
            {miniMapOpen ? "map" : "map_search"}
          </span>
        </ControlButton>
        <ControlButton
          onClick={() => {
            void resetOverrides();
          }}
          title="Reset positions to auto layout"
          aria-label="Reset layout"
          data-testid="canvas-reset-layout"
        >
          <span className="material-symbols-outlined text-[14px] leading-none">
            grid_view
          </span>
        </ControlButton>
      </Controls>
      {contextMenu && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
        />
      )}
      {miniMapOpen && (
        <MiniMap
          data-testid="canvas-minimap"
          pannable
          zoomable
          position="bottom-right"
          maskColor={themeColors.miniMapMask}
          nodeStrokeColor={themeColors.miniMapStroke}
          nodeColor={(n) => {
            if (n.type === "boundary") return "transparent";
            return themeColors.miniMapNode;
          }}
          className="!border !border-outline-variant !rounded-none"
        />
      )}
      {layoutPending && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center flex flex-col items-center">
            <div className="w-6 h-6 border-2 border-schema-accent border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-on-surface-muted">Computing layout...</p>
          </div>
        </div>
      )}
      {isEmpty && !layoutPending && (
        <div
          data-testid="canvas-empty"
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="text-center pointer-events-auto flex flex-col items-center">
            <SchemaLogo className="w-10 h-10 opacity-30 mb-4" />
            <p className="text-sm text-neutral-300">
              No nodes at this depth
            </p>
            <p className="mt-2 text-xs text-neutral-500 leading-relaxed max-w-xs">
              Try a different depth level, or check that the repo has supported source files (TypeScript, Python, Go, Java, Ruby, Rust).
            </p>
          </div>
        </div>
      )}
    </ReactFlow>
    </div>
  );
}

function moduleGrid(nodes: Node[], membership: ClusterMembership, order: string[]): Node[] {
  const COLS = 4, PAD = 28, HEAD = 56, GAP_X = 24, GAP_Y = 18, BLOCK_GAP_X = 90, BLOCK_GAP_Y = 90;
  const w = Math.max(200, ...nodes.map((n) => (typeof n.width === "number" ? n.width : 220)));
  const h = Math.max(64, ...nodes.map((n) => (typeof n.height === "number" ? n.height : 72)));
  const byCluster = new Map<string, Node[]>();
  for (const n of nodes) {
    const c = membership.parentOf[n.id] ?? "cluster:misc";
    (byCluster.get(c) ?? byCluster.set(c, []).get(c)!).push(n);
  }
  const clusters = [...order.filter((c) => byCluster.has(c)), ...[...byCluster.keys()].filter((c) => !order.includes(c))];
  const blockW = PAD * 2 + w * 2 + GAP_X;
  const heightOf = (c: string) => HEAD + Math.ceil((byCluster.get(c)?.length ?? 1) / 2) * (h + GAP_Y) - GAP_Y + PAD;
  const pos = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (let r = 0; r * COLS < clusters.length; r++) {
    const row = clusters.slice(r * COLS, r * COLS + COLS);
    const rowH = Math.max(...row.map(heightOf));
    row.forEach((c, ci) => {
      const x0 = ci * (blockW + BLOCK_GAP_X);
      (byCluster.get(c) ?? []).forEach((n, i) => {
        pos.set(n.id, { x: x0 + PAD + (i % 2) * (w + GAP_X), y: y + HEAD + Math.floor(i / 2) * (h + GAP_Y) });
      });
    });
    y += rowH + BLOCK_GAP_Y;
  }
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}

export default function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

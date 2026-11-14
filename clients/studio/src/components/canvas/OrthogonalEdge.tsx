"use client";

import { memo, useMemo } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";

interface BendPoint {
  x: number;
  y: number;
}

const CORNER_RADIUS = 10;

function buildPath(points: BendPoint[], radius: number): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  let d = `M ${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, dPrev / 2, dNext / 2);

    if (r < 1) {
      d += ` L ${curr.x},${curr.y}`;
      continue;
    }

    const ux1 = (curr.x - prev.x) / Math.max(dPrev, 0.01);
    const uy1 = (curr.y - prev.y) / Math.max(dPrev, 0.01);
    const ux2 = (next.x - curr.x) / Math.max(dNext, 0.01);
    const uy2 = (next.y - curr.y) / Math.max(dNext, 0.01);

    d += ` L ${curr.x - ux1 * r},${curr.y - uy1 * r}`;
    d += ` Q ${curr.x},${curr.y} ${curr.x + ux2 * r},${curr.y + uy2 * r}`;
  }

  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/**
 * L-shaped fallback when no ELK bend points are available.
 * Horizontal from source, vertical at midpoint, horizontal to target.
 */
function lShapePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  radius: number,
): string {
  const midX = (sx + tx) / 2;
  return buildPath(
    [
      { x: sx, y: sy },
      { x: midX, y: sy },
      { x: midX, y: ty },
      { x: tx, y: ty },
    ],
    radius,
  );
}

function OrthogonalEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
}: EdgeProps) {
  const d = data as Record<string, unknown> | undefined;
  const bendPoints = d?.bendPoints as BendPoint[] | undefined;
  const bundleOffset = (d?.bundleOffset as number) ?? 0;

  const path = useMemo(() => {
    let points: BendPoint[];
    if (bendPoints && bendPoints.length >= 2) {
      points = bendPoints;
    } else {
      const midX = (sourceX + targetX) / 2;
      points = [
        { x: sourceX, y: sourceY },
        { x: midX, y: sourceY },
        { x: midX, y: targetY },
        { x: targetX, y: targetY },
      ];
    }

    if (bundleOffset !== 0) {
      points = points.map((p) => ({ x: p.x, y: p.y + bundleOffset }));
    }

    return buildPath(points, CORNER_RADIUS);
  }, [bendPoints, sourceX, sourceY, targetX, targetY, bundleOffset]);

  return (
    <>
    <path
      d={path} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke", cursor: "help" }}
      onMouseEnter={(e) => window.dispatchEvent(new CustomEvent("schema:edge-hover", { detail: { source, target, x: e.clientX, y: e.clientY } }))}
      onMouseMove={(e) => window.dispatchEvent(new CustomEvent("schema:edge-hover", { detail: { source, target, x: e.clientX, y: e.clientY } }))}
      onMouseLeave={() => window.dispatchEvent(new CustomEvent("schema:edge-hover", { detail: null }))}
    />
    <BaseEdge
      path={path}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      interactionWidth={interactionWidth ?? 20}
    />
    </>
  );
}

export default memo(OrthogonalEdge);

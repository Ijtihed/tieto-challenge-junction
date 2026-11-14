// Deterministic force layout for the curated repo map, plus module outlines.
// Runs server-side so the live map and the PR snapshots share one geometry.
import type { MapEdge, MapNode } from "./repomap.ts";

export interface Placed { x: number; y: number; r: number }
export interface GroupShape { id: string; path: string; labelX: number; labelY: number; cx: number; cy: number }
export interface MapGeometry { width: number; height: number; nodes: Record<string, Placed>; groups: GroupShape[] }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function radiusOf(n: MapNode): number {
  if (n.bucket) return 12 + Math.sqrt(n.count ?? 0) * 1.9;
  return 7 + Math.log2(n.usedBy + 1) * 3.1 + Math.min(4, n.members / 20);
}

function hull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof p = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  const upper: typeof p = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Closed Catmull-Rom spline through the points, as an SVG path. */
function smoothClosed(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  const at = (i: number) => pts[(i + n) % n]!;
  let d = `M${at(0).x.toFixed(1)},${at(0).y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d + "Z";
}

export function computeGeometry(nodes: MapNode[], edges: MapEdge[], groupOrder: string[]): MapGeometry {
  const rand = rng(2283);
  const G = groupOrder.length;
  const anchor = new Map(groupOrder.map((g, i) => {
    const a = (i / G) * Math.PI * 2 - Math.PI / 2;
    return [g, { x: Math.cos(a) * 820, y: Math.sin(a) * 560 }] as const;
  }));
  const idx = new Map(nodes.map((n, i) => [n.id, i] as const));
  const P = nodes.map((n) => {
    const a = anchor.get(n.group) ?? { x: 0, y: 0 };
    return { x: a.x + (rand() - 0.5) * 140, y: a.y + (rand() - 0.5) * 140, vx: 0, vy: 0, r: radiusOf(n), g: n.group };
  });
  const E = edges.map((e) => ({ a: idx.get(e.source)!, b: idx.get(e.target)!, w: Math.log2(e.weight + 1) })).filter((e) => e.a !== undefined && e.b !== undefined);

  const ITER = 700;
  for (let it = 0; it < ITER; it++) {
    const cool = 1 - it / ITER;
    // Repulsion (n ~ 90, so O(n^2) is fine).
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const a = P[i]!, b = P[j]!;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = 1; }
        const d = Math.sqrt(d2);
        const other = a.g !== b.g;
        const minD = a.r + b.r + (other ? 70 : 30);
        const f = (other ? 7000 : 2600) / d2 + (d < minD ? (minD - d) * 0.7 : 0);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    // Connections pull, stronger for heavier links.
    for (const e of E) {
      const a = P[e.a]!, b = P[e.b]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = a.r + b.r + 70;
      const f = (d - rest) * 0.004 * (0.6 + e.w * 0.25) * (a.g === b.g ? 1 : 0.35);
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    // Module cohesion toward the module's current centroid, and a soft pull to its anchor.
    const cent = new Map<string, { x: number; y: number; n: number }>();
    nodes.forEach((n, i) => { const c = cent.get(n.group) ?? { x: 0, y: 0, n: 0 }; c.x += P[i]!.x; c.y += P[i]!.y; c.n++; cent.set(n.group, c); });
    nodes.forEach((n, i) => {
      const c = cent.get(n.group)!; const p = P[i]!; const a = anchor.get(n.group)!;
      p.vx += (c.x / c.n - p.x) * 0.03 + (a.x - p.x) * 0.004;
      p.vy += (c.y / c.n - p.y) * 0.03 + (a.y - p.y) * 0.004;
    });
    for (const p of P) {
      const step = 0.85 * cool + 0.05;
      p.x += Math.max(-30, Math.min(30, p.vx * step));
      p.y += Math.max(-30, Math.min(30, p.vy * step));
      p.vx *= 0.55; p.vy *= 0.55;
    }
  }

  const margin = 110;
  const minX = Math.min(...P.map((p) => p.x - p.r)) - margin;
  const minY = Math.min(...P.map((p) => p.y - p.r)) - margin;
  const maxX = Math.max(...P.map((p) => p.x + p.r)) + margin;
  const maxY = Math.max(...P.map((p) => p.y + p.r)) + margin;
  const placed: Record<string, Placed> = {};
  nodes.forEach((n, i) => { placed[n.id] = { x: P[i]!.x - minX, y: P[i]!.y - minY, r: P[i]!.r }; });

  const groups: GroupShape[] = groupOrder.map((g) => {
    const members = nodes.filter((n) => n.group === g).map((n) => placed[n.id]!);
    const ring: { x: number; y: number }[] = [];
    for (const m of members) for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2; const pad = m.r + 30;
      ring.push({ x: m.x + Math.cos(a) * pad, y: m.y + Math.sin(a) * pad });
    }
    const h = hull(ring);
    const cx = members.reduce((s, m) => s + m.x, 0) / Math.max(1, members.length);
    const cy = members.reduce((s, m) => s + m.y, 0) / Math.max(1, members.length);
    const top = Math.min(...h.map((p) => p.y));
    return { id: g, path: smoothClosed(h), labelX: cx, labelY: top - 12, cx, cy };
  });

  return { width: maxX - minX, height: maxY - minY, nodes: placed, groups };
}

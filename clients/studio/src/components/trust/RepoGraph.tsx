"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RepoMap } from "@/state/trust";

export type ActKind = "read" | "search" | "edit" | "command" | "result";
// Looking is neutral; only a change gets the agent's accent.
export const ACT_COLOR: Record<ActKind, string> = { read: "#B9B9C0", search: "#B9B9C0", edit: "#D97757", command: "#B9B9C0", result: "#F5F5F7" };

export interface GraphMarks {
  touched?: Map<string, ActKind>;
  edited?: Set<string>;
  changed?: Set<string>;
  flagged?: Set<string>;
  added?: Set<string>;
  lines?: Map<string, number>;
  current?: { node: string; kind: ActKind } | null;
  trail?: { node: string; kind: ActKind }[];
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }, bend = 0.18): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  return `M${a.x},${a.y} Q${mx - dy * bend},${my + dx * bend} ${b.x},${b.y}`;
}

/** Force-directed repo graph: modules are density blobs, node size is how much the type is used. */
export default function RepoGraph({ map, marks, compact = false }: { map: RepoMap; marks: GraphMarks; compact?: boolean }) {
  const geo = map.geometry;
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const color = useMemo(() => new Map(map.groups.map((g) => [g.id, g.color])), [map]);
  const group = useMemo(() => new Map(map.groups.map((g) => [g.id, g])), [map]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of map.edges) {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return m;
  }, [map]);
  const maxW = useMemo(() => Math.max(1, ...map.edges.map((e) => e.weight)), [map]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / geo.width, (r.height - (compact ? 0 : 90)) / geo.height) * 0.96;
      setView({ k, x: (r.width - geo.width * k) / 2, y: Math.max(8, (r.height - (compact ? 0 : 90) - geo.height * k) / 2) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [geo, compact]);

  const pos = geo.nodes;
  // Greedy label placement: biggest nodes first, skip labels that would overlap.
  const labelled = useMemo(() => {
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const out = new Set<string>();
    const order = [...map.nodes].filter((n) => !n.bucket).sort((a, b) => (pos[b.id]?.r ?? 0) - (pos[a.id]?.r ?? 0));
    for (const n of order) {
      const p = pos[n.id]!;
      const fs = p.r >= 16 ? 13 : 11.5;
      const box = { x1: p.x + p.r + 4, y1: p.y - fs * 0.8, x2: p.x + p.r + 8 + n.label.length * fs * 0.62, y2: p.y + fs * 0.5 };
      const hitsNode = map.nodes.some((m) => { const q = pos[m.id]!; return m.id !== n.id && q.x + q.r > box.x1 && q.x - q.r < box.x2 && q.y + q.r > box.y1 && q.y - q.r < box.y2; });
      if (hitsNode || placed.some((b) => b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1)) continue;
      placed.push(box); out.add(n.id);
    }
    return out;
  }, [map, pos]);
  const near = hover ? new Set([hover, ...(neighbours.get(hover) ?? [])]) : null;
  const activeGroups = new Set((marks.trail ?? []).slice(-3).map((t) => map.nodes.find((n) => n.id === t.node)?.group));
  const cur = marks.current ? pos[marks.current.node] : null;
  const hoverNode = hover ? map.nodes.find((n) => n.id === hover) : null;

  return (
    <div
      ref={wrap}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: "#0c0c0f", cursor: drag.current ? "grabbing" : "grab" }}
      onWheel={(e) => {
        const r = wrap.current!.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
      }}
      onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
      onMouseMove={(e) => { if (drag.current) setView({ ...view, x: drag.current.vx + e.clientX - drag.current.x, y: drag.current.vy + e.clientY - drag.current.y }); }}
      onMouseUp={() => { drag.current = null; }}
      onMouseLeave={() => { drag.current = null; }}
    >
      <style>{`
        @keyframes rg-pulse { 0% { opacity: .95; r: var(--r0); } 100% { opacity: 0; r: var(--r1); } }
        @keyframes rg-dash { to { stroke-dashoffset: -24; } }
        .rg-flow { animation: rg-dash .5s linear infinite; }
      `}</style>
      <svg width="100%" height="100%">
        <defs>
          {map.groups.map((g) => (
            <radialGradient key={g.id} id={`rg-d-${g.id}`}>
              <stop offset="0%" stopColor={g.color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={g.color} stopOpacity="0" />
            </radialGradient>
          ))}
          <radialGradient id="rg-edit"><stop offset="0%" stopColor="#f59e0b" stopOpacity=".55" /><stop offset="100%" stopColor="#f59e0b" stopOpacity="0" /></radialGradient>
          <radialGradient id="rg-flag"><stop offset="0%" stopColor="#ef4444" stopOpacity=".55" /><stop offset="100%" stopColor="#ef4444" stopOpacity="0" /></radialGradient>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* density: every node contributes a soft glow, so busy regions read as brighter */}
          {map.nodes.map((n) => { const p = pos[n.id]!; return <circle key={`d${n.id}`} cx={p.x} cy={p.y} r={p.r * 5.2} fill={`url(#rg-d-${n.group})`} />; })}

          {geo.groups.map((s) => {
            const g = group.get(s.id)!;
            const hot = activeGroups.has(s.id);
            return <path key={`h${s.id}`} d={s.path} fill={alpha(g.color, hot ? 0.09 : 0.035)} stroke={alpha(g.color, hot ? 0.6 : 0.22)} strokeWidth={hot ? 2 : 1.2} style={{ transition: "all 200ms" }} />;
          })}

          {map.edges.map((e, i) => {
            const a = pos[e.source], b = pos[e.target];
            if (!a || !b) return null;
            const hl = !!hover && (e.source === hover || e.target === hover);
            const w = 0.6 + (Math.log2(e.weight + 1) / Math.log2(maxW + 1)) * 2.6;
            return <path key={i} d={curve(a, b)} fill="none" stroke={hl ? "#f4f4f5" : "#a1a1aa"} strokeOpacity={hl ? 0.9 : hover ? 0.03 : 0.12} strokeWidth={hl ? w + 0.8 : w} strokeLinecap="round" />;
          })}

          {(marks.trail ?? []).slice(1).map((t, i) => {
            const prev = marks.trail![i]!;
            const a = pos[prev.node], b = pos[t.node];
            if (!a || !b || prev.node === t.node) return null;
            return <path key={`t${i}`} d={curve(a, b, 0.25)} fill="none" stroke={ACT_COLOR[t.kind]} strokeOpacity={0.3 + (0.7 * (i + 1)) / marks.trail!.length} strokeWidth={2.6} strokeDasharray="7 6" className="rg-flow" />;
          })}

          {geo.groups.map((s) => {
            const g = group.get(s.id)!;
            return (
              <g key={`l${s.id}`} transform={`translate(${s.labelX},${s.labelY})`} style={{ pointerEvents: "none" }}>
                <text textAnchor="middle" fill={g.color} fontSize="15" fontWeight="650" letterSpacing=".3">{g.name}</text>
                <text textAnchor="middle" y={15} fill="#71717a" fontSize="10.5">{g.types} types</text>
              </g>
            );
          })}

          {map.nodes.map((n) => {
            const p = pos[n.id]!;
            const c = color.get(n.group) ?? "#a1a1aa";
            const act = marks.touched?.get(n.id);
            const edited = marks.edited?.has(n.id) || marks.changed?.has(n.id);
            const flagged = marks.flagged?.has(n.id);
            const added = marks.added?.has(n.id);
            const dim = near ? !near.has(n.id) : false;
            const ring = flagged ? "#ef4444" : edited ? "#f59e0b" : act ? ACT_COLOR[act] : c;
            const showLabel = !n.bucket && (labelled.has(n.id) || hover === n.id || (!!marks.current && marks.current.node === n.id) || (!!edited && !near));
            const lines = marks.lines?.get(n.id);
            return (
              <g key={n.id} opacity={dim ? 0.18 : 1} style={{ transition: "opacity 150ms" }} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                {(edited || flagged) && <circle cx={p.x} cy={p.y} r={p.r * 3.4} fill={`url(#${flagged ? "rg-flag" : "rg-edit"})`} />}
                <circle cx={p.x} cy={p.y} r={p.r} fill={n.bucket ? alpha(c, 0.07) : edited ? "#3a2606" : "#141418"} stroke={ring} strokeWidth={act || edited || flagged ? 2.4 : n.bucket ? 1 : 1.6} strokeDasharray={n.bucket ? "3 3" : undefined} style={{ transition: "all 150ms" }} />
                {!n.bucket && <circle cx={p.x} cy={p.y} r={Math.max(2.2, p.r * 0.32)} fill={ring} opacity={0.9} />}
                {n.bucket && <text x={p.x} y={p.y + 4} textAnchor="middle" fill={alpha(c, 0.9)} fontSize="11" fontFamily="JetBrains Mono, monospace">+{n.count}</text>}
                {showLabel && (
                  <text x={p.x + p.r + 6} y={p.y + 4} fill={edited ? "#fde68a" : "#e4e4e7"} fontSize={p.r >= 16 ? 13 : 11.5} fontFamily="JetBrains Mono, monospace" style={{ paintOrder: "stroke", stroke: "#0c0c0f", strokeWidth: 3.5 }}>
                    {n.label}
                  </text>
                )}
                {lines ? <text x={p.x} y={p.y - p.r - 6} textAnchor="middle" fill="#fbbf24" fontSize="10.5" fontFamily="JetBrains Mono, monospace" style={{ paintOrder: "stroke", stroke: "#0c0c0f", strokeWidth: 3 }}>±{lines}</text> : null}
                {added ? <text x={p.x} y={p.y + p.r + 13} textAnchor="middle" fill="#4ade80" fontSize="9.5" fontWeight="800">NEW</text> : null}
              </g>
            );
          })}

          {cur && marks.current && (
            <g style={{ transform: `translate(${cur.x}px, ${cur.y}px)`, transition: "transform 220ms cubic-bezier(.2,.8,.2,1)" }}>
              <circle r={cur.r + 6} fill="none" stroke={ACT_COLOR[marks.current.kind]} strokeWidth={2.5} style={{ ["--r0" as string]: `${cur.r + 4}px`, ["--r1" as string]: `${cur.r + 26}px`, animation: "rg-pulse .9s ease-out infinite" } as React.CSSProperties} />
              <g transform={`translate(${cur.r * 0.75},${-cur.r - 14})`}>
                <rect x={-12} y={-12} width={24} height={24} rx={7} fill="#fafafa" />
                <text y={5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#18181b">C</text>
              </g>
            </g>
          )}
        </g>
      </svg>

      {hoverNode && !hoverNode.bucket && (
        <div className="absolute top-3 left-3 bg-surface-dim/95 border border-outline-variant px-3 py-2 text-xs pointer-events-none">
          <div className="font-[JetBrains_Mono] text-white">{hoverNode.label}</div>
          <div className="text-on-surface-muted mt-0.5">{group.get(hoverNode.group)?.name} · {hoverNode.kind} · used by {hoverNode.usedBy} · {hoverNode.members} members</div>
          <div className="text-on-surface-faint mt-0.5 font-[JetBrains_Mono]">{hoverNode.file}</div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useTrust } from "@/state/trust";

// Layered evidence graph: tests -> call path -> changed code. Edges point caller -> callee.
const COL: Record<string, number> = { test: 0, path: 1, caller: 1, changed: 2, flagged: 2 };
const W = 1200;
const NODE_W = 330;
const NODE_H = 34;
const GAP = 14;
const TOP = 64;

const ROLE_STYLE: Record<string, { fill: string; stroke: string; text: string; label: string }> = {
  test: { fill: "#0c2416", stroke: "#22c55e", text: "#bbf7d0", label: "test" },
  path: { fill: "#0b1a33", stroke: "#3b82f6", text: "#bfdbfe", label: "on a test path" },
  caller: { fill: "#1c1c1f", stroke: "#3f3f46", text: "#d4d4d8", label: "caller" },
  changed: { fill: "#2a1f06", stroke: "#eab308", text: "#fde68a", label: "changed" },
  flagged: { fill: "#2a0b0b", stroke: "#ef4444", text: "#fecaca", label: "flagged" },
};

export default function EvidenceView() {
  const graph = useTrust((s) => s.graph);
  const receipt = useTrust((s) => s.receipt);
  const selectMember = useTrust((s) => s.selectMember);
  const selectedKey = useTrust((s) => s.selectedKey);
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    if (!graph) return null;
    const cols: string[][] = [[], [], []];
    const byRole = [...graph.nodes].sort((a, b) =>
      (a.role === "flagged" ? 0 : 1) - (b.role === "flagged" ? 0 : 1) || a.label.localeCompare(b.label));
    for (const n of byRole) cols[COL[n.role] ?? 1]!.push(n.id);
    const rows = Math.max(1, ...cols.map((c) => c.length));
    const height = TOP + rows * (NODE_H + GAP) + 40;
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((col, ci) => {
      const x = 40 + ci * ((W - NODE_W - 80) / 2);
      const offset = TOP + ((rows - col.length) * (NODE_H + GAP)) / 2;
      col.forEach((id, ri) => pos.set(id, { x, y: offset + ri * (NODE_H + GAP) }));
    });
    return { pos, height, counts: cols.map((c) => c.length) };
  }, [graph]);

  if (!receipt) return null;
  if (!graph || !layout) return <div className="absolute inset-0 flex items-center justify-center text-xs text-on-surface-muted">Building evidence graph…</div>;

  const focus = hover ?? selectedKey;
  const near = new Set<string>();
  if (focus) {
    near.add(focus);
    for (const e of graph.edges) { if (e.source === focus) near.add(e.target); if (e.target === focus) near.add(e.source); }
  }
  const memberKeys = new Set(receipt.members.map((m) => m.key));

  return (
    <div className="absolute inset-0 overflow-auto">
      <svg viewBox={`0 0 ${W} ${layout.height}`} className="w-full min-w-[900px]" style={{ height: "auto" }}>
        <defs>
          <marker id="ev-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#52525b" />
          </marker>
          <marker id="ev-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#e4e4e7" />
          </marker>
        </defs>

        {(["Tests", "Call path and callers", "Changed code"] as const).map((t, i) => (
          <g key={t}>
            <text x={40 + i * ((W - NODE_W - 80) / 2)} y={30} fill="#a1a1aa" fontSize="12" letterSpacing="1.5" style={{ textTransform: "uppercase" }}>
              {t.toUpperCase()}
            </text>
            <text x={40 + i * ((W - NODE_W - 80) / 2)} y={47} fill="#52525b" fontSize="11">{layout.counts[i]} node{layout.counts[i] === 1 ? "" : "s"}</text>
          </g>
        ))}

        {graph.edges.map((e, i) => {
          const a = layout.pos.get(e.source); const b = layout.pos.get(e.target);
          if (!a || !b) return null;
          const hot = !!focus && (e.source === focus || e.target === focus);
          const sameCol = Math.abs(a.x - b.x) < 1;
          const d = sameCol
            ? `M${a.x + NODE_W},${a.y + NODE_H / 2} C${a.x + NODE_W + 50},${a.y + NODE_H / 2} ${b.x + NODE_W + 50},${b.y + NODE_H / 2} ${b.x + NODE_W},${b.y + NODE_H / 2}`
            : (() => {
                const [s, t] = a.x < b.x ? [a, b] : [b, a];
                const x1 = s.x + NODE_W; const y1 = s.y + NODE_H / 2; const x2 = t.x; const y2 = t.y + NODE_H / 2;
                const dx = (x2 - x1) * 0.5;
                return a.x < b.x
                  ? `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 2},${y2}`
                  : `M${x2},${y2} C${x2 - dx},${y2} ${x1 + dx},${y1} ${x1 + 2},${y1}`;
              })();
          return (
            <path key={i} d={d} fill="none"
              stroke={hot ? "#e4e4e7" : "#3f3f46"} strokeWidth={hot ? 1.8 : 1.1} strokeOpacity={focus && !hot ? 0.25 : 0.9}
              strokeDasharray={e.resolved ? undefined : "4 4"} markerEnd={`url(#${hot ? "ev-arrow-hot" : "ev-arrow"})`} />
          );
        })}

        {graph.nodes.map((n) => {
          const p = layout.pos.get(n.id); if (!p) return null;
          const st = ROLE_STYLE[n.role] ?? ROLE_STYLE.caller!;
          const dim = !!focus && !near.has(n.id);
          const sel = selectedKey === n.id;
          const max = n.publicApi ? 33 : 38;
          const label = n.label.length > max ? n.label.slice(0, max - 1) + "…" : n.label;
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: "pointer", opacity: dim ? 0.28 : 1, transition: "opacity 120ms" }}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
              onClick={() => { if (memberKeys.has(n.id)) selectMember(n.id); else useTrust.setState({ selectedKey: n.id }); }}>
              <rect width={NODE_W} height={NODE_H} rx={7} fill={st.fill} stroke={sel ? "#ffffff" : st.stroke} strokeWidth={sel ? 2 : 1.2} />
              <rect width={4} height={NODE_H} rx={2} fill={st.stroke} />
              <text x={14} y={21} fill={st.text} fontSize="12.5" fontFamily="JetBrains Mono, monospace">{label}</text>
              {n.publicApi && <text x={NODE_W - 10} y={21} textAnchor="end" fill="#fca5a5" fontSize="10" fontWeight="700">API</text>}
              <title>{n.id}{"\n"}{n.file}</title>
            </g>
          );
        })}
      </svg>
      <div className="sticky bottom-0 left-0 flex flex-wrap gap-4 px-6 py-3 text-[11px] text-on-surface-variant bg-surface/80 backdrop-blur border-t border-outline-variant/50">
        {Object.entries(ROLE_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: v.fill, border: `1px solid ${v.stroke}` }} />{v.label}</span>
        ))}
        <span className="flex items-center gap-1.5"><i className="inline-block w-5 border-t border-dashed border-neutral-500" />resolved by name only</span>
        <span className="ml-auto text-on-surface-faint">Hover to trace · click a changed member to see its diff</span>
      </div>
    </div>
  );
}

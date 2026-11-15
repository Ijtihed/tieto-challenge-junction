"use client";

import { useStore as useFlowStore } from "@xyflow/react";
import { TechLogoRow, detectTech, stripTechSuffix } from "./TechLogo";

export interface BoundaryData {
  label: string;
  color: string;
  count: number;
  width: number;
  height: number;
  dimmed?: boolean;
  canonicalShape?: string;
  entryPointCount?: number;
}

const SHAPE_ICONS: Record<string, string> = {
  service: "⬡",
  domain: "◆",
  library: "▣",
  mixed: "○",
};

const SHAPE_LABELS: Record<string, string> = {
  service: "Service",
  domain: "Domain",
  library: "Library",
  mixed: "Mixed",
};

export default function ClusterBoundary({ data }: { data: BoundaryData }) {
  const techs = detectTech(data.label);
  const cleanLabel = stripTechSuffix(data.label);
  const shape = data.canonicalShape ?? "mixed";
  const shapeIcon = SHAPE_ICONS[shape] ?? "○";
  const stars = Math.min(data.entryPointCount ?? 0, 3);
  // Quantised so panning and tiny zoom changes do not re-render every frame.
  const labelScale = useFlowStore((st) => Math.round(Math.min(4.4, Math.max(1, 0.95 / st.transform[2])) * 10) / 10);

  return (
    <div
      data-testid="cluster-boundary"
      style={{
        width: data.width,
        height: data.height,
        opacity: data.dimmed ? 0.4 : 1,
        filter: data.dimmed ? "saturate(0.2)" : undefined,
        transition: "opacity 400ms cubic-bezier(0.22,1,0.36,1), filter 400ms cubic-bezier(0.22,1,0.36,1)",
      }}
      className="relative pointer-events-none select-none"
    >
      {/* Outer glow */}
      <div
        className="absolute -inset-[1px]"
        style={{
          borderRadius: 22,
          background: `radial-gradient(ellipse at 50% 0%, ${data.color}14 0%, transparent 70%)`,
        }}
      />
      {/* Main boundary frame */}
      <div
        className="absolute inset-0"
        style={{
          border: `1px solid ${data.color}2E`,
          borderRadius: 22,
          background: `${data.color}08`,
        }}
      />
      {/* Top accent line */}
      <div
        className="absolute top-0 left-4 right-4"
        style={{
          height: 1,
          background: `linear-gradient(90deg, transparent, ${data.color}60, transparent)`,
        }}
      />

      {/* Caption above the frame. It counter-scales with zoom so module names stay readable in the overview. */}
      <div
        className="absolute left-1 bottom-full mb-2 flex items-center gap-2 pointer-events-auto whitespace-nowrap"
        style={{ zIndex: 10, transform: `scale(${labelScale})`, transformOrigin: "bottom left", transition: "transform 200ms cubic-bezier(0.22,1,0.36,1)" }}
      >
        {shape !== "mixed" && <span style={{ color: data.color, fontSize: 11 }}>{shapeIcon}</span>}
        <span className="text-[13px] font-semibold tracking-tight" style={{ color: data.color }}>
          {cleanLabel}
        </span>
        {techs.length > 0 && <TechLogoRow techs={techs} size={12} />}
        <span className="text-[12px] tabular-nums" style={{ color: "var(--color-on-surface-faint)" }}>
          {data.count}
        </span>
        {shape !== "mixed" && (
          <span className="text-[11px]" style={{ color: "var(--color-on-surface-muted)" }}>
            {SHAPE_LABELS[shape]}
          </span>
        )}
        {stars > 0 && (
          <span
            className="text-[11px] flex gap-px"
            style={{ color: "#FBBF24" }}
            title={`${data.entryPointCount} entry point${(data.entryPointCount ?? 0) > 1 ? "s" : ""}`}
          >
            {Array.from({ length: stars }, (_, i) => (
              <span key={i} style={{ opacity: 1 - i * 0.15 }}>★</span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

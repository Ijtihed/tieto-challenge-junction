"use client";

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

  return (
    <div
      data-testid="cluster-boundary"
      style={{
        width: data.width,
        height: data.height,
        opacity: data.dimmed ? 0.2 : 1,
        filter: data.dimmed ? "saturate(0) brightness(0.6)" : undefined,
        transition: "opacity 400ms cubic-bezier(0.22,1,0.36,1), filter 400ms cubic-bezier(0.22,1,0.36,1)",
      }}
      className="relative pointer-events-none select-none"
    >
      {/* Outer glow */}
      <div
        className="absolute -inset-[1px]"
        style={{
          borderRadius: 16,
          background: `radial-gradient(ellipse at 50% 0%, ${data.color}12 0%, transparent 70%)`,
        }}
      />
      {/* Main boundary frame */}
      <div
        className="absolute inset-0"
        style={{
          border: `1px solid ${data.color}40`,
          borderRadius: 16,
          background: `${data.color}06`,
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

      {/* Label pill */}
      <div
        className="absolute top-2 left-3 flex items-center gap-1.5 pointer-events-auto"
        style={{ zIndex: 10 }}
      >
        {/* Shape + name */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{
            background: `${data.color}0C`,
            border: `1px solid ${data.color}25`,
            backdropFilter: "blur(8px)",
          }}
        >
          <span style={{ color: data.color, fontSize: 11 }}>
            {shapeIcon}
          </span>
          <span
            className="text-[13px] font-semibold tracking-tight"
            style={{ color: data.color }}
          >
            {cleanLabel}
          </span>
          {techs.length > 0 && <TechLogoRow techs={techs} size={12} />}
        </div>

        {/* Node count */}
        <span
          className="text-[11px] px-2 py-0.5 rounded-md"
          style={{
            color: `${data.color}90`,
            background: `${data.color}08`,
            border: `1px solid ${data.color}15`,
          }}
        >
          {data.count}
        </span>

        {/* Shape badge */}
        {shape !== "mixed" && (
          <span
            className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-md"
            style={{
              color: `${data.color}B0`,
              background: `${data.color}0A`,
              border: `1px solid ${data.color}20`,
              letterSpacing: "0.08em",
            }}
          >
            {SHAPE_LABELS[shape]}
          </span>
        )}

        {/* Entry point stars */}
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

"use client";

import { Handle, Position } from "@xyflow/react";
import type { AggNode } from "@/lib/aggregate";
import type { NodeKind } from "@/lib/types";

interface EnglishNodeData {
  agg: AggNode;
  className: string;
  stripeColor?: string;
  sourceHandles?: number;
  targetHandles?: number;
}

const HANDLE_STYLE = {
  background: "transparent",
  border: "none",
  width: 2,
  height: 2,
  opacity: 0,
} as const;

function spreadHandles(type: "source" | "target", count: number) {
  const prefix = type === "source" ? "src" : "tgt";
  const pos = type === "source" ? Position.Right : Position.Left;
  const n = Math.max(count, 1);
  if (n === 1) {
    return <Handle id={`${prefix}-0`} type={type} position={pos} style={HANDLE_STYLE} />;
  }
  return Array.from({ length: n }, (_, i) => {
    const frac = 0.15 + (i / (n - 1)) * 0.7;
    return (
      <Handle
        key={`${prefix}-${i}`}
        id={`${prefix}-${i}`}
        type={type}
        position={pos}
        style={{ ...HANDLE_STYLE, top: `${frac * 100}%` }}
      />
    );
  });
}

const RESPONSIBILITY_COLOR: Record<NodeKind, string> = {
  route_handler: "var(--color-kind-route)",
  middleware: "var(--color-kind-middleware)",
  service: "var(--color-kind-service)",
  data_access: "var(--color-kind-data)",
  model: "var(--color-kind-model)",
  external: "var(--color-kind-external)",
  utility: "var(--color-kind-utility)",
};

export default function EnglishNode({ data }: { data: EnglishNodeData }) {
  const { agg, className, stripeColor, sourceHandles = 1, targetHandles = 1 } = data;
  const color = stripeColor ?? RESPONSIBILITY_COLOR[agg.dominantKind] ?? "#94a3b8";
  const count = agg.childIds.length;

  return (
    <div
      className={`schema-node w-[360px] flex flex-col ${className}`}
      style={{
        ["--node-stripe" as string]: color,
        background: "var(--schema-node-bg)",
      }}
    >
      {spreadHandles("target", targetHandles)}

      <div className="px-5 pt-4 pb-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: color, boxShadow: `0 0 6px ${color}66` }}
          />
          <span className="text-[0.95rem] font-semibold text-white tracking-tight">
            {agg.label}
          </span>
          <span
            className="ml-auto text-[0.65rem] font-medium uppercase tracking-wider opacity-60"
            style={{ color }}
          >
            {count}
          </span>
        </div>

        {agg.description && (
          <p className="text-[0.8rem] text-neutral-300 leading-[1.55] line-clamp-2 pl-5">
            {agg.description}
          </p>
        )}

        <span className="text-[0.68rem] text-neutral-500 pl-5">
          {count} {count === 1 ? "symbol" : "symbols"}
        </span>
      </div>

      {spreadHandles("source", sourceHandles)}
    </div>
  );
}

"use client";

import { Handle, Position } from "@xyflow/react";
import { KIND_META, HTTP_METHOD_COLOR } from "./nodeKindMeta";
import type { GraphNode, NodeKind } from "@/lib/types";
import type { AggNode as AggNodeT } from "@/lib/aggregate";
import { TechLogoRow, detectTech, stripTechSuffix } from "./TechLogo";

interface NodeData {
  agg: AggNodeT;
  inner?: GraphNode;
  className: string;
  stripeColor?: string;
  sourceHandles?: number;
  targetHandles?: number;
}

const HANDLE_STYLE = { background: "transparent", border: "none", opacity: 0 } as const;

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

const KIND_HEX: Record<NodeKind, string> = {
  route_handler: "var(--color-kind-route)",
  middleware: "var(--color-kind-middleware)",
  service: "var(--color-kind-service)",
  data_access: "var(--color-kind-data)",
  model: "var(--color-kind-model)",
  external: "var(--color-kind-external)",
  utility: "var(--color-kind-utility)",
};

const HTTP_METHOD_HEX: Record<string, string> = {
  GET: "var(--color-kind-data)",
  POST: "var(--color-kind-route)",
  PUT: "var(--color-kind-service)",
  PATCH: "var(--color-kind-service)",
  DELETE: "var(--color-kind-model)",
  PAGE: "var(--color-kind-utility)",
};

export default function AggNode({ data }: { data: NodeData }) {
  const { agg, inner, className, stripeColor, sourceHandles = 1, targetHandles = 1 } = data;

  // Cluster (L1) variant
  if (agg.kind === "cluster") {
    const color = stripeColor ?? KIND_HEX[agg.dominantKind];
    const count = agg.childIds.length;
    const techs = detectTech(agg.label);
    const cleanLabel = stripTechSuffix(agg.label);
    return (
      <div
        className={`schema-node w-[300px] flex flex-col pl-6 ${className}`}
        style={{
          ["--node-stripe" as string]: color,
          background: "var(--schema-node-bg)",
        }}
      >
        {spreadHandles("target", targetHandles)}
        <div className="px-4 pt-4 pb-4 flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[0.95rem] font-semibold text-white tracking-tight">{cleanLabel}</span>
            {techs.length > 0 && <TechLogoRow techs={techs} size={13} />}
            <span className="ml-auto text-[0.65rem] font-medium uppercase tracking-wider opacity-60" style={{ color }}>{count}</span>
          </div>
          {agg.description && (
            <p className="text-[0.8rem] text-neutral-300 leading-[1.55] line-clamp-2 pl-[18px]">
              {agg.description}
            </p>
          )}
          <span className="text-[0.68rem] text-neutral-500 pl-[18px]">{count} {count === 1 ? "symbol" : "symbols"}</span>
        </div>
        {spreadHandles("source", sourceHandles)}
      </div>
    );
  }

  // Module (L2) — when no inner node provided
  if (agg.kind === "module" && !inner) {
    const color = stripeColor ?? KIND_HEX[agg.dominantKind];
    const meta = (KIND_META[agg.dominantKind] ?? KIND_META.utility!);
    return (
      <div
        className={`schema-node px-4 py-3 w-[260px] pl-5 ${className}`}
        style={{ ["--node-stripe" as string]: color }}
      >
        {spreadHandles("target", targetHandles)}
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-sm text-white truncate">
            {agg.label}
          </span>
          <span
            className={`text-xs shrink-0 ${meta.color}`}
          >
            {meta.label}
          </span>
        </div>
        <p className="font-[JetBrains_Mono] text-xs text-neutral-400 truncate">
          {agg.sub}
        </p>
        {spreadHandles("source", sourceHandles)}
      </div>
    );
  }

  // Detail (L3) — function or route node
  if (inner) {
    const isRoute = inner.kind === "route_handler" && !!inner.meta?.httpMethod;
    if (isRoute) {
      const method = inner.meta?.httpMethod ?? "GET";
      const path = inner.meta?.httpPath ?? "/";
      const methodColor = HTTP_METHOD_COLOR[method] ?? "text-on-surface-variant";
      const stripe = HTTP_METHOD_HEX[method] ?? KIND_HEX.route_handler;
      return (
        <div
          className={`schema-node px-4 py-3 w-[240px] pl-5 ${className}`}
          style={{ ["--node-stripe" as string]: stripe }}
        >
          {spreadHandles("target", targetHandles)}
          <div className="flex items-baseline gap-2.5">
            <span
              className={`font-[JetBrains_Mono] text-xs font-semibold uppercase tracking-[0.15em] ${methodColor}`}
            >
              {method}
            </span>
            <span className="font-[JetBrains_Mono] text-sm text-white truncate">
              {path}
            </span>
          </div>
          <p className="font-[JetBrains_Mono] text-xs text-neutral-400 truncate mt-1">
            {inner.file}
          </p>
          {spreadHandles("source", sourceHandles)}
        </div>
      );
    }
    const km = (KIND_META[inner.kind] ?? KIND_META.utility!);
    const stripe = KIND_HEX[inner.kind];
    return (
    <div
      className={`schema-node px-4 py-3 w-[240px] pl-5 ${className}`}
      style={{ ["--node-stripe" as string]: stripe }}
    >
      {spreadHandles("target", targetHandles)}
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-[JetBrains_Mono] text-sm text-white truncate">
          {inner.name}
        </span>
        <span
          className={`text-xs font-semibold shrink-0 ${km.color}`}
        >
          {km.label}
        </span>
      </div>
      <p className="font-[JetBrains_Mono] text-xs text-neutral-400 truncate mt-1">
        {inner.file}
      </p>
      {spreadHandles("source", sourceHandles)}
    </div>
    );
  }

  return null;
}

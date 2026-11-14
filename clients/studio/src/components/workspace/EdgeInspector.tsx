"use client";

import { useStore } from "@/state/store";
import { KIND_META } from "@/components/canvas/nodeKindMeta";
import type { EdgeRelation, GraphNode } from "@/lib/types";

const RELATION_COLOR: Record<EdgeRelation, string> = {
  imports: "text-on-surface-muted",
  calls: "text-on-surface-variant",
  registers_route: "text-kind-route",
  applies_middleware: "text-kind-middleware",
  data_flow: "text-kind-data",
  control_flow: "text-on-surface-muted",
  rest_contract: "text-kind-route",
  grpc_contract: "text-kind-middleware",
  sql_contract: "text-kind-data",
  reads_field: "text-kind-service",
  writes_field: "text-kind-model",
};

const RELATION_ICON: Record<EdgeRelation, string> = {
  imports: "inventory_2",
  calls: "call_made",
  registers_route: "alt_route",
  applies_middleware: "shield",
  data_flow: "swap_horiz",
  control_flow: "device_hub",
  rest_contract: "http",
  grpc_contract: "cable",
  sql_contract: "storage",
  reads_field: "visibility",
  writes_field: "edit",
};

interface ResolvedEdge {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
}

function resolveEdges(
  graph: ReturnType<typeof useStore.getState>["workingGraph"],
  level: ReturnType<typeof useStore.getState>["level"],
  selectedId: string,
): { underlying: ResolvedEdge[]; isAggregated: boolean } {
  const direct = graph.edges.find((e) => e.id === selectedId);
  if (direct) {
    return {
      underlying: [{
        id: direct.id, source: direct.source,
        target: direct.target, relation: direct.relation,
      }],
      isAggregated: false,
    };
  }
  const parts = selectedId.split("::");
  if (parts.length !== 3) return { underlying: [], isAggregated: false };
  const [bucketSource, bucketTarget, relation] = parts;

  function bucketOf(nodeId: string): string {
    if (level === 3) return nodeId;
    if (level === 2) {
      const n = graph.nodes.find((x) => x.id === nodeId);
      return n ? `module:${n.file}` : nodeId;
    }
    const n = graph.nodes.find((x) => x.id === nodeId);
    return n?.cluster ?? "cluster:misc";
  }

  const matches = graph.edges.filter(
    (e) =>
      e.relation === relation &&
      bucketOf(e.source) === bucketSource &&
      bucketOf(e.target) === bucketTarget,
  );
  return {
    underlying: matches.map((m) => ({
      id: m.id, source: m.source, target: m.target, relation: m.relation,
    })),
    isAggregated: true,
  };
}

function nodeName(n: GraphNode): string {
  return n.meta?.httpPath
    ? `${n.meta.httpMethod} ${n.meta.httpPath}`
    : n.name;
}

/** Build a plain-English summary of what this edge means architecturally. */
function buildSummary(
  relation: EdgeRelation,
  sourceNode: GraphNode | undefined,
  targetNode: GraphNode | undefined,
  count: number,
  isAggregated: boolean,
): string {
  const src = sourceNode ? nodeName(sourceNode) : "unknown";
  const tgt = targetNode ? nodeName(targetNode) : "unknown";

  if (isAggregated && count > 1) {
    switch (relation) {
      case "calls":
        return `${count} call sites between these two — the source cluster/file depends on the target for business logic.`;
      case "registers_route":
        return `${count} HTTP routes are registered to handlers in the target. Each route dispatches to its own handler function.`;
      case "applies_middleware":
        return `${count} routes apply this middleware before their handler runs. The middleware runs on every matched request.`;
      case "imports":
        return `${count} import statements link these two modules.`;
    }
  }

  switch (relation) {
    case "calls":
      return `${src} calls ${tgt} at runtime. If ${tgt} changes its signature or behavior, ${src} is directly affected.`;
    case "registers_route":
      return `The HTTP endpoint ${src} dispatches to ${tgt}. Incoming requests matching this route execute the handler.`;
    case "applies_middleware":
      return `${tgt} runs before ${src}'s handler on every request. It can reject the request (e.g. 401) or enrich it (e.g. attach user context).`;
    case "imports":
      return `${src} imports ${tgt}. Changing ${tgt}'s exports may require updating ${src}.`;
    default:
      return `${src} → ${tgt} via ${(relation as string).replace(/_/g, " ")}.`;
  }
}

function NodeCard({
  node,
  label,
  onClick,
}: {
  node: GraphNode | undefined;
  label: string;
  onClick: () => void;
}) {
  if (!node) {
    return (
      <div className="px-4 py-3 border border-outline-variant/40 bg-neutral-900/30">
        <p className="text-xs text-on-surface-faint mb-1">{label}</p>
        <p className="text-xs text-on-surface-muted">(not in graph)</p>
      </div>
    );
  }
  const meta = (KIND_META[node.kind] ?? KIND_META.utility!);
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border border-outline-variant/40 hover:border-neutral-600 transition-colors group"
    >
      <div className="flex items-center gap-2 mb-1">
        <p className="text-xs text-on-surface-faint">{label}</p>
        <span className={`text-xs ${meta.color}`}>{meta.label}</span>
      </div>
      <p className="font-[JetBrains_Mono] text-sm text-white truncate group-hover:text-schema-accent transition-colors">
        {nodeName(node)}
      </p>
      <p className="font-[JetBrains_Mono] text-xs text-on-surface-muted truncate mt-0.5">
        {node.file}
      </p>
    </button>
  );
}

export default function EdgeInspector() {
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const workingGraph = useStore((s) => s.workingGraph);
  const level = useStore((s) => s.level);
  const selectNode = useStore((s) => s.selectNode);
  const selectEdge = useStore((s) => s.selectEdge);
  const focusOnIds = useStore((s) => s.focusOnIds);

  if (!selectedEdgeId) {
    return (
      <div className="p-6 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-3 inline-block">
          link
        </span>
        <p className="text-sm text-on-surface-variant">
          Select an edge on the canvas to inspect it.
        </p>
      </div>
    );
  }

  const { underlying, isAggregated } = resolveEdges(workingGraph, level, selectedEdgeId);
  if (underlying.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-xs text-on-surface-muted">
          Edge not found in current view
        </p>
        <button
          onClick={() => selectEdge(null)}
          className="mt-3 text-xs text-on-surface-faint hover:text-white transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  const relation = underlying[0].relation;
  const relColor = RELATION_COLOR[relation];
  const icon = RELATION_ICON[relation] ?? "link";
  const sourceNode = workingGraph.nodes.find((n) => n.id === underlying[0].source);
  const targetNode = workingGraph.nodes.find((n) => n.id === underlying[0].target);
  const summary = buildSummary(relation, sourceNode, targetNode, underlying.length, isAggregated);

  const allInvolvedIds = [
    ...new Set(underlying.flatMap((u) => [u.source, u.target])),
  ];

  return (
    <div className="p-5 space-y-5" data-testid="edge-inspector">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <span className={`material-symbols-outlined text-[20px] ${relColor}`}>{icon}</span>
          <h3 className="text-lg text-white">
            {relation.replace(/_/g, " ")}
          </h3>
          {isAggregated && (
            <span className="text-xs text-schema-accent px-2 py-0.5 border border-schema-accent/30">
              {underlying.length}×
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-300 leading-[1.6]">
          {summary}
        </p>
      </div>

      {/* Source → Target cards */}
      <div className="space-y-2">
        <NodeCard
          node={sourceNode}
          label="source"
          onClick={() => sourceNode && selectNode(sourceNode.id)}
        />
        <div className="flex items-center gap-2 px-4">
          <div className="flex-1 h-px bg-outline-variant" />
          <span className={`material-symbols-outlined text-[14px] ${relColor}`}>arrow_downward</span>
          <div className="flex-1 h-px bg-outline-variant" />
        </div>
        <NodeCard
          node={targetNode}
          label="target"
          onClick={() => targetNode && selectNode(targetNode.id)}
        />
      </div>

      {/* Aggregated breakdown */}
      {isAggregated && underlying.length > 1 && (
        <div>
          <p className="text-xs text-on-surface-muted mb-2">
            View all edges
          </p>
          <div className="space-y-1 max-h-[240px] overflow-y-auto">
            {underlying.map((u) => {
              const s = workingGraph.nodes.find((n) => n.id === u.source);
              const t = workingGraph.nodes.find((n) => n.id === u.target);
              return (
                <button
                  key={u.id}
                  onClick={() => {
                    focusOnIds([u.source, u.target]);
                  }}
                  className="w-full text-left px-3 py-2 border border-outline-variant/40 hover:border-neutral-600 transition-colors flex items-center gap-2"
                >
                  <span className="font-[JetBrains_Mono] text-xs text-neutral-300 truncate flex-1">
                    {s ? nodeName(s) : u.source.split(":").pop()}
                  </span>
                  <span className="text-on-surface-faint text-xs">→</span>
                  <span className="font-[JetBrains_Mono] text-xs text-neutral-300 truncate flex-1">
                    {t ? nodeName(t) : u.target.split(":").pop()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

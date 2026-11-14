"use client";

import { useMemo } from "react";
import { useStore } from "@/state/store";
import { KIND_META } from "@/components/canvas/nodeKindMeta";
import { APPLICABLE_OPS } from "@/lib/ops";

const OP_PROMPT: Record<string, (names: string[]) => string> = {
  addMiddleware: (names) =>
    `Apply requireAuth middleware to ${names.join(", ")}.`,
  addCaching: (names) =>
    `Memoize ${names.join(", ")} with a 60-second TTL cache.`,
  wrapTransformation: (names) =>
    `Wrap ${names.join(", ")} with telemetry.`,
  extractModule: (names) =>
    `Extract ${names.join(", ")} into separate files under src/domain/.`,
};

/**
 * Floats above the canvas when bulkSelection has 2+ nodes. Surfaces ops
 * that are applicable to ALL selected nodes (intersection of each kind's
 * APPLICABLE_OPS list). Single-prompt batching: one prompt that names
 * every selected node — the planner expands.
 */
export default function BulkActionToolbar() {
  const bulk = useStore((s) => s.bulkSelection);
  const workingGraph = useStore((s) => s.workingGraph);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const clearBulk = useStore((s) => s.clearBulk);

  const selectedNodes = useMemo(() => {
    return workingGraph.nodes.filter((n) => bulk.has(n.id));
  }, [bulk, workingGraph.nodes]);

  if (bulk.size < 2) return null;

  // Intersection of applicable ops across every selected node.
  const opSets = selectedNodes.map(
    (n) => new Set(APPLICABLE_OPS[n.kind] ?? []),
  );
  const commonOps = opSets.length === 0
    ? []
    : [...opSets[0]].filter((op) => opSets.every((s) => s.has(op)));

  // Kind breakdown for the chip line
  const kinds = new Map<string, number>();
  for (const n of selectedNodes) {
    kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1);
  }

  function applyOp(op: string) {
    const names = selectedNodes.map((n) => n.name);
    submitPrompt(OP_PROMPT[op]?.(names) ?? `Apply ${op} to ${names.join(", ")}.`);
    clearBulk();
  }

  return (
    <div
      data-testid="bulk-toolbar"
      className="absolute left-1/2 top-4 -translate-x-1/2 z-30 border border-outline bg-surface/95 backdrop-blur shadow-xl pointer-events-auto"
    >
      <div className="px-4 py-2.5 flex items-center gap-3">
        <span
          className="text-sm text-white"
          data-testid="bulk-count"
        >
          {bulk.size} selected
        </span>
        <span className="w-px h-4 bg-outline-variant" />
        <div className="flex items-center gap-2">
          {[...kinds.entries()].map(([kind, n]) => {
            const meta = KIND_META[kind as keyof typeof KIND_META];
            return (
              <span
                key={kind}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta.accent}`} />
                <span className={meta.color}>
                  {meta.label} · {n}
                </span>
              </span>
            );
          })}
        </div>
        <span className="w-px h-4 bg-outline-variant" />
        {commonOps.length === 0 ? (
          <span className="text-xs text-on-surface-faint">
            no ops apply to every selection
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {commonOps.map((op) => (
              <button
                key={op}
                onClick={() => applyOp(op)}
                data-testid={`bulk-${op}`}
                className="px-3 py-1.5 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors"
              >
                Apply {op}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={clearBulk}
          data-testid="bulk-clear"
          className="ml-2 w-7 h-7 flex items-center justify-center text-on-surface-faint hover:text-white transition-colors"
          aria-label="Clear bulk selection"
          title="Clear selection (esc)"
        >
          <span className="material-symbols-outlined text-[16px] leading-none">
            close
          </span>
        </button>
      </div>
    </div>
  );
}

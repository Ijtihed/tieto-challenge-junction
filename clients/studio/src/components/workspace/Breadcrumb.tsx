"use client";

// Per `research/25-95-percent-and-leveling.md` §6.4 + Step 3 of the
// launch plan. The breadcrumb shows the level WORD the user thinks
// in (`area`, `file`, `symbol`) — never the internal id
// (`cluster:`, `module:`, `node:`). The L1 word is archetype-aware
// (`service`, `module`, `command`, …) and reads from the store's
// `workspaceArchetype.primary`.

import { useMemo } from "react";
import { useStore } from "@/state/store";
import { filterByDrill } from "@/lib/aggregate";
import { archetypeL1Label } from "@/lib/archetype";

export default function Breadcrumb() {
  const drillPath = useStore((s) => s.drillPath);
  const popToSegment = useStore((s) => s.popToSegment);
  const workingGraph = useStore((s) => s.workingGraph);
  const archetype = useStore((s) => s.workspaceArchetype);

  const deepest = drillPath[drillPath.length - 1];
  const kindLabel = useMemo(() => {
    if (!deepest) return "";
    if (deepest.id.startsWith("cluster:")) {
      // Use the singular form of the archetype L1 label, lowercased.
      // "Services" → "service", "Modules" → "module", etc. Plain
      // "Areas" stays singular as "area" (the fallback).
      const l1Plural = archetypeL1Label(archetype?.primary);
      const singular = l1Plural.endsWith("s") ? l1Plural.slice(0, -1) : l1Plural;
      return singular.toLowerCase();
    }
    if (deepest.id.startsWith("module:")) return "file";
    return "symbol";
  }, [deepest, archetype]);

  const surviving = useMemo(() => {
    if (drillPath.length === 0) return 0;
    return filterByDrill(workingGraph, drillPath).nodes.length;
  }, [drillPath, workingGraph]);

  if (drillPath.length === 0) return null;

  return (
    <nav
      aria-label="Drill path"
      data-testid="drill-banner"
      className="relative flex items-center gap-3 px-4 py-1.5 border-b border-outline-variant bg-surface-dim shrink-0 overflow-hidden"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs text-on-surface-muted shrink-0">
          Viewing {kindLabel}
        </span>

        <h2
          className="text-sm text-white truncate"
          data-testid="drill-banner-name"
        >
          {deepest.label}
        </h2>

        <span className="text-xs text-on-surface-faint shrink-0">
          · {surviving} node{surviving === 1 ? "" : "s"}
        </span>

        <span className="w-px h-3 bg-outline-variant mx-1.5" />

        <button
          onClick={() => popToSegment(-1)}
          className="text-xs text-neutral-300 hover:text-white transition-colors"
        >
          All
        </button>
        {drillPath.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-xs text-neutral-600">›</span>
            <button
              onClick={() => popToSegment(i)}
              className={`text-xs transition-colors ${
                i === drillPath.length - 1
                  ? "text-white"
                  : "text-neutral-300 hover:text-white"
              }`}
            >
              {seg.label}
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => popToSegment(-1)}
        data-testid="drill-exit"
        title="Back to overview"
        className="shrink-0 flex items-center justify-center w-7 h-7 border border-outline-variant hover:border-neutral-500 text-on-surface-muted hover:text-white transition-colors text-sm"
      >
        ×
      </button>
    </nav>
  );
}

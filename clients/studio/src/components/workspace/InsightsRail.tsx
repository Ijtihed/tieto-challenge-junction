"use client";

import { useStore } from "@/state/store";
import type { Insight } from "@/lib/types";

const SEVERITY: Record<string, { dot: string; label: string }> = {
  high: { dot: "bg-phase-fail", label: "text-phase-fail" },
  medium: { dot: "bg-phase-testing", label: "text-phase-testing" },
  low: { dot: "bg-phase-applying", label: "text-phase-applying" },
};

export default function InsightsRail() {
  const insights = useStore((s) => s.insights);
  const hoverInsight = useStore((s) => s.hoverInsight);
  const submitPrompt = useStore((s) => s.submitPrompt);

  function onApply(insight: Insight) {
    submitPrompt(insight.suggestedPrompt);
  }

  if (insights.length === 0) {
    return (
      <div className="text-center py-10 px-4">
        <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-3 inline-block">
          check_circle
        </span>
        <p className="text-sm text-neutral-300">No issues found</p>
        <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
          Your graph looks clean. Schema re-runs the insight pass after every plan, so anything that creeps in lands here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {insights.map((i, idx) => {
        const sev = SEVERITY[i.severity] ?? SEVERITY.low;
        return (
          <div
            key={i.id}
            data-tutorial={idx === 0 ? "insight-card" : undefined}
            data-testid={`insight-${i.id}`}
            onMouseEnter={() => hoverInsight(i)}
            onMouseLeave={() => hoverInsight(null)}
            className="border border-outline-variant hover:border-neutral-600 bg-surface-dim hover:bg-neutral-950 transition-colors p-4"
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
                <p className="text-sm text-white truncate">{i.title}</p>
              </div>
              <span
                className={`text-xs shrink-0 ${sev.label}`}
              >
                {i.severity}
              </span>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed mb-3">
              {i.rationale}
            </p>
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-outline-variant/60">
              <p className="text-xs text-neutral-500 leading-relaxed truncate flex-1">
                <span className="text-schema-accent mr-1">›</span>
                {i.suggestedPrompt}
              </p>
              <button
                onClick={() => onApply(i)}
                data-testid={`insight-apply-${i.id}`}
                className="text-xs text-schema-accent hover:text-white transition-colors shrink-0"
              >
                Fix
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

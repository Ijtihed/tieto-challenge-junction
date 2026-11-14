"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { mergeProblems, type Problem } from "@/lib/problems";

const SEVERITY: Record<string, { dot: string; label: string; chip: string }> = {
  high: { dot: "bg-phase-fail", label: "text-phase-fail", chip: "border-phase-fail/40 text-phase-fail" },
  medium: { dot: "bg-phase-testing", label: "text-phase-testing", chip: "border-phase-testing/40 text-phase-testing" },
  low: { dot: "bg-phase-applying", label: "text-phase-applying", chip: "border-phase-applying/40 text-phase-applying" },
};

const KIND_TAG: Record<Problem["kind"], { label: string; tw: string }> = {
  violation: { label: "rule", tw: "text-violation" },
  insight: { label: "insight", tw: "text-on-surface-muted" },
};

/**
 * Unified list of architectural "problems" — rule violations and
 * heuristic insights merged into a single severity-sorted feed.
 *
 *   Click an entry            → submitPrompt(problem.suggestedPrompt) — kicks off the fix flow
 *   Hover an entry            → hoverInsightTargets / hoverViolationTargets light up the canvas
 *   "fix" button (right edge) → same as click; explicit affordance
 *   "why?" toggle             → expands the rationale + target id list inline
 *
 * Replaces the old Insights + Rules side-panel tabs. Deleting two
 * panels in favour of one removes a navigation step + a concept users
 * would otherwise have to learn.
 */
export default function ProblemsRail() {
  const rules = useStore((s) => s.rules);
  const violations = useStore((s) => s.violations);
  const insights = useStore((s) => s.insights);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const hoverInsight = useStore((s) => s.hoverInsight);
  const hoverViolation = useStore((s) => s.hoverViolation);
  const focusOnIds = useStore((s) => s.focusOnIds);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const problems = useMemo(
    () => mergeProblems(rules, violations, insights),
    [rules, violations, insights],
  );

  if (problems.length === 0) {
    return (
      <div className="text-center py-10 px-4">
        <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-3 inline-block">
          check_circle
        </span>
        <p className="text-sm text-neutral-300">
          No problems found
        </p>
        <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
          Schema re-checks every rule + insight after every plan. Anything
          that creeps in lands here.
        </p>
      </div>
    );
  }

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  function onHover(p: Problem | null) {
    // Re-use the existing canvas-highlight machinery: violations dim the
    // graph in violation color, insights in their own. We pick whichever
    // matches the problem's kind so the visual style still tells them apart.
    if (!p) {
      hoverInsight(null);
      hoverViolation(null);
      return;
    }
    if (p.kind === "violation") {
      hoverViolation({ ruleId: p.ruleId ?? "", targetIds: p.targetIds, message: p.rationale, suggestedPrompt: p.suggestedPrompt });
    } else {
      hoverInsight({ id: p.id, title: p.title, rationale: p.rationale, severity: p.severity, targetIds: p.targetIds, suggestedPrompt: p.suggestedPrompt });
    }
  }

  function onApply(p: Problem) {
    submitPrompt(p.suggestedPrompt);
    onHover(null);
  }

  function onJump(p: Problem) {
    if (p.targetIds.length === 0) return;
    focusOnIds(p.targetIds);
  }

  return (
    <div className="space-y-3">
      {problems.map((p) => {
        const sev = SEVERITY[p.severity] ?? SEVERITY.low;
        const kindMeta = KIND_TAG[p.kind];
        const isOpen = expanded.has(p.id);
        return (
          <div
            key={p.id}
            data-testid={`problem-${p.id}`}
            data-kind={p.kind}
            data-severity={p.severity}
            onMouseEnter={() => onHover(p)}
            onMouseLeave={() => onHover(null)}
            className="border border-outline-variant hover:border-neutral-600 bg-surface-dim hover:bg-neutral-950 transition-colors"
          >
            <button
              type="button"
              onClick={() => onJump(p)}
              className="w-full text-left p-4 cursor-pointer focus:outline-none focus:ring-1 focus:ring-schema-accent"
              title={
                p.targetIds.length > 0
                  ? "Click to focus the canvas on the affected nodes"
                  : ""
              }
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
                  <p className="text-sm text-white truncate">
                    {p.title}
                  </p>
                </div>
                <span
                  className={`text-xs shrink-0 ${kindMeta.tw}`}
                >
                  {kindMeta.label}
                </span>
              </div>
              <p
                className={`text-sm leading-relaxed text-neutral-400 ${
                  isOpen ? "" : "line-clamp-2"
                }`}
              >
                {p.rationale}
              </p>
            </button>

            <div className="px-4 pb-3 flex items-center justify-between gap-2 border-t border-outline-variant/40 pt-2">
              <button
                type="button"
                onClick={() => toggle(p.id)}
                data-testid={`problem-why-${p.id}`}
                className="text-xs text-on-surface-muted hover:text-white transition-colors"
              >
                {isOpen ? "Less" : "Why?"}
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-on-surface-faint">
                  · {p.targetIds.length} {p.targetIds.length === 1 ? "node" : "nodes"}
                </span>
                <button
                  type="button"
                  onClick={() => onApply(p)}
                  data-testid={`problem-fix-${p.id}`}
                  className={`text-xs transition-colors ${sev.label} hover:text-white`}
                >
                  Fix
                </button>
              </div>
            </div>

            {isOpen && p.targetIds.length > 0 && (
              <ul className="px-4 pb-3 space-y-1">
                {p.targetIds.slice(0, 5).map((id) => (
                  <li
                    key={id}
                    className="font-[JetBrains_Mono] text-xs text-on-surface-muted truncate"
                  >
                    · {id}
                  </li>
                ))}
                {p.targetIds.length > 5 && (
                  <li className="font-[JetBrains_Mono] text-xs text-on-surface-faint">
                    +{p.targetIds.length - 5} more
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

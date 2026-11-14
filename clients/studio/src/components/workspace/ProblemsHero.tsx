"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { mergeProblems, summariseProblems } from "@/lib/problems";

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-phase-fail",
  medium: "bg-phase-testing",
  low: "bg-phase-applying",
};

export default function ProblemsHero() {
  const rules = useStore((s) => s.rules);
  const violations = useStore((s) => s.violations);
  const insights = useStore((s) => s.insights);
  const workingGraph = useStore((s) => s.workingGraph);
  const onboardingDismissed = useStore((s) => s.onboardingDismissed);
  const planPhase = useStore((s) => s.planPhase);
  const setSidePanelView = useStore((s) => s.setSidePanelView);
  const heroDismissedSig = useStore((s) => s.problemsHeroDismissedSig);
  const dismissHero = useStore((s) => s.dismissProblemsHero);
  const focusOnIds = useStore((s) => s.focusOnIds);
  const selectedNodeId = useStore((s) => s.selectedNodeId);

  const [expanded, setExpanded] = useState(false);

  const problems = useMemo(
    () => mergeProblems(rules, violations, insights),
    [rules, violations, insights],
  );
  const summary = useMemo(() => summariseProblems(problems), [problems]);

  const sig = `${workingGraph.rootDir}::${workingGraph.nodes.length}`;

  const visible =
    onboardingDismissed &&
    planPhase === "idle" &&
    summary.total > 0 &&
    heroDismissedSig !== sig;

  useEffect(() => {
    if (visible && selectedNodeId) dismissHero(sig);
  }, [visible, selectedNodeId, sig, dismissHero]);

  if (!visible) return null;

  function onReviewAll() {
    setSidePanelView("problems");
    dismissHero(sig);
  }

  function onJumpTo(targetIds: string[]) {
    if (targetIds.length > 0) focusOnIds(targetIds);
    setSidePanelView("problems");
    dismissHero(sig);
  }

  const top = problems.slice(0, 3);
  const remaining = summary.total - top.length;
  const severityLabel = summary.topSeverity ? summary.topSeverity.charAt(0).toUpperCase() + summary.topSeverity.slice(1) : "Low";

  return (
    <div
      data-testid="problems-hero"
      className="absolute top-4 right-4 z-30 w-[min(400px,calc(100vw-32px))] rounded-xl border border-outline-variant/60 bg-surface/95 backdrop-blur shadow-xl pointer-events-auto overflow-hidden"
    >
      {/* Collapsed header — always visible */}
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2.5 flex-1 text-left"
        >
          <span
            className={`material-symbols-outlined text-[16px] leading-none text-on-surface-faint transition-transform ${expanded ? "rotate-180" : ""}`}
            style={{ fontVariationSettings: "'wght' 200" }}
          >
            expand_more
          </span>
          <span className="text-xs text-on-surface-muted">{severityLabel} severity</span>
          <span className="text-sm text-white">{summary.total} {summary.total === 1 ? "issue" : "issues"} found</span>
        </button>
        <button
          onClick={() => dismissHero(sig)}
          data-testid="problems-hero-dismiss"
          className="w-6 h-6 flex items-center justify-center text-on-surface-faint hover:text-on-surface-variant transition-colors"
          title="Dismiss"
          aria-label="Dismiss"
        >
          <span className="material-symbols-outlined text-[16px] leading-none" style={{ fontVariationSettings: "'wght' 200" }}>close</span>
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <>
          <ul className="divide-y divide-outline-variant/30 border-t border-outline-variant/40">
            {top.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onJumpTo(p.targetIds)}
                  data-testid={`problems-hero-jump-${p.id}`}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-surface-container/50 transition-colors"
                >
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_DOT[p.severity] ?? SEVERITY_DOT.low}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{p.title}</p>
                    <p className="text-xs text-on-surface-muted leading-relaxed line-clamp-1 mt-0.5">{p.rationale}</p>
                  </div>
                  <span className="text-xs text-on-surface-faint shrink-0 self-center">
                    {p.targetIds.length} node{p.targetIds.length !== 1 ? "s" : ""} →
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 flex items-center justify-between gap-3 border-t border-outline-variant/40">
            <span className="text-xs text-on-surface-faint">
              {remaining > 0 ? `+${remaining} more` : `${summary.violations} violations · ${summary.insights} insights`}
            </span>
            <button
              onClick={onReviewAll}
              data-testid="problems-hero-review"
              className="px-3 py-1.5 rounded-lg bg-schema-accent/10 border border-schema-accent/30 text-schema-accent hover:bg-schema-accent/20 text-xs transition-colors"
            >
              Review all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

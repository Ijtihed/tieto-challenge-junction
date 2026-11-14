"use client";

import { useEffect, useState } from "react";
import { useTrust } from "@/state/trust";
import { callTool } from "@/mcp-client";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";
import type { Step, StepPhase } from "@/lib/types";
import ChangesView from "@/components/trust/ChangesView";

/**
 * Result of GET /api/git/probe. Mirrors the server-side shape but
 * declared here so we don't import server modules into the client
 * bundle.
 */
interface GitProbeView {
  available: boolean;
  schemaReady: boolean;
  reason?: string;
  currentBranch: string | null;
  headSha: string | null;
  isDirty: boolean;
  dirtyFiles: string[];
}

const PHASE_LABEL: Record<StepPhase, string> = {
  queued: "queued",
  applying: "applying",
  testing: "testing",
  verifying_intent: "verifying",
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
};

/** Compact token count: 1234 → "1.2k", 12345 → "12k", < 1000 stays raw. */
function compactTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const PHASE_COLOR: Record<StepPhase, string> = {
  queued: "text-on-surface-muted border-neutral-800",
  applying: "text-phase-applying border-phase-applying/40",
  testing: "text-phase-testing border-phase-testing/40",
  verifying_intent: "text-phase-verifying border-phase-verifying/40",
  passed: "text-phase-pass border-phase-pass/40",
  failed: "text-phase-fail border-phase-fail/40",
  skipped: "text-phase-skip border-phase-skip/40",
};

function StepLabel({ step, idx }: { step: Step; idx: number }) {
  const num = String(idx + 1).padStart(2, "0");
  if (step.kind === "op") {
    return (
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="text-xs text-on-surface-faint tabular-nums shrink-0">
          [{num}]
        </span>
        <span className="font-[JetBrains_Mono] text-sm text-schema-accent shrink-0">
          {step.opName}
        </span>
        <span className="text-sm text-neutral-200 truncate">
          {step.description}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <span className="text-xs text-on-surface-faint tabular-nums shrink-0">
        [{num}]
      </span>
      <span className="font-[JetBrains_Mono] text-sm text-kind-external shrink-0">
        freeform
      </span>
      <span className="text-sm text-neutral-200 truncate">
        {step.description} · {step.files.length} file(s)
      </span>
    </div>
  );
}

const TOOL_ICON: Record<string, string> = {
  "graph.search": "search",
  "graph.find_callers": "call_received",
  "graph.impact_score": "analytics",
  "rules.evaluate": "gavel",
  "graph.diff_against": "compare",
};

const TOOL_COLOR: Record<string, string> = {
  "graph.search": "text-kind-service",
  "graph.find_callers": "text-kind-route",
  "graph.impact_score": "text-kind-middleware",
  "rules.evaluate": "text-kind-data",
  "graph.diff_against": "text-kind-external",
};

function AgentReasoningStream() {
  const agentEvents = useStore((s) => s.agentEvents);
  const planPhase = useStore((s) => s.planPhase);
  const isComplete = agentEvents.some((e) => e.kind === "complete") || planPhase !== "streaming";

  if (agentEvents.length === 0) {
    return (
      <div className="py-6 text-center">
        <div className="inline-flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-phase-applying animate-pulse" />
          <span className="text-xs text-on-surface-muted">Reasoning...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {agentEvents.map((ev, i) => {
        if (ev.kind === "thinking") {
          return (
            <div key={i} className="flex items-start gap-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-phase-applying mt-1.5 shrink-0 animate-pulse" />
              <span className="text-xs text-on-surface-variant italic">{ev.text}</span>
            </div>
          );
        }
        if (ev.kind === "tool_call") {
          const icon = TOOL_ICON[ev.tool ?? ""] ?? "build";
          const color = TOOL_COLOR[ev.tool ?? ""] ?? "text-on-surface-variant";
          return (
            <div key={i} className="flex items-center gap-2 py-1 pl-1">
              <span className={`material-symbols-outlined text-[14px] ${color}`}>{icon}</span>
              <span className={`font-[JetBrains_Mono] text-xs ${color}`}>{ev.tool}</span>
              {ev.tokenCount && (
                <span className="text-[10px] text-on-surface-faint ml-auto">{ev.tokenCount} tok</span>
              )}
            </div>
          );
        }
        if (ev.kind === "tool_result") {
          const summary = ev.result && typeof ev.result === "object"
            ? Object.entries(ev.result as Record<string, unknown>)
                .slice(0, 3)
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`)
                .join(" · ")
            : "";
          return (
            <div key={i} className="pl-6 py-0.5">
              <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-muted">{summary}</span>
            </div>
          );
        }
        if (ev.kind === "metric") {
          return (
            <div key={i} className="flex items-center gap-2 py-1 pl-1 border-l-2 border-phase-pass/40 ml-1">
              <span className="text-xs text-phase-pass font-medium pl-2">{ev.metric?.label}:</span>
              <span className="font-[JetBrains_Mono] text-xs text-white">
                {ev.metric?.value}{ev.metric?.unit ? ` ${ev.metric.unit}` : ""}
              </span>
            </div>
          );
        }
        if (ev.kind === "complete") {
          return (
            <div key={i} className="flex items-center gap-2 py-2 pl-1 border-l-2 border-phase-pass ml-1">
              <span className="text-xs text-phase-pass font-medium pl-2">Analysis complete</span>
            </div>
          );
        }
        if (ev.kind === "error") {
          return (
            <div key={i} className="flex items-center gap-2 py-1 pl-1 border-l-2 border-phase-fail/40 ml-1">
              <span className="text-xs text-phase-fail pl-2">{ev.error}</span>
            </div>
          );
        }
        return null;
      })}
      {!isComplete && (
        <div className="flex items-center gap-2 pt-2">
          <span className="w-1.5 h-1.5 rounded-full bg-phase-applying animate-pulse" />
          <span className="text-[11px] text-on-surface-faint">streaming...</span>
        </div>
      )}
    </div>
  );
}

export default function PlanPanel() {
  const planPhase = useStore((s) => s.planPhase);
  const plan = useStore((s) => s.plan);
  const planPartial = useStore((s) => s.planPartial);
  const stepRuns = useStore((s) => s.stepRuns);
  const testOutputLive = useStore((s) => s.testOutputLive);
  const activeStepIndex = useStore((s) => s.activeStepIndex);
  const approvePlan = useStore((s) => s.approvePlan);
  const cancelPlan = useStore((s) => s.cancelPlan);
  const plannerSource = useStore((s) => s.plannerSource);
  const plannerUsedRealLLM = useStore((s) => s.plannerUsedRealLLM);
  const plannerFallbackReason = useStore((s) => s.plannerFallbackReason);
  const plannerUsage = useStore((s) => s.plannerUsage);
  const agentEvents = useStore((s) => s.agentEvents);
  const planError = useStore((s) => s.planError);

  if (planPhase === "idle" && !planError) return null;

  if (planPhase === "idle" && planError) {
    return (
      <aside className="w-[420px] shrink-0 border-l border-outline-variant bg-surface-dim flex flex-col">
        <div className="px-5 py-4 border-b border-outline-variant">
          <h2 className="text-base text-white">Plan</h2>
          <p className="text-xs text-phase-fail mt-1">Generation failed</p>
        </div>
        <div className="p-5">
          <div className="border border-phase-fail/30 bg-phase-fail/5 rounded p-4">
            <p className="text-xs text-phase-fail leading-relaxed">{planError}</p>
            <p className="text-xs text-on-surface-faint mt-3">
              Check that the MCP server is running and your API key is set in Settings.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const intent = plan?.intent ?? planPartial.intent ?? "";
  const steps: Step[] = plan?.steps ?? planPartial.steps ?? [];

  return (
    <aside
      data-testid="plan-panel"
      aria-label="Plan"
      className="w-[440px] shrink-0 border-l border-outline-variant bg-surface-dim backdrop-blur flex flex-col"
    >
      <div className="px-5 py-4 border-b border-outline-variant shrink-0">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h2 className="text-base text-white">Plan</h2>
          <div className="flex items-center gap-2">
            <span
              data-testid="planner-source-badge"
              title={
                plannerUsedRealLLM
                  ? `live planner · ${plannerSource}${
                      plannerUsage
                        ? ` · ${plannerUsage.inputTokens} in / ${plannerUsage.outputTokens} out · ${plannerUsage.model}`
                        : ""
                    }`
                  : plannerFallbackReason
                    ? `mock fallback · ${plannerFallbackReason}. Set GEMINI_API_KEY or ANTHROPIC_API_KEY to use a real LLM.`
                    : `mock planner · keyword matcher only. Set GEMINI_API_KEY or ANTHROPIC_API_KEY to enable the real planner.`
              }
              className={`font-[JetBrains_Mono] text-xs px-1.5 py-0.5 border ${
                plannerUsedRealLLM
                  ? "text-phase-pass border-phase-pass/40"
                  : "text-phase-testing border-phase-testing/40 bg-phase-testing/5"
              }`}
            >
              {plannerUsedRealLLM ? plannerSource : "mock · no model"}
            </span>
            {plannerUsedRealLLM && plannerUsage && (
              <span
                data-testid="planner-usage-badge"
                title={`${plannerUsage.totalTokens} total tokens (${plannerUsage.inputTokens} in / ${plannerUsage.outputTokens} out) · model: ${plannerUsage.model}`}
                className="text-xs text-on-surface-variant"
              >
                {compactTokens(plannerUsage.inputTokens)} in · {compactTokens(plannerUsage.outputTokens)} out
              </span>
            )}
            <span
              className={`text-xs ${
                planPhase === "streaming"
                  ? "text-phase-applying"
                  : planPhase === "preview"
                    ? "text-schema-accent"
                    : planPhase === "running"
                      ? "text-phase-testing"
                      : "text-phase-pass"
              }`}
            >
              {planPhase === "streaming"
                ? "streaming"
                : planPhase === "preview"
                  ? "preview"
                  : planPhase === "running"
                    ? "running"
                    : "done"}
            </span>
          </div>
        </div>
        <p
          className={`text-base text-white leading-relaxed ${
            planPhase === "streaming" ? "schema-cursor" : ""
          }`}
        >
          {intent || "Thinking..."}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {planPhase === "streaming" && (
          <div className="px-5 py-4 border-b border-outline-variant">
            <AgentReasoningStream />
          </div>
        )}
        {planPhase === "preview" && agentEvents.length > 0 && (
          <div className="px-5 py-3 border-b border-outline-variant">
            <details className="group">
              <summary className="text-xs text-on-surface-muted cursor-pointer select-none flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] group-open:rotate-90 transition-transform">chevron_right</span>
                Analysis ({agentEvents.length} events)
              </summary>
              <div className="mt-2">
                <AgentReasoningStream />
              </div>
            </details>
          </div>
        )}

        {steps.map((step, i) => {
          const run = stepRuns[i];
          const phase = run?.phase ?? "queued";
          const isActive = activeStepIndex === i;
          return (
            <div
              key={i}
              className={`px-5 py-4 border-b border-outline-variant/60 ${
                isActive ? "bg-surface-dim" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <StepLabel step={step} idx={i} />
                <span
                  className={`text-xs border px-2 py-0.5 shrink-0 ${PHASE_COLOR[phase]}`}
                >
                  {PHASE_LABEL[phase]}
                </span>
              </div>

              {step.kind === "op" && (
                <p className="text-xs text-neutral-500 leading-relaxed mb-2">
                  Target:{" "}
                  <span className="font-[JetBrains_Mono] text-neutral-400 break-all">{step.targetId}</span>
                </p>
              )}

              {run?.diff && (
                <pre className="mt-2 font-[JetBrains_Mono] text-xs leading-relaxed max-h-36 overflow-auto border border-outline-variant/60 bg-surface-dim p-3">
                  {run.diff
                    .split("\n")
                    .slice(0, 12)
                    .map((l, li) => (
                      <span
                        key={li}
                        className={
                          l.startsWith("+")
                            ? "text-phase-pass block"
                            : l.startsWith("-")
                              ? "text-phase-fail block"
                              : "text-neutral-500 block"
                        }
                      >
                        {l}
                      </span>
                    ))}
                </pre>
              )}

              {run?.intentCheck && (
                <p
                  className={`mt-2 text-xs leading-relaxed ${
                    run.intentCheck.matches ? "text-phase-pass" : "text-phase-fail"
                  }`}
                >
                  Intent: {run.intentCheck.reason}
                </p>
              )}

              {isActive &&
                (run?.phase === "testing" || run?.phase === "verifying_intent") &&
                testOutputLive && (
                  <div className="mt-2 border border-phase-testing/30 bg-surface-dim">
                    <CancelTestsHeader />
                    <pre className="font-[JetBrains_Mono] text-xs leading-relaxed text-neutral-400 max-h-44 overflow-auto p-3 m-0">
                      {testOutputLive}
                    </pre>
                  </div>
                )}

              {run?.error && (
                <p className="mt-2 text-xs text-phase-fail leading-relaxed">
                  ✗ {run.error}
                  {run.explanation && (
                    <span className="block text-neutral-500 mt-1">
                      → {run.explanation}
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}

        {plan?.notes && planPhase === "preview" && (
          <PlanNotesSection notesUri={plan.notes} />
        )}

        {planPhase === "done" && plan && (() => {
          const total = plan.steps.length;
          const runs = Object.values(stepRuns);
          const passed = runs.filter((r) => r.phase === "passed").length;
          const failed = runs.filter((r) => r.phase === "failed").length;
          const skipped = runs.filter((r) => r.phase === "skipped").length;
          const totalMs = runs
            .map((r) => r.durationMs ?? 0)
            .reduce((a, b) => a + b, 0);
          const allPassed = passed === total && failed === 0;
          return (
            <div
              data-testid="plan-summary"
              className={`px-5 py-5 border-b border-outline-variant/60 ${
                allPassed ? "bg-phase-pass/[0.04]" : "bg-phase-fail/[0.04]"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`material-symbols-outlined text-[20px] leading-none ${
                    allPassed ? "text-phase-pass" : "text-phase-fail"
                  }`}
                >
                  {allPassed ? "check_circle" : "error"}
                </span>
                <p
                  className={`text-sm ${
                    allPassed ? "text-phase-pass" : "text-phase-fail"
                  }`}
                >
                  {allPassed ? "Plan applied" : "Plan completed with rollbacks"}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-px bg-neutral-800/60 border border-outline-variant/60">
                <div className="bg-surface/40 px-3 py-2.5">
                  <p className="text-xs text-on-surface-muted">
                    passed
                  </p>
                  <p
                    className="text-base text-phase-pass mt-0.5 tabular-nums"
                    data-testid="summary-passed"
                  >
                    {passed} / {total}
                  </p>
                </div>
                <div className="bg-surface/40 px-3 py-2.5">
                  <p className="text-xs text-on-surface-muted">
                    rolled back
                  </p>
                  <p
                    className={`text-base mt-0.5 tabular-nums ${
                      failed + skipped > 0
                        ? "text-phase-fail"
                        : "text-on-surface-muted"
                    }`}
                  >
                    {failed + skipped}
                  </p>
                </div>
                <div className="bg-surface/40 px-3 py-2.5">
                  <p className="text-xs text-on-surface-muted">
                    duration
                  </p>
                  <p className="text-base text-on-surface mt-0.5 tabular-nums">
                    {(totalMs / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-on-surface-muted leading-relaxed">
                {allPassed
                  ? "The graph mutated as planned. Edges that landed are flashing green on the canvas."
                  : "Schema rolled the working graph back to the pre-plan snapshot. The step that failed is marked above."}
              </p>
            </div>
          );
        })()}
      </div>

      <div className="px-5 py-4 border-t border-outline-variant flex flex-col gap-2 shrink-0">
        {planPhase === "streaming" && (
          <button
            onClick={() => cancelPlan()}
            data-testid="plan-cancel-streaming"
            className="w-full px-3 py-2.5 border border-outline-variant text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
          >
            Cancel
          </button>
        )}
        {planPhase === "preview" && plan && plan.steps.length > 0 && (
          <>
            <PreApplyGitBanner />
            <PlanValidationBanner planId={plan.planId} />
            <div className="flex items-center gap-2">
              <button
                onClick={() => cancelPlan()}
                data-testid="plan-discard"
                className="flex-1 px-3 py-2.5 border border-outline-variant text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => approvePlan()}
                data-testid="plan-apply"
                className="flex-1 px-3 py-2.5 rounded-md border border-schema-accent/40 text-xs text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 transition-colors"
              >
                Apply
              </button>
            </div>
          </>
        )}
        {planPhase === "preview" && plan && plan.steps.length === 0 && (
          <button
            onClick={() => cancelPlan()}
            className="flex-1 px-3 py-2.5 border border-outline-variant text-xs text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors"
          >
            Close
          </button>
        )}
        {planPhase === "running" && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-phase-testing flex items-center gap-2">
              <span className="inline-block w-2 h-2 bg-phase-testing rounded-full schema-spin" />
              Executing — do not edit files
            </span>
            <CancelRunningButton planId={plan?.planId} />
          </div>
        )}
        {planPhase === "done" && (
          <PlanDoneFooter onClose={() => cancelPlan()} />
        )}
      </div>
    </aside>
  );
}

function CancelRunningButton({ planId }: { planId?: string }) {
  const cancelPlan = useStore((s) => s.cancelPlan);
  const emitToast = useStore((s) => s.emitToast);
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    if (planId) {
      try {
        await fetchApi("/api/plan/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planRunId: planId }),
        });
      } catch {
        /* best-effort */
      }
    }
    cancelPlan();
    emitToast("plan cancelled");
    setCancelling(false);
  }

  return (
    <button
      onClick={handleCancel}
      disabled={cancelling}
      data-testid="plan-cancel-running"
      className="px-3 py-1.5 border border-outline hover:border-violation/60 hover:text-violation text-xs text-on-surface-variant transition-colors disabled:opacity-50"
    >
      {cancelling ? "Cancelling..." : "Cancel"}
    </button>
  );
}

function PlanNotesSection({ notesUri }: { notesUri: string }) {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    if (!notesUri.startsWith("markdown://")) {
      setContent(notesUri);
      return;
    }
    fetchApi("/api/markdown/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri: notesUri }),
    })
      .then((r) => r.json())
      .then((d) => setContent(d.content ?? d.text ?? notesUri))
      .catch(() => setContent(notesUri));
  }, [notesUri]);

  return (
    <div className="px-5 py-3 border-b border-outline-variant/60">
      <pre className="font-[JetBrains_Mono] text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap max-h-36 overflow-auto">
        {content ?? "loading notes…"}
      </pre>
    </div>
  );
}

function PlanValidationBanner({ planId }: { planId?: string }) {
  const [validation, setValidation] = useState<{ ok: boolean; issues: string[] } | null>(null);
  const [interference, setInterference] = useState<{ conflicts: string[] } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!planId) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const [valRes, intRes] = await Promise.all([
          fetchApi("/api/plan/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planId }),
          }),
          fetchApi("/api/plan/interference", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planId }),
          }),
        ]);
        if (cancelled) return;
        if (valRes.ok) {
          const vj = await valRes.json();
          setValidation({
            ok: vj.valid !== false,
            issues: vj.issues?.map?.((i: any) => i.message ?? String(i)) ?? [],
          });
        }
        if (intRes.ok) {
          const ij = await intRes.json();
          const conflicts = [
            ...(ij.writeConflicts?.map?.((c: any) => `write conflict: ${c.file ?? c.symbolId ?? "unknown"}`) ?? []),
            ...(ij.framingViolations?.map?.((f: any) => `framing: ${f.message ?? String(f)}`) ?? []),
          ];
          setInterference({ conflicts });
        }
      } catch { /* best-effort */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [planId]);

  if (!loaded || (!validation?.issues.length && !interference?.conflicts.length)) return null;

  const allIssues = [
    ...(validation?.issues ?? []),
    ...(interference?.conflicts ?? []),
  ];
  if (allIssues.length === 0) return null;

  return (
    <div
      data-testid="plan-validation-banner"
      className="border border-phase-testing/30 bg-phase-testing/5 px-3 py-2"
    >
      <p className="text-xs text-phase-testing mb-1.5">
        {allIssues.length} warning{allIssues.length === 1 ? "" : "s"}
      </p>
      <ul className="space-y-1">
        {allIssues.slice(0, 5).map((issue, i) => (
          <li
            key={i}
            className="text-xs text-phase-testing/80 leading-relaxed"
          >
            · {issue}
          </li>
        ))}
        {allIssues.length > 5 && (
          <li className="text-xs text-on-surface-faint">
            … +{allIssues.length - 5} more
          </li>
        )}
      </ul>
    </div>
  );
}

/** Links to the PR (and its live review page) that was opened automatically for an agent run. */
function AgentPrLinks() {
  const pr = useTrust((s) => s.pr);
  const run = useTrust((s) => s.run);
  const hasReceipt = useTrust((s) => !!s.receipt);
  const url = pr?.url ?? run?.prUrl;
  const page = pr?.pageUrl ?? run?.pageUrl;
  const receiptId = run?.receiptId ?? useTrust.getState().receipt?.id;
  const [tests, setTests] = useState<{ phase: "idle" | "running" | "done" | "error"; text?: string }>({ phase: "idle" });
  async function runTests() {
    if (!receiptId) return;
    setTests({ phase: "running" });
    try {
      const r = await callTool<{ passed: number; failed: number; seconds: number; filter: string }>("trust.run_tests", { receiptId });
      setTests({ phase: "done", text: `${r.passed} passed · ${r.failed} failed · ${r.seconds}s` });
    } catch (e) {
      setTests({ phase: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }
  const openPr = useTrust((s) => s.openPr);
  const busy = useTrust((s) => s.busy);
  const [showChanges, setShowChanges] = useState(false);
  if (!url && !hasReceipt) return run?.status === "done" ? <p className="text-xs text-on-surface-muted">Building the evidence receipt…</p> : null;
  return (
    <div className="flex flex-col gap-2">
    {run?.runId && run.headSha && (
      <button
        onClick={() => setShowChanges(true)}
        className="w-full px-3 py-3 bg-surface-container-high border border-schema-accent text-sm text-white hover:bg-schema-accent hover:text-black transition-colors"
      >
        View Claude's changes
      </button>
    )}
    {showChanges && run?.runId && (
      <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-6" onClick={() => setShowChanges(false)}>
        <div className="w-full max-w-[1400px] h-[88vh] flex flex-col bg-surface" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center px-4 py-2.5 border border-b-0 border-outline-variant text-sm text-white">
            Changes by Claude Code · {run.branch ?? run.runId}
            <button onClick={() => setShowChanges(false)} className="ml-auto text-xs text-on-surface-muted hover:text-white">Close ✕</button>
          </div>
          <div className="flex-1 min-h-0"><ChangesView runId={run.runId} /></div>
        </div>
      </div>
    )}
    {run?.ci?.length ? (() => {
      const last = run.ci[run.ci.length - 1]!;
      return (
        <p className={`font-[JetBrains_Mono] text-xs ${last.passed ? "text-phase-pass" : "text-phase-fail"}`}>
          CI ({last.provider}) {last.passed ? "passed" : "failed"} on {last.headSha.slice(0, 8)}{run.ci.length > 1 ? ` · ${run.ci.length - 1} automatic fix attempt(s)` : ""}
        </p>
      );
    })() : null}
    <button
      onClick={() => useTrust.setState({ open: true, tab: "signoff" })}
      disabled={!hasReceipt}
      className="w-full px-3 py-2.5 border border-schema-accent text-xs text-schema-accent hover:bg-schema-accent hover:text-black transition-colors disabled:opacity-50"
    >
      Review evidence & sign off
    </button>
    <button
      onClick={() => void runTests()}
      disabled={!receiptId || tests.phase === "running"}
      className="w-full px-3 py-2.5 border border-outline-variant text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors disabled:opacity-60"
    >
      {tests.phase === "running" ? "Running the tests that reach this change…" : "Run tests on the agent's commit"}
    </button>
    {tests.text && (
      <p className={`font-[JetBrains_Mono] text-xs ${tests.phase === "error" || /[1-9]\d* failed/.test(tests.text) ? "text-phase-fail" : "text-phase-pass"}`}>{tests.text}</p>
    )}
    {!url ? (
      <button
        onClick={() => void openPr()}
        disabled={!!busy}
        className="w-full px-3 py-3 bg-schema-accent text-black text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {busy?.startsWith("Pushing") ? "Opening the pull request…" : "Open pull request"}
      </button>
    ) : (
    <div className="flex gap-2">
      <a href={url} target="_blank" rel="noreferrer" className="flex-1 text-center px-3 py-2.5 border border-schema-accent text-xs text-schema-accent hover:bg-schema-accent hover:text-black transition-colors">
        Open PR #{url!.split("/").pop()}
      </a>
      {page && (
        <a href={page} target="_blank" rel="noreferrer" className="flex-1 text-center px-3 py-2.5 border border-outline-variant text-xs text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors">
          Live review page
        </a>
      )}
    </div>
    )}
    </div>
  );
}

function PlanDoneFooter({ onClose }: { onClose: () => void }) {
  const undoStack = useStore((s) => s.undoStack);
  const undoLast = useStore((s) => s.undoLast);
  const emitToast = useStore((s) => s.emitToast);
  const canUndo = undoStack.length > 0;
  const lastEntry = undoStack[0];
  const realApply = !!lastEntry?.realApply;
  const hasFileSnapshot =
    !!lastEntry?.fileSnapshots && lastEntry.fileSnapshots.length > 0;
  const git = lastEntry?.git;
  const canGitUndo = !!git?.enabled && git.commits.length > 0 && !!git.branchName;
  const canRealUndo = realApply && (hasFileSnapshot || canGitUndo);

  const [prState, setPrState] = useState<
    | { kind: "idle" }
    | { kind: "confirm" }
    | { kind: "loading" }
    | { kind: "ok"; url: string }
    | { kind: "err"; reason: string }
  >({ kind: "idle" });

  const prTitle = git?.branchName
    ? `schema: ${lastEntry?.intent || "applied plan"}`.slice(0, 100)
    : "";
  const prBodyLines = git?.branchName
    ? [
        `Schema applied **${git.commits.length} step(s)** on branch \`${git.branchName}\`.`,
        "",
        "## Steps",
        ...git.commits.map(
          (c, i) => `${i + 1}. \`${c.shortSha}\` ${c.message}`,
        ),
        "",
        `Baseline: \`${git.baselineSha?.slice(0, 7) ?? "?"}\`${git.previousBranch ? ` · forked from \`${git.previousBranch}\`` : ""}`,
      ]
    : [];
  const prBody = prBodyLines.join("\n");

  const filesTouched = git?.branchName
    ? Array.from(
        new Set(git.commits.flatMap((c) => c.filesChanged ?? [])),
      ).sort()
    : [];

  function handleUndo() {
    void undoLast();
    onClose();
  }

  async function confirmAndOpenPr() {
    if (!git?.branchName || !lastEntry?.rootPath) return;
    setPrState({ kind: "loading" });
    try {
      const res = await fetchApi("/api/op/open-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath: lastEntry.rootPath,
          branchName: git.branchName,
          title: prTitle,
          body: prBody,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; url: string }
        | { ok: false; code: string; reason?: string; output?: string };
      if (!res.ok || !json.ok) {
        const reason =
          "reason" in json && json.reason
            ? json.reason
            : `HTTP ${res.status}`;
        setPrState({ kind: "err", reason });
        emitToast(`open as PR failed · ${reason}`);
        return;
      }
      setPrState({ kind: "ok", url: json.url });
      emitToast(`PR opened · ${json.url}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrState({ kind: "err", reason: msg });
      emitToast(`open as PR failed · ${msg}`);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <AgentPrLinks />
      {realApply && (
        <p
          data-testid="plan-real-apply-banner"
          className="font-[JetBrains_Mono] text-xs text-on-surface-faint"
        >
          {canGitUndo
            ? `real apply · branch ${git!.branchName} · ${git!.commits.length} commit(s) · undo runs git reset --hard`
            : canRealUndo
              ? "real apply · files were written to disk · undo restores them"
              : "real apply · files were written to disk · undo is in-memory only"}
        </p>
      )}
      {git && !git.enabled && git.disabledReason && (
        <p
          data-testid="plan-git-disabled-reason"
          className="font-[JetBrains_Mono] text-xs text-on-surface-muted"
        >
          git safety off · {git.disabledReason}
        </p>
      )}
      <div className="flex gap-2">
        {canUndo && (
          <button
            onClick={handleUndo}
            data-testid="plan-done-undo"
            title={
              canGitUndo
                ? "git reset --hard to the pre-plan SHA + delete the schema branch."
                : canRealUndo
                  ? "Restore the original file content + roll the in-memory graph back."
                  : realApply
                    ? "Reverts the in-memory graph only — source files stay changed. Use git to restore disk."
                    : "Roll the graph back to its pre-plan state."
            }
            className="flex-1 px-3 py-2.5 border border-outline hover:border-violation/60 hover:text-violation text-xs text-on-surface-variant transition-colors"
          >
            Undo this plan
            {realApply && !canRealUndo ? " (graph only)" : ""}
          </button>
        )}
        <button
          onClick={onClose}
          data-testid="plan-done-close"
          className="flex-1 px-3 py-2.5 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors"
        >
          Close
        </button>
      </div>
      {canGitUndo && (prState.kind === "idle" || prState.kind === "err") && (
        <button
          onClick={() => setPrState({ kind: "confirm" })}
          data-testid="plan-open-pr"
          className="w-full px-3 py-2.5 border border-schema-accent/50 text-schema-accent hover:bg-schema-accent/10 text-xs transition-colors"
        >
          Open as PR
        </button>
      )}
      {canGitUndo && prState.kind === "confirm" && (
        <div
          data-testid="plan-pr-confirm"
          className="w-full border border-schema-accent/40 bg-surface-dim p-3 flex flex-col gap-2.5"
        >
          <p className="text-xs text-schema-accent">
            Push & open PR
          </p>
          <p className="text-xs text-on-surface-muted leading-relaxed">
            This will run{" "}
            <span className="font-[JetBrains_Mono] text-on-surface">
              git push -u origin {git!.branchName}
            </span>{" "}
            against the configured remote, then{" "}
            <span className="font-[JetBrains_Mono] text-on-surface">gh pr create</span>. The push
            is irreversible without a force-push.
          </p>
          <div className="border border-outline-variant bg-surface/60 p-2 flex flex-col gap-1.5">
            <p className="text-xs text-on-surface-faint">
              title
            </p>
            <p
              data-testid="plan-pr-confirm-title"
              className="text-xs text-on-surface break-words"
            >
              {prTitle}
            </p>
          </div>
          <div className="border border-outline-variant bg-surface/60 p-2 flex flex-col gap-1.5">
            <p className="text-xs text-on-surface-faint">
              {git!.commits.length} commit{git!.commits.length === 1 ? "" : "s"} ·{" "}
              {filesTouched.length} file{filesTouched.length === 1 ? "" : "s"}
            </p>
            <ul
              data-testid="plan-pr-confirm-commits"
              className="font-[JetBrains_Mono] text-xs text-on-surface-variant leading-relaxed max-h-24 overflow-y-auto"
            >
              {git!.commits.map((c, i) => (
                <li key={c.sha}>
                  {i + 1}. <span className="text-schema-accent">{c.shortSha}</span>{" "}
                  {c.message}
                </li>
              ))}
            </ul>
            {filesTouched.length > 0 && (
              <ul
                data-testid="plan-pr-confirm-files"
                className="mt-1 font-[JetBrains_Mono] text-xs text-on-surface-faint leading-relaxed max-h-20 overflow-y-auto"
              >
                {filesTouched.slice(0, 12).map((f) => (
                  <li key={f}>· {f}</li>
                ))}
                {filesTouched.length > 12 && (
                  <li>· … +{filesTouched.length - 12} more</li>
                )}
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPrState({ kind: "idle" })}
              data-testid="plan-pr-confirm-cancel"
              className="flex-1 px-3 py-2 border border-outline hover:border-neutral-500 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void confirmAndOpenPr()}
              data-testid="plan-pr-confirm-go"
              className="flex-1 px-3 py-2 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors"
            >
              Push & open PR
            </button>
          </div>
        </div>
      )}
      {canGitUndo && prState.kind === "loading" && (
        <div
          data-testid="plan-pr-loading"
          className="w-full px-3 py-2.5 border border-schema-accent/50 text-schema-accent flex items-center gap-2 text-xs"
        >
          <span className="inline-block w-2 h-2 bg-schema-accent rounded-full schema-spin" />
          Pushing & opening PR…
        </div>
      )}
      {prState.kind === "ok" && (
        <a
          href={prState.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="plan-pr-url"
          className="w-full px-3 py-2.5 border border-phase-pass/40 text-phase-pass hover:bg-phase-pass/10 font-[JetBrains_Mono] text-xs transition-colors block text-center truncate"
          title={prState.url}
        >
          PR · {prState.url.replace(/^https?:\/\//, "")}
        </a>
      )}
      {prState.kind === "err" && (
        <p
          data-testid="plan-pr-error"
          className="text-xs text-violation"
        >
          PR failed · {prState.reason}
        </p>
      )}
    </div>
  );
}

function PreApplyGitBanner() {
  const rootPath = useStore((s) => s.repo.rootPath ?? null);
  const [probe, setProbe] = useState<GitProbeView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!rootPath) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchApi("/api/git/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rootPath }),
        });
        if (!cancelled) {
          if (res.ok) {
            const json = (await res.json()) as GitProbeView;
            setProbe(json);
          }
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  if (!rootPath) return null;
  if (!loaded) {
    return (
      <p
        data-testid="git-banner-loading"
        className="font-[JetBrains_Mono] text-xs text-on-surface-faint"
      >
        checking git…
      </p>
    );
  }
  if (!probe) return null;
  if (probe.schemaReady) {
    return (
      <p
        data-testid="git-banner-ready"
        className="font-[JetBrains_Mono] text-xs text-phase-pass/80"
      >
        git on · forking from {probe.currentBranch ?? "(detached)"} · clean
      </p>
    );
  }
  if (!probe.available) {
    return (
      <p
        data-testid="git-banner-no-repo"
        className="font-[JetBrains_Mono] text-xs text-on-surface-muted"
      >
        not a git repo · undo via file snapshots only
      </p>
    );
  }
  if (probe.isDirty) {
    return (
      <div
        data-testid="git-banner-dirty"
        className="border border-phase-fail/30 bg-phase-fail/5 px-2 py-1.5"
      >
        <p className="font-[JetBrains_Mono] text-xs text-phase-fail">
          dirty tree · {probe.dirtyFiles.length} uncommitted change(s)
        </p>
        <p className="font-[JetBrains_Mono] text-xs text-on-surface-muted mt-0.5">
          schema will skip the auto-branch and use file snapshots only. Commit
          or stash your work to engage git safety.
        </p>
      </div>
    );
  }
  return null;
}

function CancelTestsHeader() {
  const ctrl = useStore((s) => s.testRunController);
  const cancelTests = useStore((s) => s.cancelTests);
  if (!ctrl) return null;
  return (
    <div className="px-3 py-1.5 flex items-center justify-between gap-2 border-b border-phase-testing/20">
      <span className="text-xs text-on-surface-faint">
        running tests…
      </span>
      <button
        onClick={cancelTests}
        data-testid="cancel-tests"
        className="text-xs text-on-surface-muted hover:text-violation transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

// Mirrors a Claude Code run into Studio's own plan state, so the original plan panel
// (reasoning stream while running, done summary + footer at the end) shows the agent's work.
import { useStore } from "@/state/store";
import type { AgentRun } from "@/state/trust";
import type { Plan, StepRun } from "@/lib/types";

const TOOL_LABEL: Record<string, string> = { read: "read", search: "search", edit: "edit", command: "run", note: "note" };

function events(run: AgentRun) {
  return run.steps.map((s) => {
    const ts = Date.parse(s.at) || Date.now();
    if (s.kind === "thought") return { kind: "thinking" as const, ts, text: s.title };
    if (s.kind === "result") return { kind: "complete" as const, ts };
    if (s.kind === "note" && s.title === "Tool error") return { kind: "error" as const, ts, error: s.detail?.slice(0, 160) ?? "tool error" };
    return { kind: "tool_call" as const, ts, tool: `${TOOL_LABEL[s.kind] ?? s.kind} · ${s.title.replace(/^\$ /, "").replace(/^(Read|Edit|Write) /, "").slice(0, 70)}` };
  });
}

let lastKey = "";

export function syncPlanFromRun(run: AgentRun | null): void {
  if (!run) return;
  const key = `${run.runId}:${run.status}:${run.steps.length}`;
  if (key === lastKey) return;
  lastKey = key;
  const base = {
    agentEvents: events(run),
    plannerSource: run.model ? `claude code · ${run.model}` : "claude code",
    plannerUsedRealLLM: true,
    plannerFallbackReason: null,
    planError: run.status === "failed" ? run.error ?? "Agent run failed" : null,
  };
  if (run.status === "running") {
    useStore.setState({ ...base, planPhase: "streaming", plan: null, planPartial: { intent: run.prompt, steps: [] }, stepRuns: {}, activeStepIndex: null } as never);
    return;
  }
  if (run.status === "failed") {
    useStore.setState({ ...base, planPhase: "idle", plan: null } as never);
    return;
  }
  const files = run.filesChanged ?? [];
  const plan: Plan = {
    intent: run.summary ?? run.prompt,
    steps: files.map((f) => ({ kind: "freeform", description: f, files: [{ path: f, content: "" }], risk: "low", rationale: "" })) as Plan["steps"],
  };
  const stepRuns: Record<number, StepRun> = {};
  files.forEach((f, i) => { stepRuns[i] = { phase: "passed", filesChanged: [f] }; });
  useStore.setState({ ...base, planPhase: "done", plan, planPartial: { intent: plan.intent, steps: plan.steps }, stepRuns, activeStepIndex: null } as never);
}

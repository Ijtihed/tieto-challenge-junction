"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useStore } from "@/state/store";
import { samplePrompts } from "@/lib/fixture";
import { useTrust } from "@/state/trust";
import { CHALLENGE_MODE } from "@/lib/challenge";

const AGENT_PROMPTS = [
  "Fix MP-2283: generator crashes on a closed generic struct from a referenced assembly",
  "Fix MPCS-2234: analyzer is silent when SuppressSourceGeneration = true",
  "Fix MPCS-2297: mark generated code with [ExcludeFromCodeCoverage]",
  "Fix MP-2129: allow generating a formatter for a type in a referenced assembly",
];

function useElapsed(since: string | undefined, active: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!since) return "";
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function CommandBar() {
  const submitPrompt = useStore((s) => s.submitPrompt);
  const planPhase = useStore((s) => s.planPhase);
  const [value, setValue] = useState("");
  const [showSamples, setShowSamples] = useState(false);
  const matchRequirement = useTrust((s) => s.matchRequirement);
  const startFix = useTrust((s) => s.startFix);
  const run = useTrust((s) => s.run);
  const refreshTrust = useTrust((s) => s.refresh);
  const openPanel = () => useTrust.setState({ open: true, tab: "agent" });
  useEffect(() => { void refreshTrust().catch(() => undefined); }, [refreshTrust]);

  const agentRunning = run?.status === "running";
  const elapsed = useElapsed((run as { startedAt?: string } | null)?.startedAt, agentRunning);
  const busy = planPhase === "streaming" || planPhase === "running" || agentRunning;
  const agentReq = matchRequirement(value);
  const canSubmit = !busy && !!value.trim() && (!CHALLENGE_MODE || !!agentReq);
  const prompts = CHALLENGE_MODE ? AGENT_PROMPTS : [...AGENT_PROMPTS, ...samplePrompts];
  const lastAction = run?.steps.slice().reverse().find((s) => s.kind !== "thought");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (agentReq) void startFix(value.trim(), agentReq);
    else submitPrompt(value.trim());
    setValue("");
    setShowSamples(false);
  }

  return (
    <div className="border-t border-outline-variant bg-surface/95 backdrop-blur shrink-0">
      {agentRunning && (
        <button onClick={openPanel} className="w-full px-5 py-2 border-b border-outline-variant/60 flex items-center gap-3 text-left hover:bg-surface-container">
          <span className="w-2 h-2 rounded-full bg-phase-applying animate-pulse shrink-0" />
          <span className="text-xs text-white shrink-0">Claude Code is working on {run?.requirementId}</span>
          <span className="text-[11px] font-[JetBrains_Mono] text-on-surface-muted shrink-0">{elapsed} · {run?.steps.length ?? 0} steps</span>
          <span className="text-[11px] font-[JetBrains_Mono] text-on-surface-variant truncate">
            {lastAction ? lastAction.title : "starting up, first output usually takes 15-30 s…"}
          </span>
        </button>
      )}
      {showSamples && !busy && (
        <div className="px-5 py-4 border-b border-outline-variant/60 grid grid-cols-1 md:grid-cols-2 gap-2">
          {prompts.map((p) => (
            <button
              key={p}
              onClick={() => { setValue(p); setShowSamples(false); }}
              className="text-left px-4 py-2.5 border border-outline-variant/60 bg-surface-dim hover:border-neutral-600 hover:bg-surface-container-high transition-colors text-sm text-neutral-300 leading-relaxed"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="px-5 py-3 flex items-center gap-3">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setShowSamples(true)}
          disabled={busy}
          placeholder={CHALLENGE_MODE ? "Ask the agent to fix an issue, e.g. fix MP-2283" : "Describe a change, or: fix issue #2283"}
          className="flex-1 bg-transparent text-sm text-white placeholder:text-on-surface-muted outline-none disabled:opacity-50"
        />
        <button type="button" onClick={() => setShowSamples((v) => !v)} className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors">
          Issues
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className={`px-5 py-2 border text-xs transition-colors ${
            !canSubmit
              ? "border-outline-variant text-on-surface-faint cursor-default"
              : "border-schema-accent text-schema-accent hover:bg-schema-accent hover:text-black cursor-pointer"
          }`}
        >
          {busy ? "Running..." : agentReq ? `Fix ${agentReq} with Claude Code` : CHALLENGE_MODE ? "Name an issue" : "Plan"}
        </button>
      </form>
    </div>
  );
}

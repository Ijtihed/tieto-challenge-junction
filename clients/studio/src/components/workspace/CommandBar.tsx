"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useStore } from "@/state/store";
import { samplePrompts } from "@/lib/fixture";
import { useTrust } from "@/state/trust";
import { CHALLENGE_MODE } from "@/lib/challenge";
import ClaudeCrab from "@/components/ClaudeCrab";

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
    <div className="relative shrink-0 border-t border-[var(--ui-hairline)] bg-surface">
      {showSamples && !busy && (
        <div className="ui-pop ui-sheet absolute right-3 bottom-[calc(100%+8px)] w-[min(600px,calc(100%-6rem))] p-1.5 z-20" role="listbox" aria-label="Open issues">
          {prompts.map((p) => (
            <button
              key={p}
              role="option"
              aria-selected={false}
              onClick={() => { setValue(p); setShowSamples(false); }}
              className="w-full text-left px-3 py-2 rounded-[8px] text-[0.8125rem] leading-snug text-on-surface-variant hover:bg-[var(--ui-fill-hover)] hover:text-on-surface transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {agentRunning ? (
        <button onClick={openPanel} className="w-full h-12 px-5 flex items-center gap-3 text-left">
          <ClaudeCrab walking />
          <span className="text-[0.8125rem] font-medium text-on-surface shrink-0">Claude is working on {run?.requirementId}</span>
          <span className="ui-meta tabular-nums shrink-0">{elapsed}, {run?.steps.length ?? 0} steps</span>
          <span className="ui-meta truncate">
            {lastAction ? lastAction.title : "First output takes 15 to 30 seconds."}
          </span>
        </button>
      ) : (
        <form onSubmit={onSubmit} className="pl-5 pr-3 h-12 flex items-center gap-3">
          <ClaudeCrab />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setShowSamples(true)}
            disabled={busy}
            aria-label="Ask Claude Code to fix an issue"
            placeholder={CHALLENGE_MODE ? "Fix an issue, for example MP-2283" : "Describe a change, or: fix issue #2283"}
            className="flex-1 min-w-0 bg-transparent text-[0.875rem] text-on-surface placeholder:text-on-surface-faint outline-none disabled:opacity-50"
          />
          <button type="button" onClick={() => setShowSamples((v) => !v)} aria-expanded={showSamples} aria-label="Show open issues" className="ui-icon-btn">
            <span className={`material-symbols-outlined text-[18px] transition-transform duration-200 ${showSamples ? "rotate-180" : ""}`} style={{ fontVariationSettings: "'wght' 300" }}>expand_less</span>
          </button>
          <button type="submit" disabled={!canSubmit} className="ui-btn ui-btn-primary">
            {busy ? "Running" : agentReq ? `Fix ${agentReq}` : CHALLENGE_MODE ? "Fix" : "Plan"}
            <span className="ui-arrow material-symbols-outlined text-[17px] leading-none -mr-0.5" style={{ fontVariationSettings: "'wght' 400" }} aria-hidden="true">arrow_forward</span>
          </button>
        </form>
      )}
    </div>
  );
}

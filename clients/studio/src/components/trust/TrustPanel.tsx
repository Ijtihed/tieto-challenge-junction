"use client";

import { useEffect, useMemo, useState } from "react";
import { useTrust, type AgentStep, type Claim, type ReviewedMember } from "@/state/trust";

const STEP_ICON: Record<string, [string, string]> = {
  read: ["description", "text-kind-service"],
  search: ["search", "text-kind-route"],
  edit: ["edit", "text-phase-applying"],
  command: ["terminal", "text-kind-middleware"],
  thought: ["psychology", "text-on-surface-variant"],
  note: ["sticky_note_2", "text-on-surface-muted"],
  result: ["flag", "text-phase-pass"],
};

const STATUS_CLS: Record<string, string> = {
  verified: "border-phase-pass/60 text-phase-pass",
  partial: "border-phase-applying/60 text-phase-applying",
  heuristic: "border-phase-applying/60 text-phase-applying",
  unverified: "border-outline-variant text-on-surface-muted",
  contradicted: "border-phase-fail/60 text-phase-fail",
};

const TIER_CLS: Record<string, string> = {
  light: "border-phase-pass text-phase-pass",
  focused: "border-phase-applying text-phase-applying",
  full: "border-phase-fail text-phase-fail",
};

export const shortKey = (key: string) => {
  if (key.includes("/")) return key.split("/").pop() ?? key;
  const noParams = key.replace(/\(.*\)$/, "");
  const ctor = noParams.match(/^(.*)\.(\.c?ctor)$/);
  if (ctor) return `${ctor[1]!.split(".").pop()}.${ctor[2]!.slice(1)}`;
  return noParams.split(".").slice(-2).join(".");
};

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mt-5 mb-2">
      <h3 className="text-[11px] uppercase tracking-[0.12em] text-on-surface-muted">{children}</h3>
      {right}
    </div>
  );
}

function Btn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 border text-xs transition-colors ${
        disabled ? "border-outline-variant text-on-surface-faint cursor-default"
          : primary ? "border-schema-accent text-schema-accent hover:bg-schema-accent hover:text-black cursor-pointer"
            : "border-outline-variant text-neutral-300 hover:border-neutral-500 hover:text-white cursor-pointer"
      }`}
    >
      {children}
    </button>
  );
}

function StepRow({ s }: { s: AgentStep }) {
  const [open, setOpen] = useState(false);
  const [icon, color] = STEP_ICON[s.kind] ?? ["build", "text-on-surface-variant"];
  return (
    <div className="py-1">
      <button onClick={() => s.detail && setOpen(!open)} className={`w-full flex items-start gap-2 text-left ${s.detail ? "cursor-pointer" : "cursor-default"}`}>
        <span className={`material-symbols-outlined text-[14px] mt-[1px] ${color}`}>{icon}</span>
        <span className={`text-xs ${s.kind === "thought" ? "italic text-on-surface-variant" : "font-[JetBrains_Mono] text-neutral-200"} break-words min-w-0`}>{s.title}</span>
      </button>
      {open && s.detail && (
        <pre className="ml-6 mt-1 p-2 bg-surface text-[11px] text-on-surface-variant font-[JetBrains_Mono] whitespace-pre-wrap max-h-56 overflow-auto border border-outline-variant/60">{s.detail}</pre>
      )}
    </div>
  );
}

function AgentTab() {
  const run = useTrust((s) => s.run);
  const receipt = useTrust((s) => s.receipt);
  const showHead = useTrust((s) => s.showHeadOnCanvas);
  const setTab = useTrust((s) => s.setTab);
  const decisions = run?.decisions ?? receipt?.agent?.decisions ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of run?.steps ?? []) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [run?.steps]);

  if (!run) {
    return <div className="text-xs text-on-surface-muted py-6">This change was written by the organisers' agent; no run transcript is recorded. See the receipt.</div>;
  }
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-muted font-[JetBrains_Mono]">
        <span>{run.model ?? "claude"}</span>
        <span>branch {run.branch}</span>
        <span>base {run.baseSha.slice(0, 8)}</span>
        {run.headSha && <span>head {run.headSha.slice(0, 8)}</span>}
        {run.turns ? <span>{run.turns} turns</span> : null}
        {run.durationMs ? <span>{Math.round(run.durationMs / 60000)} min</span> : null}
      </div>
      <div className="flex gap-3 mt-2 text-[11px] text-on-surface-variant">
        {(["read", "search", "edit", "command"] as const).map((k) => <span key={k}>{counts[k] ?? 0} {k}{k === "search" ? "es" : "s"}</span>)}
      </div>

      {run.status === "running" && (
        <div className="flex items-center gap-2 mt-3">
          <span className="w-1.5 h-1.5 rounded-full bg-phase-applying animate-pulse" />
          <span className="text-xs text-on-surface-muted">{run.steps.length === 0 ? "Claude Code is starting; first output usually takes 15-30 s." : "Agent is working in an isolated worktree. It cannot push, open PRs or sign."}</span>
        </div>
      )}
      {run.status === "failed" && <div className="mt-3 text-xs text-phase-fail border-l-2 border-phase-fail pl-2">{run.error}</div>}

      {decisions.length > 0 && (
        <>
          <SectionTitle>Decisions the agent made</SectionTitle>
          {run.summary && <p className="text-xs text-neutral-300 leading-relaxed mb-2">{run.summary}</p>}
          <div className="space-y-2">
            {decisions.map((d, i) => (
              <div key={i} className={`border-l-2 pl-3 py-1 ${d.confidence === "unsure" ? "border-phase-applying" : "border-outline-variant"}`}>
                <div className="text-xs text-white">{d.decision} {d.confidence === "unsure" && <span className="ml-1 text-[10px] uppercase text-phase-applying">unsure</span>}</div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">{d.why}</div>
                {d.alternatives && <div className="text-[11px] text-on-surface-muted mt-0.5">Alternatives: {d.alternatives}</div>}
                {d.evidence && <div className="text-[11px] font-[JetBrains_Mono] text-on-surface-muted mt-0.5">{d.evidence}</div>}
              </div>
            ))}
          </div>
          {run.openQuestions.length > 0 && (
            <>
              <SectionTitle>Left for a human</SectionTitle>
              <ul className="list-disc ml-4 text-xs text-neutral-300 space-y-1">{run.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
            </>
          )}
        </>
      )}

      {run.status === "done" && (
        <div className="flex gap-2 mt-4">
          <Btn primary onClick={() => setTab("receipt")}>Review the receipt</Btn>
          <Btn onClick={() => void showHead()}>Show agent's version on canvas</Btn>
        </div>
      )}

      <SectionTitle right={<span className="text-[10px] text-on-surface-faint">{run.steps.length} steps · click to expand</span>}>What it did</SectionTitle>
      <div className="border-l border-outline-variant/60 pl-2">
        {run.steps.map((s) => <StepRow key={s.i} s={s} />)}
      </div>
    </div>
  );
}

function ClaimRow({ c }: { c: Claim }) {
  const [open, setOpen] = useState(false);
  const select = useTrust((s) => s.selectMember);
  return (
    <div className="border-b border-outline-variant/40">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start gap-2 py-2 text-left cursor-pointer">
        <span className={`shrink-0 w-[84px] text-center px-1 py-[1px] border text-[10px] uppercase tracking-wide ${STATUS_CLS[c.status]}`}>{c.status}</span>
        <span className="text-xs text-neutral-200 flex-1">{c.text}</span>
        <span className="text-[10px] font-[JetBrains_Mono] text-on-surface-faint shrink-0">{c.decidedBy}</span>
      </button>
      {open && (
        <ul className="pb-2 pl-[92px] space-y-1">
          {c.evidence.map((e, i) => (
            <li key={i} className="text-[11px] text-on-surface-variant">
              {e.label}
              {e.ref && <button onClick={() => select(e.ref!)} className="ml-2 font-[JetBrains_Mono] text-kind-service hover:underline">{shortKey(e.ref)}</button>}
              {e.detail && <pre className="mt-1 p-2 bg-surface whitespace-pre-wrap font-[JetBrains_Mono] text-[10.5px] text-on-surface-muted max-h-40 overflow-auto">{e.detail}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberDetail({ m }: { m: ReviewedMember }) {
  const before = (m.before?.text ?? "").split("\n");
  const after = (m.after?.text ?? "").split("\n");
  const removed = new Set(before.filter((l) => !after.includes(l)));
  const added = new Set(after.filter((l) => !before.includes(l)));
  const lines = [
    ...before.filter((l) => removed.has(l)).map((t) => ({ k: "-", t })),
    ...after.map((t) => ({ k: added.has(t) ? "+" : " ", t })),
  ];
  const context = lines.filter((l, i) => l.k !== " " || lines.slice(Math.max(0, i - 2), i + 3).some((x) => x.k !== " "));
  return (
    <div className="mt-2 border border-outline-variant/60 bg-surface">
      <div className="px-3 py-2 border-b border-outline-variant/60 flex flex-wrap gap-1.5">
        {m.changes.map((c) => <span key={c} className="text-[10px] font-[JetBrains_Mono] px-1.5 border border-outline-variant text-phase-applying">{c}</span>)}
        {m.flags.map((f) => <span key={f} className="text-[10px] font-[JetBrains_Mono] px-1.5 border border-phase-fail/60 text-phase-fail">{f.replace("wires-in:", "wires in ")}</span>)}
        <span className="text-[10px] text-on-surface-muted ml-auto">{m.directCallers} callers · {m.tests.length} tests reach</span>
      </div>
      <pre className="text-[10.5px] font-[JetBrains_Mono] max-h-72 overflow-auto py-1">
        {context.map((l, i) => (
          <div key={i} className={l.k === "+" ? "bg-phase-pass/10 text-phase-pass" : l.k === "-" ? "bg-phase-fail/10 text-phase-fail" : "text-on-surface-muted"}>
            <span className="inline-block w-4 text-center opacity-60">{l.k}</span>{l.t}
          </div>
        ))}
      </pre>
      {m.tests[0] && (
        <div className="px-3 py-2 border-t border-outline-variant/60 text-[10.5px] font-[JetBrains_Mono] text-on-surface-muted">
          {m.tests[0].path.filter((p, i) => p !== m.tests[0]!.path[i - 1]).join(" → ")}
        </div>
      )}
    </div>
  );
}

function ReceiptTab() {
  const r = useTrust((s) => s.receipt);
  const selectedKey = useTrust((s) => s.selectedKey);
  const select = useTrust((s) => s.selectMember);
  if (!r) return <div className="text-xs text-on-surface-muted py-6">The receipt is built when the agent finishes.</div>;
  const counts: Record<string, number> = {};
  for (const c of r.claims) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const sel = r.members.find((m) => m.key === selectedKey);
  return (
    <div>
      <div className={`border px-4 py-3 ${TIER_CLS[r.risk.tier] ?? ""}`}>
        <div className="flex items-baseline justify-between">
          <span className="text-lg">{r.risk.tierLabel}</span>
          <span className="text-[11px] font-[JetBrains_Mono]">risk {r.risk.score}</span>
        </div>
        <div className="text-xs text-neutral-200 mt-1">Owner reads <b className="text-white">{r.summary.readLines}</b> of <b className="text-white">{r.summary.totalLines}</b> changed lines</div>
        <div className="h-1 bg-surface-container mt-2"><div className="h-1 bg-schema-accent" style={{ width: `${Math.max(1.5, (100 * r.summary.readLines) / Math.max(1, r.summary.totalLines))}%` }} /></div>
        <div className="text-[11px] text-on-surface-variant mt-2">{r.risk.tierMeaning}</div>
        {r.risk.trustAdjustments.map((t) => <div key={t} className="text-[11px] text-kind-service mt-1">{t}</div>)}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {Object.entries(counts).map(([k, v]) => <span key={k} className={`text-[10px] uppercase px-1.5 border ${STATUS_CLS[k]}`}>{v} {k}</span>)}
        <span className="text-[10px] uppercase px-1.5 border border-kind-service/60 text-kind-service">{r.refusals.length} refused</span>
      </div>

      <SectionTitle>The change explains itself</SectionTitle>
      <ol className="list-decimal ml-4 space-y-1 text-xs text-neutral-300 leading-relaxed">{r.story.map((s, i) => <li key={i}>{s}</li>)}</ol>

      <SectionTitle right={<span className="text-[10px] text-on-surface-faint">click to see the change</span>}>Read these</SectionTitle>
      <div className="space-y-0.5">
        {r.readList.map((x) => (
          <button key={x.key} onClick={() => select(x.key)} className={`w-full text-left px-2 py-1.5 border ${selectedKey === x.key ? "border-schema-accent bg-surface-container-high" : "border-transparent hover:bg-surface-container"}`}>
            <div className="text-xs font-[JetBrains_Mono] text-white break-all">{shortKey(x.key)}</div>
            <div className="text-[11px] text-phase-applying">{x.why.join(" · ")}</div>
          </button>
        ))}
      </div>
      {sel && <MemberDetail m={sel} />}

      <SectionTitle>Why this tier</SectionTitle>
      {r.risk.factors.map((f) => (
        <details key={f.id} className="py-1 border-b border-outline-variant/40">
          <summary className="text-xs text-neutral-200 cursor-pointer"><span className="font-[JetBrains_Mono] text-phase-applying mr-2">+{f.points}</span>{f.label}</summary>
          <ul className="ml-6 mt-1 space-y-0.5">{f.evidence.map((e, i) => <li key={i} className="text-[11px] text-on-surface-variant">{e.label}{e.ref && <span className="ml-1 font-[JetBrains_Mono] text-on-surface-muted">{shortKey(e.ref)}</span>}</li>)}</ul>
        </details>
      ))}

      <SectionTitle>Claims · decided by evidence</SectionTitle>
      {r.claims.map((c) => <ClaimRow key={c.id} c={c} />)}

      <SectionTitle>Not checked</SectionTitle>
      <ul className="space-y-1">{r.notChecked.filter((n) => !n.why.startsWith("Refused")).map((n) => <li key={n.what} className="text-[11px] text-on-surface-variant"><span className="text-neutral-200">{n.what}</span>: {n.why}</li>)}</ul>
    </div>
  );
}

function SignoffTab() {
  const r = useTrust((s) => s.receipt);
  const pr = useTrust((s) => s.pr);
  const verify = useTrust((s) => s.verify);
  const log = useTrust((s) => s.log);
  const busy = useTrust((s) => s.busy);
  const openPr = useTrust((s) => s.openPr);
  const verifyPr = useTrust((s) => s.verifyPr);
  const signoff = useTrust((s) => s.signoff);
  const [owner, setOwner] = useState("");
  const [decision, setDecision] = useState("accept");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [risk, setRisk] = useState("");
  const [notes, setNotes] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => { setAnswers({}); setChecked({}); setRisk(""); setNotes(""); }, [r?.id]);
  if (!r) return <div className="text-xs text-on-surface-muted py-6">No receipt yet.</div>;
  const open = r.refusals.filter((q) => !answers[q.question]?.trim()).length;
  const canSign = !!owner.trim() && !!risk.trim() && (decision !== "accept" || open === 0);
  const input = "w-full bg-surface border border-outline-variant px-3 py-2 text-xs text-white outline-none focus:border-neutral-500";

  return (
    <div>
      <SectionTitle>Pull request</SectionTitle>
      {!pr ? (
        <div className="space-y-2">
          <p className="text-[11px] text-on-surface-variant">Pushes {r.headSha.slice(0, 8)} to the private copy and opens a PR whose body is this receipt (digest included). The PR is never approved by the AI.</p>
          <Btn primary disabled={!!busy} onClick={() => void openPr()}>Open PR with receipt</Btn>
        </div>
      ) : (
        <div className="space-y-2">
          <a href={pr.url} target="_blank" rel="noreferrer" className="text-xs font-[JetBrains_Mono] text-kind-service hover:underline break-all">{pr.url}</a>
          <div><Btn disabled={!!busy} onClick={() => void verifyPr()}>Verify PR against receipt</Btn></div>
          {verify && (
            <ul className="space-y-1 mt-1">
              {verify.checks.map((c) => (
                <li key={c.check} className="flex items-start gap-2 text-[11px]">
                  <span className={`material-symbols-outlined text-[14px] ${c.ok ? "text-phase-pass" : "text-phase-fail"}`}>{c.ok ? "check_circle" : "cancel"}</span>
                  <span className="text-neutral-200">{c.check}</span>
                  <span className="ml-auto font-[JetBrains_Mono] text-on-surface-faint">{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <SectionTitle>Refused to decide · you answer</SectionTitle>
      {r.refusals.length === 0 && <div className="text-[11px] text-on-surface-muted">Nothing refused.</div>}
      {r.refusals.map((q) => (
        <div key={q.question} className="mb-3">
          <div className="text-xs text-white leading-snug">{q.question}</div>
          <div className="text-[11px] text-on-surface-variant mt-0.5 mb-1">{q.why}</div>
          {q.evidence.slice(0, 2).map((e, i) => e.detail && <pre key={i} className="mb-1 p-2 bg-surface text-[10.5px] font-[JetBrains_Mono] text-on-surface-muted whitespace-pre-wrap">{e.detail}</pre>)}
          <textarea className={`${input} min-h-[52px]`} placeholder="Your answer…" value={answers[q.question] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.question]: e.target.value })} />
        </div>
      ))}

      <SectionTitle>I checked</SectionTitle>
      {r.readList.map((x) => (
        <label key={x.key} className="flex items-start gap-2 py-0.5 text-[11px] text-neutral-300 cursor-pointer">
          <input type="checkbox" className="mt-[2px]" checked={!!checked[x.key]} onChange={(e) => setChecked({ ...checked, [x.key]: e.target.checked })} />
          <span className="font-[JetBrains_Mono] break-all">{shortKey(x.key)}</span>
        </label>
      ))}

      <SectionTitle>Residual risk I accept</SectionTitle>
      <textarea className={`${input} min-h-[60px]`} value={risk} onChange={(e) => setRisk(e.target.value)} placeholder="What could still be wrong, and why you accept it" />
      <textarea className={`${input} min-h-[40px] mt-2`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      <div className="flex gap-2 mt-2">
        <input className={input} placeholder="Your name (required)" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <select className="bg-surface border border-outline-variant px-2 text-xs text-white" value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="accept">accept</option>
          <option value="request-changes">request changes</option>
          <option value="reject">reject</option>
        </select>
      </div>
      {decision === "accept" && open > 0 && <div className="text-[11px] text-phase-applying mt-1">Answer all {open} refused question(s) to accept.</div>}
      <div className="mt-2">
        <Btn primary disabled={!canSign || !!busy} onClick={() => void signoff({
          owner, decision, residualRisk: risk, notes, refusalAnswers: answers,
          checkedByOwner: r.readList.filter((x) => checked[x.key]).map((x) => `Read ${shortKey(x.key)} (${x.why.join(", ")})`),
        })}>Sign {pr ? "and post to PR" : ""}</Btn>
      </div>

      <SectionTitle>Decision log</SectionTitle>
      <div className="space-y-1 max-h-48 overflow-auto">
        {log.slice().reverse().map((d, i) => (
          <div key={i} className="text-[10.5px] text-on-surface-variant">
            <span className="font-[JetBrains_Mono] text-on-surface-faint">{d.at.slice(11, 19)}</span> <span className="text-white">{d.actor}</span> {d.action} <span className="text-on-surface-muted">{d.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrustPanel() {
  const open = useTrust((s) => s.open);
  const tab = useTrust((s) => s.tab);
  const setTab = useTrust((s) => s.setTab);
  const close = useTrust((s) => s.close);
  const run = useTrust((s) => s.run);
  const receipt = useTrust((s) => s.receipt);
  const busy = useTrust((s) => s.busy);
  const error = useTrust((s) => s.error);
  if (!open) return null;
  const req = receipt?.requirement.id ?? run?.requirementId ?? "";
  const status = run?.status === "running" ? "agent running" : receipt ? receipt.risk.tierLabel : run?.status ?? "";
  return (
    <aside className="w-[460px] shrink-0 border-l border-outline-variant bg-surface-dim flex flex-col" aria-label="Agent PR review">
      <div className="px-5 py-4 border-b border-outline-variant flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base text-white truncate">{req} · {receipt?.requirement.title ?? run?.prompt ?? "Agent PR"}</h2>
          <p className="text-xs text-neutral-300 mt-0.5">AI reviews · a named human signs · {status}</p>
        </div>
        <button onClick={close} className="w-8 h-8 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-surface-container-high" aria-label="Close">
          <span className="material-symbols-outlined text-[18px] leading-none">close</span>
        </button>
      </div>
      <div className="flex border-b border-outline-variant text-xs">
        {([["agent", "Agent"], ["receipt", "Receipt"], ["signoff", "PR & sign-off"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 py-2.5 border-b-2 ${tab === id ? "border-schema-accent text-white" : "border-transparent text-on-surface-muted hover:text-white"}`}>{label}</button>
        ))}
      </div>
      {(busy || error) && (
        <div className={`px-5 py-2 text-[11px] border-b border-outline-variant ${error ? "text-phase-fail" : "text-phase-applying"}`}>
          {busy && <span className="inline-block w-1.5 h-1.5 rounded-full bg-phase-applying animate-pulse mr-2" />}{error ?? busy}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tab === "agent" && <AgentTab />}
        {tab === "receipt" && <ReceiptTab />}
        {tab === "signoff" && <SignoffTab />}
      </div>
    </aside>
  );
}

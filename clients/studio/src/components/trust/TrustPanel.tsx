"use client";

import { useEffect, useMemo, useState } from "react";
import { useTrust, type AgentStep, type Claim, type Receipt, type ReviewedMember } from "@/state/trust";
import ClaudeCrab from "@/components/ClaudeCrab";
import { Arrow } from "./ReviewList";

// Steps are neutral; only an edit, the one thing that changes code, takes the agent's accent.
const STEP_ICON: Record<string, [string, string]> = {
  read: ["description", "text-on-surface-muted"],
  search: ["search", "text-on-surface-muted"],
  edit: ["edit", "text-accent"],
  command: ["terminal", "text-on-surface-muted"],
  thought: ["psychology", "text-on-surface-faint"],
  note: ["sticky_note_2", "text-on-surface-faint"],
  result: ["flag", "text-on-surface-variant"],
};

export const STATUS_CLS: Record<string, string> = {
  verified: "ui-chip-pass",
  partial: "ui-chip-warn",
  heuristic: "ui-chip-warn",
  unverified: "",
  contradicted: "ui-chip-fail",
};

export const TIER_CLS: Record<string, string> = {
  light: "ui-chip-pass",
  focused: "ui-chip-warn",
  full: "ui-chip-fail",
};

export const shortKey = (key: string) => {
  if (key.includes("/")) return key.split("/").pop() ?? key;
  const noParams = key.replace(/\(.*\)$/, "");
  const ctor = noParams.match(/^(.*)\.(\.c?ctor)$/);
  if (ctor) return `${ctor[1]!.split(".").pop()}.${ctor[2]!.slice(1)}`;
  return noParams.split(".").slice(-2).join(".");
};

/** Section heading: a rule above, more space above than below, nothing beside it but a count. */
export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="ui-rule flex items-baseline justify-between gap-3 mt-5 pt-5 mb-1">
      <h3 className="ui-section">{children}</h3>
      {right}
    </div>
  );
}

function Btn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`ui-btn ${primary ? "ui-btn-primary" : ""}`}>
      {children}
    </button>
  );
}

function StepRow({ s }: { s: AgentStep }) {
  const [open, setOpen] = useState(false);
  const [icon, color] = STEP_ICON[s.kind] ?? ["build", "text-on-surface-muted"];
  return (
    <div>
      <button onClick={() => s.detail && setOpen(!open)} aria-expanded={s.detail ? open : undefined} className={`w-full flex items-start gap-2.5 text-left px-2 py-1.5 rounded-[8px] ${s.detail ? "cursor-pointer hover:bg-[var(--ui-fill)]" : "cursor-default"}`}>
        <span className={`material-symbols-outlined text-[15px] mt-[2px] ${color}`} style={{ fontVariationSettings: "'wght' 300" }}>{icon}</span>
        <span className={`${s.kind === "thought" ? "ui-meta" : "ui-code text-on-surface-variant"} break-words min-w-0 leading-relaxed`}>{s.title}</span>
      </button>
      {open && s.detail && (
        <pre className="ui-fade ui-well ml-8 mt-1 mb-2 p-3 ui-code text-on-surface-variant whitespace-pre-wrap [overflow-wrap:anywhere] max-h-56 overflow-auto">{s.detail}</pre>
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
    return <p className="ui-body py-6">The organisers' agent wrote this change, so there is no run transcript. The receipt has the evidence.</p>;
  }
  return (
    <div>
      <p className="ui-meta leading-relaxed tabular-nums">
        {(["read", "search", "edit", "command"] as const).map((k) => `${counts[k] ?? 0} ${k}${k === "search" ? "es" : "s"}`).join(", ")}
        {run.turns ? ` in ${run.turns} turns` : ""}
      </p>
      <p className="ui-meta ui-code mt-1 break-words">{run.model ?? "claude"} on {run.branch}, {run.baseSha.slice(0, 8)}..{run.headSha?.slice(0, 8) ?? "working"}</p>

      {run.status === "running" && (
        <p className="flex items-center gap-2.5 mt-4 text-[0.8125rem] text-on-surface-variant">
          <ClaudeCrab walking />
          {run.steps.length === 0 ? "Starting. First output takes 15 to 30 seconds." : "Working in its own worktree. It cannot push, open PRs or sign."}
        </p>
      )}
      {run.status === "failed" && <p className="ui-chip ui-chip-fail mt-4 !whitespace-normal !items-start">{run.error}</p>}

      {decisions.length > 0 && (
        <>
          <SectionTitle>Claude decided</SectionTitle>
          {run.summary && <p className="ui-body py-2">{run.summary}</p>}
          <div className="ui-divide">
            {decisions.map((d, i) => (
              <div key={i} className="py-3">
                <p className="text-[0.875rem] leading-snug font-medium text-on-surface">{d.decision}</p>
                <p className="ui-meta mt-1 leading-relaxed">{d.confidence === "unsure" && <span className="ui-chip ui-chip-warn mr-2">Unsure</span>}{d.why}</p>
                {d.alternatives && <p className="ui-meta mt-1 leading-relaxed">Alternative: {d.alternatives}</p>}
                {d.evidence && <p className="ui-meta ui-code mt-1 break-words">{d.evidence}</p>}
              </div>
            ))}
          </div>
          {run.openQuestions.length > 0 && (
            <>
              <SectionTitle>Your call</SectionTitle>
              <ul className="ui-divide">{run.openQuestions.map((q) => <li key={q} className="py-3 text-[0.8125rem] leading-relaxed text-on-surface-variant">{q}</li>)}</ul>
            </>
          )}
        </>
      )}

      {run.status === "done" && (
        <div className="flex gap-2 mt-4">
          <Btn primary onClick={() => setTab("receipt")}>Open the receipt</Btn>
          <Btn onClick={() => void showHead()}>Show on the map</Btn>
        </div>
      )}

      <SectionTitle right={<span className="ui-meta tabular-nums">{run.steps.length}</span>}>Steps</SectionTitle>
      <div className="-mx-2 mt-1">
        {run.steps.map((s) => <StepRow key={s.i} s={s} />)}
      </div>
    </div>
  );
}

function ClaimRow({ c }: { c: Claim }) {
  const [open, setOpen] = useState(false);
  const select = useTrust((s) => s.selectMember);
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-start gap-3 py-3 text-left cursor-pointer group">
        <span className="flex-1 min-w-0">
          <span className="block text-[0.8125rem] leading-relaxed text-on-surface-variant group-hover:text-on-surface transition-colors">{c.text}</span>
          <span className="mt-1 flex items-center gap-2.5 ui-meta">
            <span className={`ui-chip capitalize ${STATUS_CLS[c.status]}`}>{c.status}</span>
            <span className="truncate">by {c.decidedBy}</span>
          </span>
        </span>
        <span className={`material-symbols-outlined text-[16px] mt-1 text-on-surface-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}>chevron_right</span>
      </button>
      {open && (
        <ul className="ui-fade pb-3 space-y-2">
          {c.evidence.map((e, i) => (
            <li key={i} className="ui-meta leading-relaxed">
              {e.label}
              {e.ref && <button onClick={() => select(e.ref!)} className="ml-2 ui-code text-on-surface-variant underline hover:text-on-surface">{shortKey(e.ref)}</button>}
              {e.detail && <pre className="ui-well mt-1.5 p-3 whitespace-pre-wrap [overflow-wrap:anywhere] ui-code text-on-surface-variant max-h-40 overflow-auto">{e.detail}</pre>}
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
    <div className="ui-fade ui-well mt-2 mb-3 overflow-hidden">
      <p className="px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 ui-meta">
        {m.changes.map((c) => <span key={c}>{c}</span>)}
        {m.flags.map((f) => <span key={f} className="ui-chip ui-chip-fail">{f.replace("wires-in:", "wires in ")}</span>)}
        <span className="ml-auto tabular-nums">{m.directCallers} callers, {m.tests.length} tests reach it</span>
      </p>
      <pre className="ui-code leading-[1.6] max-h-72 overflow-auto py-1">
        {context.map((l, i) => (
          <div key={i} className={l.k === "+" ? "bg-phase-pass/10 text-phase-pass" : l.k === "-" ? "bg-phase-fail/10 text-phase-fail" : "text-on-surface-muted"}>
            <span className="inline-block w-4 text-center opacity-60">{l.k}</span>{l.t}
          </div>
        ))}
      </pre>
      {m.tests[0] && (
        <p className="px-3.5 py-2.5 ui-meta ui-code break-words">
          {m.tests[0].path.filter((p, i) => p !== m.tests[0]!.path[i - 1]).join(" → ")}
        </p>
      )}
    </div>
  );
}

/** The one number that matters: how much of the change a human still has to read. */
export function TierCard({ r }: { r: Receipt }) {
  const pct = Math.max(1.5, (100 * r.summary.readLines) / Math.max(1, r.summary.totalLines));
  return (
    <div>
      <p className="text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.035em] text-on-surface tabular-nums">
        Read {r.summary.readLines} of {r.summary.totalLines} lines
      </p>
      <div className="h-[3px] rounded-full bg-[var(--ui-fill-hover)] mt-3.5 overflow-hidden" role="img" aria-label={`${r.summary.readLines} of ${r.summary.totalLines} changed lines need an owner's read`}>
        <div className="h-full rounded-full bg-on-surface" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 ui-meta">
        <span className={`ui-chip ${TIER_CLS[r.risk.tier] ?? ""}`}>{r.risk.tierLabel}</span>
        <span className="tabular-nums">Risk score {r.risk.score}</span>
      </p>
      <p className="ui-body !text-[0.8125rem] mt-2">{r.risk.tierMeaning}</p>
      {r.risk.trustAdjustments.map((t) => <p key={t} className="ui-meta mt-1.5">{t}</p>)}
    </div>
  );
}

/** The change in a few plain sentences, as an ordered list without decoration. */
export function Story({ lines }: { lines: string[] }) {
  return (
    <ol className="ui-divide">
      {lines.map((s, i) => <li key={i} className="py-2.5 text-[0.8125rem] leading-relaxed text-on-surface-variant">{s}</li>)}
    </ol>
  );
}

function ReceiptTab() {
  const r = useTrust((s) => s.receipt);
  const selectedKey = useTrust((s) => s.selectedKey);
  const select = useTrust((s) => s.selectMember);
  if (!r) return <p className="ui-body py-6">The receipt is built when the agent finishes.</p>;
  const counts: Record<string, number> = {};
  for (const c of r.claims) counts[c.status] = (c.status in counts ? counts[c.status]! : 0) + 1;
  const sel = r.members.find((m) => m.key === selectedKey);
  return (
    <div>
      <TierCard r={r} />

      <SectionTitle>What changed</SectionTitle>
      <Story lines={r.story} />

      {r.readList.length > 0 && (
        <>
          <SectionTitle right={<span className="ui-meta tabular-nums">{r.readList.length}</span>}>Read these</SectionTitle>
          <div className="ui-divide">
            {r.readList.map((x) => (
              <div key={x.key}>
                <button onClick={() => select(x.key)} aria-expanded={selectedKey === x.key} className="ui-action !items-start py-3">
                  <span className="min-w-0">
                    <span className="block ui-code text-on-surface break-all">{shortKey(x.key)}</span>
                    <span className="block ui-meta mt-1 font-normal">{x.why.join(", ")}</span>
                  </span>
                  <Arrow />
                </button>
                {sel && selectedKey === x.key && <MemberDetail m={sel} />}
              </div>
            ))}
          </div>
        </>
      )}

      {r.risk.factors.length > 0 && (
        <>
          <SectionTitle>Why this tier</SectionTitle>
          <div className="ui-divide">
            {r.risk.factors.map((f) => (
              <details key={f.id} className="py-3 group">
                <summary className="flex items-center gap-3 text-[0.8125rem] text-on-surface-variant cursor-pointer list-none">
                  <span className="flex-1">{f.label}</span>
                  <span className="ui-meta tabular-nums">+{f.points}</span>
                  <span className="material-symbols-outlined text-[16px] text-on-surface-faint transition-transform duration-200 group-open:rotate-90">chevron_right</span>
                </summary>
                <ul className="mt-2 space-y-1">{f.evidence.map((e, i) => <li key={i} className="ui-meta">{e.label}{e.ref && <span className="ml-1.5 ui-code">{shortKey(e.ref)}</span>}</li>)}</ul>
              </details>
            ))}
          </div>
        </>
      )}

      <SectionTitle right={<span className="ui-meta tabular-nums">{counts.verified ?? 0} of {r.claims.length} verified</span>}>Claims</SectionTitle>
      <div className="ui-divide">{r.claims.map((c) => <ClaimRow key={c.id} c={c} />)}</div>

      <SectionTitle>Not checked</SectionTitle>
      <ul className="ui-divide">
        {r.notChecked.filter((n) => !n.why.startsWith("Refused")).map((n) => (
          <li key={n.what} className="py-3">
            <p className="text-[0.8125rem] leading-relaxed text-on-surface-variant">{n.what}</p>
            <p className="ui-meta mt-1 leading-relaxed">{n.why}</p>
          </li>
        ))}
      </ul>
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
  if (!r) return <p className="ui-body py-6">No receipt yet.</p>;
  const open = r.refusals.filter((q) => !answers[q.question]?.trim()).length;
  const canSign = !!owner.trim() && !!risk.trim() && (decision !== "accept" || open === 0);
  const label = "block text-[0.8125rem] font-medium text-on-surface mb-1.5";

  return (
    <div>
      {!pr ? (
        <div>
          <p className="ui-body !text-[0.8125rem]">No pull request yet. Opening one pushes <span className="ui-code">{r.headSha.slice(0, 8)}</span> with this receipt as its description. The AI never approves it.</p>
          <div className="mt-3"><Btn primary disabled={!!busy} onClick={() => void openPr()}>Open the pull request</Btn></div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-3">
            <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.875rem] font-medium text-on-surface hover:underline">
              Pull request #{pr.number}
              <span className="material-symbols-outlined text-[15px] text-on-surface-muted" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">arrow_outward</span>
            </a>
            <button disabled={!!busy} onClick={() => void verifyPr()} className="ui-btn ml-auto">Check against receipt</button>
          </div>
          {verify && (
            <ul className="ui-fade ui-divide mt-2">
              {verify.checks.map((c) => (
                <li key={c.check} className="py-2 flex items-baseline gap-3">
                  <span className={`ui-chip !whitespace-normal ${c.ok ? "ui-chip-pass" : "ui-chip-fail"}`}>{c.check}</span>
                  <span className="ml-auto ui-meta ui-code text-right">{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <SectionTitle right={r.refusals.length ? <span className="ui-meta tabular-nums">{r.refusals.length - open} of {r.refusals.length} answered</span> : undefined}>Your answers</SectionTitle>
      {r.refusals.length === 0 && <p className="ui-meta py-2">The review left nothing for you to answer.</p>}
      <div className="ui-divide">
        {r.refusals.map((q, qi) => (
          <div key={q.question} className="py-4">
            <label htmlFor={`refusal-${qi}`} className="block text-[0.875rem] leading-snug font-medium text-on-surface">{q.question}</label>
            <p className="ui-meta mt-1.5 leading-relaxed">{q.why}</p>
            {q.evidence.slice(0, 2).map((e, i) => e.detail && <pre key={i} className="ui-well mt-2.5 p-3 ui-code text-on-surface-variant whitespace-pre-wrap [overflow-wrap:anywhere] max-h-40 overflow-auto">{e.detail}</pre>)}
            <textarea id={`refusal-${qi}`} className="ui-input min-h-[60px] mt-3" placeholder="Answer" value={answers[q.question] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.question]: e.target.value })} />
          </div>
        ))}
      </div>

      {r.readList.length > 0 && (
        <>
          <SectionTitle>I read these</SectionTitle>
          <div className="ui-divide">
            {r.readList.map((x) => (
              <label key={x.key} className="flex items-center gap-3 py-2.5 cursor-pointer">
                <input type="checkbox" className="accent-white w-4 h-4" checked={!!checked[x.key]} onChange={(e) => setChecked({ ...checked, [x.key]: e.target.checked })} />
                <span className="ui-code text-on-surface-variant break-all">{shortKey(x.key)}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Decision</SectionTitle>
      <div className="space-y-4 pt-2">
        <div className="ui-seg" role="group" aria-label="Decision">
          {([["accept", "Accept"], ["request-changes", "Request changes"], ["reject", "Reject"]] as const).map(([id, text]) => (
            <button key={id} type="button" aria-pressed={decision === id} onClick={() => setDecision(id)}>{text}</button>
          ))}
        </div>
        <div>
          <label htmlFor="signoff-risk" className={label}>Risk you accept</label>
          <textarea id="signoff-risk" className="ui-input min-h-[64px]" value={risk} onChange={(e) => setRisk(e.target.value)} placeholder="What could still be wrong, and why that is acceptable" />
        </div>
        <div>
          <label htmlFor="signoff-notes" className={label}>Notes</label>
          <textarea id="signoff-notes" className="ui-input min-h-[44px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label htmlFor="signoff-owner" className={label}>Your name</label>
          <input id="signoff-owner" className="ui-input" value={owner} onChange={(e) => setOwner(e.target.value)} autoComplete="name" />
        </div>
      </div>
      {decision === "accept" && open > 0 && <p className="ui-chip ui-chip-warn mt-3">Answer {open} more question{open === 1 ? "" : "s"} to accept</p>}
      <button
        className="ui-btn ui-btn-primary ui-btn-lg w-full !justify-between mt-3"
        disabled={!canSign || !!busy}
        onClick={() => void signoff({
          owner, decision, residualRisk: risk, notes, refusalAnswers: answers,
          checkedByOwner: r.readList.filter((x) => checked[x.key]).map((x) => `Read ${shortKey(x.key)} (${x.why.join(", ")})`),
        })}
      >
        Sign
        <Arrow />
      </button>

      <SectionTitle>Log</SectionTitle>
      <DecisionLog rows={log.slice().reverse()} />
    </div>
  );
}

/** Who did what, newest first. */
export function DecisionLog({ rows }: { rows: { at: string; actor: string; action: string; detail: string }[] }) {
  return (
    <div className="ui-divide max-h-64 overflow-auto">
      {rows.map((d, i) => (
        <p key={i} className="py-2.5 ui-meta leading-relaxed">
          <span className="text-on-surface-variant">{d.actor}</span> {d.action.replace(/[:_]/g, " ")} at <span className="tabular-nums">{d.at.slice(11, 16)}</span>
          <span className="block break-words">{d.detail}</span>
        </p>
      ))}
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
  const TABS = [["agent", "Agent"], ["receipt", "Receipt"], ["signoff", "Sign-off"]] as const;
  return (
    <aside className="w-[440px] shrink-0 ui-panel flex flex-col" aria-label="Agent PR review">
      <div className="px-5 pt-5">
        <div className="flex items-start gap-3">
          <h2 className="ui-title flex-1">{receipt?.requirement.title ?? run?.prompt ?? "Agent PR"}</h2>
          <button onClick={close} className="ui-icon-btn -mr-1 -mt-1" aria-label="Close review">
            <span className="material-symbols-outlined text-[18px] leading-none">close</span>
          </button>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 ui-meta">
          <span className="ui-code">{req}</span>
          {run?.status === "running"
            ? <span className="inline-flex items-center gap-1.5"><ClaudeCrab size={15} walking />Claude is working</span>
            : receipt ? <span className={`ui-chip ${TIER_CLS[receipt.risk.tier] ?? ""}`}>{receipt.risk.tierLabel}</span> : null}
        </p>
        <div className="ui-tabs mt-3" role="tablist" aria-label="Review sections">
          {TABS.map(([id, text]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{text}</button>
          ))}
        </div>
      </div>
      {(busy || error) && (
        <p className={`ui-fade ui-rule mx-5 py-2.5 ui-chip !whitespace-normal ${error ? "ui-chip-fail" : "ui-chip-info ui-chip-live"}`} role="status">{error ?? busy}</p>
      )}
      <div key={tab} className="ui-fade flex-1 overflow-y-auto px-5 pt-5 pb-6" role="tabpanel">
        {tab === "agent" && <AgentTab />}
        {tab === "receipt" && <ReceiptTab />}
        {tab === "signoff" && <SignoffTab />}
      </div>
    </aside>
  );
}

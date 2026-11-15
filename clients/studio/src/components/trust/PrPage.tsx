"use client";

import { useEffect, useMemo, useState } from "react";
import { callTool } from "@/mcp-client";
import SchemaLogo from "@/components/SchemaLogo";
import type { AgentRun, Decision, PrRecord, Receipt, RepoMap } from "@/state/trust";
import { ACT_COLOR, type ActKind } from "./RepoGraph";
import GraphCanvas from "@/components/canvas/GraphCanvas";
import { applyCanvasMarks, loadCurated } from "@/lib/curatedGraph";
import { eventsFor, marksAt } from "./RepoMap";
import { shortKey, STATUS_CLS, TierCard } from "./TrustPanel";

interface PageData {
  page: { slug: string; prNumber: number; prUrl: string; branch: string; requirementId: string; baseSha: string; state: string; checkedAt: string; revisions: { receiptId: string; headSha: string; at: string; reason: string }[] };
  receipt: Receipt; run: AgentRun | null; map: RepoMap; pr: PrRecord | null; repo: string;
  signoff: { owner: string; decision: string; at: string; residualRisk: string } | null;
  decisions: Decision[];
}

const STEP_ICON: Record<string, string> = { read: "description", search: "search", edit: "edit", command: "terminal", thought: "psychology", note: "sticky_note_2", result: "flag" };

function H({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3 mt-7 mb-2.5"><h3 className="ui-section">{children}</h3>{right}</div>;
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export default function PrPage({ slug }: { slug: string }) {
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"before" | "path" | "after">("path");
  const [head, setHead] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    let n = 0;
    const load = async () => {
      try {
        const d = await callTool<PageData>("pr.page", { slug, refresh: n++ % 5 === 0 });
        if (alive) { setData(d); setError(null); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    const t = setInterval(load, 4000);
    const c = setInterval(() => tick((x) => x + 1), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(c); };
  }, [slug]);

  const events = useMemo(() => (data ? eventsFor(data.map, data.run, data.receipt) : []), [data]);
  useEffect(() => {
    if (mode !== "path" || !playing || !events.length) return;
    const t = setInterval(() => setHead((h) => { if (h >= events.length) { setPlaying(false); return h; } return h + 1; }), 280);
    return () => clearInterval(t);
  }, [mode, playing, events.length]);

  useEffect(() => { if (data) loadCurated(data.map, data.receipt.repo, `PR #${data.page.prNumber}`); }, [data?.map.sha]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive Schema's canvas highlights for the selected mode.
  useEffect(() => {
    if (!data) return;
    const mk = mode === "before" ? marksAt(data.map, [], 0, null, false)
      : mode === "after" ? marksAt(data.map, events, events.length, data.receipt, true)
      : marksAt(data.map, events, head, data.receipt, false);
    applyCanvasMarks({
      current: mk.current?.node ?? null,
      recent: mode === "path" ? [...new Set(events.slice(Math.max(0, head - 5), head).map((e) => e.node))] : [],
      changed: new Set([...(mk.edited ?? []), ...(mk.changed ?? [])]),
      added: mk.added,
      flagged: mk.flagged,
    });
  }, [data, mode, head, events]);

  useEffect(() => { document.title = data ? `PR #${data.page.prNumber} · ${data.receipt.requirement.id} · Schema` : "Schema review"; }, [data]);

  if (error && !data) {
    return (
      <div className="fixed inset-0 bg-surface flex flex-col items-center justify-center text-center px-6">
        <SchemaLogo className="w-9 h-9 mb-6" />
        <p className="ui-title">This review page could not load</p>
        <p className="ui-body mt-2 max-w-md">The review server did not return the pull request. It retries every few seconds.</p>
        <p className="ui-meta ui-code mt-3 text-phase-fail">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="fixed inset-0 bg-surface flex flex-col items-center justify-center gap-5" aria-busy="true">
        <SchemaLogo className="w-9 h-9 schema-skeleton" />
        <p className="ui-meta">Loading the review</p>
      </div>
    );
  }

  const r = data.receipt;
  const run = data.run;
  const current = mode === "path" ? events[head - 1] : undefined;

  const steps = run?.steps.filter((s) => s.kind !== "thought" && s.kind !== "note") ?? [];
  const latestRev = data.page.revisions[data.page.revisions.length - 1]!;
  const isOpen = data.page.state === "OPEN";

  return (
    <div className="fixed inset-0 bg-surface text-on-surface flex flex-col">
      <header className="h-14 shrink-0 flex items-center gap-3 px-5">
        <SchemaLogo className="w-7 h-7 shrink-0" />
        <div className="min-w-0 flex items-baseline gap-2.5">
          <h1 className="text-[0.9375rem] font-semibold tracking-[-0.02em] truncate">{r.requirement.title}</h1>
          <span className="ui-meta shrink-0 hidden md:inline">PR #{data.page.prNumber} in {data.repo}</span>
        </div>
        <span className={`ui-chip ml-auto shrink-0 ${isOpen ? "ui-chip-pass" : "ui-chip-info"}`}>{isOpen ? "Open" : data.page.state.charAt(0) + data.page.state.slice(1).toLowerCase()}</span>
        <span className="hidden lg:flex items-center gap-1.5 ui-meta shrink-0" title={`${data.page.branch} · ${r.baseSha.slice(0, 8)}..${r.headSha.slice(0, 8)} · revision ${data.page.revisions.length}`}>
          <span className="ui-dot text-phase-pass animate-pulse" />Live, checked {ago(data.page.checkedAt)}
        </span>
        <a href={data.page.prUrl} target="_blank" rel="noreferrer" className="ui-btn ui-btn-pill shrink-0">
          View on GitHub
          <span className="material-symbols-outlined text-[15px] -mr-0.5" style={{ fontVariationSettings: "'wght' 300" }}>arrow_outward</span>
        </a>
      </header>

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 relative">
          <GraphCanvas />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 ui-seg !bg-[var(--ui-glass)] backdrop-blur-xl" role="group" aria-label="Which state of the repo to show">
            {([["before", "Before"], ["path", "Agent's path"], ["after", "After"]] as const).map(([id, label]) => (
              <button key={id} aria-pressed={mode === id} onClick={() => { setMode(id); if (id === "path") { setHead(0); setPlaying(true); } }}>
                {label}
              </button>
            ))}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 bottom-5 w-[min(680px,calc(100%-7rem))] ui-panel !rounded-[22px] px-4 py-3 z-10" style={{ animationName: "ui-rise" }}>
            {mode === "path" ? (
              <>
                <div className="flex items-center gap-3">
                  <button onClick={() => { if (head >= events.length) setHead(0); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Play"} className="ui-icon-btn !bg-on-surface !text-surface shrink-0">
                    <span className="material-symbols-outlined text-[18px]">{playing ? "pause" : "play_arrow"}</span>
                  </button>
                  <input type="range" min={0} max={events.length} value={head} aria-label="Step through the agent's path" onChange={(e) => { setPlaying(false); setHead(Number(e.target.value)); }} className="flex-1 accent-white h-1" />
                  <span className="ui-meta ui-code tabular-nums w-14 text-right">{head} / {events.length}</span>
                </div>
                <p className="mt-2 pl-11 text-[0.8125rem] truncate">
                  {current
                    ? <><span className="font-medium capitalize" style={{ color: ACT_COLOR[current.kind as ActKind] }}>{current.kind}</span> <span className="ui-code text-on-surface-variant ml-1">{current.title.replace(new RegExp(`^${current.kind}\\s+`, "i"), "")}</span></>
                    : <span className="text-on-surface-muted">The agent's route through the repo, one step at a time.</span>}
                </p>
              </>
            ) : mode === "before" ? (
              <p className="ui-body !text-[0.8125rem] px-1">The repo at <span className="ui-code">{r.baseSha.slice(0, 8)}</span>, before the agent started: {data.map.nodes.length} components in {data.map.groups.length} modules. Size shows how much each type is used.</p>
            ) : (
              <p className="ui-body !text-[0.8125rem] px-1">After <span className="ui-code">{r.headSha.slice(0, 8)}</span>: <span className="text-[#fbbf24]">changed</span> ({r.members.length} members), <span className="text-[#f87171]">flagged by review</span>, <span className="text-[#4ade80]">new files</span>. Numbers show changed lines.</p>
            )}
          </div>
        </main>

        <aside className="w-[460px] shrink-0 m-3 ml-0 mt-0 ui-panel overflow-y-auto px-5 pt-5 pb-10" aria-label="Review">
          <TierCard r={r} />
          <div className="ui-card mt-2 px-4 py-3 flex items-start gap-2.5">
            {data.signoff ? (
              <>
                <span className="material-symbols-outlined text-[18px] text-phase-pass mt-px">verified</span>
                <p className="text-[0.8125rem] leading-snug text-on-surface">Signed by {data.signoff.owner}<span className="block ui-meta mt-0.5">{data.signoff.decision.charAt(0).toUpperCase() + data.signoff.decision.slice(1).replace("-", " ")}, {ago(data.signoff.at)}</span></p>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px] text-phase-testing mt-px">pending</span>
                <p className="text-[0.8125rem] leading-snug text-on-surface">Waiting for a named owner to sign<span className="block ui-meta mt-0.5">{r.refusals.length} question{r.refusals.length === 1 ? "" : "s"} to answer first</span></p>
              </>
            )}
          </div>
          <p className="ui-meta mt-3 px-1">AI review is advice with evidence. It never approves.</p>

          <H>What changed, in order</H>
          <ol className="space-y-2.5">
            {r.story.map((s, i) => (
              <li key={i} className="flex gap-3 ui-body !text-[0.8125rem]">
                <span className="shrink-0 w-5 h-5 mt-px rounded-full bg-[var(--ui-fill)] text-[0.6875rem] font-medium text-on-surface-variant flex items-center justify-center tabular-nums">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          {run && (
            <>
              <H right={<span className="ui-meta">{run.model}, {run.turns ?? "?"} turns</span>}>Decisions the agent made</H>
              {run.summary && <p className="ui-body mb-3">{run.summary}</p>}
              <div className="space-y-2">
                {run.decisions.map((d, i) => (
                  <div key={i} className="ui-card px-4 py-3.5">
                    <div className="flex items-start gap-2">
                      <p className="text-[0.875rem] leading-snug font-medium text-on-surface flex-1">{d.decision}</p>
                      {d.confidence === "unsure" && <span className="ui-chip ui-chip-warn shrink-0">Unsure</span>}
                    </div>
                    <p className="ui-body !text-[0.8125rem] mt-1.5">{d.why}</p>
                  </div>
                ))}
              </div>
              <H right={<span className="ui-meta">{steps.length} steps, select one to jump</span>}>Everything it did</H>
              <div className="-mx-2">
                {steps.map((s) => {
                  const idx = events.findIndex((e) => e.title === s.title);
                  return (
                    <button key={s.i} onClick={() => { if (idx >= 0) { setMode("path"); setPlaying(false); setHead(idx + 1); } }} className="w-full flex items-start gap-2.5 text-left px-2 py-1.5 rounded-[8px] hover:bg-[var(--ui-fill)] transition-colors">
                      <span className="material-symbols-outlined text-[15px] mt-[2px]" style={{ color: ACT_COLOR[s.kind as ActKind] ?? "#a1a1aa", fontVariationSettings: "'wght' 300" }}>{STEP_ICON[s.kind] ?? "build"}</span>
                      <span className="ui-code text-on-surface-variant break-all leading-relaxed">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <H right={<span className="ui-meta">decided by evidence</span>}>Claims</H>
          <div className="ui-divide">
            {r.claims.map((c) => (
              <div key={c.id} className="py-3">
                <div className="flex items-center gap-2">
                  <span className={`ui-chip capitalize ${STATUS_CLS[c.status]}`}>{c.status}</span>
                  <span className="ui-meta ui-code truncate">{c.decidedBy}</span>
                </div>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-on-surface-variant">{c.text}</p>
              </div>
            ))}
          </div>

          <H>Left for the owner to decide</H>
          {r.refusals.length === 0 ? <p className="ui-meta">The review refused nothing.</p> : (
            <div className="space-y-2">
              {r.refusals.map((q) => (
                <div key={q.question} className="ui-card px-4 py-3.5">
                  <p className="text-[0.875rem] leading-snug font-medium text-on-surface">{q.question}</p>
                  <p className="ui-meta mt-1.5 leading-relaxed">{q.why}</p>
                </div>
              ))}
            </div>
          )}

          {r.readList.length > 0 && (
            <>
              <H>Read these yourself</H>
              <div className="space-y-1.5">
                {r.readList.map((x) => (
                  <div key={x.key} className="ui-card px-3.5 py-3">
                    <div className="ui-code text-on-surface break-all">{shortKey(x.key)}</div>
                    <div className="ui-meta mt-1">{x.why.join(" · ")}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <H right={<span className="ui-meta">updates as the PR changes</span>}>Revisions</H>
          {data.page.revisions.slice().reverse().map((rev, i) => (
            <div key={rev.receiptId} className="flex items-baseline gap-2.5 text-[0.8125rem] py-1">
              <span className={`ui-code ${i === 0 ? "text-on-surface" : "text-on-surface-muted"}`}>{rev.headSha.slice(0, 8)}</span>
              <span className="text-on-surface-variant">{rev.reason}</span>
              <span className="ml-auto ui-meta">{ago(rev.at)}</span>
            </div>
          ))}
          <p className="ui-meta ui-code text-on-surface-faint mt-1.5 break-all">Receipt {latestRev.receiptId} · digest {(r as Receipt & { digest?: string }).digest?.slice(0, 12)}</p>

          <H>Decision log</H>
          <div className="space-y-2">
            {data.decisions.slice().reverse().slice(0, 20).map((d, i) => (
              <div key={i} className="ui-meta leading-relaxed">
                <span className="ui-code text-on-surface-faint tabular-nums mr-2">{d.at.slice(11, 16)}</span>
                <span className="text-on-surface-variant">{d.actor}</span> {d.action.replace(/[:_]/g, " ")}
                <span className="block text-on-surface-faint break-words">{d.detail}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

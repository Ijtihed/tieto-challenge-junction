"use client";

import { useEffect, useMemo, useState } from "react";
import { callTool } from "@/mcp-client";
import SchemaLogo from "@/components/SchemaLogo";
import type { AgentRun, Decision, PrRecord, Receipt, RepoMap } from "@/state/trust";
import { ACT_COLOR, type ActKind } from "./RepoGraph";
import GraphCanvas from "@/components/canvas/GraphCanvas";
import { applyCanvasMarks, loadCurated } from "@/lib/curatedGraph";
import { eventsFor, marksAt } from "./RepoMap";
import { shortKey } from "./TrustPanel";

interface PageData {
  page: { slug: string; prNumber: number; prUrl: string; branch: string; requirementId: string; baseSha: string; state: string; checkedAt: string; revisions: { receiptId: string; headSha: string; at: string; reason: string }[] };
  receipt: Receipt; run: AgentRun | null; map: RepoMap; pr: PrRecord | null; repo: string;
  signoff: { owner: string; decision: string; at: string; residualRisk: string } | null;
  decisions: Decision[];
}

const STATUS: Record<string, string> = {
  verified: "text-phase-pass border-phase-pass/50", partial: "text-phase-applying border-phase-applying/50", heuristic: "text-phase-applying border-phase-applying/50",
  unverified: "text-on-surface-muted border-outline-variant", contradicted: "text-phase-fail border-phase-fail/50",
};
const TIER: Record<string, string> = { light: "text-phase-pass border-phase-pass", focused: "text-phase-applying border-phase-applying", full: "text-phase-fail border-phase-fail" };
const STEP_ICON: Record<string, string> = { read: "description", search: "search", edit: "edit", command: "terminal", thought: "psychology", note: "sticky_note_2", result: "flag" };

function H({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="flex items-baseline justify-between mt-6 mb-2"><h3 className="text-[11px] uppercase tracking-[0.14em] text-on-surface-muted">{children}</h3>{right}</div>;
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

  if (error && !data) return <div className="fixed inset-0 bg-surface flex items-center justify-center text-sm text-phase-fail">{error}</div>;
  if (!data) return <div className="fixed inset-0 bg-surface flex items-center justify-center text-xs text-on-surface-muted">Loading review page…</div>;

  const r = data.receipt;
  const run = data.run;
  const marks = mode === "before"
    ? marksAt(data.map, [], 0, null, false)
    : mode === "after" ? marksAt(data.map, events, events.length, r, true) : marksAt(data.map, events, head, r, false);
  const current = mode === "path" ? events[head - 1] : undefined;

  const steps = run?.steps.filter((s) => s.kind !== "thought" && s.kind !== "note") ?? [];
  const latestRev = data.page.revisions[data.page.revisions.length - 1]!;

  return (
    <div className="fixed inset-0 bg-surface text-white flex flex-col">
      <header className="h-14 shrink-0 border-b border-outline-variant flex items-center gap-4 px-5">
        <SchemaLogo className="w-7 h-7" />
        <div className="min-w-0">
          <div className="text-sm truncate"><span className="text-on-surface-muted">{data.repo} · </span>PR #{data.page.prNumber} · {r.requirement.title}</div>
          <div className="text-[11px] text-on-surface-muted font-[JetBrains_Mono]">{data.page.branch} · {r.baseSha.slice(0, 8)}..{r.headSha.slice(0, 8)} · revision {data.page.revisions.length}</div>
        </div>
        <span className={`ml-auto text-[11px] px-2 py-0.5 border ${data.page.state === "OPEN" ? "border-phase-pass/60 text-phase-pass" : "border-kind-service/60 text-kind-service"}`}>{data.page.state.toLowerCase()}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-on-surface-muted"><span className="w-1.5 h-1.5 rounded-full bg-phase-pass animate-pulse" />live · checked {ago(data.page.checkedAt)}</span>
        <a href={data.page.prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 border border-outline-variant text-xs hover:border-neutral-400">
          <span className="material-symbols-outlined text-[16px]">open_in_new</span>View on GitHub
        </a>
      </header>

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 relative">
          <GraphCanvas />
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex bg-surface-dim/90 backdrop-blur z-10">
            {([["before", "Before", "history"], ["path", "Agent's path", "route"], ["after", "After", "check_circle"]] as const).map(([id, label, icon]) => (
              <button key={id} onClick={() => { setMode(id); if (id === "path") { setHead(0); setPlaying(true); } }}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs border ${mode === id ? "border-schema-accent text-white bg-surface-container-high" : "border-outline-variant text-on-surface-muted hover:text-white"}`}>
                <span className="material-symbols-outlined text-[16px]">{icon}</span>{label}
              </button>
            ))}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 bottom-4 w-[min(720px,92%)] bg-surface-dim/95 backdrop-blur border border-outline-variant px-4 py-3 z-10">
            {mode === "path" ? (
              <>
                <div className="flex items-center gap-3">
                  <button onClick={() => { if (head >= events.length) setHead(0); setPlaying(!playing); }} className="w-8 h-8 flex items-center justify-center border border-outline-variant hover:border-neutral-400">
                    <span className="material-symbols-outlined text-[18px]">{playing ? "pause" : "play_arrow"}</span>
                  </button>
                  <input type="range" min={0} max={events.length} value={head} onChange={(e) => { setPlaying(false); setHead(Number(e.target.value)); }} className="flex-1 accent-white" />
                  <span className="text-[11px] font-[JetBrains_Mono] text-on-surface-muted w-16 text-right">{head}/{events.length}</span>
                </div>
                <div className="mt-2 text-xs font-[JetBrains_Mono] truncate">
                  {current ? <><span style={{ color: ACT_COLOR[current.kind as ActKind] }}>{current.kind}</span> <span className="text-neutral-200">{current.title}</span></> : <span className="text-on-surface-muted">The agent's route through the repo, step by step.</span>}
                </div>
              </>
            ) : mode === "before" ? (
              <div className="text-xs text-neutral-300">The repo at {r.baseSha.slice(0, 8)}, before the agent started. {data.map.nodes.length} components in {data.map.groups.length} modules; size is how much each type is used.</div>
            ) : (
              <div className="text-xs text-neutral-300">After {r.headSha.slice(0, 8)}: <span className="text-[#fbbf24]">changed</span> ({r.members.length} members), <span className="text-[#f87171]">flagged by review</span>, <span className="text-[#4ade80]">new files</span>. Numbers show changed lines.</div>
            )}
          </div>
        </main>

        <aside className="w-[460px] shrink-0 border-l border-outline-variant bg-surface-dim overflow-y-auto px-5 pb-10">
          <div className={`mt-5 border px-4 py-3 ${TIER[r.risk.tier] ?? ""}`}>
            <div className="flex items-baseline justify-between"><span className="text-lg">{r.risk.tierLabel}</span><span className="text-[11px] font-[JetBrains_Mono]">risk {r.risk.score}</span></div>
            <div className="text-xs text-neutral-200 mt-1">Owner reads <b className="text-white">{r.summary.readLines}</b> of <b className="text-white">{r.summary.totalLines}</b> changed lines</div>
            <div className="text-[11px] text-on-surface-variant mt-1">AI review is advice with evidence. It never approves.</div>
          </div>
          <div className="mt-3 text-xs">
            {data.signoff
              ? <span className="text-phase-pass">Signed by {data.signoff.owner}: {data.signoff.decision} · {ago(data.signoff.at)}</span>
              : <span className="text-phase-applying">Waiting for a named owner to sign off ({r.refusals.length} question{r.refusals.length === 1 ? "" : "s"} to answer)</span>}
          </div>

          <H>The change explains itself</H>
          <ol className="list-decimal ml-4 space-y-1 text-xs text-neutral-300 leading-relaxed">{r.story.map((s, i) => <li key={i}>{s}</li>)}</ol>

          {run && (
            <>
              <H right={<span className="text-[10px] text-on-surface-faint font-[JetBrains_Mono]">{run.model} · {run.turns ?? "?"} turns</span>}>Decisions the agent made</H>
              {run.summary && <p className="text-xs text-neutral-300 leading-relaxed mb-2">{run.summary}</p>}
              {run.decisions.map((d, i) => (
                <div key={i} className={`border-l-2 pl-3 py-1 mb-2 ${d.confidence === "unsure" ? "border-phase-applying" : "border-outline-variant"}`}>
                  <div className="text-xs text-white">{d.decision}{d.confidence === "unsure" && <span className="ml-1.5 text-[10px] uppercase text-phase-applying">unsure</span>}</div>
                  <div className="text-[11px] text-on-surface-variant mt-0.5">{d.why}</div>
                </div>
              ))}
              <H right={<span className="text-[10px] text-on-surface-faint">click to jump the graph</span>}>Everything it did · {steps.length} steps</H>
              <div className="border-l border-outline-variant/60 pl-2 space-y-0.5">
                {steps.map((s) => {
                  const idx = events.findIndex((e) => e.title === s.title);
                  return (
                    <button key={s.i} onClick={() => { if (idx >= 0) { setMode("path"); setPlaying(false); setHead(idx + 1); } }} className="w-full flex items-start gap-2 text-left py-0.5 hover:bg-surface-container">
                      <span className="material-symbols-outlined text-[14px] mt-[1px]" style={{ color: ACT_COLOR[s.kind as ActKind] ?? "#a1a1aa" }}>{STEP_ICON[s.kind] ?? "build"}</span>
                      <span className="text-[11px] font-[JetBrains_Mono] text-neutral-300 break-all">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <H>Claims · decided by evidence</H>
          {r.claims.map((c) => (
            <div key={c.id} className="flex gap-2 items-start py-1.5 border-b border-outline-variant/40">
              <span className={`shrink-0 w-[84px] text-center text-[10px] uppercase border px-1 ${STATUS[c.status]}`}>{c.status}</span>
              <span className="text-xs text-neutral-200 flex-1">{c.text}</span>
              <span className="text-[10px] font-[JetBrains_Mono] text-on-surface-faint">{c.decidedBy}</span>
            </div>
          ))}

          <H>Refused to decide · for the owner</H>
          {r.refusals.length === 0 ? <div className="text-[11px] text-on-surface-muted">Nothing refused.</div> : r.refusals.map((q) => (
            <div key={q.question} className="mb-2"><div className="text-xs text-white">{q.question}</div><div className="text-[11px] text-on-surface-variant">{q.why}</div></div>
          ))}

          <H>Read these</H>
          {r.readList.map((x) => <div key={x.key} className="text-[11px] py-0.5"><span className="font-[JetBrains_Mono] text-white">{shortKey(x.key)}</span> <span className="text-phase-applying">{x.why.join(" · ")}</span></div>)}

          <H>Revisions · updates as the PR changes</H>
          {data.page.revisions.slice().reverse().map((rev, i) => (
            <div key={rev.receiptId} className="flex items-baseline gap-2 text-[11px] py-0.5">
              <span className={`font-[JetBrains_Mono] ${i === 0 ? "text-white" : "text-on-surface-muted"}`}>{rev.headSha.slice(0, 8)}</span>
              <span className="text-on-surface-variant">{rev.reason}</span>
              <span className="ml-auto text-on-surface-faint">{ago(rev.at)}</span>
            </div>
          ))}
          <div className="text-[10px] text-on-surface-faint mt-1">Latest receipt {latestRev.receiptId} · digest {(r as Receipt & { digest?: string }).digest?.slice(0, 12)}</div>

          <H>Decision log</H>
          {data.decisions.slice().reverse().slice(0, 20).map((d, i) => (
            <div key={i} className="text-[10.5px] text-on-surface-variant py-0.5"><span className="text-on-surface-faint font-[JetBrains_Mono]">{d.at.slice(11, 19)}</span> <span className="text-white">{d.actor}</span> {d.action} <span className="text-on-surface-muted">{d.detail}</span></div>
          ))}
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { callTool } from "@/mcp-client";
import SchemaLogo from "@/components/SchemaLogo";
import type { AgentRun, Decision, PrRecord, Receipt, RepoMap } from "@/state/trust";
import { ACT_COLOR, type ActKind } from "./RepoGraph";
import GraphCanvas from "@/components/canvas/GraphCanvas";
import { applyCanvasMarks, loadCurated } from "@/lib/curatedGraph";
import { eventsFor, marksAt } from "./RepoMap";
import { shortKey, STATUS_CLS, TierCard, Story, SectionTitle as H, DecisionLog } from "./TrustPanel";
import ClaudeCrab from "@/components/ClaudeCrab";

interface PageData {
  page: { slug: string; prNumber: number; prUrl: string; branch: string; requirementId: string; baseSha: string; state: string; checkedAt: string; revisions: { receiptId: string; headSha: string; at: string; reason: string }[] };
  receipt: Receipt; run: AgentRun | null; map: RepoMap; pr: PrRecord | null; repo: string;
  signoff: { owner: string; decision: string; at: string; residualRisk: string } | null;
  decisions: Decision[];
}

const STEP_ICON: Record<string, string> = { read: "description", search: "search", edit: "edit", command: "terminal", thought: "psychology", note: "sticky_note_2", result: "flag" };

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
        <p className="ui-title">This review did not load</p>
        <p className="ui-body mt-2 max-w-md">The review server did not return the pull request. It retries every few seconds.</p>
        <p className="ui-chip ui-chip-fail mt-3">{error}</p>
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
  const DECIDED: Record<string, string> = { accept: "Accepted", "request-changes": "Changes requested", reject: "Rejected" };
  const signed = data.signoff ? `${DECIDED[data.signoff.decision] ?? data.signoff.decision} by ${data.signoff.owner}` : null;

  return (
    <div className="fixed inset-0 bg-surface text-on-surface flex flex-col">
      <header className="h-12 shrink-0 flex items-center gap-4 px-5 border-b border-[var(--ui-hairline)]">
        <SchemaLogo className="w-6 h-6 shrink-0" />
        <h1 className="text-[0.875rem] font-semibold tracking-[-0.015em] truncate min-w-0">{r.requirement.title}</h1>
        <p className="hidden lg:flex items-center gap-2.5 ui-meta shrink-0 ml-auto" title={`${data.page.branch}, ${r.baseSha.slice(0, 8)}..${r.headSha.slice(0, 8)}, revision ${data.page.revisions.length}`}>
          <span className={`ui-chip ${isOpen ? "ui-chip-pass ui-chip-live" : ""}`}>{isOpen ? "Open" : data.page.state.charAt(0) + data.page.state.slice(1).toLowerCase()}, checked {ago(data.page.checkedAt)}</span>
        </p>
        <a href={data.page.prUrl} target="_blank" rel="noreferrer" className="ui-btn shrink-0 lg:ml-0 ml-auto">
          PR #{data.page.prNumber} on GitHub
          <span className="ui-arrow material-symbols-outlined text-[15px] leading-none -mr-0.5" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">arrow_outward</span>
        </a>
      </header>

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="ui-tabs shrink-0 px-5" role="group" aria-label="Which state of the repo to show">
            {([["before", "Before"], ["path", "Claude's path"], ["after", "After"]] as const).map(([id, label]) => (
              <button key={id} aria-pressed={mode === id} onClick={() => { setMode(id); if (id === "path") { setHead(0); setPlaying(true); } }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 relative">
            <GraphCanvas />
          </div>
          <div className="shrink-0 h-12 px-5 flex items-center gap-3 border-t border-[var(--ui-hairline)]">
            {mode === "path" ? (
              <>
                <button onClick={() => { if (head >= events.length) setHead(0); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Play"} className="ui-icon-btn shrink-0 -ml-1.5">
                  <span className="material-symbols-outlined text-[20px]">{playing ? "pause" : "play_arrow"}</span>
                </button>
                <input type="range" min={0} max={events.length} value={head} aria-label="Step through Claude's path" onChange={(e) => { setPlaying(false); setHead(Number(e.target.value)); }} className="w-[32%] min-w-[140px] accent-white h-1" />
                <span className="ui-meta tabular-nums shrink-0">{head} of {events.length}</span>
                <p className="ui-meta truncate min-w-0">
                  {current
                    ? <><span className="text-on-surface-variant capitalize">{current.kind}</span> <span className="ui-code">{current.title.replace(new RegExp(`^${current.kind}\\s+`, "i"), "")}</span></>
                    : "Claude's route through the repo, step by step."}
                </p>
              </>
            ) : mode === "before" ? (
              <p className="ui-meta truncate">The repo at <span className="ui-code">{r.baseSha.slice(0, 8)}</span>, before Claude started: {data.map.nodes.length} components in {data.map.groups.length} modules.</p>
            ) : (
              <p className="ui-meta flex flex-wrap items-center gap-x-3">
                <span>After <span className="ui-code">{r.headSha.slice(0, 8)}</span></span>
                <span className="ui-chip ui-chip-info">Changed</span>
                <span className="ui-chip ui-chip-fail">Flagged</span>
                <span className="ui-chip ui-chip-pass">New</span>
              </p>
            )}
          </div>
        </main>

        <aside className="w-[440px] shrink-0 ui-panel overflow-y-auto px-5 pt-5 pb-10" aria-label="Review">
          <TierCard r={r} />
          <p className={`mt-3 ui-chip !whitespace-normal ${data.signoff ? "ui-chip-pass" : "ui-chip-warn"}`}>
            {data.signoff
              ? `${signed}, ${ago(data.signoff.at)}`
              : `Waiting for an owner to sign, ${r.refusals.length} question${r.refusals.length === 1 ? "" : "s"} open`}
          </p>

          <H>What changed</H>
          <Story lines={r.story} />

          {run && (
            <>
              <H>Claude decided</H>
              {run.summary && <p className="ui-body py-2">{run.summary}</p>}
              <div className="ui-divide">
                {run.decisions.map((d, i) => (
                  <div key={i} className="py-3">
                    <p className="text-[0.875rem] leading-snug font-medium text-on-surface">{d.decision}</p>
                    <p className="ui-meta mt-1 leading-relaxed">{d.confidence === "unsure" && <span className="ui-chip ui-chip-warn mr-2">Unsure</span>}{d.why}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <H>Left for the owner</H>
          {r.refusals.length === 0 ? <p className="ui-meta py-2">Nothing.</p> : (
            <div className="ui-divide">
              {r.refusals.map((q) => (
                <div key={q.question} className="py-3">
                  <p className="text-[0.875rem] leading-snug font-medium text-on-surface">{q.question}</p>
                  <p className="ui-meta mt-1 leading-relaxed">{q.why}</p>
                </div>
              ))}
            </div>
          )}

          <H right={<span className="ui-meta tabular-nums">{r.claims.filter((c) => c.status === "verified").length} of {r.claims.length} verified</span>}>Claims</H>
          <div className="ui-divide">
            {r.claims.map((c) => (
              <div key={c.id} className="py-3">
                <p className="text-[0.8125rem] leading-relaxed text-on-surface-variant">{c.text}</p>
                <p className="mt-1 flex items-center gap-2.5 ui-meta">
                  <span className={`ui-chip capitalize ${STATUS_CLS[c.status]}`}>{c.status}</span>
                  <span className="truncate">by {c.decidedBy}</span>
                </p>
              </div>
            ))}
          </div>

          {r.readList.length > 0 && (
            <>
              <H>Read these</H>
              <div className="ui-divide">
                {r.readList.map((x) => (
                  <div key={x.key} className="py-3">
                    <p className="ui-code text-on-surface break-all">{shortKey(x.key)}</p>
                    <p className="ui-meta mt-1">{x.why.join(", ")}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {run && (
            <>
              <H right={<span className="ui-meta tabular-nums">{steps.length}</span>}>Steps</H>
              <div className="-mx-2 mt-1">
                {steps.map((s) => {
                  const idx = events.findIndex((e) => e.title === s.title);
                  return (
                    <button key={s.i} onClick={() => { if (idx >= 0) { setMode("path"); setPlaying(false); setHead(idx + 1); } }} className="w-full flex items-start gap-2.5 text-left px-2 py-1.5 rounded-[8px] hover:bg-[var(--ui-fill)] transition-colors">
                      <span className="material-symbols-outlined text-[15px] mt-[2px]" style={{ color: ACT_COLOR[s.kind as ActKind] ?? "var(--color-on-surface-muted)", fontVariationSettings: "'wght' 300" }}>{STEP_ICON[s.kind] ?? "build"}</span>
                      <span className="ui-code text-on-surface-variant break-all leading-relaxed">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <H>Revisions</H>
          <div className="ui-divide">
            {data.page.revisions.slice().reverse().map((rev) => (
              <p key={rev.receiptId} className="py-2.5 flex items-baseline gap-2.5 ui-meta">
                <span className="ui-code text-on-surface-variant">{rev.headSha.slice(0, 8)}</span>
                <span>{rev.reason}</span>
                <span className="ml-auto">{ago(rev.at)}</span>
              </p>
            ))}
          </div>
          <p className="ui-meta ui-code mt-2 break-all">{latestRev.receiptId}, digest {(r as Receipt & { digest?: string }).digest?.slice(0, 12)}</p>

          <H>Log</H>
          <DecisionLog rows={data.decisions.slice().reverse().slice(0, 20)} />
          <p className="ui-rule mt-4 pt-4 ui-meta flex items-center gap-2"><ClaudeCrab size={15} />AI review is advice with evidence. It never approves.</p>
        </aside>
      </div>
    </div>
  );
}

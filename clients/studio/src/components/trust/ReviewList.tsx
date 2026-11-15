"use client";

import { useEffect, useState } from "react";
import { callTool } from "@/mcp-client";
import { useTrust } from "@/state/trust";
import { useStore } from "@/state/store";

interface IssueRun { runId: string; status: string; startedAt: string; branch: string; prUrl?: string; pageUrl?: string }
interface Issue {
  requirementId: string; tracker: string; key: string; status: string; priority: string; assignee: string; labels: string[];
  reporter: string; updatedAt: string; title: string; kind: string; source: string; branch: string; intent: string; runs: IssueRun[];
}
interface Connector { id: string; name: string; workspace: string; transport: string; status: string }
interface IssuesData { note: string; connectors: Connector[]; syncedAt: string; issues: Issue[] }

const TRACKER: Record<string, { label: string; color: string; glyph: string }> = {
  linear: { label: "Linear", color: "#8b8dfc", glyph: "◆" },
  jira: { label: "Jira", color: "#4c9aff", glyph: "▲" },
};
// Only the two priorities that change what you do get colour.
const PRIORITY: Record<string, string> = { Urgent: "ui-chip-fail", High: "ui-chip-warn", Medium: "", Low: "" };

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

export default function ReviewList() {
  const [data, setData] = useState<IssuesData | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const startFix = useTrust((s) => s.startFix);
  const watchRun = useTrust((s) => s.watchRun);
  const refresh = useTrust((s) => s.refresh);
  const busy = useTrust((s) => s.busy);

  useEffect(() => {
    let alive = true;
    const load = () => callTool<IssuesData>("issues.list", {}).then((d) => { if (alive) setData(d); }).catch(() => undefined);
    void refresh();
    void load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [refresh]);

  if (!data) {
    return (
      <div className="px-3 pb-4 space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="ui-card h-[104px] schema-skeleton" />)}
        <p className="sr-only">Syncing issues from trackers</p>
      </div>
    );
  }
  const q = query.trim().toLowerCase();
  const matches = (i: Issue) => !q || [i.key, i.title, i.status, i.priority, i.requirementId, ...i.labels].some((x) => x.toLowerCase().includes(q));
  // Everything shows until you search; issues with a run in progress always stay visible.
  const isActive = (i: Issue) => i.runs.some((r) => r.status === "running");
  const issues = data.issues.filter((i) => (filter === "all" || i.tracker === filter) && (matches(i) || isActive(i)));
  const visibleFor = (f: string) => data.issues.filter((i) => (f === "all" || i.tracker === f) && matches(i)).length;
  // The run takes over the panel area; the list comes back from the Issues button in the top bar.
  const focusRun = () => useStore.getState().setSidePanelView(null);

  return (
    <div className="px-3 pb-4">
      <label className="flex items-center gap-2.5 ui-input !py-0 h-10 focus-within:border-[var(--ui-hairline-strong)]">
        <span className="material-symbols-outlined text-[18px] text-on-surface-faint" style={{ fontVariationSettings: "'wght' 300" }}>search</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by key, title or label"
          aria-label="Search issues"
          className="flex-1 bg-transparent text-[0.8125rem] text-on-surface placeholder:text-on-surface-faint outline-none"
        />
        {query && <button onClick={() => setQuery("")} aria-label="Clear search" className="material-symbols-outlined text-[16px] text-on-surface-muted hover:text-on-surface">close</button>}
      </label>

      <div className="flex items-center justify-between mt-3 mb-3 px-1">
        <div className="ui-seg" role="group" aria-label="Tracker">
          {["all", ...data.connectors.map((c) => c.id)].map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : TRACKER[f]?.label} <span className="text-on-surface-faint tabular-nums">{visibleFor(f)}</span>
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1.5 ui-meta" title={data.connectors.map((c) => `${c.name} · ${c.workspace} · ${c.status}`).join("\n")}>
          <span className="ui-dot text-phase-pass" />Synced {ago(data.syncedAt)}
        </span>
      </div>

      {issues.length === 0 && (
        <div className="py-12 text-center">
          <p className="ui-body">No issue matches "{query}".</p>
          <button className="ui-btn ui-btn-quiet mt-3" onClick={() => setQuery("")}>Clear search</button>
        </div>
      )}
      <div className="space-y-2">
        {issues.map((i, idx) => {
          const t = TRACKER[i.tracker];
          return (
            <article key={i.key} className="ui-card ui-rise p-4" style={{ "--i": idx } as React.CSSProperties}>
              <div className="flex items-center gap-2 ui-meta">
                <span aria-hidden style={{ color: t?.color }}>{t?.glyph}</span>
                <span className="ui-code text-on-surface-variant">{i.key}</span>
                <span>{i.status}</span>
                {PRIORITY[i.priority] ? <span className={`ui-chip ml-auto ${PRIORITY[i.priority]}`}>{i.priority}</span> : <span className="ml-auto">{i.priority}</span>}
              </div>
              <h3 className="mt-2 text-[0.9375rem] leading-[1.38] font-medium tracking-[-0.015em] text-on-surface">{i.title}</h3>
              <p className="mt-1.5 ui-meta truncate">{[...i.labels, `updated ${ago(i.updatedAt)}`].join(" · ")}</p>
              <IssueAction
                issue={i}
                busy={!!busy}
                onFix={() => { focusRun(); void startFix(`Fix ${i.key} (#${i.requirementId.slice(4)}): ${i.title}`, i.requirementId); }}
                onOpen={(runId) => { focusRun(); useTrust.setState({ open: false }); watchRun(runId); }}
              />
            </article>
          );
        })}
      </div>
      <p className="mt-4 px-1 ui-meta text-on-surface-faint leading-relaxed">{data.note}</p>
    </div>
  );
}

/** One action per issue, following the latest agent run: fix -> working -> review -> PR. */
function IssueAction({ issue, busy, onFix, onOpen }: { issue: Issue; busy: boolean; onFix: () => void; onOpen: (runId: string) => void }) {
  const last = issue.runs[0];
  const row = "mt-3.5 flex items-center gap-2";
  if (last?.status === "running") {
    return (
      <div className={row}>
        <span className="flex items-center gap-2 text-[0.8125rem] text-phase-applying"><span className="ui-dot animate-pulse" />Claude Code is working</span>
        <button onClick={() => onOpen(last.runId)} className="ui-btn ml-auto">Watch</button>
      </div>
    );
  }
  if (last?.status === "done" && last.prUrl) {
    return (
      <div className={row}>
        <button onClick={() => onOpen(last.runId)} className="ui-btn ui-btn-primary">Review the change</button>
        <a href={last.pageUrl ?? last.prUrl} target="_blank" rel="noreferrer" className="ui-btn ui-btn-quiet">
          PR #{last.prUrl.split("/").pop()}
          <span className="material-symbols-outlined text-[15px] -mr-0.5" style={{ fontVariationSettings: "'wght' 300" }}>arrow_outward</span>
        </a>
      </div>
    );
  }
  if (last?.status === "done") {
    return (
      <div className={row}>
        <button onClick={() => onOpen(last.runId)} className="ui-btn ui-btn-primary">Review the change</button>
        <span className="ui-meta">Claude finished, no PR yet</span>
      </div>
    );
  }
  return (
    <div className={row}>
      <button disabled={busy} onClick={onFix} className="ui-btn">
        <span className="material-symbols-outlined text-[17px] -ml-0.5" style={{ fontVariationSettings: "'wght' 300" }}>auto_fix_high</span>
        {last?.status === "failed" ? "Try again with Claude Code" : "Fix with Claude Code"}
      </button>
      {last?.status === "failed" && <span className="ui-meta text-phase-fail">Last attempt failed</span>}
    </div>
  );
}

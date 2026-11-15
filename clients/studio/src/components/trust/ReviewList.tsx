"use client";

import { useEffect, useState } from "react";
import { callTool } from "@/mcp-client";
import { useTrust } from "@/state/trust";
import { useStore } from "@/state/store";
import ClaudeCrab from "@/components/ClaudeCrab";

interface IssueRun { runId: string; status: string; startedAt: string; branch: string; prUrl?: string; pageUrl?: string }
interface Issue {
  requirementId: string; tracker: string; key: string; status: string; priority: string; assignee: string; labels: string[];
  reporter: string; updatedAt: string; title: string; kind: string; source: string; branch: string; intent: string; runs: IssueRun[];
}
interface Connector { id: string; name: string; workspace: string; transport: string; status: string }
interface IssuesData { note: string; connectors: Connector[]; syncedAt: string; issues: Issue[] }

const TRACKER: Record<string, string> = { linear: "Linear", jira: "Jira" };
// Only the two priorities that change what you do get a dot.
const PRIORITY: Record<string, string> = { Urgent: "ui-chip-fail", High: "ui-chip-warn" };

export const Arrow = ({ out = false }: { out?: boolean }) => (
  <span className="ui-arrow material-symbols-outlined text-[17px] leading-none" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">{out ? "arrow_outward" : "arrow_forward"}</span>
);

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
      <div className="px-5 pb-4 ui-divide" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="py-4"><div className="h-4 w-4/5 rounded bg-[var(--ui-fill)] schema-skeleton" /><div className="h-3 w-2/5 rounded bg-[var(--ui-fill)] schema-skeleton mt-2.5" /></div>)}
        <p className="sr-only">Syncing issues</p>
      </div>
    );
  }
  const q = query.trim().toLowerCase();
  const matches = (i: Issue) => !q || [i.key, i.title, i.status, i.priority, i.requirementId, ...i.labels].some((x) => x.toLowerCase().includes(q));
  // Everything shows until you search; issues with a run in progress always stay visible.
  const isActive = (i: Issue) => i.runs.some((r) => r.status === "running");
  const issues = data.issues.filter((i) => (filter === "all" || i.tracker === filter) && (matches(i) || isActive(i)));
  const visibleFor = (f: string) => data.issues.filter((i) => (f === "all" || i.tracker === f) && matches(i)).length;
  // The run takes over the panel; the list comes back from Issues in the top bar.
  const focusRun = () => useStore.getState().setSidePanelView(null);

  return (
    <div className="px-5 pb-5">
      <label className="flex items-center gap-2.5 ui-input !py-0 h-9">
        <span className="material-symbols-outlined text-[17px] text-on-surface-faint" style={{ fontVariationSettings: "'wght' 300" }}>search</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search issues"
          className="flex-1 bg-transparent text-[0.8125rem] text-on-surface placeholder:text-on-surface-faint outline-none"
        />
        {query && <button onClick={() => setQuery("")} aria-label="Clear search" className="material-symbols-outlined text-[16px] text-on-surface-muted hover:text-on-surface">close</button>}
      </label>

      <div className="ui-tabs mt-3" role="group" aria-label="Tracker">
        {["all", ...data.connectors.map((c) => c.id)].map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : TRACKER[f]} <span className="text-on-surface-faint tabular-nums font-normal">{visibleFor(f)}</span>
          </button>
        ))}
      </div>

      {issues.length === 0 && (
        <div className="py-12 text-center">
          <p className="ui-body">Nothing matches "{query}".</p>
          <button className="ui-btn mt-3" onClick={() => setQuery("")}>Clear search</button>
        </div>
      )}
      <div className="ui-divide">
        {issues.map((i, idx) => {
          const last = i.runs[0];
          const pr = last?.status === "done" && last.prUrl ? last : null;
          return (
            <article key={i.key} className="ui-rise pt-4 pb-2.5" style={{ "--i": idx } as React.CSSProperties}>
              <h3 className="text-[0.9375rem] leading-[1.4] font-medium tracking-[-0.015em] text-on-surface [text-wrap:pretty]">{i.title}</h3>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 ui-meta">
                <span className="ui-code">{i.key}</span>
                <span>{i.status}</span>
                <span className={`ui-chip ${PRIORITY[i.priority] ?? ""}`}>{i.priority}</span>
                {pr && (
                  <a href={pr.pageUrl ?? pr.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-on-surface-variant hover:text-on-surface transition-colors">
                    PR #{pr.prUrl!.split("/").pop()}<span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">arrow_outward</span>
                  </a>
                )}
              </p>
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
      <div className="ui-rule mt-1 pt-4" title={data.connectors.map((c) => `${c.name} · ${c.workspace} · ${c.status}`).join("\n")}>
        <p className="ui-chip ui-chip-pass">Synced {ago(data.syncedAt)}</p>
        <p className="ui-meta mt-1.5 leading-relaxed">{data.note}</p>
      </div>
    </div>
  );
}

/** One action per issue, following its latest agent run. The crab marks work done by Claude Code. */
function IssueAction({ issue, busy, onFix, onOpen }: { issue: Issue; busy: boolean; onFix: () => void; onOpen: (runId: string) => void }) {
  const last = issue.runs[0];
  if (last?.status === "running") {
    return (
      <button onClick={() => onOpen(last.runId)} className="ui-action mt-1.5">
        <ClaudeCrab walking />Claude is working<Arrow />
      </button>
    );
  }
  if (last?.status === "done") {
    return (
      <button onClick={() => onOpen(last.runId)} className="ui-action mt-1.5">
        <ClaudeCrab />Review Claude's change<Arrow />
      </button>
    );
  }
  return (
    <button disabled={busy} onClick={onFix} className="ui-action mt-1.5">
      <ClaudeCrab />{last?.status === "failed" ? "Try again with Claude Code" : "Fix with Claude Code"}<Arrow />
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { callTool } from "@/mcp-client";
import { useTrust } from "@/state/trust";

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
const PRIORITY: Record<string, string> = { Urgent: "text-phase-fail", High: "text-phase-applying", Medium: "text-kind-service", Low: "text-on-surface-muted" };

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

  if (!data) return <div className="p-4 text-xs text-on-surface-muted">Syncing issues from trackers…</div>;
  const q = query.trim().toLowerCase();
  const matches = (i: Issue) => !q || [i.key, i.title, i.status, i.priority, i.requirementId, ...i.labels].some((x) => x.toLowerCase().includes(q));
  // Everything shows until you search; issues with a run in progress always stay visible.
  const isActive = (i: Issue) => i.runs.some((r) => r.status === "running");
  const issues = data.issues.filter((i) => (filter === "all" || i.tracker === filter) && (matches(i) || isActive(i)));
  const visibleFor = (f: string) => data.issues.filter((i) => (f === "all" || i.tracker === f) && matches(i)).length;
  const activeCount = data.issues.filter(isActive).length;

  return (
    <div className="p-4 space-y-3">
      <div className="space-y-1.5">
        {data.connectors.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-xs">
            <span style={{ color: TRACKER[c.id]?.color }}>{TRACKER[c.id]?.glyph}</span>
            <span className="text-white">{c.name}</span>
            <span className="text-on-surface-muted font-[JetBrains_Mono]">{c.workspace}</span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-phase-pass"><span className="w-1.5 h-1.5 rounded-full bg-phase-pass" />MCP · synced {ago(data.syncedAt)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border border-outline-variant bg-surface px-3 py-2 focus-within:border-neutral-500">
        <span className="material-symbols-outlined text-[16px] text-on-surface-muted">search</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${data.issues.length} issues: key, title or label`}
          className="flex-1 bg-transparent text-xs text-white placeholder:text-on-surface-muted outline-none"
        />
        {query && <button onClick={() => setQuery("")} className="material-symbols-outlined text-[16px] text-on-surface-muted hover:text-white">close</button>}
      </div>

      <div className="flex gap-1 text-[11px]">
        {["all", ...data.connectors.map((c) => c.id)].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 border ${filter === f ? "border-schema-accent text-white" : "border-outline-variant text-on-surface-muted hover:text-white"}`}>
            {f === "all" ? "All" : TRACKER[f]?.label} ({visibleFor(f)})
          </button>
        ))}
      </div>

      <div className="text-[11px] text-on-surface-muted">
        {q
          ? `${visibleFor(filter)} of ${data.issues.length} issues match “${query}”${activeCount ? ` · ${activeCount} in progress` : ""}`
          : `${data.issues.length} issues synced${activeCount ? ` · ${activeCount} in progress` : ""}`}
      </div>
      {issues.length === 0 && (
        <div className="py-6 text-center text-xs text-on-surface-muted">
          {`No issues match “${query}”.`}
        </div>
      )}
      {issues.map((i) => {
        const t = TRACKER[i.tracker];
        const active = i.runs.find((r) => r.status === "running");
        return (
          <div key={i.key} className="border border-outline-variant/60 bg-surface">
            <div className="px-3 py-2.5 border-b border-outline-variant/60">
              <div className="flex items-center gap-2 text-[11px]">
                <span style={{ color: t?.color }}>{t?.glyph}</span>
                <span className="font-[JetBrains_Mono] text-white">{i.key}</span>
                <span className="text-on-surface-muted">· {i.status}</span>
                <span className={`ml-auto ${PRIORITY[i.priority] ?? ""}`}>{i.priority}</span>
              </div>
              <div className="text-xs text-neutral-200 mt-1 leading-snug">{i.title}</div>
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                {i.labels.map((l) => <span key={l} className="text-[10px] px-1.5 border border-outline-variant text-on-surface-variant">{l}</span>)}
                <span className="ml-auto text-[10px] text-on-surface-faint">{i.assignee} · {ago(i.updatedAt)}</span>
              </div>
            </div>
            <IssueAction issue={i} busy={!!busy} onFix={() => void startFix(`Fix ${i.key} (#${i.requirementId.slice(4)}): ${i.title}`, i.requirementId)} onOpen={(runId) => { useTrust.setState({ open: false }); watchRun(runId); }} />
          </div>
        );
      })}
      <p className="text-[10px] text-on-surface-faint leading-relaxed">{data.note}</p>
    </div>
  );
}

/** One button per issue, following the latest agent run: fix -> working -> open PR -> PR link. */
function IssueAction({ issue, busy, onFix, onOpen }: { issue: Issue; busy: boolean; onFix: () => void; onOpen: (runId: string) => void }) {
  const last = issue.runs[0];
  const row = "w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs border-t border-outline-variant/40";
  if (last?.status === "running") {
    return (
      <button onClick={() => onOpen(last.runId)} className={`${row} text-phase-applying hover:bg-surface-container-high`}>
        <span className="w-2 h-2 rounded-full bg-phase-applying animate-pulse" />Claude Code is working on this… <span className="ml-auto text-on-surface-muted">view</span>
      </button>
    );
  }
  if (last?.status === "done" && last.prUrl) {
    return (
      <div className={`${row} justify-between`}>
        <a href={last.pageUrl ?? last.prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-kind-service hover:underline">
          <span className="material-symbols-outlined text-[16px]">merge</span>PR #{last.prUrl.split("/").pop()} opened
        </a>
        <button onClick={() => onOpen(last.runId)} className="text-on-surface-muted hover:text-white">details</button>
      </div>
    );
  }
  if (last?.status === "done") {
    return (
      <button onClick={() => onOpen(last.runId)} className={`${row} text-white hover:bg-surface-container-high`}>
        <span className="material-symbols-outlined text-[16px] text-phase-pass">task_alt</span>Claude finished · review and open PR
      </button>
    );
  }
  return (
    <button disabled={busy} onClick={onFix} className={`${row} text-neutral-200 hover:bg-surface-container-high disabled:opacity-50`}>
      <span className="material-symbols-outlined text-[16px] text-phase-applying">smart_toy</span>
      {last?.status === "failed" ? "Last attempt failed · fix it with Claude Code" : "Fix it with Claude Code"}
    </button>
  );
}

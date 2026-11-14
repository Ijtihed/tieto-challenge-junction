"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/state/store";

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function relative(ts: number, now = Date.now()): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function HistoryPanel() {
  const chatHistory = useStore((s) => s.chatHistory);
  const undoStack = useStore((s) => s.undoStack);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const undoTo = useStore((s) => s.undoTo);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chatHistory;
    return chatHistory.filter((h) => {
      if (h.intent.toLowerCase().includes(q)) return true;
      if (h.prompt.toLowerCase().includes(q)) return true;
      return h.appliedDescriptions.some((d) =>
        d.toLowerCase().includes(q),
      );
    });
  }, [query, chatHistory]);

  if (chatHistory.length === 0) {
    return (
      <div className="p-6 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-3 inline-block">
          history
        </span>
        <p className="text-sm text-on-surface-variant">No history yet</p>
        <p className="mt-2 text-sm text-on-surface-muted leading-relaxed">
          Completed plans appear here. The next plan sees the last few turns and
          can build on them.
        </p>
        <p className="mt-4 text-xs text-on-surface-muted leading-relaxed">
          Try{" "}
          <kbd className="font-[JetBrains_Mono] border border-outline px-1.5 py-0.5 text-on-surface">
            /
          </kbd>{" "}
          to focus the command bar, or open{" "}
          <kbd className="font-[JetBrains_Mono] border border-outline px-1.5 py-0.5 text-on-surface">
            i
          </kbd>{" "}
          for a one-click insight.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-on-surface-muted leading-none">
          search
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search history..."
          data-testid="history-search"
          className={`w-full bg-transparent border border-outline-variant focus:border-neutral-500 transition-colors pl-9 ${
            query ? "pr-9" : "pr-3"
          } py-2 text-sm text-white placeholder:text-on-surface-faint outline-none`}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            data-testid="history-search-clear"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-on-surface-faint hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-[16px] leading-none">
              close
            </span>
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-on-surface-muted leading-relaxed py-6 text-center">
          No history entries match{" "}
          <span className="text-on-surface-variant">&ldquo;{query}&rdquo;</span>
        </p>
      )}

      {filtered.map((h, fi) => {
        const i = chatHistory.findIndex((x) => x.id === h.id);
        const canUndo = i >= 0 && i < undoStack.length;
        return (
          <div
            key={h.id}
            data-testid={`history-entry-${h.id}`}
            className="border border-outline-variant/60 bg-surface-dim p-4"
          >
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="text-xs text-on-surface-muted tabular-nums">
                {String(fi + 1).padStart(2, "0")} · {formatTime(h.at)} ·{" "}
                {relative(h.at)}
              </span>
              <span className="flex items-center gap-2">
                {h.git?.enabled && h.git.branchName && (
                  <span
                    data-testid={`history-git-${h.id}`}
                    title={
                      h.git.baselineSha
                        ? `branch ${h.git.branchName} · ${h.git.baselineSha.slice(0, 7)}..${h.git.headShortSha ?? "?"} (${h.git.commitCount} commit(s))`
                        : `branch ${h.git.branchName}`
                    }
                    className="font-[JetBrains_Mono] text-xs text-schema-accent"
                  >
                    {h.git.branchName} · {h.git.baselineSha?.slice(0, 7) ?? "?"}…{h.git.headShortSha ?? "?"}
                  </span>
                )}
                {h.realApply && !h.git?.enabled && (
                  <span
                    data-testid={`history-real-${h.id}`}
                    title={`Wrote ${h.filesChanged?.length ?? 0} file(s) to disk`}
                    className="text-xs text-schema-accent"
                  >
                    disk · {h.filesChanged?.length ?? 0}f
                  </span>
                )}
                <span className="text-xs text-phase-pass">
                  {h.appliedDescriptions.length} applied
                </span>
              </span>
            </div>
            <p className="text-sm text-white leading-relaxed mb-3">
              {h.intent}
            </p>
            <div className="space-y-1 mb-3">
              {h.appliedDescriptions.map((d, di) => (
                <p
                  key={di}
                  className="text-xs text-on-surface-variant leading-relaxed"
                >
                  <span className="text-phase-pass mr-2">✓</span>
                  {d}
                </p>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => submitPrompt(h.intent)}
                data-testid={`history-rerun-${h.id}`}
                className="text-xs text-on-surface-muted hover:text-white transition-colors"
              >
                Re-run
              </button>
              <span className="text-on-surface-faint">·</span>
              <button
                onClick={() => undoTo(h.id)}
                disabled={!canUndo}
                data-testid={`history-undo-${h.id}`}
                title={
                  canUndo
                    ? `Rewind the graph to before this plan was applied`
                    : `Snapshot for this plan was evicted (older than the cap)`
                }
                className={`text-xs transition-colors ${
                  canUndo
                    ? "text-on-surface-muted hover:text-violation"
                    : "text-on-surface-faint cursor-default"
                }`}
              >
                {canUndo ? "Restore" : "no snapshot"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

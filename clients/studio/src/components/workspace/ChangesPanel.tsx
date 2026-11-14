"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";
import type { LocalDiff, NodeDiff } from "@/lib/types";

/**
 * Changes panel — the side-panel sibling of the canvas diff overlay.
 *
 * Shows, for the current local-vs-remote diff:
 *   - Header: branch + ahead/behind counts + a "refresh w/ fetch" button
 *   - Counts strip: nodes added / removed / modified, edges added / removed
 *   - Rule delta: violations introduced by the diff and resolved by it,
 *     each clickable to focus the canvas on the targets
 *   - Per-file change list: files added / modified / deleted, each
 *     expandable to show the changed nodes inside
 *   - Coverage: list of changed nodes that have no test coverage,
 *     when the working graph carries a coverage map
 *
 * Empty / null states:
 *   - No diff computed yet → "Click 'Review changes' in the topbar"
 *   - Diff returned with zero changes → "In sync with origin/<branch>"
 *   - Diff failed → error string + retry button
 */

type FileGroup = {
  file: string;
  status: "added" | "modified" | "deleted" | "renamed";
  nodes: NodeDiff[];
};

export default function ChangesPanel() {
  const diffOverlay = useStore((s) => s.diffOverlay);
  const diffComputing = useStore((s) => s.diffComputing);
  const diffError = useStore((s) => s.diffError);
  const computeDiff = useStore((s) => s.computeDiff);
  const setDiffOverlayMode = useStore((s) => s.setDiffOverlayMode);
  const diffOverlayMode = useStore((s) => s.diffOverlayMode);
  const focusOnIds = useStore((s) => s.focusOnIds);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const coverage = useStore((s) => s.coverage);
  const repoRootPath = useStore((s) => s.repo.rootPath ?? null);

  if (diffComputing && !diffOverlay) {
    return <Loading />;
  }

  if (diffError && !diffOverlay) {
    return (
      <ErrorState
        error={diffError}
        onRetry={() => computeDiff({ fetch: false })}
      />
    );
  }

  if (!diffOverlay) {
    return (
      <EmptyState
        onCompute={() => computeDiff({ fetch: false })}
        onComputeWithFetch={() => computeDiff({ fetch: true })}
      />
    );
  }

  return (
    <Body
      diff={diffOverlay}
      computing={diffComputing}
      overlayOn={diffOverlayMode === "on"}
      repoRootPath={repoRootPath}
      onRefresh={(fetch) => computeDiff({ fetch })}
      onToggleOverlay={() =>
        setDiffOverlayMode(diffOverlayMode === "on" ? "off" : "on")
      }
      onFocusIds={(ids) => focusOnIds(ids)}
      onApplyFix={(prompt) => submitPrompt(prompt)}
      coverage={coverage}
    />
  );
}

/* ─────────────────── Body ─────────────────── */

function Body({
  diff,
  computing,
  overlayOn,
  repoRootPath,
  onRefresh,
  onToggleOverlay,
  onFocusIds,
  onApplyFix,
  coverage,
}: {
  diff: LocalDiff;
  computing: boolean;
  overlayOn: boolean;
  repoRootPath: string | null;
  onRefresh: (fetch: boolean) => void;
  onToggleOverlay: () => void;
  onFocusIds: (ids: string[]) => void;
  onApplyFix: (prompt: string) => void;
  coverage: { coveredNodeIds: Set<string>; totalNodes: number };
}) {
  const counts = diff.graphDelta.counts;
  const totalChanges =
    counts.nodesAdded + counts.nodesRemoved + counts.nodesModified;
  const inSync = totalChanges === 0 && diff.fileStats.filesChanged.length === 0;

  // Bucket nodes by file. We use a reasonable status per file —
  // "added" if all its visible nodes are added; "deleted" if all are
  // removed; "modified" otherwise.
  const byFile = useMemo(() => {
    const map = new Map<string, FileGroup>();
    for (const n of diff.graphDelta.nodes) {
      if (n.status === "unchanged") continue;
      const g = map.get(n.file);
      if (g) {
        g.nodes.push(n);
        // Promote to "modified" once we see anything but pure-add or
        // pure-delete.
        if (g.status === "added" && n.status !== "added") g.status = "modified";
        if (g.status === "deleted" && n.status !== "removed") g.status = "modified";
      } else {
        map.set(n.file, {
          file: n.file,
          status:
            n.status === "added"
              ? "added"
              : n.status === "removed"
                ? "deleted"
                : "modified",
          nodes: [n],
        });
      }
    }
    return [...map.values()].sort((a, b) => a.file.localeCompare(b.file));
  }, [diff.graphDelta.nodes]);

  // Changed nodes that have no test coverage. Only meaningful when
  // the working graph carries a coverage set.
  const uncoveredChangedIds = useMemo(() => {
    if (coverage.totalNodes === 0) return [];
    const out: NodeDiff[] = [];
    for (const n of diff.graphDelta.nodes) {
      if (n.status === "unchanged" || n.status === "removed") continue;
      if (!coverage.coveredNodeIds.has(n.id)) out.push(n);
    }
    return out;
  }, [diff.graphDelta.nodes, coverage]);

  return (
    <div className="flex flex-col" data-testid="changes-panel">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-outline-variant/60">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white truncate">
              {diff.workingTreeDirty ? "working tree" : "HEAD"} · vs{" "}
              <span className="text-schema-accent">{diff.baseBranch}</span>
            </p>
            <p className="mt-0.5 text-xs text-on-surface-faint">
              {diff.ahead} ahead · {diff.behind} behind
              {diff.fetched ? " · fetched" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleOverlay}
            data-testid="changes-toggle-overlay"
            title={overlayOn ? "Hide canvas overlay" : "Show canvas overlay"}
            className="text-xs shrink-0 text-on-surface-muted hover:text-white transition-colors"
          >
            {overlayOn ? "Hide overlay" : "Show overlay"}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onRefresh(false)}
            disabled={computing}
            className="text-xs text-on-surface-muted hover:text-white disabled:text-on-surface-faint disabled:cursor-wait transition-colors flex items-center gap-1.5"
            data-testid="changes-refresh"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">
              refresh
            </span>
            {computing ? "Computing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => onRefresh(true)}
            disabled={computing}
            className="text-xs text-schema-accent hover:text-white disabled:text-on-surface-faint disabled:cursor-wait transition-colors flex items-center gap-1.5"
            data-testid="changes-refresh-fetch"
            title="Run git fetch then refresh — slower, but compares against the latest remote"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">
              cloud_download
            </span>
            Fetch & refresh
          </button>
          {repoRootPath && (
            <PrReviewButton baseBranch={diff.baseBranch} />
          )}
        </div>
      </div>

      {/* Counts strip */}
      <div className="px-4 py-3 border-b border-outline-variant/60 flex items-center gap-3 flex-wrap text-xs">
        <Count label="nodes +" value={counts.nodesAdded} tone="add" />
        <Count label="nodes ~" value={counts.nodesModified} tone="mod" />
        <Count label="nodes −" value={counts.nodesRemoved} tone="rem" />
        <Count label="edges +" value={counts.edgesAdded} tone="add" />
        <Count label="edges −" value={counts.edgesRemoved} tone="rem" />
        <Count
          label="files"
          value={diff.fileStats.filesChanged.length}
          tone="neutral"
        />
      </div>

      {/* In-sync state */}
      {inSync && (
        <div className="px-4 py-8 text-center">
          <span className="material-symbols-outlined text-[28px] text-flash-new leading-none mb-2 inline-block">
            check_circle
          </span>
          <p className="text-sm text-neutral-300">
            in sync with {diff.baseBranch}
          </p>
          <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
            No graph-level changes since the merge-base.
          </p>
        </div>
      )}

      {/* PR Review section */}
      {!inSync && repoRootPath && (
        <PrReviewSection baseBranch={diff.baseBranch} />
      )}

      {!inSync && (
        <>
          {/* Rule delta */}
          {(diff.delta.newViolations.length > 0 ||
            diff.delta.resolvedViolations.length > 0) && (
            <Section title="Rules" testId="changes-rule-delta">
              {diff.delta.newViolations.map((v, i) => (
                <DeltaRow
                  key={`new-${i}`}
                  tone="bad"
                  title={`+ ${v.ruleId}`}
                  detail={v.message}
                  count={v.targetIds.length}
                  onJump={() => onFocusIds(v.targetIds)}
                  onFix={
                    v.suggestedPrompt
                      ? () => onApplyFix(v.suggestedPrompt)
                      : undefined
                  }
                />
              ))}
              {diff.delta.resolvedViolations.map((v, i) => (
                <DeltaRow
                  key={`res-${i}`}
                  tone="good"
                  title={`− ${v.ruleId}`}
                  detail={v.message || "resolved"}
                  count={v.targetIds.length}
                  onJump={() => onFocusIds(v.targetIds)}
                />
              ))}
            </Section>
          )}

          {/* Per-file changes */}
          {byFile.length > 0 && (
            <Section title="Files" testId="changes-files">
              {byFile.map((f) => (
                <FileRow key={f.file} group={f} onFocusIds={onFocusIds} />
              ))}
            </Section>
          )}

          {/* Coverage of changed nodes */}
          {uncoveredChangedIds.length > 0 && (
            <Section title="Uncovered changes" testId="changes-coverage">
              {uncoveredChangedIds.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onFocusIds([n.id])}
                  className="w-full text-left border border-outline-variant/60 hover:border-neutral-600 px-3 py-2 transition-colors"
                >
                  <p className="text-sm text-white truncate">
                    {n.name}
                  </p>
                  <p className="mt-0.5 font-[JetBrains_Mono] text-xs text-on-surface-faint truncate">
                    {n.file}
                  </p>
                </button>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────── PR Review ─────────────────── */

function PrReviewButton({ baseBranch }: { baseBranch: string }) {
  const emitToast = useStore((s) => s.emitToast);
  const [state, setState] = useState<"idle" | "loading">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        setState("loading");
        try {
          const res = await fetchApi("/api/pr/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base: baseBranch }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          if (json.markdown && typeof navigator !== "undefined" && navigator.clipboard) {
            await navigator.clipboard.writeText(json.markdown);
            emitToast("review copied to clipboard");
          } else {
            emitToast("review generated — open Changes panel to view");
          }
        } catch (e) {
          emitToast(`review failed · ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setState("idle");
        }
      }}
      disabled={state === "loading"}
      data-testid="changes-pr-review"
      className="ml-auto text-xs text-on-surface-muted hover:text-white disabled:text-on-surface-faint disabled:cursor-wait transition-colors flex items-center gap-1.5"
      title="Generate a PR review comment from the graph diff + rules"
    >
      <span className="material-symbols-outlined text-[14px] leading-none">
        rate_review
      </span>
      {state === "loading" ? "Generating..." : "Generate review"}
    </button>
  );
}

function PrReviewSection({ baseBranch }: { baseBranch: string }) {
  const emitToast = useStore((s) => s.emitToast);
  const [review, setReview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi("/api/pr/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: baseBranch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setReview(json.markdown ?? JSON.stringify(json, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!review) return;
    try {
      await navigator.clipboard.writeText(review);
      emitToast("review copied to clipboard");
    } catch {
      emitToast("clipboard write failed");
    }
  }

  if (!review && !loading && !error) {
    return (
      <div className="px-4 py-3 border-b border-outline-variant/60">
        <button
          type="button"
          onClick={generate}
          data-testid="changes-generate-review"
          className="w-full px-3 py-2.5 border border-schema-accent/50 text-schema-accent hover:bg-schema-accent/10 text-xs transition-colors flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[16px] leading-none">
            rate_review
          </span>
          Generate PR review
        </button>
      </div>
    );
  }

  return (
    <Section title="PR review" testId="changes-pr-review-section">
      {loading && (
        <p className="text-xs text-on-surface-muted flex items-center gap-2">
          <span className="inline-block w-2 h-2 bg-schema-accent rounded-full schema-spin" />
          Generating review...
        </p>
      )}
      {error && (
        <div>
          <p className="text-xs text-violation mb-2">
            Review failed · {error}
          </p>
          <button
            type="button"
            onClick={generate}
            className="text-xs text-schema-accent hover:text-white"
          >
            Retry
          </button>
        </div>
      )}
      {review && (
        <div>
          <pre
            data-testid="pr-review-content"
            className="font-[JetBrains_Mono] text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap break-words bg-black/40 border border-outline-variant/60 p-3 max-h-64 overflow-auto"
          >
            {review}
          </pre>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={copyToClipboard}
              className="text-xs text-schema-accent hover:text-white"
            >
              Copy to clipboard
            </button>
            <button
              type="button"
              onClick={generate}
              className="text-xs text-on-surface-muted hover:text-white"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────── small parts ─────────────────── */

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-outline-variant/60" data-testid={testId}>
      <p className="text-xs font-medium text-on-surface-faint mb-2">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "add" | "mod" | "rem" | "neutral";
}) {
  const color =
    tone === "add"
      ? "text-flash-new"
      : tone === "mod"
        ? "text-phase-testing"
        : tone === "rem"
          ? "text-violation"
          : "text-on-surface-muted";
  return (
    <span
      className={`tabular-nums ${value > 0 ? color : "text-on-surface-faint"}`}
    >
      {label} {value}
    </span>
  );
}

function DeltaRow({
  tone,
  title,
  detail,
  count,
  onJump,
  onFix,
}: {
  tone: "good" | "bad";
  title: string;
  detail: string;
  count: number;
  onJump?: () => void;
  onFix?: () => void;
}) {
  const color = tone === "good" ? "text-flash-new" : "text-violation";
  return (
    <div className="border border-outline-variant/60 hover:border-neutral-600 transition-colors p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className={`font-[JetBrains_Mono] text-xs ${color} truncate`}>
          {title}
        </p>
        <span className="text-xs text-on-surface-faint shrink-0">
          {count} target(s)
        </span>
      </div>
      <p className="text-sm text-neutral-300 leading-relaxed">
        {detail}
      </p>
      <div className="mt-2 flex items-center gap-3">
        {onJump && (
          <button
            type="button"
            onClick={onJump}
            className="text-xs text-on-surface-muted hover:text-white"
          >
            Jump
          </button>
        )}
        {onFix && (
          <button
            type="button"
            onClick={onFix}
            className="text-xs text-schema-accent hover:text-white"
          >
            Fix
          </button>
        )}
      </div>
    </div>
  );
}

function FileRow({
  group,
  onFocusIds,
}: {
  group: FileGroup;
  onFocusIds: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const badge =
    group.status === "added"
      ? { label: "added", tone: "text-flash-new" }
      : group.status === "deleted"
        ? { label: "deleted", tone: "text-violation" }
        : { label: "modified", tone: "text-phase-testing" };
  return (
    <div className="border border-outline-variant/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-neutral-950"
      >
        <span className="font-[JetBrains_Mono] text-xs text-neutral-200 truncate">
          {group.file}
        </span>
        <span
          className={`text-xs shrink-0 ${badge.tone}`}
        >
          {badge.label} · {group.nodes.length}
        </span>
      </button>
      {open && (
        <div className="border-t border-outline-variant/60 divide-y divide-outline-variant/60">
          {group.nodes.map((n) => (
            <button
              key={n.id + n.status}
              type="button"
              onClick={() => onFocusIds([n.id])}
              className="w-full text-left px-3 py-2 hover:bg-neutral-950"
            >
              <p className="text-sm text-white truncate">
                {n.name}
              </p>
              <p className="mt-0.5 font-[JetBrains_Mono] text-xs text-on-surface-faint">
                {n.status}
                {n.reasons && n.reasons.length > 0 && (
                  <> · {n.reasons.join(", ")}</>
                )}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── empty / loading / error ─────────────── */

function EmptyState({
  onCompute,
  onComputeWithFetch,
}: {
  onCompute: () => void;
  onComputeWithFetch: () => void;
}) {
  return (
    <div className="px-6 py-10 text-center">
      <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-2 inline-block">
        difference
      </span>
      <p className="text-sm text-neutral-300">No diff yet</p>
      <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
        Compare your working tree to the default branch. Schema spins up a temp git worktree at the merge-base, extracts both states, and shows the delta.
      </p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onCompute}
          data-testid="changes-empty-compute"
          className="text-xs text-on-surface-muted hover:text-white"
        >
          Compute
        </button>
        <button
          type="button"
          onClick={onComputeWithFetch}
          className="text-xs text-schema-accent hover:text-white"
        >
          Fetch + compute
        </button>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="px-6 py-10 text-center">
      <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-2 inline-block animate-spin">
        progress_activity
      </span>
      <p className="text-sm text-neutral-300">Computing diff...</p>
      <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
        Extracting base + head graphs and computing the delta.
      </p>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="px-6 py-8">
      <p className="text-sm text-violation mb-2">
        Diff failed
      </p>
      <pre className="font-[JetBrains_Mono] text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap break-words bg-black/40 border border-outline-variant/60 p-3">
        {error}
      </pre>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 text-xs text-schema-accent hover:text-white"
      >
        Retry
      </button>
    </div>
  );
}

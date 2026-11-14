"use client";

import { useStore } from "@/state/store";

/**
 * Topbar control for the local-vs-remote diff overlay. Renders only
 * when the diff capabilities probe says we have a git repo with a
 * remote — non-git directories or repos without an origin/<branch>
 * just don't see this widget.
 *
 * Three states:
 *   - "review changes": no diff cached yet. One click computes a
 *     fresh diff (without `git fetch`) and flips the canvas overlay
 *     on. Holding shift triggers fetch+compute (the explicit
 *     "review before commit" path).
 *   - "diff: <counts>": diff cached and overlay on. Shows the headline
 *     counts. Click toggles the overlay off without dropping the
 *     payload. The [refresh] sub-button forces a recompute.
 *   - "diff hidden": diff cached, overlay off. Click flips it back on.
 */
export default function DiffToggle() {
  const probe = useStore((s) => s.diffProbe);
  const overlay = useStore((s) => s.diffOverlay);
  const overlayMode = useStore((s) => s.diffOverlayMode);
  const computing = useStore((s) => s.diffComputing);
  const computeDiff = useStore((s) => s.computeDiff);
  const setOverlayMode = useStore((s) => s.setDiffOverlayMode);
  const setSidePanelView = useStore((s) => s.setSidePanelView);
  const sidePanelView = useStore((s) => s.sidePanelView);

  if (!probe || !probe.isGitRepo || !probe.hasRemote) return null;

  function openChangesPanel() {
    setSidePanelView(sidePanelView === "changes" ? null : "changes");
  }

  function onClickReview(e: React.MouseEvent) {
    if (e.shiftKey) {
      void computeDiff({ fetch: true });
    } else {
      void computeDiff({ fetch: false });
    }
    setSidePanelView("changes");
  }

  // No diff yet — call to action.
  if (!overlay) {
    return (
      <button
        type="button"
        onClick={onClickReview}
        disabled={computing}
        data-testid="diff-toggle-review"
        title={
          probe.workingTreeDirty
            ? "Review working-tree changes (shift-click to fetch first)"
            : "Compare HEAD vs " + (probe.baseBranch ?? "remote")
        }
        className="flex items-center gap-2 h-9 px-3 border border-outline-variant hover:border-neutral-600 text-neutral-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        <span className="material-symbols-outlined text-[16px] leading-none">
          difference
        </span>
        <span className="text-xs">
          {computing ? "Computing..." : "Review changes"}
        </span>
        {probe.ahead > 0 && (
          <span className="font-[JetBrains_Mono] text-xs tabular-nums text-on-surface-faint">
            {probe.ahead}↑
          </span>
        )}
      </button>
    );
  }

  // Have a diff — show counts; toggling flips overlay only.
  const c = overlay.graphDelta.counts;
  const total = c.nodesAdded + c.nodesRemoved + c.nodesModified;
  return (
    <div className="flex items-center h-9 border border-outline-variant">
      <button
        type="button"
        onClick={() =>
          setOverlayMode(overlayMode === "on" ? "off" : "on")
        }
        data-testid="diff-toggle"
        title={
          overlayMode === "on"
            ? "Hide canvas overlay (diff still computed)"
            : "Show canvas overlay"
        }
        className={`flex items-center gap-2 px-3 h-full transition-colors ${
          overlayMode === "on"
            ? "text-white"
            : "text-neutral-400 hover:text-white"
        }`}
      >
        <span
          className={`material-symbols-outlined text-[16px] leading-none ${
            overlayMode === "on" ? "text-flash-new" : ""
          }`}
        >
          {overlayMode === "on" ? "visibility" : "visibility_off"}
        </span>
        <span className="font-[JetBrains_Mono] text-xs tabular-nums">
          {total === 0 ? "in sync" : `${c.nodesAdded}+ ${c.nodesRemoved}− ${c.nodesModified}~`}
        </span>
      </button>
      <div className="w-px h-5 bg-outline-variant" />
      <button
        type="button"
        onClick={openChangesPanel}
        data-testid="diff-toggle-open-panel"
        title="Open the Changes panel"
        className="flex items-center px-2 h-full text-neutral-400 hover:text-white transition-colors"
      >
        <span className="material-symbols-outlined text-[16px] leading-none">
          chevron_right
        </span>
      </button>
    </div>
  );
}

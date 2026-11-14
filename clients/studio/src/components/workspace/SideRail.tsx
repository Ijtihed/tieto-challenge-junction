"use client";

import { useStore } from "@/state/store";
import { mergeProblems } from "@/lib/problems";
import { CHALLENGE_MODE } from "@/lib/challenge";

const ITEMS = [
  { id: "review", icon: "assignment", label: "Issues" },
  { id: "problems", icon: "report", label: "Problems" },
  { id: "rules", icon: "gavel", label: "Rules" },
  { id: "changes", icon: "difference", label: "Changes" },
  { id: "history", icon: "history", label: "History" },
  { id: "snapshots", icon: "bookmark", label: "Saves" },
  { id: "agents", icon: "smart_toy", label: "Agents" },
  { id: "query", icon: "database", label: "Query" },
  { id: "wisdom", icon: "school", label: "Wisdom" },
] as const;

type ItemId = (typeof ITEMS)[number]["id"];

export default function SideRail() {
  const sidePanelView = useStore((s) => s.sidePanelView);
  const setSidePanelView = useStore((s) => s.setSidePanelView);
  const insights = useStore((s) => s.insights);
  const violations = useStore((s) => s.violations);
  const rules = useStore((s) => s.rules);
  const chatHistory = useStore((s) => s.chatHistory);
  const snapshots = useStore((s) => s.snapshots);
  const diffProbe = useStore((s) => s.diffProbe);
  const diffOverlay = useStore((s) => s.diffOverlay);

  const problemCount = mergeProblems(rules, violations, insights).length;
  const hasViolations = violations.length > 0;

  const diffAvailable = !!(diffProbe && diffProbe.isGitRepo && diffProbe.hasRemote);
  const visibleItems = ITEMS.filter(
    (it) => (CHALLENGE_MODE ? it.id === "review" : it.id !== "changes" || diffAvailable),
  );

  function getCount(id: ItemId): number | null {
    if (id === "problems") return problemCount;
    if (id === "rules") return rules.length;
    if (id === "changes") {
      if (!diffOverlay) return diffProbe?.ahead ?? null;
      const c = diffOverlay.graphDelta.counts;
      return c.nodesAdded + c.nodesRemoved + c.nodesModified;
    }
    if (id === "history") return chatHistory.length;
    if (id === "snapshots") return snapshots.length;
    return null;
  }

  function onClick(id: ItemId) {
    if (sidePanelView === id) {
      // Toggling off: clear selection + focus + hover so the canvas
      // doesn't stay dimmed with no visible panel to explain why.
      setSidePanelView(null);
      useStore.setState({
        selectedNodeId: null,
        selectedEdgeId: null,
        focusTargetIds: new Set<string>(),
        hoverInsightTargets: new Set<string>(),
        hoverViolationTargets: new Set<string>(),
        hoverPreviewTargets: new Set<string>(),
      });
    } else {
      setSidePanelView(id);
    }
  }

  function renderItem(it: (typeof ITEMS)[number]) {
    const active = sidePanelView === it.id;
    const count = getCount(it.id);
    const showCount = count !== null && count > 0;
    const isProblems = it.id === "problems";
    return (
      <button
        key={it.id}
        data-tutorial={`rail-${it.id}`}
        data-testid={`rail-${it.id}`}
        onClick={() => onClick(it.id)}
        title={it.label}
        className={`
          relative w-full py-2.5 flex items-center justify-center
          transition-colors duration-200
          ${active ? "text-white" : "text-neutral-400 hover:text-white hover:bg-surface-container"}
        `}
      >
        <span
          className={`absolute left-0 top-2 bottom-2 w-[2px] transition-colors ${
            active ? "bg-schema-accent" : "bg-transparent"
          }`}
        />
        <span className="relative">
          <span
            className="material-symbols-outlined text-[22px] leading-none"
            style={{ fontVariationSettings: "'wght' 200, 'opsz' 24" }}
          >
            {it.icon}
          </span>
          {showCount && isProblems && (
            <span
              className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                hasViolations ? "bg-violation" : "bg-schema-accent"
              }`}
            />
          )}
          {showCount && !isProblems && (
            <span
              className="absolute -top-1.5 -right-2.5 min-w-[14px] h-[14px] px-0.5
                flex items-center justify-center
                border border-outline bg-surface
                text-[0.5rem] tabular-nums leading-none text-neutral-300"
            >
              {count}
            </span>
          )}
        </span>
      </button>
    );
  }

  const settingsActive = sidePanelView === "settings";

  return (
    <aside className="w-14 shrink-0 border-r border-outline-variant bg-surface flex flex-col items-center py-3 gap-2 relative">
      {visibleItems.map(renderItem)}
      <div className="mt-auto w-full flex justify-center">
        <button
          data-testid="rail-settings"
          hidden={CHALLENGE_MODE}
          onClick={() => setSidePanelView(settingsActive ? null : "settings")}
          title="Settings"
          className={`
            relative w-full py-2.5 flex items-center justify-center
            transition-colors duration-200
            ${settingsActive ? "text-white" : "text-neutral-400 hover:text-white hover:bg-surface-container"}
          `}
        >
          <span
            className={`absolute left-0 top-2 bottom-2 w-[2px] transition-colors ${
              settingsActive ? "bg-schema-accent" : "bg-transparent"
            }`}
          />
          <span
            className="material-symbols-outlined text-[22px] leading-none"
            style={{ fontVariationSettings: "'wght' 200, 'opsz' 24" }}
          >settings</span>
        </button>
      </div>
    </aside>
  );
}

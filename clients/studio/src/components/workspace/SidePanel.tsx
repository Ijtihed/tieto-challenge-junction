"use client";

import { Suspense } from "react";
import { useStore } from "@/state/store";
import Inspector from "./Inspector";
import ProblemsRail from "./ProblemsRail";
import InsightsRail from "./InsightsRail";
import RulesPanel from "./RulesPanel";
import HistoryPanel from "./HistoryPanel";
import SummaryPanel from "./SummaryPanel";
import SnapshotsPanel from "./SnapshotsPanel";
import EdgeInspector from "./EdgeInspector";
import SourceViewer from "./SourceViewer";
import ChangesPanel from "./ChangesPanel";
import AgentsMdPanel from "./AgentsMdPanel";
import QueryPanel from "./QueryPanel";
import WisdomPanel from "./WisdomPanel";
import SettingsPanel from "./SettingsPanel";
import ReviewList from "@/components/trust/ReviewList";

const VIEW_META: Record<string, { title: string; sub: string }> = {
  inspector: { title: "Inspector", sub: "Selected node" },
  edge: { title: "Edge", sub: "Selected connection" },
  problems: { title: "Problems", sub: "Ranked issues" },
  insights: { title: "Insights", sub: "Quick fixes" },
  rules: { title: "Rules", sub: "Architecture rules" },
  history: { title: "History", sub: "Completed plans" },
  summary: { title: "Overview", sub: "Repository summary" },
  snapshots: { title: "Snapshots", sub: "Graph history" },
  source: { title: "Source", sub: "Source code" },
  changes: { title: "Changes", sub: "Diff view" },
  agents: { title: "AGENTS.md", sub: "Agent context" },
  query: { title: "Query", sub: "Graph queries" },
  wisdom: { title: "Wisdom", sub: "Knowledge base" },
  settings: { title: "Settings", sub: "Preferences" },
  review: { title: "Issues", sub: "" },
};

export default function SidePanel() {
  const sidePanelView = useStore((s) => s.sidePanelView);
  const setSidePanelView = useStore((s) => s.setSidePanelView);
  const selectNode = useStore((s) => s.selectNode);
  const selectEdge = useStore((s) => s.selectEdge);
  const planPhase = useStore((s) => s.planPhase);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);

  if (planPhase === "running") return null;

  const view = sidePanelView;

  if (!view) return null;
  const meta = VIEW_META[view];

  function close() {
    setSidePanelView(null);
    // Always clear selection + focus when closing ANY panel. Before
    // this fix, closing the Problems panel after "Jump to" left
    // focusTargetIds set and the canvas stayed dimmed with no
    // visible panel explaining why.
    if (selectedNodeId) selectNode(null);
    if (selectedEdgeId) selectEdge(null);
    useStore.setState({
      focusTargetIds: new Set<string>(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
    });
  }

  return (
    <aside
      data-testid="side-panel"
      aria-label={meta.title}
      className="w-[400px] shrink-0 ui-panel flex flex-col"
    >
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="ui-title">{meta.title}</h2>
          {meta.sub && <p className="ui-meta mt-0.5">{meta.sub}</p>}
        </div>
        <button
          onClick={close}
          data-testid="side-panel-close"
          className="ui-icon-btn -mr-1 -mt-1"
          title="Close"
          aria-label="Close panel"
        >
          <span className="material-symbols-outlined text-[18px] leading-none">
            close
          </span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<PanelSkeleton />}>
        {view === "inspector" && <Inspector />}
        {view === "edge" && <EdgeInspector />}
        {view === "problems" && (
          <div className="p-4">
            <ProblemsRail />
          </div>
        )}
        {view === "insights" && (
          <div className="p-4">
            <InsightsRail />
          </div>
        )}
        {view === "rules" && <RulesPanel />}
        {view === "history" && <HistoryPanel />}
        {view === "summary" && <SummaryPanel />}
        {view === "snapshots" && <SnapshotsPanel />}
        {view === "source" && <SourceViewer />}
        {view === "changes" && <ChangesPanel />}
        {view === "agents" && <AgentsMdPanel />}
        {view === "query" && <QueryPanel />}
        {view === "wisdom" && <WisdomPanel />}
        {view === "settings" && <SettingsPanel />}
        {view === "review" && <ReviewList />}
        </Suspense>
      </div>
    </aside>
  );
}

function PanelSkeleton() {
  return (
    <div className="p-5 space-y-4 animate-pulse">
      <div className="h-3 w-2/3 bg-surface-container rounded" />
      <div className="h-3 w-full bg-surface-container rounded" />
      <div className="h-3 w-5/6 bg-surface-container rounded" />
      <div className="h-8 w-full bg-surface-container rounded mt-2" />
      <div className="h-3 w-3/4 bg-surface-container rounded" />
      <div className="h-3 w-1/2 bg-surface-container rounded" />
    </div>
  );
}

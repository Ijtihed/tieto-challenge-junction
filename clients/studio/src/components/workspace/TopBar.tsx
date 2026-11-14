"use client";

import { CHALLENGE_MODE } from "@/lib/challenge";
import Link from "next/link";
import { useMemo, useEffect, useState } from "react";
import { useStore } from "@/state/store";
import SchemaLogo from "@/components/SchemaLogo";
import LevelToggle from "./LevelToggle";
import DiffToggle from "./DiffToggle";
import UserMenu from "./UserMenu";
import { filterByDrill } from "@/lib/aggregate";

export default function TopBar() {
  const repo = useStore((s) => s.repo);
  const mcpStatus = useStore((s) => s.mcpStatus);
  const liveAtlas = useStore((s) => s.liveAtlas);
  const diffProbe = useStore((s) => s.diffProbe);
  const drillPath = useStore((s) => s.drillPath);
  const popToSegment = useStore((s) => s.popToSegment);
  const workingGraph = useStore((s) => s.workingGraph);

  const deepest = drillPath[drillPath.length - 1];

  const kindLabel = useMemo(() => {
    if (!deepest) return "";
    if (deepest.id.startsWith("cluster:")) return "cluster";
    if (deepest.id.startsWith("module:")) return "module";
    return "node";
  }, [deepest]);

  const surviving = useMemo(() => {
    if (drillPath.length === 0) return 0;
    return filterByDrill(workingGraph, drillPath).nodes.length;
  }, [drillPath, workingGraph]);

  return (
    <header className="h-16 border-b border-outline-variant bg-surface-dim flex items-center justify-between px-5 shrink-0 relative z-50">
      {/* Left: logo + repo */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Link
          href="/"
          className="flex items-center gap-2 hover:opacity-70 transition-opacity shrink-0"
          title="Schema Studio"
        >
          <SchemaLogo className="w-9 h-9" />
        </Link>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            mcpStatus === "connected" ? "bg-green-400" :
            mcpStatus === "reconnecting" ? "bg-yellow-400 animate-pulse" :
            "bg-red-400"
          }`}
          title={`MCP: ${mcpStatus}`}
        />
        <LiveAtlasIndicator
          watching={liveAtlas.watching}
          lastEventAt={liveAtlas.lastEventAt}
          eventsReceived={liveAtlas.eventsReceived}
        />
        <span className="w-px h-5 bg-outline-variant shrink-0" />
        <span className="text-base text-on-surface-variant truncate">{repo.label}</span>
        {repo.subtitle && (
          <span className="text-xs text-on-surface-faint truncate hidden sm:inline">{repo.subtitle}</span>
        )}
        {diffProbe?.headBranch && (
          <BranchPill
            branch={diffProbe.headBranch}
            ahead={diffProbe.ahead}
            behind={diffProbe.behind}
            dirty={diffProbe.workingTreeDirty}
            base={diffProbe.baseBranch}
          />
        )}
      </div>

      {/* Center: drill breadcrumb (only when drilling) */}
      {drillPath.length > 0 && (
        <nav
          aria-label="Drill path"
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs text-on-surface-variant"
        >
          <span>{kindLabel}</span>
          <button onClick={() => popToSegment(-1)} className="hover:text-white transition-colors">All</button>
          {drillPath.map((seg, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-neutral-600">›</span>
              <button
                onClick={() => popToSegment(i)}
                className={`transition-colors ${i === drillPath.length - 1 ? "text-white" : "hover:text-white"}`}
              >
                {seg.label}
              </button>
            </div>
          ))}
          <span className="text-on-surface-faint">· {surviving} node{surviving === 1 ? "" : "s"}</span>
          <button
            onClick={() => popToSegment(-1)}
            data-testid="drill-exit"
            title="Back to overview"
            className="w-4 h-4 flex items-center justify-center border border-outline-variant hover:border-neutral-500 text-on-surface-faint hover:text-white transition-colors ml-1"
          >
            ×
          </button>
        </nav>
      )}

      {/* Right: controls */}
      <div className="flex items-center gap-3 flex-1 justify-end">
        {CHALLENGE_MODE ? null : <><DiffToggle /><LevelToggle /></>}
        {CHALLENGE_MODE ? null : <UserMenu />}
      </div>
    </header>
  );
}

// Step 5a: L1 file-watch surfacing. When `watching` is true, a tiny
// teal dot sits next to the MCP status dot; when a `files.changed`
// event arrives, it pulses briefly. Per `architecture/v1-launch-plan.md`
// Step 5a — the entry point for the live-atlas UX.
function LiveAtlasIndicator(props: {
  watching: boolean;
  lastEventAt: number;
  eventsReceived: number;
}) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!props.lastEventAt) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [props.lastEventAt]);

  if (!props.watching) return null;

  return (
    <span
      data-testid="live-atlas-indicator"
      data-pulsing={pulse ? "true" : "false"}
      data-events={props.eventsReceived}
      title={`Live atlas: ${props.eventsReceived} file change${props.eventsReceived === 1 ? "" : "s"} observed`}
      className={`w-2 h-2 rounded-full shrink-0 transition-all duration-300 ${
        pulse ? "bg-teal-300 ring-2 ring-teal-400/60 scale-110" : "bg-teal-500/70"
      }`}
    />
  );
}

function BranchPill(props: {
  branch: string;
  base: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
}) {
  const trackInfo: string[] = [];
  if (props.ahead > 0) trackInfo.push(`+${props.ahead}`);
  if (props.behind > 0) trackInfo.push(`−${props.behind}`);
  return (
    <span
      data-testid="topbar-branch"
      data-dirty={props.dirty ? "true" : "false"}
      title={
        props.dirty
          ? `On ${props.branch} · working tree has uncommitted changes${
              props.base ? ` · base ${props.base}` : ""
            }`
          : `On ${props.branch}${
              props.base ? ` · base ${props.base}` : ""
            }`
      }
      className={`hidden sm:inline-flex items-center gap-1.5 font-[JetBrains_Mono] text-xs tracking-[0.06em] px-2 py-0.5 border ${
        props.dirty
          ? "border-phase-applying/40 text-phase-applying"
          : "border-outline-variant text-on-surface-variant"
      }`}
    >
      <span className="material-symbols-outlined text-[10px] leading-none">
        alt_route
      </span>
      <span className="truncate max-w-[140px]">{props.branch}</span>
      {props.dirty && (
        <span
          data-testid="topbar-branch-dirty"
          aria-label="working tree dirty"
          className="w-1.5 h-1.5 rounded-full bg-phase-applying"
        />
      )}
      {trackInfo.length > 0 && (
        <span className="text-on-surface-faint">{trackInfo.join(" ")}</span>
      )}
    </span>
  );
}

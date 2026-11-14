"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTrust, type AgentRun, type Receipt, type RepoMap as RepoMapData } from "@/state/trust";
import { eventsFromReceipt, eventsFromRun, finalState, type MapEvent } from "./mapModel";
import { ACT_COLOR, type ActKind, type GraphMarks } from "./RepoGraph";
import { applyCanvasMarks, describeCanvasEdge, loadCurated } from "@/lib/curatedGraph";
import { CHALLENGE_REPO } from "@/lib/challenge";
import { syncPlanFromRun } from "@/lib/agentPlanBridge";


export function marksAt(map: RepoMapData, events: MapEvent[], head: number, receipt: Receipt | null, showFinal: boolean): GraphMarks {
  const shown = events.slice(0, head);
  const touched = new Map<string, ActKind>();
  const edited = new Set<string>();
  for (const e of shown) {
    touched.set(e.node, e.kind === "edit" || touched.get(e.node) === "edit" ? "edit" : e.kind);
    if (e.kind === "edit") edited.add(e.node);
  }
  const fin = showFinal ? finalState(map, receipt) : null;
  const last = shown[shown.length - 1];
  return {
    touched, edited,
    changed: fin?.changed, flagged: fin?.flagged, added: fin?.added, lines: fin?.lines,
    current: last && !showFinal ? { node: last.node, kind: last.kind } : null,
    trail: showFinal ? [] : shown.slice(-8).map((e) => ({ node: e.node, kind: e.kind })),
  };
}

export function eventsFor(map: RepoMapData, run: AgentRun | null, receipt: Receipt | null): MapEvent[] {
  if (run && (!receipt || receipt.agent?.runId === run.runId || run.status === "running")) return eventsFromRun(map, run);
  return receipt ? eventsFromReceipt(map, receipt) : [];
}

interface Note { id: number; icon: string; color: string; title: string; body?: string; href?: string }

/** Toasts for the moments a reviewer cares about: edits, test runs, finish, PR. */
function useNotifications(): Note[] {
  const run = useTrust((s) => s.run);
  const receipt = useTrust((s) => s.receipt);
  const pr = useTrust((s) => s.pr);
  const [notes, setNotes] = useState<Note[]>([]);
  const seen = useRef<{ run?: string; steps: number; status?: string; receipt?: string; pr?: string }>({ steps: 0 });
  const push = (n: Omit<Note, "id">) => {
    const id = Date.now() + Math.random();
    setNotes((xs) => [...xs.slice(-3), { ...n, id }]);
    setTimeout(() => setNotes((xs) => xs.filter((x) => x.id !== id)), 7000);
  };
  useEffect(() => {
    if (!run) return;
    const s = seen.current;
    if (s.run !== run.runId) { s.run = run.runId; s.steps = run.status === "running" ? 0 : run.steps.length; s.status = run.status; }
    for (const st of run.steps.slice(s.steps)) {
      if (st.kind === "edit") push({ icon: "edit", color: ACT_COLOR.edit, title: "Claude edited a file", body: st.file ?? st.title });
      if (st.kind === "command" && /dotnet test/.test(st.title)) push({ icon: "science", color: ACT_COLOR.command, title: "Claude is running tests", body: st.title.replace(/^\$ /, "") });
      if (st.title.startsWith("CI (")) push({ icon: "deployed_code", color: "#8a9bb0", title: "CI started", body: st.title });
      if (st.title.startsWith("CI · ") && !st.title.includes("passed")) push({ icon: "error", color: "#f87171", title: "CI step failed: Claude will try to fix it", body: st.title.slice(5) });
      if (st.title.startsWith("CI · vulnerable packages")) push({ icon: st.title.includes("passed") ? "verified_user" : "gpp_bad", color: st.title.includes("passed") ? "#4ade80" : "#f87171", title: "Supply-chain check", body: st.title.slice(5) });
    }
    s.steps = run.steps.length;
    if (s.status === "running" && run.status !== "running") {
      push(run.status === "done"
        ? { icon: "task_alt", color: "#4ade80", title: "Claude finished: open a PR?", body: `${run.filesChanged?.length ?? 0} files changed · review it in the plan panel, then Open pull request` }
        : { icon: "error", color: "#f87171", title: "Agent run failed", body: run.error });
    }
    s.status = run.status;
  }, [run]);
  useEffect(() => {
    if (receipt && seen.current.receipt !== receipt.id && run?.status === "done") {
      seen.current.receipt = receipt.id;
      push({ icon: "fact_check", color: "#e4e4e7", title: `Receipt: ${receipt.risk.tierLabel}`, body: `Owner reads ${receipt.summary.readLines} of ${receipt.summary.totalLines} lines · ${receipt.refusals.length} question(s) for you` });
    }
  }, [receipt, run?.status]);
  useEffect(() => {
    if (pr && seen.current.pr !== pr.url) {
      seen.current.pr = pr.url;
      push({ icon: "merge", color: "#8a9bb0", title: `PR #${pr.number} opened`, body: "Live page with the graph, actions and decisions", href: pr.pageUrl ?? pr.url });
    }
  }, [pr]);
  return notes;
}

export default function RepoMap() {
  const map = useTrust((s) => s.map);
  const run = useTrust((s) => s.run);
  const receipt = useTrust((s) => s.receipt);
  const notes = useNotifications();

  // Only edits move the canvas: reads, searches and commands stay in the plan panel's stream.
  const events = useMemo(() => (map ? eventsFor(map, run, receipt).filter((e) => e.kind === "edit") : []), [map, run, receipt]);
  const live = run?.status === "running";
  const head = events.length;
  const finished = !live && !!receipt;
  const marks = map ? marksAt(map, events, head, receipt, finished) : null;

  // Schema's own canvas shows the curated map; this layer only drives its highlights and plan panel.
  useEffect(() => { if (map) loadCurated(map, CHALLENGE_REPO); }, [map]);
  useEffect(() => { syncPlanFromRun(run); }, [run]);
  useEffect(() => {
    if (!marks) return;
    const recent = [...new Set(events.slice(Math.max(0, head - 5), head).map((e) => e.node))];
    applyCanvasMarks({
      current: live ? marks.current?.node ?? null : null,
      prev: live ? [...events.slice(0, Math.max(0, head - 1))].reverse().find((e) => e.node !== marks.current?.node)?.node ?? null : null,
      recent: live ? recent : [],
      changed: new Set([...(marks.edited ?? []), ...(marks.changed ?? [])]),
      added: marks.added,
      flagged: marks.flagged,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, head, events, finished, receipt?.id]);

  if (!map) return null;

  return (
    <div className="absolute inset-0 pointer-events-none [&>*]:pointer-events-auto">
      <EdgeHoverCard />
      <div className="absolute top-3 right-3 z-30 flex flex-col gap-2 w-[340px]">
        {notes.map((n) => (
          <a key={n.id} href={n.href} target={n.href ? "_blank" : undefined} rel="noreferrer"
            className="flex gap-3 items-start bg-surface-dim/95 backdrop-blur border border-outline-variant px-3 py-2.5 shadow-2xl animate-[fadeIn_200ms_ease-out]">
            <span className="material-symbols-outlined text-[18px] mt-0.5" style={{ color: n.color }}>{n.icon}</span>
            <span className="min-w-0">
              <span className="block text-xs text-white">{n.title}</span>
              {n.body && <span className="block text-[11px] text-on-surface-variant font-[JetBrains_Mono] truncate">{n.body}</span>}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Hover card for a connection: what kind of dependency it is and concrete member-level examples. */
function EdgeHoverCard() {
  const [info, setInfo] = useState<{ x: number; y: number; title: string; description: string; examples: string[] } | null>(null);
  useEffect(() => {
    const h = (ev: Event) => {
      const d = (ev as CustomEvent<{ source: string; target: string; x: number; y: number } | null>).detail;
      if (!d) { setInfo(null); return; }
      const desc = describeCanvasEdge(d.source, d.target);
      setInfo(desc ? { x: d.x, y: d.y, ...desc } : null);
    };
    window.addEventListener("schema:edge-hover", h);
    return () => window.removeEventListener("schema:edge-hover", h);
  }, []);
  if (!info) return null;
  return (
    <div className="fixed z-50 max-w-[380px] bg-surface-dim/95 backdrop-blur border border-outline-variant px-3 py-2.5 shadow-2xl pointer-events-none" style={{ left: info.x + 14, top: info.y + 14 }}>
      <div className="text-xs text-white font-[JetBrains_Mono]">{info.title}</div>
      <div className="text-[11px] text-on-surface-variant mt-1 leading-relaxed">{info.description}</div>
      {info.examples.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">{info.examples.map((x) => <li key={x} className="text-[10.5px] font-[JetBrains_Mono] text-on-surface-muted">{x}</li>)}</ul>
      )}
    </div>
  );
}

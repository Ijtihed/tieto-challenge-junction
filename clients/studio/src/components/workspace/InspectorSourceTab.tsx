"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";

interface FileResponse {
  path: string;
  content: string;
  lines: number;
  bytes: number;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: FileResponse }
  | { kind: "error"; message: string };

/**
 * Source-code tab for the Inspector. Loads the file referenced by the
 * selected node and renders it with clickable identifiers — clicking a
 * symbol that matches another node in the graph selects + focuses that
 * node in the canvas.
 */
export default function InspectorSourceTab({ nodeId }: { nodeId: string }) {
  const workingGraph = useStore((s) => s.workingGraph);
  const repo = useStore((s) => s.repo);
  const selectNode = useStore((s) => s.selectNode);
  const focusOnIds = useStore((s) => s.focusOnIds);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const targetLineRef = useRef<HTMLDivElement | null>(null);

  const node = workingGraph.nodes.find((n) => n.id === nodeId);
  const file = node?.file ?? null;
  const startLine = node?.sourceRange?.startLine ?? 1;
  const endLine = node?.sourceRange?.endLine ?? startLine;
  const rootPath = repo.rootPath ?? null;
  const absPath = useMemo(() => {
    if (!file || !rootPath) return null;
    if (file.startsWith("/")) return file;
    return `${rootPath.replace(/\/$/, "")}/${file}`;
  }, [file, rootPath]);
  const looksOnDisk = !!absPath;

  // Map identifier text → matching node id so we can render clickable spans.
  const symbolIndex = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of workingGraph.nodes) {
      if (n.id === nodeId) continue;
      if (n.name && n.name.length > 2) m.set(n.name, n.id);
    }
    return m;
  }, [workingGraph.nodes, nodeId]);

  useEffect(() => {
    if (!absPath) return;
    setState({ kind: "loading" });
    let cancelled = false;
    fetchApi(`/api/file?path=${encodeURIComponent(absPath)}`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || "error" in json) {
          setState({ kind: "error", message: ("error" in json ? json.error : `HTTP ${res.status}`) as string });
        } else {
          setState({ kind: "ready", data: json as FileResponse });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [absPath]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const el = targetLineRef.current;
    if (el) el.scrollIntoView({ block: "center", behavior: "auto" });
  }, [state]);

  function jumpToNode(targetId: string) {
    selectNode(targetId);
    focusOnIds([targetId]);
  }

  if (!node) return <div className="p-4 text-xs text-on-surface-faint">No node selected.</div>;

  if (!looksOnDisk) {
    return (
      <div className="p-4">
        <p className="text-xs text-on-surface-muted mb-2">Source unavailable</p>
        <p className="text-xs text-on-surface-faint leading-relaxed">
          This graph was loaded from the bundled fixture, so the file paths don&apos;t exist on disk.
        </p>
      </div>
    );
  }

  if (state.kind === "loading" || state.kind === "idle") {
    return <div className="p-4 text-xs text-on-surface-muted">Loading source…</div>;
  }

  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="font-[JetBrains_Mono] text-xs text-violation mb-1">Error</p>
        <p className="text-xs text-on-surface-faint">{state.message}</p>
      </div>
    );
  }

  const lines = state.data.content.split(/\r?\n/);
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="inspector-source">
      <div className="px-4 py-2.5 border-b border-outline-variant/60 shrink-0">
        <p className="text-[10px] font-[JetBrains_Mono] uppercase tracking-wider text-on-surface-faint">
          {endLine > startLine ? `lines ${startLine}–${endLine}` : `line ${startLine}`}
        </p>
        <p className="font-[JetBrains_Mono] text-xs text-on-surface-variant truncate mt-0.5">
          {file}
        </p>
      </div>
      <div className="flex-1 overflow-auto bg-surface font-[JetBrains_Mono] text-xs leading-[1.55]">
        {lines.map((ln, idx) => {
          const lineNum = idx + 1;
          const isStart = lineNum === startLine;
          const inRange = lineNum >= startLine && lineNum <= endLine;
          return (
            <div
              key={lineNum}
              ref={isStart ? targetLineRef : null}
              className={`grid grid-cols-[2.75rem_1fr] ${
                inRange
                  ? "bg-schema-accent/[0.07] border-l-2 border-schema-accent/60"
                  : "border-l-2 border-transparent"
              }`}
            >
              <span className="px-2 text-right text-on-surface-faint select-none tabular-nums">
                {lineNum}
              </span>
              <span className="px-2 text-on-surface whitespace-pre">
                {renderLine(ln, symbolIndex, jumpToNode)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tokenise a line and wrap matching identifiers in clickable buttons. */
function renderLine(
  line: string,
  symbolIndex: Map<string, string>,
  jump: (id: string) => void,
) {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  const re = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const word = match[0];
    const id = symbolIndex.get(word);
    if (!id) continue;
    if (match.index > lastIdx) parts.push(line.slice(lastIdx, match.index));
    parts.push(
      <button
        key={`${match.index}-${word}`}
        onClick={(e) => { e.stopPropagation(); jump(id); }}
        className="text-schema-accent hover:underline cursor-pointer"
        title={`Jump to ${word}`}
      >
        {word}
      </button>,
    );
    lastIdx = match.index + word.length;
  }
  if (lastIdx < line.length) parts.push(line.slice(lastIdx));
  return parts.length > 0 ? parts : line;
}

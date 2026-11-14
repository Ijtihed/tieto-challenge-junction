"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";

interface FileResponse {
  path: string;
  content: string;
  lines: number;
  bytes: number;
}

interface ErrorResponse {
  error: string;
  code: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: FileResponse }
  | { kind: "error"; message: string; code: string };

/**
 * Right-panel source viewer. Activated by `sidePanelView === "source"`.
 *
 * Reads the file path + highlighted line from the currently selected
 * graph node (we expect `node.file` and `node.sourceRange.startLine`).
 * Falls back to a friendly "this is a fixture node, source is in-memory
 * only" empty state when the file isn't on disk.
 */
export default function SourceViewer() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const workingGraph = useStore((s) => s.workingGraph);
  const repo = useStore((s) => s.repo);

  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const targetLineRef = useRef<HTMLDivElement | null>(null);

  const node =
    selectedNodeId != null
      ? workingGraph.nodes.find((n) => n.id === selectedNodeId)
      : null;
  const file = node?.file ?? null;
  const startLine = node?.sourceRange?.startLine ?? 1;
  const endLine = node?.sourceRange?.endLine ?? startLine;
  // Range-aware highlight: route handlers with inline arrow bodies
  // carry an inlineHandlerEndLine on meta + a real endLine on
  // sourceRange. The viewer paints every line in [startLine, endLine]
  // when the range spans multiple lines.
  const isRange = endLine > startLine;

  // The bundled fixture has no rootPath — its files live only in memory.
  // Real extracted graphs carry an absolute rootPath set by the API
  // response, which we join with the node's repo-relative file path to
  // build the lookup the /api/file endpoint expects.
  const rootPath = repo.rootPath ?? null;
  const absPath = file && rootPath ? `${rootPath}/${file}` : null;
  const looksOnDisk = !!absPath;
  // Reference workingGraph.rootDir to keep the dependency on the active
  // graph explicit (eslint will otherwise mark it unused after the
  // refactor — and we want SourceViewer to re-render when the graph
  // identity changes).
  void workingGraph.rootDir;

  useEffect(() => {
    if (!file || !looksOnDisk) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchApi(`/api/file?path=${encodeURIComponent(absPath!)}`)
      .then(async (res) => {
        const json = (await res.json()) as FileResponse | ErrorResponse;
        if (cancelled) return;
        if (!res.ok || "error" in json) {
          setState({
            kind: "error",
            message: "error" in json ? json.error : `HTTP ${res.status}`,
            code: "error" in json ? json.code : "http",
          });
        } else {
          setState({ kind: "ready", data: json });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
          code: "fetch-failed",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [absPath, file, looksOnDisk]);

  // Scroll the highlighted line into view once the content renders.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const el = targetLineRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "auto" });
  }, [state]);

  if (!node) {
    return (
      <div data-testid="source-empty-no-node">
        <div className="p-6 text-xs text-on-surface-faint">
          Select a node to view its source.
        </div>
        {rootPath && <WorkspaceFileList onSelectFile={(f) => {
          const match = workingGraph.nodes.find((n) => n.file === f);
          if (match) useStore.getState().selectNode(match.id);
        }} />}
      </div>
    );
  }

  if (!looksOnDisk) {
    return (
      <div className="p-6" data-testid="source-empty-fixture">
        <p className="text-xs text-on-surface-muted mb-2">
          Source unavailable
        </p>
        <p className="text-xs text-on-surface leading-relaxed">
          This graph was loaded from the bundled in-memory fixture, so its
          file paths don&apos;t exist on disk. Extract a real repo from the
          landing page (or set <code className="font-[JetBrains_Mono]">SCHEMA_ALLOW_ROOTS</code>) to enable
          source viewing.
        </p>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div
        className="p-6 text-xs text-on-surface-muted"
        data-testid="source-loading"
      >
        Loading...
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="p-6" data-testid="source-error">
        <p className="font-[JetBrains_Mono] text-xs text-violation mb-2">
          {state.code}
        </p>
        <p className="text-xs text-on-surface leading-relaxed">
          {state.message}
        </p>
      </div>
    );
  }

  if (state.kind === "ready") {
    const lines = state.data.content.split(/\r?\n/);
    return (
      <div
        className="flex flex-col h-full overflow-hidden"
        data-testid="source-viewer"
      >
        <div className="px-4 py-3 border-b border-outline-variant shrink-0">
          <p className="text-xs text-on-surface-muted">
            Source · {isRange ? `lines ${startLine}–${endLine}` : `line ${startLine}`}
          </p>
          <p className="font-[JetBrains_Mono] text-xs text-on-surface truncate mt-0.5">
            {file}
          </p>
        </div>
        <pre
          className="flex-1 overflow-auto bg-surface m-0 font-[JetBrains_Mono] text-xs leading-[1.5]"
          data-testid="source-content"
        >
          {lines.map((ln, idx) => {
            const lineNum = idx + 1;
            const isStart = lineNum === startLine;
            const inRange = lineNum >= startLine && lineNum <= endLine;
            return (
              <div
                key={lineNum}
                ref={isStart ? targetLineRef : null}
                data-line={lineNum}
                data-target={isStart ? "true" : undefined}
                data-in-range={inRange ? "true" : undefined}
                className={`grid grid-cols-[3rem_1fr] ${
                  inRange
                    ? "bg-schema-accent/15 border-l-2 border-schema-accent"
                    : "border-l-2 border-transparent"
                }`}
              >
                <span className="px-2 text-right text-on-surface-faint select-none">
                  {lineNum}
                </span>
                <span className="px-2 text-on-surface whitespace-pre">{ln}</span>
              </div>
            );
          })}
        </pre>
      </div>
    );
  }

  return null;
}

function WorkspaceFileList({ onSelectFile }: { onSelectFile: (file: string) => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchApi("/api/workspace/list-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((d) => {
        setFiles((d.files ?? []).map((f: any) => (typeof f === "string" ? f : f.path ?? f.name ?? "")));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded || files.length === 0) return null;

  const visible = expanded ? files : files.slice(0, 15);

  return (
    <div className="px-4 py-3 border-t border-outline-variant/60" data-testid="workspace-file-list">
      <p className="text-xs font-medium text-on-surface-faint mb-2">
        Workspace files · {files.length}
      </p>
      <div className="space-y-0.5 max-h-60 overflow-auto">
        {visible.map((f) => (
          <button
            key={f}
            onClick={() => onSelectFile(f)}
            className="w-full text-left font-[JetBrains_Mono] text-xs text-neutral-400 hover:text-white truncate py-0.5 transition-colors"
          >
            {f}
          </button>
        ))}
      </div>
      {files.length > 15 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-on-surface-muted hover:text-white"
        >
          {expanded ? `Show fewer · hide ${files.length - 15}` : `Show all · ${files.length - 15} more`}
        </button>
      )}
    </div>
  );
}

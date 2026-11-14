"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";
import { KIND_META, HTTP_METHOD_COLOR } from "@/components/canvas/nodeKindMeta";
import { mockDiff, mockGraphPatch } from "@/lib/mockPlanner";
import { APPLICABLE_OPS, promptForOp, buildPreviewStep } from "@/lib/ops";
import type { OpStep, GraphNode, GraphPatch, Graph } from "@/lib/types";
import OpenInEditorButton from "./OpenInEditorButton";
import BlameStrip from "./BlameStrip";
import InspectorSourceTab from "./InspectorSourceTab";

function InspectorTabs({
  active,
  onChange,
}: {
  active: "overview" | "source";
  onChange: (t: "overview" | "source") => void;
}) {
  const tabs: { id: "overview" | "source"; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "description" },
    { id: "source", label: "Source", icon: "code" },
  ];
  return (
    <div className="flex border-b border-outline-variant/60 shrink-0 px-3 pt-2 gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-xs transition-colors ${
            active === t.id
              ? "text-white bg-surface-container/60 border-b border-schema-accent -mb-px"
              : "text-on-surface-faint hover:text-on-surface-variant"
          }`}
        >
          <span
            className="material-symbols-outlined text-[14px] leading-none"
            style={{ fontVariationSettings: "'wght' 200" }}
          >
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    let ok = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id);
        ok = true;
      }
    } catch {
      // Modern API failed (insecure context, permissions, etc.) — fall through.
    }
    if (!ok && typeof document !== "undefined") {
      try {
        const ta = document.createElement("textarea");
        ta.value = id;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        /* both paths failed — give up silently */
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }
  return (
    <button
      onClick={copy}
      data-testid="copy-node-id"
      className="group w-full text-left flex items-baseline gap-2 hover:text-white transition-colors"
      title={copied ? "Copied" : "Copy node id"}
    >
      <span className="font-[JetBrains_Mono] text-xs text-on-surface-muted break-all leading-relaxed group-hover:text-on-surface-variant flex-1">
        {id}
      </span>
      <span
        className={`text-xs shrink-0 transition-colors ${
          copied ? "text-phase-pass" : "text-on-surface-faint group-hover:text-on-surface-variant"
        }`}
        data-testid="copy-node-id-status"
      >
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

const OP_DEFAULT_PARAMS: Record<string, string> = {
  addMiddleware: "{ middleware: 'requireAuth', middlewareFile: 'src/middleware/auth.ts' }",
  addCaching: "{ cacheKey: '\"global\"', ttlMs: 60000 }",
  wrapTransformation: "{ kind: 'telemetry' }",
  extractModule: "{ destFile: 'src/domain/<name>.ts' }",
};

/**
 * One-line note rendered under each op button. Used for ops whose
 * behaviour isn't obvious from the name or whose v1 implementation
 * is intentionally narrow.
 */
const OP_NOTE: Record<string, string> = {
  extractModule:
    "shim only · re-exports from the original file so importers keep working",
  addCaching:
    "v1 · parameterless functions only · module-global cache, no manual eviction",
};

function CallersSection({ nodeId }: { nodeId: string }) {
  const [callers, setCallers] = useState<{ id: string; name: string; relation?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const selectNode = useStore((s) => s.selectNode);
  const focusOnIds = useStore((s) => s.focusOnIds);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchApi("/api/graph/find-callers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbolId: nodeId, depth: 2 }),
      });
      if (res.ok) {
        const json = await res.json();
        setCallers(json.callers ?? []);
      }
    } catch { /* best-effort */ }
    setLoading(false);
    setLoaded(true);
  }

  if (!loaded) {
    return (
      <button
        onClick={load}
        disabled={loading}
        data-testid="find-callers-btn"
        className="w-full text-left px-4 py-2.5 border border-outline-variant hover:border-neutral-600 text-xs text-on-surface-muted hover:text-white transition-colors"
      >
        {loading ? "Loading callers…" : "Find callers"}
      </button>
    );
  }

  if (callers.length === 0) {
    return (
      <p className="text-xs text-on-surface-faint px-1">
        No callers found
      </p>
    );
  }

  return (
    <div className="space-y-1" data-testid="callers-list">
      {callers.slice(0, 20).map((c) => (
        <button
          key={c.id}
          onClick={() => { selectNode(c.id); focusOnIds([c.id]); }}
          className="w-full text-left flex items-center gap-3 py-1.5 border-b border-outline-variant/40 last:border-0 hover:text-white transition-colors"
        >
          <span className="text-xs text-neutral-500 w-16 shrink-0">
            {c.relation ?? "calls"}
          </span>
          <span className="font-[JetBrains_Mono] text-xs text-neutral-200 truncate">
            {c.name ?? c.id}
          </span>
        </button>
      ))}
      {callers.length > 20 && (
        <p className="text-xs text-on-surface-faint mt-1">
          … +{callers.length - 20} more
        </p>
      )}
    </div>
  );
}

function FindPathButton({ fromId }: { fromId: string }) {
  const workingGraph = useStore((s) => s.workingGraph);
  const focusOnIds = useStore((s) => s.focusOnIds);
  const emitToast = useStore((s) => s.emitToast);
  const [target, setTarget] = useState("");
  const [path, setPath] = useState<{ id: string; name: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function findPath() {
    if (!target.trim()) return;
    setLoading(true);
    try {
      const res = await fetchApi("/api/graph/path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromId, to: target.trim(), maxHops: 6 }),
      });
      if (res.ok) {
        const json = await res.json();
        const hops = json.paths?.[0]?.hops ?? json.hops ?? [];
        setPath(hops);
        if (hops.length > 0) {
          focusOnIds(hops.map((h: any) => h.id));
        } else {
          emitToast("no path found");
        }
      }
    } catch (e) {
      emitToast(`path failed · ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-testid="find-path-btn"
        className="w-full text-left px-4 py-2.5 border border-outline-variant hover:border-neutral-600 text-xs text-on-surface-muted hover:text-white transition-colors"
      >
        Find path
      </button>
    );
  }

  return (
    <div className="border border-outline-variant p-3 space-y-2" data-testid="find-path-form">
      <div className="flex gap-2">
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="target node id"
          list="path-target-suggestions"
          className="flex-1 bg-transparent border border-outline px-2 py-1.5 font-[JetBrains_Mono] text-xs text-white placeholder:text-on-surface-faint outline-none focus:border-schema-accent"
        />
        <button
          onClick={findPath}
          disabled={loading || !target.trim()}
          className="px-3 py-1.5 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors disabled:opacity-40"
        >
          {loading ? "…" : "Find"}
        </button>
      </div>
      <datalist id="path-target-suggestions">
        {workingGraph.nodes.slice(0, 100).map((n) => (
          <option key={n.id} value={n.id}>{n.name}</option>
        ))}
      </datalist>
      {path && path.length > 0 && (
        <div className="space-y-1">
          {path.map((hop: any, i: number) => (
            <p key={i} className="font-[JetBrains_Mono] text-xs text-neutral-300">
              {i > 0 && <span className="text-on-surface-faint mr-2">→</span>}
              {hop.name ?? hop.id}
            </p>
          ))}
        </div>
      )}
      {path && path.length === 0 && (
        <p className="text-xs text-on-surface-faint">
          No path found
        </p>
      )}
    </div>
  );
}

function NodeSnippet({ nodeId }: { nodeId: string }) {
  const [snippet, setSnippet] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchApi("/api/graph/get-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: nodeId, include: ["snippet"] }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setSnippet(d.snippet ?? null);
          setLoaded(true);
        }
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [nodeId]);

  if (!loaded || !snippet) return null;

  return (
    <div data-testid="node-snippet">
      <p className="text-xs text-neutral-500 mb-2">
        Snippet
      </p>
      <pre className="font-[JetBrains_Mono] text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap bg-surface-dim border border-outline-variant/60 p-2 max-h-28 overflow-auto">
        {snippet}
      </pre>
    </div>
  );
}

function FunctionInspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const workingGraph = useStore((s) => s.workingGraph);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const drillInto = useStore((s) => s.drillInto);
  const level = useStore((s) => s.level);
  const pinnedNodeIds = useStore((s) => s.pinnedNodeIds);
  const togglePin = useStore((s) => s.togglePin);
  const setSidePanelView = useStore((s) => s.setSidePanelView);
  const repoRootPath = useStore((s) => s.repo.rootPath ?? null);
  const setHoverPreview = useStore((s) => s.setHoverPreview);
  const [expandedOp, setExpandedOp] = useState<string | null>(null);
  const hoveredOp = expandedOp;
  const [showAllConnections, setShowAllConnections] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "source">("overview");
  const [backendOps, setBackendOps] = useState<string[] | null>(null);

  const [realPreview, setRealPreview] = useState<
    | null
    | { kind: "loading" }
    | { kind: "ready"; diff: string; patch: GraphPatch; blockers: { code: string; message: string }[] }
    | { kind: "error"; message: string }
  >(null);

  const node = workingGraph.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;
  const isPinned = pinnedNodeIds.has(node.id);

  const meta = (KIND_META[node.kind] ?? KIND_META.utility!);
  const isRoute = !!node.meta?.httpMethod;
  const inEdges = workingGraph.edges.filter((e) => e.target === node.id);
  const outEdges = workingGraph.edges.filter((e) => e.source === node.id);
  const localOps = APPLICABLE_OPS[node.kind] ?? [];
  const ops = backendOps ?? localOps;

  useEffect(() => {
    if (!repoRootPath || !selectedNodeId) return;
    let cancelled = false;
    fetchApi("/api/ops/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbolId: selectedNodeId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.ops && Array.isArray(d.ops)) {
          setBackendOps(d.ops.map((o: any) => o.name ?? o.id ?? o));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [repoRootPath, selectedNodeId]);
  const cluster = workingGraph.clusters.find((c) => c.id === node.cluster);

  const previewStep = hoveredOp ? buildPreviewStep(hoveredOp, node, workingGraph) : null;
  const mockPreviewDiff = previewStep ? mockDiff(previewStep, workingGraph) : null;
  const mockPreviewPatch = previewStep ? mockGraphPatch(previewStep, workingGraph) : null;
  const previewDiff =
    realPreview?.kind === "ready" ? realPreview.diff : mockPreviewDiff;
  const previewPatch =
    realPreview?.kind === "ready" ? realPreview.patch : mockPreviewPatch;
  const previewBlockers =
    realPreview?.kind === "ready" ? realPreview.blockers : [];

  useEffect(() => {
    if (!hoveredOp) {
      setHoverPreview(null);
      return;
    }
    if (realPreview?.kind === "ready") {
      setHoverPreview(realPreview.patch);
    } else if (mockPreviewPatch) {
      setHoverPreview(mockPreviewPatch);
    }
    return () => setHoverPreview(null);
  }, [hoveredOp, realPreview?.kind, setHoverPreview, node.id]);

  useEffect(() => {
    if (!repoRootPath || !hoveredOp || !previewStep) {
      setRealPreview(null);
      return;
    }
    const ctrl = new AbortController();
    setRealPreview({ kind: "loading" });
    fetchApi("/api/op/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: repoRootPath,
        opName: previewStep.opName,
        target: previewStep.targetId,
        params: previewStep.params,
      }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (ctrl.signal.aborted) return;
        const json = (await res.json()) as
          | {
              diff: string;
              patch: GraphPatch;
              blockers: { code: string; message: string }[];
            }
          | { error: string; code: string };
        if (!res.ok || "error" in json) {
          setRealPreview({
            kind: "error",
            message:
              "error" in json
                ? `${json.code} · ${json.error}`
                : `HTTP ${res.status}`,
          });
        } else {
          setRealPreview({
            kind: "ready",
            diff: json.diff,
            patch: json.patch,
            blockers: json.blockers,
          });
        }
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setRealPreview({ kind: "error", message: e.message });
      });
    return () => ctrl.abort();
  }, [
    repoRootPath,
    hoveredOp,
    node.id,
    previewStep?.opName,
    JSON.stringify(previewStep?.params),
  ]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <InspectorTabs active={activeTab} onChange={setActiveTab} />
      {activeTab === "source" ? (
        <InspectorSourceTab nodeId={node.id} />
      ) : (
    <div className="p-5 space-y-6 overflow-y-auto">
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          {isRoute ? (
            <div className="flex items-baseline gap-2.5 min-w-0">
              <span
                className={`font-[JetBrains_Mono] text-xs uppercase tracking-[0.18em] shrink-0 ${
                  HTTP_METHOD_COLOR[node.meta?.httpMethod ?? ""] ??
                  "text-on-surface-variant"
                }`}
              >
                {node.meta?.httpMethod}
              </span>
              <h3 className="text-lg text-white truncate">
                {node.meta?.httpPath}
              </h3>
            </div>
          ) : (
            <h3 className="text-lg text-white truncate">{node.name}</h3>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setSidePanelView("source")}
              data-testid="open-source"
              title="Open source file in side panel"
              aria-label="Open source file in side panel"
              className="w-7 h-7 flex items-center justify-center overflow-hidden border border-outline-variant text-on-surface-faint hover:border-neutral-500 hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[14px] leading-none">
                description
              </span>
            </button>
            {repoRootPath && (
              <OpenInEditorButton
                rootPath={repoRootPath}
                file={node.file}
                line={node.sourceRange?.startLine ?? 1}
              />
            )}
            <button
              onClick={() => togglePin(node.id)}
              data-testid="pin-toggle"
              data-pinned={isPinned ? "true" : "false"}
              title={isPinned ? "Unpin" : "Pin — keep visible across drills"}
              aria-label={isPinned ? "Unpin node" : "Pin node"}
              aria-pressed={isPinned}
              className={`w-7 h-7 flex items-center justify-center overflow-hidden border transition-colors ${
                isPinned
                  ? "border-schema-accent text-schema-accent"
                  : "border-outline-variant text-on-surface-faint hover:border-neutral-500 hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[14px] leading-none">
                {isPinned ? "keep" : "keep_outline"}
              </span>
            </button>
            <span
              className={`text-xs ${meta.color}`}
            >
              {meta.label}
            </span>
          </div>
        </div>
        <CopyIdButton id={node.id} />
      </div>

      {isRoute && node.meta?.hasInlineHandler && (
        <div
          data-testid="inline-handler-badge"
          className="border border-outline-variant bg-surface-dim px-3 py-2 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-xs text-on-surface-muted">
              inline handler
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
              body lives at lines {node.sourceRange?.startLine ?? "?"}
              {node.meta.inlineHandlerEndLine != null &&
              node.meta.inlineHandlerEndLine !== (node.sourceRange?.startLine ?? -1)
                ? `–${node.meta.inlineHandlerEndLine}`
                : ""}
              {" · "}no separately-defined fn node
            </p>
          </div>
          <button
            onClick={() => setSidePanelView("source")}
            data-testid="view-inline-body"
            className="shrink-0 px-2.5 py-1 border border-outline hover:border-schema-accent hover:text-schema-accent text-xs text-on-surface-variant transition-colors"
          >
            View body
          </button>
        </div>
      )}

      {level < 3 && (
        <button
          onClick={() => drillInto({ id: node.id, label: node.name, level })}
          className="w-full px-4 py-3 rounded-md border border-outline/70 hover:bg-white/10 hover:border-outline text-xs text-white transition-colors"
        >
          Expand
        </button>
      )}

      <div className="grid grid-cols-2 gap-px bg-neutral-800/60 border border-outline-variant/60">
        <div className="bg-surface px-4 py-3">
          <p className="text-xs text-neutral-500">
            file
          </p>
          <p className="font-[JetBrains_Mono] text-xs text-neutral-200 truncate mt-1">
            {node.file}
          </p>
        </div>
        <div className="bg-surface px-4 py-3">
          <p className="text-xs text-neutral-500">
            cluster
          </p>
          <p className="text-xs text-neutral-200 truncate mt-1">
            {cluster?.name ?? "—"}
          </p>
        </div>
        <div className="bg-surface px-4 py-3">
          <p className="text-xs text-neutral-500">
            Dependencies
          </p>
          <p className="text-base text-white mt-1 tabular-nums">
            {inEdges.length}
          </p>
        </div>
        <div className="bg-surface px-4 py-3">
          <p className="text-xs text-neutral-500">
            Dependents
          </p>
          <p className="text-base text-white mt-1 tabular-nums">
            {outEdges.length}
          </p>
        </div>
      </div>

      {repoRootPath && node.sourceRange && (
        <BlameStrip
          rootPath={repoRootPath}
          relPath={node.file}
          startLine={node.sourceRange.startLine}
          endLine={node.sourceRange.endLine ?? node.sourceRange.startLine}
        />
      )}

      <div>
        <p className="text-xs text-neutral-500 mb-3">
          Actions
        </p>
        {ops.length === 0 ? (
          <p className="text-xs text-on-surface-muted italic">
            No ops apply to this node kind.
          </p>
        ) : (
          <div className="space-y-2">
            {ops.map((opName) => {
              const isExpanded = expandedOp === opName;
              return (
              <div key={opName}>
                <button
                  onClick={() => setExpandedOp(isExpanded ? null : opName)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 border border-outline-variant hover:border-neutral-600 hover:bg-neutral-950 transition-colors"
                >
                  <span className="font-[JetBrains_Mono] text-sm text-schema-accent flex-1">
                    {opName}
                  </span>
                  <span
                    className="material-symbols-outlined text-[16px] text-on-surface-faint transition-transform"
                    style={{ fontVariationSettings: "'wght' 200", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    expand_more
                  </span>
                </button>
                {isExpanded && (
                  <div className="border border-t-0 border-outline-variant/60 bg-surface-dim">
                    {OP_NOTE[opName] && (
                      <p data-testid={`op-note-${opName}`} className="px-4 py-2 text-xs text-on-surface-faint leading-relaxed border-b border-outline-variant/40">
                        {OP_NOTE[opName]}
                      </p>
                    )}
                    <pre
                      data-testid="op-preview"
                      className="px-4 py-2 font-[JetBrains_Mono] text-xs leading-relaxed max-h-28 overflow-auto border-b border-outline-variant/40"
                    >
                      {realPreview?.kind === "loading" ? (
                        <span className="text-on-surface-faint">loading preview…</span>
                      ) : previewBlockers.length > 0 ? (
                        <span className="text-phase-fail block">
                          {previewBlockers.map((b) => `[${b.code}] ${b.message}`).join("\n")}
                        </span>
                      ) : previewDiff ? (
                        <>
                          {previewDiff.split("\n").slice(0, 8).map((l, li) => (
                            <span key={li} className={l.startsWith("+") ? "text-phase-pass block" : l.startsWith("-") ? "text-phase-fail block" : "text-neutral-500 block"}>
                              {l}
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="text-on-surface-faint">no preview available</span>
                      )}
                    </pre>
                    <div className="px-4 py-2">
                      <button
                        onClick={() => { submitPrompt(promptForOp(opName, node.name)); setExpandedOp(null); }}
                        className="w-full px-3 py-2 rounded-lg bg-schema-accent/10 border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/20 text-xs font-medium transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {repoRootPath && node.id && (
        <div>
          <p className="text-xs text-neutral-500 mb-3">
            Explore
          </p>
          <div className="space-y-2">
            <CallersSection nodeId={node.id} />
            <FindPathButton fromId={node.id} />
          </div>
        </div>
      )}

      {repoRootPath && <NodeSnippet nodeId={node.id} />}

      <div>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <p className="text-xs text-neutral-500">
            Connections
          </p>
          <span className="text-xs text-on-surface-muted tabular-nums">
            {inEdges.length} in · {outEdges.length} out
          </span>
        </div>
        {(() => {
          const all = [
            ...inEdges.map((e) => ({ e, dir: "in" as const })),
            ...outEdges.map((e) => ({ e, dir: "out" as const })),
          ];
          const visible = showAllConnections ? all : all.slice(0, 12);
          const hidden = all.length - visible.length;
          return (
            <>
              <div className="space-y-1" data-testid="connections-list">
                {visible.map(({ e, dir }) => {
                  const otherId = dir === "in" ? e.source : e.target;
                  const other = workingGraph.nodes.find((n) => n.id === otherId);
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 py-2 border-b border-outline-variant/40 last:border-0"
                    >
                      <span className="text-xs text-on-surface-faint w-7 shrink-0">
                        {dir}
                      </span>
                      <span className="text-xs text-neutral-500 w-28 shrink-0">
                        {e.relation.replace("_", " ")}
                      </span>
                      <span className="font-[JetBrains_Mono] text-xs text-neutral-200 truncate">
                        {other?.name ?? otherId}
                      </span>
                    </div>
                  );
                })}
              </div>
              {(hidden > 0 || showAllConnections) && all.length > 12 && (
                <button
                  onClick={() => setShowAllConnections((v) => !v)}
                  data-testid="connections-toggle"
                  className="mt-3 text-xs text-on-surface-muted hover:text-white transition-colors"
                >
                  {showAllConnections ? "Show less" : "Show all"}
                </button>
              )}
            </>
          );
        })()}
      </div>
    </div>
      )}
    </div>
  );
}

function ClusterInspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const workingGraph = useStore((s) => s.workingGraph);
  const drillInto = useStore((s) => s.drillInto);
  const level = useStore((s) => s.level);
  const submitPrompt = useStore((s) => s.submitPrompt);

  const cluster = workingGraph.clusters.find((c) => c.id === selectedNodeId);
  if (!cluster) return null;

  const members = workingGraph.nodes.filter((n) => cluster.nodeIds.includes(n.id));
  const files = Array.from(new Set(members.map((m) => m.file)));
  const kindCounts: Record<string, number> = {};
  for (const m of members) kindCounts[m.kind] = (kindCounts[m.kind] ?? 0) + 1;

  return (
    <div className="p-5 space-y-6">
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h3 className="text-lg text-white">{cluster.name}</h3>
          <span className="text-xs text-on-surface-muted">
            cluster
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          {members.length} nodes · {files.length} files
        </p>
      </div>

      <button
        onClick={() => drillInto({ id: cluster.id, label: cluster.name, level })}
        data-tutorial="drill-button"
        className="w-full px-4 py-3 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors"
      >
        View modules
      </button>

      <div>
        <p className="text-xs text-neutral-300 mb-2">
          Composition
        </p>
        <div className="space-y-1.5">
          {Object.entries(kindCounts).map(([k, n]) => {
            const meta = KIND_META[k as keyof typeof KIND_META];
            return (
              <div
                key={k}
                className="flex items-center justify-between gap-3 py-1 border-b border-outline-variant/40 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full ${meta.accent}`} />
                  <span className={`text-xs ${meta.color}`}>
                    {meta.label}
                  </span>
                </div>
                <span className="text-xs text-neutral-500 tabular-nums">
                  {n}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-xs text-neutral-500 mb-2">
          Files
        </p>
        <div className="space-y-1">
          {files.map((f) => (
            <p
              key={f}
              className="font-[JetBrains_Mono] text-xs text-neutral-300 truncate py-1 border-b border-outline-variant/40 last:border-0"
            >
              {f}
            </p>
          ))}
        </div>
      </div>

      <button
        onClick={() =>
          submitPrompt(`Audit the ${cluster.name} cluster and apply low-risk improvements.`)
        }
        className="w-full px-4 py-2.5 border border-outline hover:border-neutral-500 text-xs text-neutral-300 hover:text-white transition-colors"
      >
        Run audit
      </button>
    </div>
  );
}

function ModuleInspector({ moduleId }: { moduleId: string }) {
  const workingGraph = useStore((s) => s.workingGraph);
  const drillInto = useStore((s) => s.drillInto);
  const level = useStore((s) => s.level);
  const submitPrompt = useStore((s) => s.submitPrompt);

  const file = moduleId.replace(/^module:/, "");
  const members = workingGraph.nodes.filter((n) => n.file === file);
  if (members.length === 0) {
    return (
      <p className="p-6 text-center text-xs text-neutral-500">
        Module not found.
      </p>
    );
  }
  const cluster = workingGraph.clusters.find((c) =>
    members.some((m) => c.nodeIds.includes(m.id)),
  );
  const folder = file.split("/").slice(0, -1).join("/");
  const filename = file.split("/").pop() ?? file;

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-lg text-white truncate">{filename}</h3>
        <p className="font-[JetBrains_Mono] text-xs text-on-surface-muted truncate mt-1">
          {folder}
        </p>
        <p className="text-xs text-neutral-500 mt-2">
          {members.length} function{members.length === 1 ? "" : "s"}
          {cluster ? ` · in ${cluster.name}` : ""}
        </p>
      </div>

      <button
        onClick={() => drillInto({ id: moduleId, label: filename, level })}
        className="w-full px-4 py-3 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors"
      >
        View functions
      </button>

      <div>
        <p className="text-xs text-neutral-500 mb-2">
          Functions
        </p>
        <div className="space-y-1">
          {members.map((m) => {
            const meta = (KIND_META[m.kind] ?? KIND_META.utility!);
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-outline-variant/40 last:border-0"
              >
                <span className="font-[JetBrains_Mono] text-xs text-white truncate">
                  {m.name}
                </span>
                <span
                  className={`text-xs shrink-0 ${meta.color}`}
                >
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => submitPrompt(`Improve ${filename} where it makes sense.`)}
        className="w-full px-4 py-2.5 border border-outline hover:border-neutral-500 text-xs text-neutral-300 hover:text-white transition-colors"
      >
        Suggest improvements
      </button>
    </div>
  );
}

export default function Inspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const workingGraph = useStore((s) => s.workingGraph);

  if (!selectedNodeId) {
    return (
      <div className="p-6 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-3 inline-block">
          arrow_selector_tool
        </span>
        <p className="text-sm text-neutral-300">No node selected</p>
        <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
          Click a node on the canvas to inspect it.
          <br />
          Double-click to drill in.
        </p>
      </div>
    );
  }

  if (selectedNodeId.startsWith("cluster:")) return <ClusterInspector />;
  if (selectedNodeId.startsWith("module:"))
    return <ModuleInspector moduleId={selectedNodeId} />;
  if (workingGraph.nodes.some((n) => n.id === selectedNodeId)) return <FunctionInspector />;

  return (
    <p className="p-6 text-center text-xs text-neutral-500">
      Selection not in current graph.
    </p>
  );
}

"use client";

import { Suspense, lazy, useEffect, useState, useCallback, Component, type ReactNode, type ErrorInfo } from "react";

import TopBar from "@/components/workspace/TopBar";
import SideRail from "@/components/workspace/SideRail";
import CommandBar from "@/components/workspace/CommandBar";
import SidePanel from "@/components/workspace/SidePanel";
import PlanPanel from "@/components/workspace/PlanPanel";
import TrustPanel from "@/components/trust/TrustPanel";
import EvidenceView from "@/components/trust/EvidenceView";
import { useTrust } from "@/state/trust";
import ViewToggle from "@/components/trust/ViewToggle";
import RepoMap from "@/components/trust/RepoMap";
import { CHALLENGE_MODE, challengeRepo, setChallengeRepo } from "@/lib/challenge";
import { loadCurated } from "@/lib/curatedGraph";
import { callTool, onMcpStatus } from "@/mcp-client";
import type { RepoMap as RepoMapData } from "@/state/trust";
import CheatSheet from "@/components/workspace/CheatSheet";
import Toast from "@/components/workspace/Toast";
import ExtractionBanner from "@/components/workspace/ExtractionBanner";
import { PrModeBanner } from "@/components/workspace/PrModeBanner";
import { WelcomeHero, shouldShowWelcomeHero } from "@/components/workspace/WelcomeHero";
import { SkeletonCanvas } from "@/components/skeleton/SkeletonCanvas";
import Shortcuts from "@/components/workspace/Shortcuts";
import Onboarding from "@/components/workspace/Onboarding";
import ProblemsHero from "@/components/workspace/ProblemsHero";
import SearchOverlay from "@/components/workspace/SearchOverlay";
import BulkActionToolbar from "@/components/workspace/BulkActionToolbar";
import SchemaLogo from "@/components/SchemaLogo";
import { usePrMode } from "@/hooks/usePrMode";
import { useStore } from "@/state/store";
import { ProgressBar, InlineProgress } from "@/components/ProgressBar";
import { fetchApi, getSessionId, bindMcpStatus, bindApiLoading, probeMcpHealth } from "@/lib/api";
import { applyAlgorithmicClusters } from "@/lib/applyClusters";
import type { Graph, Rule, Violation, Insight } from "@/lib/types";
import {
  mernGraph,
  mernInsights,
  mernRules,
  mernViolations,
  supabaseGraph,
  supabaseInsights,
  supabaseRules,
  supabaseViolations,
} from "@/lib/fixture";
import {
  continueExtractGraph,
  continueExtractInsights,
  continueExtractRules,
  continueExtractStats,
  continueExtractViolations,
} from "@/lib/continueExtract";

const GraphCanvas = lazy(() => import("@/components/canvas/GraphCanvas"));

function McpBanner() {
  const status = useStore((s) => s.mcpStatus);
  if (status === "connected") return null;
  return (
    <div className={`px-4 py-1.5 text-xs font-[JetBrains_Mono] flex items-center justify-center gap-2 shrink-0 ${
      status === "reconnecting"
        ? "bg-yellow-900/40 text-yellow-300 border-b border-yellow-800/50"
        : "bg-red-900/40 text-red-300 border-b border-red-800/50"
    }`}>
      <span className={`w-2 h-2 rounded-full ${status === "reconnecting" ? "bg-yellow-400 animate-pulse" : "bg-red-400"}`} />
      {status === "reconnecting" ? "Reconnecting to MCP server..." : "MCP server disconnected"}
      <button
        onClick={() => window.location.reload()}
        className="ml-2 underline underline-offset-2 hover:text-white transition-colors"
      >
        retry
      </button>
    </div>
  );
}

// ExtractionBanner is extracted to `components/workspace/ExtractionBanner.tsx`
// so it carries its own unit test surface (per Step 2). Imported below.

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Schema UI error:", error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-surface flex flex-col items-center justify-center gap-4 p-8">
          <SchemaLogo className="w-10 h-10 mb-2" />
          <p className="text-xl text-white">Something went wrong</p>
          <pre className="font-[JetBrains_Mono] text-xs text-phase-fail whitespace-pre-wrap max-w-2xl leading-relaxed text-center">{this.state.error.message}</pre>
          <pre className="font-[JetBrains_Mono] text-xs text-neutral-500 whitespace-pre-wrap max-w-2xl leading-relaxed">{this.state.error.stack?.split("\n").slice(0, 8).join("\n")}</pre>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="px-5 py-2.5 border border-white text-white text-xs hover:bg-white hover:text-black transition-colors">
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// The ordered set of high-level steps the UI shows during repo open.
// Each step animates in sequence (pending -> running -> done) driven by
// real SSE events from the MCP server (plus a few client-side phases).
type LoadStepId =
  | "cache"
  | "open"
  | "extractors"
  | "bridges"
  | "clustering"
  | "load"
  | "layout";

interface LoadStep {
  readonly id: LoadStepId;
  readonly label: string;
  readonly sub: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  progress?: number; // 0-100 within this step
}

const INITIAL_STEPS: LoadStep[] = [
  { id: "cache", label: "Cache lookup", sub: "checking IndexedDB + server snapshot", status: "pending" },
  { id: "open", label: "Open workspace", sub: "preparing session", status: "pending" },
  { id: "extractors", label: "Run extractors", sub: "7 languages: ts, py, go, java, ruby, rust, config", status: "pending" },
  { id: "bridges", label: "Link contracts", sub: "REST + gRPC + SQL bridges", status: "pending" },
  { id: "clustering", label: "Cluster architecture", sub: "Leiden community detection", status: "pending" },
  { id: "load", label: "Load graph", sub: "nodes, edges, rules, insights", status: "pending" },
  { id: "layout", label: "Build layout", sub: "ELK with dagre fallback", status: "pending" },
];

function RepoLanding({ onOpened }: { onOpened: () => void }) {
  const loadGraph = useStore((s) => s.loadGraph);
  const [pathInput, setPathInput] = useState(CHALLENGE_MODE ? challengeRepo() : "");
  useEffect(() => {
    if (!CHALLENGE_MODE || challengeRepo()) return;
    callTool<{ defaultRepo: string }>("trust.list_requirements", {})
      .then((d) => setPathInput((cur) => cur || d.defaultRepo))
      .catch(() => undefined);
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<LoadStep[]>(INITIAL_STEPS);
  const [extractors, setExtractors] = useState<Record<string, "running" | "done" | "error">>({});
  const [progress, setProgress] = useState(0);
  const [keyCardDismissed, setKeyCardDismissed] = useState(() => {
    try { return !!(localStorage.getItem("schema:anthropicKey") || localStorage.getItem("schema:keyDismissed")); } catch { return true; }
  });
  const [recentPaths] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("schema:recentPaths");
      return raw ? (JSON.parse(raw) as string[]).slice(0, 3) : [];
    } catch { return []; }
  });

  const setStep = useCallback((id: LoadStepId, status: LoadStep["status"], sub?: string) => {
    setSteps((prev) => prev.map((s) =>
      s.id === id ? { ...s, status, ...(sub !== undefined ? { sub } : {}) } : s,
    ));
  }, []);

  const openPath = useCallback(async (path: string) => {
    if (!path || loading) return;
    setPathInput(path);
    setLoading(true);
    setError(null);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s })));
    setExtractors({});
    setProgress(0);

    let unsub: (() => void) | null = null;

    // Smoothly tick the progress bar forward during the long blocking
    // `/api/open` call. Real events bump it past the target.
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    const startProgressRamp = (from: number, to: number, durationMs: number) => {
      if (progressTimer) clearInterval(progressTimer);
      const startedAt = performance.now();
      progressTimer = setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const ratio = Math.min(1, elapsed / durationMs);
        setProgress((p) => Math.max(p, from + (to - from) * ratio));
        if (ratio >= 1 && progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      }, 100);
    };

    try {
      // STEP 1: cache lookup -- show last graph from IndexedDB while server works
      setStep("cache", "running");
      let hadCache = false;
      try {
        const { loadGraphFromIDB } = await import("@/lib/idb");
        const cached = await loadGraphFromIDB(path);
        if (cached?.graph && (cached.graph as Graph).nodes?.length > 0) {
          hadCache = true;
          setStep("cache", "done", `found ${(cached.graph as Graph).nodes.length} cached nodes`);
        } else {
          setStep("cache", "skipped", "no cached snapshot");
        }
      } catch {
        setStep("cache", "skipped", "IndexedDB unavailable");
      }
      setProgress(8);

      // STEP 2: open workspace (blocking; server does cache check, extraction, bridges, clustering)
      setStep("open", "running");
      // Server runs in parallel: ramp progress toward 50% over 6s as a hint
      startProgressRamp(8, 50, 6_000);

      const openRes = await fetchApi("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      const openJson = await openRes.json();
      if (openJson.error) throw new Error(openJson.error);
      const sid = openJson.sessionId as string;
      const fromCache = !!openJson.fromCache;
      if (openJson.extraction) {
        useStore.getState().setExtractionStats(openJson.extraction);
      }
      if (openJson.archetype) {
        useStore.getState().setWorkspaceArchetype(openJson.archetype);
      }

      if (fromCache) {
        setStep("open", "done", "snapshot reused from server cache");
        setStep("extractors", "skipped", "skipped: snapshot reused");
        setStep("bridges", "skipped", "skipped: snapshot reused");
        setStep("clustering", "skipped", "skipped: snapshot reused");
      } else {
        setStep("open", "done", `session ${sid.slice(0, 16)}...`);
      }
      setProgress(Math.max(progress, 55));

      // STEP 3: subscribe to SSE to backfill the granular extractor events
      // (these already fired during the blocking open; replay delivers them).
      const { subscribeEvents } = await import("@/mcp-client");
      unsub = subscribeEvents(sid, (event) => {
        const kind = event.kind as string;
        const extractorId = event.extractorId as string | undefined;
        if (kind === "extractor.start" && extractorId) {
          setExtractors((prev) => ({ ...prev, [extractorId]: "running" }));
          setStep("extractors", "running");
        } else if (kind === "extractor.done" && extractorId) {
          setExtractors((prev) => ({ ...prev, [extractorId]: "done" }));
        } else if (kind === "extractor.error" && extractorId) {
          setExtractors((prev) => ({ ...prev, [extractorId]: "error" }));
        } else if (kind === "bridges.start") {
          setStep("extractors", "done");
          setStep("bridges", "running");
        } else if (kind === "bridges.done") {
          const bridgeEdges = (event.bridgeEdges as number) ?? 0;
          const contracts = (event.contractNodes as number) ?? 0;
          setStep("bridges", "done", `${contracts} contracts, ${bridgeEdges} bridge edges`);
        } else if (kind === "clustering.start") {
          setStep("clustering", "running");
        } else if (kind === "clustering.done") {
          const n = (event.clusters as number) ?? 0;
          setStep("clustering", "done", `${n} clusters detected`);
        } else if (kind === "files.changed") {
          // Step 5a: L1 file-watch event. Bumps the live-atlas
          // counter; Step 5b will use this to trigger reactive
          // memoized-query invalidation in the canvas. For now
          // it surfaces in `<LiveAtlasIndicator />` as a pulse.
          const changes = event.changes as { uri: string; kind: string }[] | undefined;
          useStore.getState().noteFilesChanged(changes?.length ?? 1);
        } else if (kind === "workspace.watch_started") {
          useStore.getState().setLiveAtlasWatching(true);
        } else if (kind === "workspace.watch_stopped") {
          useStore.getState().setLiveAtlasWatching(false);
        }
      }, (status) => {
        useStore.getState().setMcpStatus(status === "connected" ? "connected" : status === "reconnecting" ? "reconnecting" : "disconnected");
      });

      // Brief pause for SSE replay to flush through the event loop and our
      // setState calls to update the UI.
      await new Promise((r) => setTimeout(r, 250));
      if (!fromCache) {
        // If still running after replay, mark whatever's left as done.
        setSteps((prev) => prev.map((s) =>
          (s.id === "extractors" || s.id === "bridges" || s.id === "clustering") && s.status === "pending"
            ? { ...s, status: "done" }
            : s,
        ));
      }
      setProgress(75);

      if (CHALLENGE_MODE) {
        // Challenge mode shows the curated architecture map instead of the full symbol graph.
        setStep("load", "running");
        const map = await callTool<RepoMapData>("repo.map", {});
        useTrust.setState({ map });
        setChallengeRepo(path);
        loadCurated(map, path);
        setStep("load", "done", `${map.nodes.length} components in ${map.groups.length} modules`);
        setStep("layout", "done", "rendering canvas...");
        onOpened();
        return;
      }

      // STEP 4: load graph data (nodes, edges, rules, insights)
      setStep("load", "running");
      const graphRes = await fetchApi("/api/load-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const json = await graphRes.json();
      if (json.error) throw new Error(json.error);
      const graph = json.graph as Graph;
      setStep("load", "done", `${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      setProgress(90);

      // STEP 5: layout
      setStep("layout", "running");
      const label = graph.rootDir?.split("/").pop() ?? path.split("/").pop() ?? "workspace";
      loadGraph(graph, {
        label,
        subtitle: `local · ${graph.nodes.length} nodes · ${graph.edges.length} edges`,
        origin: "local",
        rootPath: path,
      }, {
        rules: json.rules as Rule[] | undefined,
        violations: json.violations as Violation[] | undefined,
        insights: json.insights as Insight[] | undefined,
      });
      setStep("layout", "done", "rendering canvas...");

      if (json.rulesError) {
        useStore.getState().emitToast(`rules: ${json.rulesError}`);
      }
      try {
        const recent = JSON.parse(localStorage.getItem("schema:recentPaths") ?? "[]") as string[];
        const updated = [path, ...recent.filter((p) => p !== path)].slice(0, 5);
        localStorage.setItem("schema:recentPaths", JSON.stringify(updated));
      } catch {}

      setProgress(100);
      // Give the user a beat to see the "done" state, then enter the workspace
      await new Promise((r) => setTimeout(r, 350));
      setLoading(false);
      unsub?.();
      void hadCache; // silence unused
      onOpened();
    } catch (e) {
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      const msg = e instanceof Error ? e.message : "Extract failed";
      const friendly = msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("Failed to fetch")
        ? "MCP server not running. Start it with: schema serve"
        : msg.includes("ENOENT") || msg.includes("not found")
        ? `Path not found: ${path}`
        : msg;
      setError(friendly);
      setSteps((prev) => prev.map((s) =>
        s.status === "running" ? { ...s, status: "error" } : s,
      ));
      setLoading(false);
      setProgress(0);
      useStore.getState().setMcpStatus("disconnected");
      unsub?.();
    }
  }, [loading, loadGraph, onOpened, progress, setStep]);

  // Wire native folder picker from Tauri menu
  useEffect(() => {
    (window as any).__schemaOpenFolder = (path: string) => openPath(path);
    return () => { delete (window as any).__schemaOpenFolder; };
  }, [openPath]);

  const handleOpen = useCallback(() => {
    const trimmed = pathInput.trim();
    if (trimmed) openPath(trimmed);
  }, [pathInput, openPath]);

  if (CHALLENGE_MODE) {
    return (
      <ChallengeLanding
        path={pathInput}
        onPath={setPathInput}
        onOpen={handleOpen}
        loading={loading}
        progress={progress}
        step={steps.find((x) => x.status === "running") ?? steps.filter((x) => x.status === "done").pop() ?? null}
        error={error}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-surface flex items-center justify-center">
      <div className="max-w-md w-full px-8">
        {/* Logo + wordmark. The "codebase atlas" framing is the
            marketing lever per research/25-95-percent-and-leveling.md
            §9 — used in hero copy, NOT as a level word. */}
        <div className="flex flex-col items-center mb-12 animate-[fadeIn_0.6s_ease-out]" data-testid="repo-landing-hero">
          <SchemaLogo className="w-16 h-16 mb-5" />
          <h1 className="text-xl font-semibold text-white tracking-tight">{CHALLENGE_MODE ? "Schema" : "Schema Studio"}</h1>
          {CHALLENGE_MODE ? null : <p className="text-sm text-on-surface-muted mt-2">Your live codebase atlas.</p>}
        </div>

        {/* Open workspace input */}
        <div className="mb-5">
          <div className="flex gap-2">
            <input
              className="opener-input flex-1 font-[JetBrains_Mono] text-sm px-4 py-2.5 bg-surface-container border border-outline-variant rounded text-white outline-none placeholder:text-on-surface-faint focus:border-on-surface-variant transition-colors"
              type="text"
              placeholder="/Users/you/projects/my-app"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleOpen(); }}
              disabled={loading}
              autoFocus
            />
            {(window as any).__TAURI_INTERNALS__ && (
              <button
                className="px-3 py-2.5 bg-surface-container border border-outline-variant text-on-surface-variant text-sm rounded hover:border-on-surface-faint transition-colors disabled:opacity-30"
                onClick={() => {
                  const dialogMod = "@tauri-apps/plugin-dialog";
                  import(/* @vite-ignore */ dialogMod).then((mod: any) => {
                    mod.open({ directory: true, multiple: false, title: "Open workspace" }).then((selected: any) => {
                      if (selected && typeof selected === "string") openPath(selected);
                    });
                  }).catch(() => {
                    useStore.getState().emitToast("folder picker unavailable");
                  });
                }}
                disabled={loading}
                title="Browse for folder"
              >
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'wght' 300" }}>folder_open</span>
              </button>
            )}
            <button
              className="px-5 py-2.5 bg-white text-surface text-sm font-medium rounded hover:bg-neutral-200 transition-colors whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => void handleOpen()}
              disabled={loading || !pathInput.trim()}
            >
              {loading ? "Opening..." : "Open"}
            </button>
          </div>
        </div>

        {loading && (
          <div className="mb-4">
            {/* Overall progress bar */}
            <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mb-4 relative">
              <div
                className="h-full bg-schema-accent rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Step list -- animated state per step */}
            <div className="space-y-2">
              {steps.map((step) => {
                const isExtractors = step.id === "extractors";
                const extractorEntries = isExtractors ? Object.entries(extractors) : [];
                return (
                  <div key={step.id} className="flex items-start gap-3">
                    <span className="shrink-0 mt-0.5">
                      {step.status === "pending" && (
                        <span className="block w-3 h-3 rounded-full border border-outline-variant" />
                      )}
                      {step.status === "running" && (
                        <span className="block w-3 h-3 border border-schema-accent border-t-transparent rounded-full animate-spin" />
                      )}
                      {step.status === "done" && (
                        <span className="block w-3 h-3 rounded-full bg-green-500/90 flex items-center justify-center text-[8px] text-black font-bold">
                          &#10003;
                        </span>
                      )}
                      {step.status === "skipped" && (
                        <span className="block w-3 h-3 rounded-full bg-on-surface-faint/30 flex items-center justify-center text-[8px] text-on-surface-faint">
                          &#8211;
                        </span>
                      )}
                      {step.status === "error" && (
                        <span className="block w-3 h-3 rounded-full bg-phase-fail/90 flex items-center justify-center text-[8px] text-black font-bold">
                          !
                        </span>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${
                        step.status === "done" ? "text-on-surface-variant" :
                        step.status === "running" ? "text-white" :
                        step.status === "skipped" ? "text-on-surface-faint" :
                        step.status === "error" ? "text-phase-fail" :
                        "text-on-surface-muted"
                      }`}>
                        {step.label}
                      </p>
                      <p className={`text-[10px] mt-0.5 leading-snug ${
                        step.status === "error" ? "text-phase-fail/70" : "text-on-surface-faint"
                      }`}>
                        {step.sub}
                      </p>
                      {/* Per-extractor breakdown when extractors step is running/done */}
                      {isExtractors && extractorEntries.length > 0 && step.status !== "skipped" && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {extractorEntries.map(([id, status]) => (
                            <span
                              key={id}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-[JetBrains_Mono] ${
                                status === "done" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                                status === "running" ? "bg-schema-accent/10 text-schema-accent border border-schema-accent/30" :
                                "bg-phase-fail/10 text-phase-fail border border-phase-fail/30"
                              }`}
                            >
                              {status === "running" && (
                                <span className="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
                              )}
                              {id.replace("extractor-", "")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 border border-phase-fail/30 bg-phase-fail/5 px-4 py-3 rounded">
            <p className="text-xs text-phase-fail leading-relaxed">{error}</p>
          </div>
        )}

        {CHALLENGE_MODE ? null : (<>
        {/* Recent workspaces */}
        {recentPaths.length > 0 && !loading && (
          <div className="mb-4">
            <p className="text-[10px] text-on-surface-faint font-medium uppercase tracking-wider mb-2">Recent</p>
            <div className="space-y-1">
              {recentPaths.map((rp) => (
                <button
                  key={rp}
                  onClick={() => openPath(rp)}
                  className="w-full text-left px-3 py-2 bg-surface-container border border-outline-variant/50 rounded hover:border-on-surface-faint transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[14px] text-on-surface-faint" style={{ fontVariationSettings: "'wght' 200" }}>folder</span>
                  <span className="font-[JetBrains_Mono] text-xs text-on-surface-variant truncate">{rp}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* First-run: optional API key setup */}
        {!keyCardDismissed && (
          <div className="mb-4 border border-primary/20 bg-primary/5 px-4 py-3 rounded">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-primary font-medium mb-1">AI planning (optional)</p>
                <p className="text-xs text-on-surface-muted leading-relaxed">
                  Open a repo, then go to Settings (gear icon) to enter your API key.
                  Schema works without it -- plans will use graph heuristics instead.
                </p>
              </div>
              <button
                className="text-xs text-on-surface-faint hover:text-on-surface-muted shrink-0"
                onClick={() => {
                  try { localStorage.setItem("schema:keyDismissed", "1"); } catch {}
                  setKeyCardDismissed(true);
                }}
              >
                dismiss
              </button>
            </div>
          </div>
        )}

        {/* Demos — the primary CTA for first-time users */}
        <div>
          <p className="text-xs text-on-surface-faint font-medium mb-2">Try a demo</p>
          <div className="space-y-2">
            <button
              className="w-full text-left px-4 py-3.5 bg-surface-container border border-kind-data/30 rounded hover:border-kind-data/60 transition-colors"
              onClick={() => {
                const clustered = applyAlgorithmicClusters(supabaseGraph);
                loadGraph(
                  clustered,
                  { label: "supabase/supabase", subtitle: "Go + TS + Rust + SQL · polyglot", origin: "local" },
                  { rules: supabaseRules, violations: supabaseViolations(clustered), insights: supabaseInsights },
                );
                onOpened();
              }}
            >
              <p className="text-sm text-white font-medium">supabase/supabase</p>
              <p className="text-xs text-on-surface-muted mt-1">Polyglot · Go + TypeScript + Rust + SQL · cross-language edges</p>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="text-left px-4 py-3 bg-surface-container border border-outline-variant rounded hover:border-on-surface-faint transition-colors"
                onClick={() => {
                  const clustered = applyAlgorithmicClusters(mernGraph);
                  loadGraph(
                    clustered,
                    { label: "shopwave/api", subtitle: "MERN e-commerce", origin: "local" },
                    { rules: mernRules, violations: mernViolations(clustered), insights: mernInsights },
                  );
                  onOpened();
                }}
              >
                <p className="text-sm text-white font-medium">shopwave/api</p>
                <p className="text-xs text-on-surface-muted mt-1">MERN · auto-clustered</p>
              </button>
              <button
                className="text-left px-4 py-3 bg-surface-container border border-outline-variant rounded hover:border-on-surface-faint transition-colors"
                onClick={() => {
                  const clustered = applyAlgorithmicClusters(useStore.getState().workingGraph);
                  loadGraph(
                    clustered,
                    { label: "acme/todos-api", subtitle: "bundled demo", origin: "local" },
                  );
                  onOpened();
                }}
              >
                <p className="text-sm text-white font-medium">acme/todos-api</p>
                <p className="text-xs text-on-surface-muted mt-1">Express · auto-clustered</p>
              </button>
            </div>
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
}

/** Challenge-mode opening screen: says what the product does, then one action. */
function ChallengeLanding(props: {
  path: string; onPath: (p: string) => void; onOpen: () => void;
  loading: boolean; progress: number; step: LoadStep | null; error: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const repoName = props.path.replace(/\/+$/, "").split("/").pop() || "repository";
  return (
    <div className="fixed inset-0 bg-surface overflow-hidden flex items-center justify-center" data-testid="repo-landing-hero">
      <div className="relative w-full max-w-[620px] px-6 text-center">
        <SchemaLogo className="w-10 h-10 mx-auto ui-rise" />
        <h1 className="ui-rise mt-8 text-[2.9rem] leading-[1.04] font-semibold tracking-[-0.04em] text-on-surface [text-wrap:balance]" style={{ "--i": 1 } as React.CSSProperties}>
          Agent code, reviewed with evidence.
        </h1>
        <p className="ui-rise mt-5 mx-auto max-w-[27rem] text-[1.0625rem] leading-[1.55] text-on-surface-muted [text-wrap:pretty]" style={{ "--i": 2 } as React.CSSProperties}>
          Schema checks an agent's pull request against the code. A named engineer signs it.
        </p>

        <div className="ui-rise mt-10 flex flex-col items-center" style={{ "--i": 3 } as React.CSSProperties}>
          {props.loading ? (
            <div className="w-full max-w-[22rem]" role="status" aria-live="polite">
              <div className="h-[3px] w-full rounded-full bg-[var(--ui-fill)] overflow-hidden">
                <div className="h-full rounded-full bg-on-surface transition-[width] duration-700 ease-out" style={{ width: `${Math.max(4, props.progress)}%` }} />
              </div>
              <p key={props.step?.id ?? "start"} className="ui-fade mt-4 text-[0.875rem] text-on-surface-variant">{props.step?.label ?? "Opening"}</p>
              <p className="mt-1 ui-meta truncate">{props.step?.sub ?? `Reading ${repoName}`}</p>
            </div>
          ) : (
            <>
              <button className="ui-btn ui-btn-primary ui-btn-lg" onClick={props.onOpen} disabled={!props.path.trim()}>
                Open {repoName}
                <span className="ui-arrow material-symbols-outlined text-[18px] leading-none -mr-1" aria-hidden="true">arrow_forward</span>
              </button>
              {editing ? (
                <input
                  className="opener-input ui-input ui-code mt-4 max-w-[26rem] text-center"
                  type="text"
                  aria-label="Repository folder"
                  value={props.path}
                  onChange={(e) => props.onPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") props.onOpen(); }}
                  autoFocus
                />
              ) : (
                <button className="mt-4 ui-meta hover:text-on-surface-variant transition-colors" onClick={() => setEditing(true)}>
                  Open another folder
                </button>
              )}
            </>
          )}
          {props.error && (
            <p className="ui-fade mt-6 max-w-[26rem] ui-chip ui-chip-fail !whitespace-normal !items-start text-left">
              {props.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  const hydrate = useStore((s) => s.hydrateFromStorage);
  const loadGraph = useStore((s) => s.loadGraph);
  const theme = useStore((s) => s.theme);
  const [repoOpened, setRepoOpened] = useState(false);
  const [resuming, setResuming] = useState(false);
  // Step 9a: PR mode (banner + focus drive) when URL has ?pr=
  const prMode = usePrMode();
  const selectNode = useStore((s) => s.selectNode);
  // Step 10a-5: WelcomeHero shows when a workspace is open but
  // the extracted graph is empty enough that the canvas has
  // nothing meaningful to render. Threshold + gating
  // function live in `WelcomeHero.tsx` (per §0.6.4 (a) +
  // Step 10a-DC §0.6.4 (b)) so the contract is pinned by
  // a direct firing test.
  const workingGraphNodeCount = useStore(
    (s) => s.workingGraph?.nodes.length ?? 0,
  );
  const showWelcomeHero = shouldShowWelcomeHero(repoOpened, workingGraphNodeCount);

  // Drive the initial node selection from PR mode's focus param.
  // Runs whenever prMode is set; the store reconciles the request
  // (selectNode is safe to call even if the graph hasn't fully
  // loaded — the store stores the id and the canvas focuses when
  // the node arrives).
  useEffect(() => {
    if (!prMode?.focusId) return;
    selectNode(prMode.focusId);
  }, [prMode, selectNode]);

  useEffect(() => {
    hydrate();
    document.body.classList.add("overflow-hidden");

    // Bind MCP status + API loading counter to store
    bindMcpStatus((s) => useStore.getState().setMcpStatus(s));
    onMcpStatus((s) => useStore.getState().setMcpStatus(s));
    // Recover on its own when the server comes back.
    setInterval(() => { if (useStore.getState().mcpStatus !== "connected") void probeMcpHealth(); }, 4000);
    bindApiLoading((delta) => useStore.getState().bumpApiLoading(delta));
    probeMcpHealth();

    // Auto-load demo. Supported variants:
    //   ?demo                       → Supabase fixture (controlled polished narrative)
    //   ?fixture=supabase           → same
    //   ?demo=continue              → real extract of continuedev/continue (no fixture)
    //   ?fixture=continue           → same
    const params = new URLSearchParams(window.location.search);
    const fixtureParam = params.get("fixture");
    const demoParam = params.get("demo");
    const isContinue = fixtureParam === "continue" || demoParam === "continue";
    const isSupabase = (params.has("demo") && !isContinue) || fixtureParam === "supabase";
    if (isContinue) {
      const subtitle = `live extract · ${continueExtractStats.totalNodes.toLocaleString()} nodes · ${continueExtractStats.totalEdges.toLocaleString()} edges · trimmed to ${continueExtractStats.keptNodes}/${continueExtractStats.keptEdges} for canvas`;
      const clustered = applyAlgorithmicClusters(continueExtractGraph);
      loadGraph(
        clustered,
        { label: "continuedev/continue", subtitle, origin: "local" },
        { rules: continueExtractRules, violations: continueExtractViolations(clustered), insights: continueExtractInsights },
      );
      setRepoOpened(true);
    } else if (isSupabase) {
      const clustered = applyAlgorithmicClusters(supabaseGraph);
      loadGraph(
        clustered,
        { label: "supabase/supabase", subtitle: "Go + TS + Rust + SQL · polyglot · OSS", origin: "local" },
        { rules: supabaseRules, violations: supabaseViolations(clustered), insights: supabaseInsights },
      );
      setRepoOpened(true);
    } else {
      // Auto-resume: if a previous repo.rootPath is persisted, try to restore it.
      // Two-stage: (1) instant load from IndexedDB graph cache, (2) reconcile
      // with MCP server in the background so the graph stays fresh.
      const persisted = useStore.getState().repo;
      // Challenge mode always opens the curated map fresh, never a cached session graph.
      if (persisted?.rootPath && !CHALLENGE_MODE) {
        setResuming(true);
        const rootPath = persisted.rootPath;
        let idbLoaded = false;

        // Hard timeout: never leave the user stuck on the resume spinner
        // for more than 10s. If both IDB and the server are unreachable,
        // bail out to the landing page.
        const failsafe = setTimeout(() => setResuming(false), 10_000);

        import("@/lib/idb").then(async ({ loadGraphFromIDB }) => {
          try {
            const cached = await loadGraphFromIDB(rootPath);
            if (cached?.graph && (cached.graph as Graph).nodes?.length > 0) {
              loadGraph(
                cached.graph as Graph,
                (cached.repo as any) ?? { ...persisted, rootPath },
                {
                  rules: cached.rules as Rule[] | undefined,
                  violations: cached.violations as Violation[] | undefined,
                  insights: cached.insights as Insight[] | undefined,
                },
              );
              idbLoaded = true;
              setRepoOpened(true);
              useStore.getState().emitToast("restored from cache");
            }
          } catch { /* IndexedDB unavailable */ }

          // Reconcile with MCP server: if server is reachable, re-extract
          // (server-side SQLite cache makes this fast).
          try {
            const probe = await fetch("/mcp", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "tools/list", params: {} }),
            });
            if (probe.ok) {
              const openRes = await fetchApi("/api/open", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: rootPath }),
              });
              const openJson = await openRes.json();
              if (openJson.extraction) {
                useStore.getState().setExtractionStats(openJson.extraction);
              }
              if (openJson.archetype) {
                useStore.getState().setWorkspaceArchetype(openJson.archetype);
              }
              if (openJson.sessionId) {
                const graphRes = await fetchApi("/api/load-graph", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ path: rootPath }),
                });
                const json = await graphRes.json();
                const graph = json.graph as Graph;
                if (graph?.nodes?.length) {
                  loadGraph(graph, {
                    label: persisted.label ?? rootPath.split("/").pop() ?? "workspace",
                    subtitle: `local · ${graph.nodes.length} nodes · ${graph.edges.length} edges`,
                    origin: "local",
                    rootPath,
                  }, {
                    rules: json.rules as Rule[] | undefined,
                    violations: json.violations as Violation[] | undefined,
                    insights: json.insights as Insight[] | undefined,
                  });
                  setRepoOpened(true);
                }
              }
            }
          } catch { /* server unreachable; rely on IDB cache or fall through to landing */ }

          clearTimeout(failsafe);
          setResuming(false);
        }).catch(() => {
          clearTimeout(failsafe);
          setResuming(false);
        });
      }
    }

    const cleanup = () => {
      const sid = getSessionId();
      if (sid) {
        // Use fetch keepalive with proper Content-Type so the server accepts
        // the close. sendBeacon sends text/plain which the MCP transport
        // rejects with 415.
        try {
          fetch("/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", id: "close", method: "tools/call",
              params: { name: "workspace.close", arguments: { sessionId: sid } },
            }),
            keepalive: true,
          }).catch(() => { /* best effort */ });
        } catch { /* best effort */ }
      }
    };
    window.addEventListener("beforeunload", cleanup);
    return () => {
      document.body.classList.remove("overflow-hidden");
      window.removeEventListener("beforeunload", cleanup);
    };
  }, [hydrate, loadGraph]);

  useEffect(() => {
    if (theme === "light") document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
  }, [theme]);

  // Step 5a: live-atlas SSE subscription. Activates once a workspace
  // is open. Listens for `files.changed`, `workspace.watch_started`,
  // `workspace.watch_stopped` events and updates the live-atlas
  // store slice. Distinct from the loading-screen SSE in
  // RepoLanding (which only listens during the blocking open and
  // tears down once the workspace is loaded). Per
  // `architecture/v1-launch-plan.md` Step 5a.
  useEffect(() => {
    if (!repoOpened) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      const { subscribeEvents } = await import("@/mcp-client");
      const sid = getSessionId();
      if (!sid || cancelled) return;

      // Best-effort watch_start. Backend logs but doesn't surface
      // errors; the live-atlas store stays in `watching: false`
      // and Studio simply behaves as if watching is unavailable
      // (which is the current behaviour for every prior step).
      try {
        const { callTool } = await import("@/mcp-client");
        await callTool("workspace.watch_start", { sessionId: sid });
      } catch {
        // Server may not support watching (older release) — degrade
        // gracefully. Live atlas stays inactive but everything else
        // works.
      }

      if (cancelled) return;

      unsub = subscribeEvents(sid, (event) => {
        const kind = event.kind as string;
        if (kind === "files.changed") {
          const changes = event.changes as { uri: string; kind: string }[] | undefined;
          useStore.getState().noteFilesChanged(changes?.length ?? 1);
        } else if (kind === "workspace.watch_started") {
          useStore.getState().setLiveAtlasWatching(true);
        } else if (kind === "workspace.watch_stopped") {
          useStore.getState().setLiveAtlasWatching(false);
        }
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
      // Best-effort watch_stop on unmount. Server-side the session
      // also auto-stops the watcher when closed; this is the
      // explicit teardown for nav-without-close cases.
      const sid = getSessionId();
      if (sid) {
        void (async () => {
          try {
            const { callTool } = await import("@/mcp-client");
            await callTool("workspace.watch_stop", { sessionId: sid });
          } catch { /* best-effort */ }
        })();
      }
    };
  }, [repoOpened]);

  const apiLoading = useStore((s) => s.apiLoadingCount > 0);
  const diffLoading = useStore((s) => s.diffComputing);
  const planBusy = useStore((s) => s.planPhase === "streaming" || s.planPhase === "running");
  const trustOpen = useTrust((s) => s.open);

  if (resuming) {
    const repoLabel = useStore.getState().repo?.label ?? "workspace";
    return (
      <div className="flex items-center justify-center h-screen bg-surface text-on-surface">
        <div className="text-center space-y-4 w-64">
          <div className="animate-spin w-6 h-6 border-2 border-schema-accent border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-on-surface-muted">Resuming {repoLabel}...</p>
          <InlineProgress active={true} height={3} className="rounded-full" />
          <div className="space-y-1 text-left">
            <p className="text-[11px] text-on-surface-faint">Restoring graph from cache</p>
            <p className="text-[11px] text-on-surface-faint">Reconnecting to MCP server</p>
          </div>
          <button
            onClick={() => {
              try {
                localStorage.removeItem("schema:state:v1");
              } catch {}
              setResuming(false);
            }}
            className="text-xs text-on-surface-faint hover:text-on-surface-variant underline"
          >
            Cancel and start fresh
          </button>
        </div>
      </div>
    );
  }

  if (!repoOpened) {
    return (
      <ErrorBoundary>
        <RepoLanding onOpened={() => { setRepoOpened(true); if (CHALLENGE_MODE) useStore.getState().setSidePanelView("review"); }} />
      </ErrorBoundary>
    );
  }


  return (
    <ErrorBoundary>
      <div className="fixed inset-0 flex flex-col bg-surface">
        <ProgressBar active={apiLoading || diffLoading || planBusy} />
        <TopBar />
        <McpBanner />
        {prMode ? <PrModeBanner prMode={prMode} /> : null}
        {CHALLENGE_MODE ? null : <ExtractionBanner />}
        <div className="flex-1 flex min-h-0">
          <SideRail />
          <main className="flex-1 flex flex-col min-w-0 relative">
            {CHALLENGE_MODE ? null : <><Onboarding /><ProblemsHero /><BulkActionToolbar /></>}
            <div className="flex-1 min-h-0 relative">
              <Suspense fallback={<SkeletonCanvas />}>
                <GraphCanvas />
              </Suspense>
              {CHALLENGE_MODE ? <RepoMap /> : null}

              {showWelcomeHero && !CHALLENGE_MODE ? <WelcomeHero /> : null}
            </div>
            <CommandBar />
          </main>
          {/* Challenge mode shows one panel at a time: issues, then the run, then the review. */}
          <SidePanel />
          {CHALLENGE_MODE && trustOpen ? null : <PlanPanel />}
          <TrustPanel />
        </div>
        <CheatSheet />
        <SearchOverlay />
        <Toast />
        <Shortcuts />
      </div>
    </ErrorBoundary>
  );
}

function EvidenceOverlay() {
  const view = useTrust((s) => s.view);
  const hasReceipt = useTrust((s) => !!s.receipt);
  return (
    <>
      {hasReceipt && view === "evidence" ? <div className="absolute inset-0 bg-surface z-10"><EvidenceView /></div> : null}
      {hasReceipt ? <ViewToggle /> : null}
    </>
  );
}

"use client";

import { create } from "zustand";
import { fetchApi } from "@/lib/api";
import {
  fixtureGraph,
  fixtureInsights,
  fixtureRules,
  fixtureSummary,
  fixtureCoverage,
  fixtureViolations,
  fixtureReadmeExcerpt,
} from "@/lib/fixture";
import {
  mockDiff,
  mockGraphPatch,
  mockPlan,
  mockTestLines,
} from "@/lib/mockPlanner";
import { runAgentLoop, type AgentEvent } from "@/lib/agentLoop";
import type {
  CoverageMap,
  DiffProbeResult,
  Graph,
  GraphPatch,
  HistoryEntry,
  Insight,
  LocalDiff,
  NodeKind,
  Plan,
  Rule,
  Step,
  StepRun,
  Violation,
} from "@/lib/types";
import type { Level } from "@/lib/aggregate";

export type SidePanelView =
  | "inspector"
  | "problems"
  | "insights"
  | "rules"
  | "history"
  | "summary"
  | "snapshots"
  | "edge"
  | "source"
  | "changes"
  | "agents"
  | "query"
  | "wisdom"
  | "settings"
  | "review";

export type PlanPhase = "idle" | "streaming" | "preview" | "running" | "done";

export interface DrillSegment {
  id: string;
  label: string;
  level: Level;
}

export interface RepoState {
  origin: "local" | "github";
  label: string;
  subtitle: string;
  /** Absolute filesystem path the graph was extracted from. Set by the
   *  extract pipeline; null for the bundled fixture (which has no
   *  on-disk source). The source viewer reads this to build full paths
   *  for the /api/file endpoint. */
  rootPath?: string | null;
}

/** Per-file content snapshot returned by ops, mirrored client-side so
 *  the store can round-trip it through /api/op/restore on undo. */
export interface FileSnapshotClient {
  relPath: string;
  mode: "modified" | "created";
  before: string | null;
}

/** Mirror of {@link import("@/server/git/orchestrator").GitPlanContext}.
 *  Kept as a duplicated literal type (rather than `import type ...`)
 *  because store.ts is "use client" and we don't want server-only
 *  modules pulled into the client bundle.  */
export interface GitContextClient {
  enabled: boolean;
  branchName: string | null;
  baselineSha: string | null;
  previousBranch: string | null;
  dirtyAtStart: boolean;
  disabledReason?: string;
  commits: {
    sha: string;
    shortSha: string;
    message: string;
    filesChanged: string[];
    step: number;
  }[];
}

export interface ExtractionFailureClient {
  filePath: string;
  reason: "too-large" | "generated" | "parse-failed" | "read-failed";
  extractorId: string;
  detail?: string;
}

/** Per `architecture/v1-launch-plan.md` Step 4 — the canonical
 *  filter-reason set. §0.6.2 ("no parallel unions"): this union
 *  IS the source of truth; api.ts re-exports it as the wire
 *  type and the engine `FilterReason` mirrors it 1:1. Both
 *  sides carry a canonical-set test that fires if the cardinality
 *  changes. */
export type FilterReasonClient =
  | "gitignore"
  | "always"
  | "filename-pattern"
  | "generated-directory"
  | "header-comment"
  | "codegen-toolchain"
  | "binary-blob";

export type FilterCountsClient = Record<FilterReasonClient, number>;

export interface FilteredFileClient {
  filePath: string;
  reason: FilterReasonClient;
  extractorId: string;
  detail?: string;
}

export interface ExtractionStatsClient {
  filesAttempted: number;
  filesParsed: number;
  filesSkipped: number;
  failures: ExtractionFailureClient[];
  perExtractor: Array<{
    extractorId: string;
    filesAttempted: number;
    filesParsed: number;
    filesSkipped: number;
    failures: ExtractionFailureClient[];
    filtered?: FilterCountsClient;
  }>;
  /** Step 4: workspace-wide filter breakdown. Optional on the
   *  client side because a pre-Step-4 cached extraction may not
   *  carry it yet. */
  filtered?: FilterCountsClient;
  filteredSample?: FilteredFileClient[];
}

/** Mirrors the engine's `ArchetypeResult` + the monorepo flag
 *  from `workspace.describe` (Step 3). The level-1 label
 *  `Services` / `Modules` / `Commands` / … is derived from
 *  `primary` at render time via `archetypeL1Label`. */
export type ArchetypeIdClient =
  | "web-app-service"
  | "library-sdk"
  | "cli-tool"
  | "ai-ml-project"
  | "data-pipeline"
  | "infrastructure-devops"
  | "documentation-site"
  | "mobile-desktop"
  | "unclassified";

export interface WorkspaceArchetypeClient {
  primary: ArchetypeIdClient;
  secondaries: ArchetypeIdClient[];
  confidence: number;
  scores: Array<{ id: ArchetypeIdClient; score: number }>;
  monorepo: boolean;
}

export interface UndoEntry {
  snapshot: Graph;
  intent: string;
  appliedDescriptions: string[];
  at: number;
  /** True when the plan ran against a real repo (repo.rootPath set) and
   *  actually mutated files on disk. */
  realApply?: boolean;
  /** Absolute path the plan ran against. Required to call /api/op/restore. */
  rootPath?: string;
  /** Aggregated per-step file snapshots (in plan order). Replayed in
   *  reverse on undo. Only present when `realApply` is true. */
  fileSnapshots?: FileSnapshotClient[];
  /** Git context captured at plan completion. Present (with
   *  `enabled: true`) when the plan actually committed on a schema
   *  branch; the undo path prefers `git reset --hard` over file
   *  snapshots when this is set. */
  git?: GitContextClient;
}

export interface State {
  workingGraph: Graph;
  baseGraph: Graph;

  repo: RepoState;
  summary: string;
  readme: string;
  coverage: CoverageMap;

  insights: Insight[];
  rules: Rule[];
  violations: Violation[];

  plan: Plan | null;
  planPhase: PlanPhase;
  planPartial: Partial<Plan>;
  stepRuns: Record<number, StepRun>;
  testOutputLive: string;
  activeStepIndex: number | null;

  /** Live agent reasoning events streamed during plan generation. */
  agentEvents: AgentEvent[];
  /** AbortController for the current agent loop run. */
  agentLoopController: AbortController | null;

  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  hoverInsightTargets: Set<string>;
  hoverViolationTargets: Set<string>;
  /** Inner node ids the user is hovering an op preview on. Lit up on
   *  the canvas alongside ghostEdges so the user can SEE which
   *  structures the op would touch before clicking apply. Empty when
   *  no op is being hovered. */
  hoverPreviewTargets: Set<string>;
  focusTargetIds: Set<string>;
  /** Inner node ids the user has explicitly pinned. Pinned nodes get a
   *  visible glow on the canvas at every level (their bucket lights up
   *  at L1/L2). Persists to localStorage. */
  pinnedNodeIds: Set<string>;
  /** Bulk selection (shift-click). When size >= 2 the canvas shows a
   *  bulk-action toolbar and the inspector hides. selectedNodeId stays
   *  the "primary" single-selection slot for the inspector. */
  bulkSelection: Set<string>;
  /** Epoch ms of the last successful extraction. Sent with every
   *  /api/op/apply request so the server can detect concurrent edits.
   *  null when working with the bundled fixture. */
  extractedAt: number | null;
  /** AbortController for the active /api/run-tests stream, if any. */
  testRunController: AbortController | null;
  /** Per-graph signature ("rootDir::nodeCount") of the last graph the
   *  user explicitly dismissed the Problems hero for. The hero re-shows
   *  for any other graph. Session-only — not persisted. */
  problemsHeroDismissedSig: string | null;
  /** Tag from the planner that produced the most-recent plan. "mock"
   *  is the bundled fallback; "anthropic" (or whatever) is a real LLM
   *  source. The UI uses this to render a small badge in PlanPanel and
   *  to surface a one-time toast when we silently downgrade. */
  plannerSource: string;
  /** True when the most-recent plan came from a real LLM. */
  plannerUsedRealLLM: boolean;
  mcpStatus: "connected" | "disconnected" | "reconnecting";
  /** Live-atlas slice per `architecture/v1-launch-plan.md` Step
   *  5a + research/27 §7.1. `watching: true` after a successful
   *  `workspace.watch_start`. `lastEventAt` (ms epoch) updates
   *  whenever a `files.changed` SSE event arrives; the UI pulses
   *  for a beat when the value changes. `eventsReceived` is a
   *  cumulative counter — useful for dogfooding. Step 5b will
   *  add `stale: boolean` once the L2/L3/reactive layers can
   *  invalidate specific views. */
  liveAtlas: {
    watching: boolean;
    lastEventAt: number;
    lastEventChanges: number;
    eventsReceived: number;
  };
  /** Extraction summary from the most-recent workspace.open. `null`
   *  before the first open completes, or after the user dismisses the
   *  banner. Drives `<ExtractionBanner />` per
   *  `architecture/v1-launch-plan.md` Step 1. */
  extractionStats: ExtractionStatsClient | null;
  /** True when the user has dismissed the current banner; cleared on
   *  the next workspace.open. */
  extractionBannerDismissed: boolean;
  /** Archetype + monorepo detection result from the most recent
   *  workspace.open per doc-25 §8 + Step 3 of the launch plan.
   *  `null` until the first open completes. Drives the L1 label
   *  (Services / Modules / Commands / …) and the L0 hero copy. */
  workspaceArchetype: WorkspaceArchetypeClient | null;
  /** Why we fell back to the mock, if we did (e.g. "ANTHROPIC_API_KEY
   *  not set"). null when no fallback happened. */
  plannerFallbackReason: string | null;
  planError: string | null;
  /** Token usage reported by the LLM vendor for the most recent plan
   *  call. null when the call fell back to the mock OR when the
   *  vendor didn't report usage. The PlanPanel renders this as a
   *  small "12k in / 4k out · gemini-2.5-pro" hint so users have
   *  visibility into what each prompt costs. */
  plannerUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    model: string;
  } | null;
  recentlyAdded: {
    nodeIds: Set<string>;
    edges: { source: string; target: string; relation: string }[];
    until: number;
  };
  ghostEdges: { source: string; target: string; relation: string }[];

  kindFilter: Record<NodeKind, boolean>;
  showCoverage: boolean;
  showImports: boolean;

  level: Level;
  drillPath: DrillSegment[];

  sidePanelView: SidePanelView | null;
  cheatSheetOpen: boolean;
  searchOpen: boolean;
  onboardingDismissed: boolean;
  /** "system" follows prefers-color-scheme; otherwise an explicit choice. */
  theme: "dark" | "light" | "system";
  /** Stack of currently-visible toasts, oldest first. */
  toasts: { id: string; msg: string; until: number }[];

  /* ─────────── Diff overlay ─────────── */
  /** Capabilities probe result — populated on workspace mount via
   *  `probeDiff`. Drives whether the topbar diff toggle renders at
   *  all. null until the probe completes; non-git repos have
   *  `isGitRepo: false`. */
  diffProbe: DiffProbeResult | null;
  /** Most-recent computed diff. null when the user hasn't asked for
   *  one yet; carries the full base/head graphs + delta when present. */
  diffOverlay: LocalDiff | null;
  /** Whether the canvas is currently rendering the overlay. Toggling
   *  this off doesn't discard `diffOverlay` so we can flip back without
   *  recomputing. */
  diffOverlayMode: "off" | "on";
  /** True while a `/api/diff/local` request is in flight; the topbar
   *  shows a spinner. */
  diffComputing: boolean;

  /** Global API loading counter. Incremented when any MCP call
   *  starts, decremented when it completes. The ProgressBar
   *  component shows whenever this is > 0. */
  apiLoadingCount: number;
  bumpApiLoading: (delta: 1 | -1) => void;
  /** Reason the most-recent compute failed, when applicable. Cleared
   *  on next successful compute. */
  diffError: string | null;

  chatHistory: HistoryEntry[];
  undoStack: UndoEntry[];

  /** Named graph snapshots (manual save/restore, distinct from undo). */
  snapshots: { id: string; name: string; graph: Graph; at: number }[];

  /** Tutorial / lesson progress. */
  activeLessonId: string | null;
  completedLessons: string[];
  lessonObjectivesDone: Set<string>;
  /** Number of plans the user has approved during the CURRENT lesson
   *  (resets on enterLesson). Lets lesson 4's "undo last plan"
   *  objective tell "user applied AND undid in this session" apart
   *  from "user opened the lesson with an empty undo stack" — which
   *  would otherwise mark the objective done by accident. */
  lessonAppliedCount: number;

  setRepo: (label: string, subtitle: string, origin: "local" | "github") => void;
  /** Replace the working graph (and base graph) with one produced by the
   *  extractor. Resets all derived state so insights/violations don't carry
   *  over from a previous repo. Optional evaluation lets the API supply
   *  freshly-evaluated rules/violations/insights so the panel rails are
   *  populated without an extra round-trip. */
  loadGraph: (
    graph: Graph,
    repo: RepoState,
    evaluation?: {
      rules?: Rule[];
      violations?: Violation[];
      insights?: Insight[];
    },
  ) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  togglePin: (id: string) => void;
  clearPins: () => void;
  toggleInBulk: (id: string) => void;
  clearBulk: () => void;
  hoverInsight: (insight: Insight | null) => void;
  /** Set the canvas-level preview state for an op hover. Pass `null` to
   *  clear. Updates both ghostEdges (for the dashed blue lines) and
   *  hoverPreviewTargets (for the node highlight). Atomic so the canvas
   *  flashes once, not twice. */
  setHoverPreview: (
    patch: { addEdges?: { source: string; target: string; relation: string }[] } | null,
  ) => void;
  hoverViolation: (v: Violation | null) => void;
  /** Spotlight a set of inner node ids on the canvas — bucketed at the
   *  current level, dims everything else, fits the camera to them.
   *  Empty array clears focus. Used by the Problems panel's "click to
   *  jump" affordance. */
  focusOnIds: (ids: string[]) => void;
  setKindFilter: (kind: NodeKind, on: boolean) => void;
  setShowCoverage: (on: boolean) => void;
  setShowImports: (on: boolean) => void;
  setMcpStatus: (status: "connected" | "disconnected" | "reconnecting") => void;
  /** Step 5a: mark the live-atlas as watching/not. Set by Studio
   *  immediately after `workspace.watch_start` succeeds. */
  setLiveAtlasWatching: (watching: boolean) => void;
  /** Step 5a: called from the SSE `files.changed` handler. Bumps
   *  `eventsReceived`, updates `lastEventAt`, records how many
   *  files were in the batch (for the "5 files updated" pulse
   *  copy). */
  noteFilesChanged: (changeCount: number) => void;
  setExtractionStats: (stats: ExtractionStatsClient | null) => void;
  dismissExtractionBanner: () => void;
  setWorkspaceArchetype: (archetype: WorkspaceArchetypeClient | null) => void;
  setLevel: (level: Level) => void;
  goToLevel: (level: Level) => void;
  drillInto: (segment: DrillSegment) => void;
  popToSegment: (idx: number) => void;
  setSidePanelView: (view: SidePanelView | null) => void;
  setCheatSheetOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  dismissOnboarding: () => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  toggleRule: (id: string) => void;
  /** Add a new custom prose rule (locally; not persisted until saveRulesToDisk). */
  addCustomRule: (input: {
    description: string;
    body: string;
    severity?: "low" | "medium" | "high";
    evaluation?: "display" | "llm";
    globs?: string[];
  }) => string;
  /** Patch an existing custom rule. Imported / built-in rules can only be
   *  toggled, not edited — call `toggleRule` for those. */
  updateCustomRule: (
    id: string,
    patch: Partial<{
      description: string;
      body: string;
      severity: "low" | "medium" | "high";
      evaluation: "display" | "llm";
      globs: string[];
    }>,
  ) => void;
  /** Remove a custom rule. No-op for non-custom rules. */
  deleteCustomRule: (id: string) => void;
  /** Switch an imported rule's evaluation between "display" and "llm".
   *  Persisted via saveRulesToDisk like any other override. */
  setRuleEvaluation: (id: string, evaluation: "display" | "llm") => void;
  /** Re-walk the repo for rule files. Replaces the current rule list
   *  with the merged (built-ins + config customs + imported) set and
   *  refreshes deterministic violations / insights. */
  reimportRules: () => Promise<void>;
  /** Persist customs + toggle overrides to schema.config.json on disk.
   *  No-op when there's no rootPath (fixture / demo). Returns true on
   *  success so the caller can chain a toast. */
  saveRulesToDisk: () => Promise<boolean>;
  /** Run a single LLM-evaluated prose rule against the current graph.
   *  Updates `violations` with whatever the model returned and emits a
   *  toast describing the outcome. */
  checkRule: (id: string) => Promise<void>;
  /* ─────────── Diff overlay actions ─────────── */
  /** Fire-and-forget capabilities probe. No-op when there's no
   *  rootPath (fixture / demo without an opened repo). Called once
   *  per loadGraph for a real repo. */
  probeDiff: () => Promise<void>;
  /** Compute the local-vs-remote diff. When `fetch` is true we run
   *  `git fetch` first so origin/<branch> reflects the latest. Stores
   *  the result in `diffOverlay` and flips `diffOverlayMode` to "on"
   *  so the canvas paints immediately. */
  computeDiff: (opts?: {
    fetch?: boolean;
    baseBranch?: string;
  }) => Promise<void>;
  /** Toggle the canvas overlay without recomputing. No-op when
   *  diffOverlay is null. */
  setDiffOverlayMode: (mode: "off" | "on") => void;
  /** Drop the current diff payload — used after the user accepts /
   *  discards a plan and the working tree is back in sync, so a
   *  stale "X added, Y removed" summary doesn't linger. */
  clearDiff: () => void;
  emitToast: (msg: string) => void;
  hydrateFromStorage: () => void;

  submitPrompt: (prompt: string) => Promise<void>;
  cancelPlan: () => void;
  /** Abort an in-flight /api/run-tests stream. No-op if no run is
   *  active. The route honors the AbortSignal and SIGTERMs the child
   *  process. */
  cancelTests: () => void;
  /** Mark the first-load Problems hero as dismissed for the given graph
   *  signature. Subsequent renders for the same signature won't show
   *  the hero. Loading a different graph clears it implicitly because
   *  the signature changes. */
  dismissProblemsHero: (sig: string) => void;
  approvePlan: () => Promise<void>;
  undoLast: () => Promise<void>;
  /** Rewind to the state before this history entry was applied. Discards
   *  this entry and every later entry in chatHistory + undoStack. */
  undoTo: (historyId: string) => Promise<void>;

  /** Named snapshot save / restore, separate from undo. */
  saveSnapshot: (name?: string) => void;
  restoreSnapshot: (id: string) => void;
  deleteSnapshot: (id: string) => void;

  /** Lessons. */
  enterLesson: (id: string) => void;
  exitLesson: () => void;
  markObjectiveDone: (id: string) => void;
  completeLesson: (id: string) => void;
}

function buildGhostEdges(plan: Plan, graph: Graph) {
  const ghosts: { source: string; target: string; relation: string }[] = [];
  for (const step of plan.steps) {
    if (step.kind !== "op") continue;
    if (step.opName === "addMiddleware") {
      const middleware = String(step.params.middleware ?? "requireAuth");
      const middlewareFile = String(
        step.params.middlewareFile ?? "src/middleware/auth.ts",
      );
      const middlewareNode = graph.nodes.find(
        (n) => n.name === middleware && n.file === middlewareFile,
      );
      if (middlewareNode) {
        ghosts.push({
          source: step.targetId,
          target: middlewareNode.id,
          relation: "applies_middleware",
        });
      }
    } else if (step.opName === "addCaching" || step.opName === "wrapTransformation") {
      const targetNode = graph.nodes.find((n) => n.id === step.targetId);
      if (targetNode) {
        ghosts.push({
          source: step.targetId,
          target: step.targetId,
          relation: step.opName === "addCaching" ? "cache_wraps" : "wraps",
        });
      }
    }
  }
  return ghosts;
}

/**
 * Best-effort filename derivation for a mock-pipeline step. The mock
 * pipeline doesn't write to disk, but the History panel + step display
 * still need a `filesChanged` value that reads coherently. We:
 *   1. For `op` steps: parse the target id (route or fn id encodes
 *      the file path: `route:src/x.ts:GET:/y:42` →  "src/x.ts").
 *   2. For freeform steps: use the first listed file, if any.
 *   3. Fall back to a generic in-memory marker.
 *
 * Avoids the historical bug of always returning "src/routes/todos.ts"
 * regardless of what the step actually targeted.
 */
function mockFilesChangedFor(step: Step, graph: Graph): string[] {
  if (step.kind === "freeform") {
    return step.files.length > 0
      ? step.files.map((f) => f.path)
      : ["(in-memory · mock pipeline)"];
  }
  // Op step: prefer the node's actual file from the graph over parsing
  // the ID string, since IDs in fixture graphs may not encode real paths.
  const id = step.targetId;
  const node = graph.nodes.find((n) => n.id === id);
  if (node?.file) return [node.file];
  const colonParts = id.split(":");
  if ((id.startsWith("route:") || id.startsWith("fn:")) && colonParts[1]) {
    return [colonParts[1]];
  }
  return ["(in-memory · mock pipeline)"];
}

function applyPatch(graph: Graph, patch: GraphPatch | undefined): Graph {
  if (!patch) return graph;
  const nodes = [
    ...graph.nodes.filter((n) => !patch.removeNodeIds?.includes(n.id)),
    ...(patch.addNodes ?? []),
  ];
  const edges = [
    ...graph.edges.filter((e) => !patch.removeEdgeIds?.includes(e.id)),
    ...(patch.addEdges ?? []),
  ];
  return { ...graph, nodes, edges };
}

const allKindsOn: Record<NodeKind, boolean> = {
  route_handler: true,
  service: true,
  data_access: true,
  middleware: true,
  model: true,
  external: true,
  utility: true,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PERSIST_KEY = "schema:state:v1";

interface PersistedShape {
  level: Level;
  sidePanelView: SidePanelView | null;
  repo: RepoState;
  chatHistory: HistoryEntry[];
  drillPath: DrillSegment[];
  onboardingDismissed: boolean;
  completedLessons: string[];
  theme: "dark" | "light" | "system";
  pinnedNodeIds: string[];
  rules: Rule[];
  violations: Violation[];
  plan: Plan | null;
  undoStack: UndoEntry[];
}

export function loadPersisted(): Partial<PersistedShape> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PersistedShape>;
  } catch {
    return null;
  }
}

/** Surface a single toast on the first persist failure per session so the
 *  user knows their preferences won't survive a reload (private mode, quota,
 *  Safari ITP eviction, etc.). */
let persistWarned = false;

function persist(state: State) {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = {
      level: state.level,
      sidePanelView: state.sidePanelView,
      repo: state.repo,
      chatHistory: state.chatHistory,
      drillPath: state.drillPath,
      onboardingDismissed: state.onboardingDismissed,
      completedLessons: state.completedLessons,
      theme: state.theme,
      pinnedNodeIds: [...state.pinnedNodeIds],
      rules: state.rules,
      violations: state.violations,
      plan: state.plan,
      undoStack: state.undoStack.slice(0, 3).map((e) => ({
        ...e,
        snapshot: { nodes: [], edges: [], clusters: [], rootDir: "" },
      })),
    };
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch (e) {
    if (!persistWarned) {
      persistWarned = true;
      // Schedule the toast so we don't recurse into setState while another
      // setState is in flight.
      setTimeout(() => {
        try {
          state.emitToast(
            "settings won't persist · localStorage unavailable",
          );
        } catch {
          /* ignore */
        }
      }, 0);
      console.warn("schema · persist failed", e);
    }
  }
}

const VALID_LEVELS = new Set([0, 1, 2, 3]);
const VALID_VIEWS = new Set<SidePanelView>([
  "inspector",
  "problems",
  "insights",
  "rules",
  "history",
  "summary",
  "snapshots",
  "edge",
  "source",
  "changes",
  "agents",
  "query",
  "wisdom",
  "settings",
]);

/** Drop / coerce any persisted field that's the wrong shape so a corrupted
 *  localStorage value can never crash the workspace. */
function sanitizePersisted(
  raw: Partial<PersistedShape> | null,
): Partial<PersistedShape> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<PersistedShape> = {};

  if (typeof raw.level === "number" && VALID_LEVELS.has(raw.level)) {
    out.level = raw.level as Level;
  }
  if (raw.sidePanelView === null) {
    out.sidePanelView = null;
  } else if (
    typeof raw.sidePanelView === "string" &&
    VALID_VIEWS.has(raw.sidePanelView as SidePanelView)
  ) {
    out.sidePanelView = raw.sidePanelView as SidePanelView;
  }
  if (
    raw.repo &&
    typeof raw.repo === "object" &&
    typeof raw.repo.label === "string" &&
    typeof raw.repo.subtitle === "string" &&
    (raw.repo.origin === "local" || raw.repo.origin === "github")
  ) {
    out.repo = raw.repo;
  }
  if (Array.isArray(raw.chatHistory)) {
    out.chatHistory = raw.chatHistory.filter(
      (h): h is HistoryEntry =>
        !!h &&
        typeof h === "object" &&
        typeof h.id === "string" &&
        typeof h.intent === "string" &&
        Array.isArray(h.appliedDescriptions),
    );
  }
  if (Array.isArray(raw.drillPath)) {
    out.drillPath = raw.drillPath.filter(
      (s): s is DrillSegment =>
        !!s &&
        typeof s === "object" &&
        typeof s.id === "string" &&
        typeof s.label === "string" &&
        typeof s.level === "number" &&
        VALID_LEVELS.has(s.level),
    );
  }
  if (typeof raw.onboardingDismissed === "boolean") {
    out.onboardingDismissed = raw.onboardingDismissed;
  }
  if (Array.isArray(raw.completedLessons)) {
    out.completedLessons = raw.completedLessons.filter(
      (id) => typeof id === "string",
    );
  }
  if (
    raw.theme === "dark" ||
    raw.theme === "light" ||
    raw.theme === "system"
  ) {
    out.theme = raw.theme;
  }
  if (Array.isArray(raw.pinnedNodeIds)) {
    out.pinnedNodeIds = raw.pinnedNodeIds.filter(
      (s) => typeof s === "string",
    );
  }
  if (Array.isArray(raw.rules)) {
    out.rules = raw.rules;
  }
  if (Array.isArray(raw.violations)) {
    out.violations = raw.violations;
  }
  if (raw.plan === null || (raw.plan && typeof raw.plan === "object")) {
    out.plan = raw.plan as Plan | null;
  }
  if (Array.isArray(raw.undoStack)) {
    out.undoStack = raw.undoStack;
  }
  return out;
}

/** Drop drillPath segments whose ids are no longer reachable in the working
 *  graph (e.g. a cluster that was renamed, a module/file that was deleted). */
function pruneDrillPath(
  segments: DrillSegment[],
  graph: Graph,
): DrillSegment[] {
  const clusters = new Set(graph.clusters.map((c) => c.id));
  const files = new Set(graph.nodes.map((n) => `module:${n.file}`));
  return segments.filter((s) => {
    if (s.id.startsWith("cluster:")) return clusters.has(s.id);
    if (s.id.startsWith("module:")) return files.has(s.id);
    return graph.nodes.some((n) => n.id === s.id);
  });
}

/**
 * Shared body of undoLast / undoTo. Handles three paths, in order of
 * preference:
 *
 *   - Git rollback (preferred when available): when every entry in
 *     `entriesToReplay` has an enabled git context AND they all
 *     belong to the same rootPath, we replay newest→oldest by POSTing
 *     each entry's git context to /api/op/restore-git. The server
 *     runs `git reset --hard <baseline>` + `git checkout <previous>`
 *     + `git branch -D <schema/...>` for each, which cleanly
 *     unwinds N stacked schema branches in order. Cleanest possible
 *     undo — every schema branch from the rolled-back plans
 *     vanishes entirely.
 *   - File-snapshot rollback: POST every entry's `fileSnapshots` to
 *     /api/op/restore in newest→oldest order. Used when at least one
 *     plan ran without git (dirty tree, non-git dir, opt-out) or
 *     when the multi-plan git path fails part-way.
 *   - In-memory: just restore `target.snapshot` as the working graph.
 *     The legacy fixture flow uses this; ditto any UndoEntry without
 *     fileSnapshots.
 *
 * `entriesToReplay` is the slice of undoStack we're rolling back, in
 * newest→oldest order. `target` is the post-undo destination state.
 */
async function applyUndo(
  get: () => State,
  set: (partial: Partial<State>) => void,
  target: UndoEntry,
  entriesToReplay: UndoEntry[],
): Promise<void> {
  // Git rollback path: only when EVERY entry has a populated, enabled
  // git context AND they all belong to the same rootPath. Mixed
  // git/no-git plans, multiple repos, or any disabled context drops
  // us through to file snapshots — that path replays disk byte-for-
  // byte and doesn't care about branch state.
  const sharedRootPath = entriesToReplay[0]?.rootPath;
  const everyEntryHasGit =
    entriesToReplay.length > 0 &&
    entriesToReplay.every(
      (e) =>
        e.git?.enabled &&
        e.git.baselineSha &&
        e.git.branchName &&
        e.rootPath === sharedRootPath,
    );
  if (everyEntryHasGit && sharedRootPath) {
    try {
      // Replay newest→oldest. Each POST reverts ONE plan's commits +
      // deletes its schema branch; the next iteration's baseline is
      // the previous iteration's previousBranch tip (which is exactly
      // where we land after step 1 of the previous reset).
      let lastResponse: {
        graph: Graph;
        rules?: Rule[];
        violations?: Violation[];
        insights?: Insight[];
      } | null = null;
      let failedIdx = -1;
      let failureReason = "";
      for (let i = 0; i < entriesToReplay.length; i++) {
        const entry = entriesToReplay[i];
        const res = await fetchApi("/api/op/restore-git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootPath: sharedRootPath,
            git: entry.git,
          }),
        });
        const json = (await res.json()) as
          | {
              graph: Graph;
              rules?: Rule[];
              violations?: Violation[];
              insights?: Insight[];
              branch: string;
            }
          | { error: string; code: string };
        if (!res.ok || "error" in json) {
          failedIdx = i;
          failureReason =
            "error" in json ? json.code : `HTTP ${res.status}`;
          break;
        }
        lastResponse = json;
      }

      if (failedIdx === -1 && lastResponse) {
        set({
          workingGraph: lastResponse.graph,
          violations:
            lastResponse.violations ?? fixtureViolations(lastResponse.graph),
          ...(lastResponse.insights ? { insights: lastResponse.insights } : {}),
          ...(lastResponse.rules ? { rules: lastResponse.rules } : {}),
          recentlyAdded: { nodeIds: new Set(), edges: [], until: 0 },
          focusTargetIds: new Set(),
          extractedAt: Date.now(),
        });
        const branchList = entriesToReplay
          .map((e) => e.git!.branchName)
          .join(", ");
        get().emitToast(
          entriesToReplay.length === 1
            ? `undone · git reset · branch ${entriesToReplay[0].git!.branchName} deleted`
            : `undone · git reset · ${entriesToReplay.length} branches deleted (${branchList})`,
        );
        return;
      }

      // Partial-failure: some plans rolled back, the rest didn't.
      // Soft-fall-through to file snapshots which still cover the
      // remaining plans (and the already-rolled-back ones get their
      // file snapshots applied as no-ops, which is harmless because
      // restoreSnapshots compares before-content per file).
      get().emitToast(
        entriesToReplay.length === 1
          ? `git undo failed (${failureReason}) · falling back to file snapshots`
          : `git undo failed at step ${failedIdx + 1}/${entriesToReplay.length} (${failureReason}) · falling back to file snapshots`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().emitToast(`git undo failed (${msg}) · falling back to file snapshots`);
    }
  }

  const realEntries = entriesToReplay.filter(
    (e) => e.realApply && e.rootPath && e.fileSnapshots && e.fileSnapshots.length > 0,
  );
  // Per-entry snapshots are stored in REPLAY order (already reversed at
  // capture time), so concatenating newest→oldest gives us the right
  // sequence to send to /api/op/restore.
  const aggregated: FileSnapshotClient[] = [];
  for (const entry of realEntries) {
    if (entry.fileSnapshots) aggregated.push(...entry.fileSnapshots);
  }

  if (aggregated.length === 0 || !realEntries.length) {
    // In-memory path: just rewind the working graph.
    set({
      workingGraph: target.snapshot,
      violations: fixtureViolations(target.snapshot),
      recentlyAdded: { nodeIds: new Set(), edges: [], until: 0 },
      focusTargetIds: new Set(),
    });
    get().emitToast(
      `undone · ${target.appliedDescriptions.length} step(s) rolled back`,
    );
    return;
  }

  const rootPath = realEntries[0].rootPath!;
  try {
    const res = await fetchApi("/api/op/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath, snapshots: aggregated }),
    });
    const json = (await res.json()) as
      | {
          graph: Graph;
          filesRestored: string[];
          warnings: { relPath: string; message: string }[];
          rules?: Rule[];
          violations?: Violation[];
          insights?: Insight[];
        }
      | { error: string; code: string };
    if (!res.ok || "error" in json) {
      get().emitToast(
        `undo failed · ${"error" in json ? json.code : `HTTP ${res.status}`}`,
      );
      return;
    }
    set({
      workingGraph: json.graph,
      violations: json.violations ?? fixtureViolations(json.graph),
      ...(json.insights ? { insights: json.insights } : {}),
      ...(json.rules ? { rules: json.rules } : {}),
      recentlyAdded: { nodeIds: new Set(), edges: [], until: 0 },
      focusTargetIds: new Set(),
      // Disk just changed under us; reset the extractedAt stamp so the
      // next apply doesn't see a stale value.
      extractedAt: Date.now(),
    });
    get().emitToast(
      `undone · ${json.filesRestored.length} file(s) restored`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    get().emitToast(`undo failed · ${msg}`);
  }
}

export const useStore = create<State>((set, get) => ({
  workingGraph: fixtureGraph,
  baseGraph: fixtureGraph,

  repo: {
    origin: "local",
    label: "acme/todos-api",
    subtitle: "express + jwt + sqlite · cached",
  },
  summary: fixtureSummary,
  readme: fixtureReadmeExcerpt,
  coverage: fixtureCoverage(),

  insights: fixtureInsights,
  rules: fixtureRules,
  violations: fixtureViolations(fixtureGraph),

  plan: null,
  planPhase: "idle",
  planPartial: {},
  stepRuns: {},
  testOutputLive: "",
  activeStepIndex: null,
  agentEvents: [],
  agentLoopController: null,

  selectedNodeId: null,
  selectedEdgeId: null,
  hoverInsightTargets: new Set(),
  hoverPreviewTargets: new Set(),
  hoverViolationTargets: new Set(),
  focusTargetIds: new Set(),
  pinnedNodeIds: new Set(),
  bulkSelection: new Set(),
  extractedAt: null,
  testRunController: null,
  problemsHeroDismissedSig: null,
  plannerSource: "mock",
  plannerUsedRealLLM: false,
  mcpStatus: "disconnected" as const,
  liveAtlas: {
    watching: false,
    lastEventAt: 0,
    lastEventChanges: 0,
    eventsReceived: 0,
  },
  extractionStats: null as ExtractionStatsClient | null,
  extractionBannerDismissed: false,
  workspaceArchetype: null as WorkspaceArchetypeClient | null,
  planError: null,
  plannerFallbackReason: null,
  plannerUsage: null,
  recentlyAdded: { nodeIds: new Set(), edges: [], until: 0 },
  ghostEdges: [],

  kindFilter: { ...allKindsOn },
  showCoverage: false,
  showImports: false,

  level: 1,
  drillPath: [],

  sidePanelView: null,
  cheatSheetOpen: false,
  searchOpen: false,
  onboardingDismissed: false,
  theme: "system",
  toasts: [],

  diffProbe: null,
  diffOverlay: null,
  diffOverlayMode: "off",
  diffComputing: false,
  diffError: null,
  apiLoadingCount: 0,
  bumpApiLoading: (delta) => set((s) => ({ apiLoadingCount: Math.max(0, s.apiLoadingCount + delta) })),

  chatHistory: [],
  undoStack: [],

  snapshots: [],

  activeLessonId: null,
  completedLessons: [],
  lessonObjectivesDone: new Set<string>(),
  lessonAppliedCount: 0,

  setRepo: (label, subtitle, origin) =>
    set({ repo: { label, subtitle, origin } }),

  loadGraph: (graph, repo, evaluation) => {
    set({
      workingGraph: graph,
      baseGraph: graph,
      repo,
      // For extracted graphs the API runs the rule engine + insight
      // detectors and ships results alongside the graph. When that
      // happens we use them; otherwise we fall back to the (legacy)
      // fixture violation finder so the bundled todos demo still
      // surfaces its requireAuth gap.
      insights: evaluation?.insights ?? [],
      rules: evaluation?.rules ?? [],
      violations: evaluation?.violations ?? fixtureViolations(graph),
      // Wipe transient UI state so the new graph mounts clean.
      plan: null,
      planPhase: "idle",
      planPartial: {},
      stepRuns: {},
      testOutputLive: "",
      activeStepIndex: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      hoverInsightTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      focusTargetIds: new Set<string>(),
      bulkSelection: new Set<string>(),
      pinnedNodeIds: new Set<string>(),
      extractedAt: repo.rootPath ? Date.now() : null,
      recentlyAdded: { nodeIds: new Set<string>(), edges: [], until: 0 },
      drillPath: [],
      level: graph.nodes.length > 50 ? 1 : graph.nodes.length > 15 ? 2 : 3,
      sidePanelView: null,
      ghostEdges: [],
      chatHistory: repo.rootPath ? get().chatHistory : [],
      undoStack: repo.rootPath ? get().undoStack : [],
      diffOverlay: null,
      diffOverlayMode: "off",
      diffComputing: false,
      diffError: null,
      agentEvents: [],
      agentLoopController: null,
    });
    // Fire-and-forget probe so the topbar can decide whether to render
    // the diff toggle. Safe to call without a rootPath — it short-
    // circuits to `diffProbe: null`.
    if (typeof window !== "undefined") {
      void get().probeDiff();
      // Persist graph snapshot to IndexedDB for instant reload
      if (repo.rootPath) {
        import("@/lib/idb").then(({ saveGraphToIDB }) => {
          saveGraphToIDB(repo.rootPath!, {
            graph,
            repo,
            rules: evaluation?.rules,
            violations: evaluation?.violations,
            insights: evaluation?.insights,
            savedAt: Date.now(),
          });
        }).catch(() => { /* IndexedDB may not be available */ });
      }
    }
  },

  selectNode: (id) => {
    if (!id) {
      set({
        selectedNodeId: null,
        selectedEdgeId: null,
        focusTargetIds: new Set<string>(),
        hoverInsightTargets: new Set<string>(),
        hoverViolationTargets: new Set<string>(),
        hoverPreviewTargets: new Set<string>(),
      });
      return;
    }
    const g = get().workingGraph;
    // Stale / invalid ID guard — run the same full cleanup as
    // selectNode(null) so focus + hover don't get orphaned.
    const invalidCleanup = {
      selectedNodeId: null,
      selectedEdgeId: null,
      focusTargetIds: new Set<string>(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
    };
    if (id.startsWith("cluster:") && !g.clusters.some((c) => c.id === id)) {
      set(invalidCleanup);
      return;
    }
    if (id.startsWith("module:")) {
      const file = id.replace(/^module:/, "");
      if (!g.nodes.some((n) => n.file === file)) {
        set(invalidCleanup);
        return;
      }
    }
    if (
      !id.startsWith("cluster:") &&
      !id.startsWith("module:") &&
      !g.nodes.some((n) => n.id === id)
    ) {
      set(invalidCleanup);
      return;
    }
    const cur = get();
    const panelUpdate: Partial<State> = {};
    // Auto-open inspector when no panel is open, or when the current
    // panel is "edge" (the edge inspector is stale once a node is
    // selected). If the user has Rules/History/etc. open, respect that.
    if (!cur.sidePanelView || cur.sidePanelView === "edge") {
      panelUpdate.sidePanelView = "inspector";
    }
    set({
      selectedNodeId: id,
      selectedEdgeId: null,
      // Always clear these on explicit selection so old focus/hover
      // states from problems-jump, insight-hover, etc. don't compete
      // with the new selection-dimming.
      focusTargetIds: new Set<string>(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
      ...panelUpdate,
    });
  },

  selectEdge: (id) => {
    if (!id) {
      set({
        selectedEdgeId: null,
        selectedNodeId: null,
        focusTargetIds: new Set(),
        hoverInsightTargets: new Set<string>(),
        hoverViolationTargets: new Set<string>(),
        hoverPreviewTargets: new Set<string>(),
      });
      return;
    }
    const graph = get().workingGraph;
    const direct = graph.edges.find((e) => e.id === id);
    let endpointIds: string[] = [];
    if (direct) {
      endpointIds = [direct.source, direct.target];
    } else {
      const parts = id.split("::");
      if (parts.length === 3) {
        endpointIds = [parts[0], parts[1]];
      }
    }
    const cur = get();
    set({
      selectedEdgeId: id,
      selectedNodeId: null,
      sidePanelView:
        !cur.sidePanelView || cur.sidePanelView === "inspector"
          ? "edge"
          : cur.sidePanelView,
      focusTargetIds: new Set(endpointIds),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
    });
  },

  togglePin: (id) => {
    const cur = get().pinnedNodeIds;
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ pinnedNodeIds: next });
  },
  clearPins: () => set({ pinnedNodeIds: new Set() }),

  toggleInBulk: (id) => {
    const cur = get();
    const next = new Set(cur.bulkSelection);
    // If the bulk set is empty, seed it with the current single selection
    // (if any) so shift-click extends an existing single selection.
    if (next.size === 0 && cur.selectedNodeId && cur.selectedNodeId !== id) {
      next.add(cur.selectedNodeId);
    }
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Both paths must clear focus + hover so we don't get competing
    // dimming systems (e.g. shift-click after a "Jump to" in Problems).
    const cleanHover = {
      focusTargetIds: new Set<string>(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
    };
    if (next.size <= 1) {
      const only = [...next][0] ?? null;
      set({
        bulkSelection: new Set(),
        selectedNodeId: only,
        selectedEdgeId: null,
        sidePanelView: only ? "inspector" : cur.sidePanelView,
        ...cleanHover,
      });
    } else {
      // Hide the inspector while bulk-selecting; the bulk toolbar takes over.
      set({
        bulkSelection: next,
        selectedNodeId: null,
        selectedEdgeId: null,
        sidePanelView:
          cur.sidePanelView === "inspector" || cur.sidePanelView === "edge"
            ? null
            : cur.sidePanelView,
        ...cleanHover,
      });
    }
  },
  clearBulk: () => set({ bulkSelection: new Set() }),

  hoverInsight: (insight) => {
    // During plan streaming/preview, the plan owns canvas highlights.
    // Don't let hover from the Problems/Insights panel compete.
    const phase = get().planPhase;
    if (phase === "streaming" || phase === "preview" || phase === "running") return;
    set({ hoverInsightTargets: new Set(insight?.targetIds ?? []) });
  },

  setHoverPreview: (patch) => {
    // During plan preview, ghost edges belong to the plan. Don't let
    // Inspector op hovers overwrite them.
    const phase = get().planPhase;
    if (phase === "preview" || phase === "streaming") return;

    if (!patch) {
      set({ hoverPreviewTargets: new Set(), ghostEdges: [] });
      return;
    }
    const targets = new Set<string>();
    const edges = (patch.addEdges ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
    }));
    for (const e of edges) {
      targets.add(e.source);
      targets.add(e.target);
    }
    set({ hoverPreviewTargets: targets, ghostEdges: edges });
  },

  hoverViolation: (v) => {
    const phase = get().planPhase;
    if (phase === "streaming" || phase === "preview" || phase === "running") return;
    set({ hoverViolationTargets: new Set(v?.targetIds ?? []) });
  },

  focusOnIds: (ids) => {
    // During plan streaming/preview/running, the plan owns canvas focus.
    const phase = get().planPhase;
    if (phase === "streaming" || phase === "preview" || phase === "running") return;
    // Clear selection + hover so focus-dimming is the only active
    // system. Without this, clicking "Jump" on a problem while a node
    // is selected causes both dimming systems to fight.
    set({
      focusTargetIds: new Set(ids),
      selectedNodeId: null,
      selectedEdgeId: null,
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
    });
  },

  setKindFilter: (kind, on) =>
    set({ kindFilter: { ...get().kindFilter, [kind]: on } }),

  setShowCoverage: (on) => set({ showCoverage: on }),
  setShowImports: (on) => set({ showImports: on }),
  setMcpStatus: (status) => set({ mcpStatus: status }),
  setLiveAtlasWatching: (watching) => set((state) => ({
    liveAtlas: { ...state.liveAtlas, watching },
  })),
  noteFilesChanged: (changeCount) => set((state) => ({
    liveAtlas: {
      ...state.liveAtlas,
      lastEventAt: Date.now(),
      lastEventChanges: changeCount,
      eventsReceived: state.liveAtlas.eventsReceived + 1,
    },
  })),
  setExtractionStats: (stats) => set({ extractionStats: stats, extractionBannerDismissed: false }),
  dismissExtractionBanner: () => set({ extractionBannerDismissed: true }),
  setWorkspaceArchetype: (archetype) => set({ workspaceArchetype: archetype }),

  setLevel: (level) => set({ level }),

  goToLevel: (level) => {
    const cur = get();
    const trimmed = cur.drillPath.filter((s) => s.level < level);
    const closePanel =
      cur.sidePanelView === "inspector" || cur.sidePanelView === "edge";
    set({
      level,
      drillPath: trimmed,
      selectedNodeId: null,
      selectedEdgeId: null,
      focusTargetIds: new Set<string>(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
      ...(closePanel ? { sidePanelView: null } : {}),
    });
  },

  drillInto: (segment) => {
    const cur = get();
    const next: Level = (Math.min(3, segment.level + 1) as Level);
    const closePanel =
      cur.sidePanelView === "inspector" || cur.sidePanelView === "edge";
    set({
      level: next,
      drillPath: [...cur.drillPath, segment],
      selectedNodeId: null,
      selectedEdgeId: null,
      focusTargetIds: new Set<string>(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
      ...(closePanel ? { sidePanelView: null } : {}),
    });
  },

  popToSegment: (idx) => {
    const cur = get();
    const closePanel =
      cur.sidePanelView === "inspector" || cur.sidePanelView === "edge";
    const hoverClear = {
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
    };
    if (idx < 0) {
      const home = cur.drillPath.length > 0 ? cur.drillPath[0].level : 1;
      set({
        level: home as Level,
        drillPath: [],
        selectedNodeId: null,
        selectedEdgeId: null,
        focusTargetIds: new Set<string>(),
        ...hoverClear,
        ...(closePanel ? { sidePanelView: null } : {}),
      });
      return;
    }
    const trimmed = cur.drillPath.slice(0, idx + 1);
    const last = trimmed[trimmed.length - 1];
    const targetLevel = last.level === 0 ? 2 : (last.level + 1);
    set({
      level: targetLevel as Level,
      drillPath: trimmed,
      selectedNodeId: null,
      selectedEdgeId: null,
      focusTargetIds: new Set<string>(),
      ...hoverClear,
      ...(closePanel ? { sidePanelView: null } : {}),
    });
  },

  setSidePanelView: (view) => set({ sidePanelView: view }),
  setCheatSheetOpen: (open) =>
    set({ cheatSheetOpen: open, ...(open ? { searchOpen: false } : {}) }),
  setSearchOpen: (open) =>
    set({ searchOpen: open, ...(open ? { cheatSheetOpen: false } : {}) }),
  dismissOnboarding: () => set({ onboardingDismissed: true }),
  setTheme: (theme) => set({ theme }),

  toggleRule: (id) =>
    set({
      rules: get().rules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r,
      ),
    }),

  addCustomRule: (input) => {
    const id = `rule:custom:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const newRule: Rule = {
      id,
      description: input.description.trim() || "Custom rule",
      kind: "prose",
      enabled: true,
      prompt: `Audit the architecture against: ${input.description.trim() || "this custom rule"}.`,
      severity: input.severity ?? "medium",
      source: "custom",
      evaluation: input.evaluation ?? "llm",
      body: input.body,
      globs: input.globs && input.globs.length > 0 ? input.globs : undefined,
    };
    set({ rules: [...get().rules, newRule] });
    return id;
  },

  updateCustomRule: (id, patch) => {
    set({
      rules: get().rules.map((r) => {
        if (r.id !== id) return r;
        if (r.source !== "custom") return r;
        return {
          ...r,
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
          ...(patch.evaluation !== undefined ? { evaluation: patch.evaluation } : {}),
          ...(patch.globs !== undefined
            ? { globs: patch.globs.length > 0 ? patch.globs : undefined }
            : {}),
        };
      }),
    });
  },

  deleteCustomRule: (id) => {
    const rule = get().rules.find((r) => r.id === id);
    if (!rule || rule.source !== "custom") return;
    set({
      rules: get().rules.filter((r) => r.id !== id),
      violations: get().violations.filter((v) => v.ruleId !== id),
    });
  },

  setRuleEvaluation: (id, evaluation) => {
    set({
      rules: get().rules.map((r) =>
        r.id === id ? { ...r, evaluation } : r,
      ),
    });
  },

  reimportRules: async () => {
    const rootPath = get().repo.rootPath;
    if (!rootPath) {
      get().emitToast("re-import only works on a real repo");
      return;
    }
    try {
      const res = await fetchApi("/api/rules/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath }),
      });
      const json = (await res.json()) as
        | {
            rules: Rule[];
            violations: Violation[];
            insights: Insight[];
          }
        | { error: string; code: string };
      if (!res.ok || "error" in json) {
        get().emitToast(
          `re-import failed · ${"error" in json ? json.code : `HTTP ${res.status}`}`,
        );
        return;
      }
      set({
        rules: json.rules,
        violations: json.violations,
        insights: json.insights,
      });
      get().emitToast(`re-imported · ${json.rules.length} rule(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().emitToast(`re-import failed · ${msg}`);
    }
  },

  saveRulesToDisk: async () => {
    const rootPath = get().repo.rootPath;
    if (!rootPath) {
      get().emitToast("rule saves require a real repo");
      return false;
    }
    const customRules = get().rules.filter((r) => r.source === "custom");
    const toggleOverrides: Record<string, boolean> = {};
    for (const r of get().rules) {
      // Built-ins + imports get toggle overrides; customs carry their
      // enabled state in their own entry. We send overrides for every
      // non-custom rule and let the server drop entries that match the
      // built-in default.
      if (r.source !== "custom") {
        toggleOverrides[r.id] = r.enabled;
      }
    }
    try {
      const res = await fetchApi("/api/rules/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath, customRules, toggleOverrides }),
      });
      const json = (await res.json()) as
        | {
            saved: boolean;
            rules: Rule[];
            violations: Violation[];
            insights: Insight[];
          }
        | { error: string; code: string };
      if (!res.ok || "error" in json) {
        get().emitToast(
          `save failed · ${"error" in json ? json.code : `HTTP ${res.status}`}`,
        );
        return false;
      }
      set({
        rules: json.rules,
        violations: json.violations,
        insights: json.insights,
      });
      get().emitToast(`rules saved to schema.config.json`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().emitToast(`save failed · ${msg}`);
      return false;
    }
  },

  checkRule: async (id) => {
    const rootPath = get().repo.rootPath;
    if (!rootPath) {
      get().emitToast("rule checks require a real repo");
      return;
    }
    let apiKeyOverride: string | undefined;
    if (typeof window !== "undefined") {
      const key = window.localStorage.getItem("schema:anthropicKey");
      if (key && key.trim()) apiKeyOverride = key.trim();
    }
    try {
      const res = await fetchApi("/api/rules/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath, ruleId: id, apiKeyOverride }),
      });
      // Rate-limited: surface a clean toast pointing at the retry-after.
      if (res.status === 429) {
        const retry =
          res.headers.get("retry-after") ??
          res.headers.get("x-ratelimit-reset") ??
          "a few seconds";
        get().emitToast(`check rate-limited · retry in ${retry}s`);
        return;
      }
      const json = (await res.json()) as
        | {
            ruleId: string;
            violations: Violation[];
            usedRealLLM: boolean;
            fallbackReason: string | null;
          }
        | { error: string; code: string };
      if (!res.ok || "error" in json) {
        get().emitToast(
          `check failed · ${"error" in json ? json.code : `HTTP ${res.status}`}`,
        );
        return;
      }
      const next = get()
        .violations.filter((v) => v.ruleId !== id)
        .concat(json.violations);
      set({ violations: next });
      if (!json.usedRealLLM) {
        get().emitToast(
          `check skipped · ${json.fallbackReason ?? "LLM unavailable"}`,
        );
      } else if (json.violations.length === 0) {
        get().emitToast("rule clean · 0 violations");
      } else {
        const v = json.violations[0];
        get().emitToast(
          `rule flagged ${v.targetIds.length} node(s)`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().emitToast(`check failed · ${msg}`);
    }
  },

  emitToast: (msg) => {
    const id = `t:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const until = Date.now() + 2400;
    set({ toasts: [...get().toasts, { id, msg, until }].slice(-4) });
    setTimeout(() => {
      // Remove the matching toast if it's still in the queue.
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 2400);
  },

  hydrateFromStorage: () => {
    const raw = loadPersisted();
    const safe = sanitizePersisted(raw);
    const drillPath = safe.drillPath
      ? pruneDrillPath(safe.drillPath, get().workingGraph)
      : [];
    set({
      level: safe.level ?? get().level,
      sidePanelView: safe.sidePanelView ?? null,
      repo: safe.repo ?? get().repo,
      chatHistory: safe.chatHistory ?? [],
      drillPath,
      onboardingDismissed: safe.onboardingDismissed ?? false,
      completedLessons: safe.completedLessons ?? [],
      theme: safe.theme ?? "system",
      pinnedNodeIds: new Set(safe.pinnedNodeIds ?? []),
      ...(safe.rules ? { rules: safe.rules } : {}),
      ...(safe.violations ? { violations: safe.violations } : {}),
      ...(safe.plan !== undefined ? { plan: safe.plan } : {}),
      ...(safe.undoStack ? { undoStack: safe.undoStack } : {}),
    });
  },

  submitPrompt: async (prompt) => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      get().emitToast("describe a change first");
      return;
    }
    if (get().planPhase === "running" || get().planPhase === "streaming") {
      get().emitToast("a plan is already in flight");
      return;
    }

    const loopCtrl = new AbortController();
    const curPanel = get().sidePanelView;
    set({
      planPhase: "streaming",
      planPartial: { intent: "" },
      plan: null,
      planError: null,
      stepRuns: {},
      testOutputLive: "",
      activeStepIndex: null,
      ghostEdges: [],
      focusTargetIds: new Set(),
      // Clear selection + hover so the plan's focus targets are the
      // only active dimming system. Without this, a stale node
      // selection causes "wrong things highlight" during plan preview.
      selectedNodeId: null,
      selectedEdgeId: null,
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
      // Close inspector/edge panel since we just cleared their
      // selection — leaving them open shows "No node selected" next
      // to the streaming plan panel, which looks broken.
      sidePanelView:
        curPanel === "inspector" || curPanel === "edge"
          ? null
          : curPanel,
      agentEvents: [],
      agentLoopController: loopCtrl,
    });

    try {
      let apiKeyOverride: string | undefined = undefined;
      if (typeof window !== "undefined") {
        const key = window.localStorage.getItem("schema:anthropicKey");
        if (key && key.trim()) apiKeyOverride = key.trim();
      }
      let finalPlan: Plan | undefined | null;
      let usedAgentLoop = false;
      try {
        const res = await fetchApi("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: trimmed,
            graph: get().workingGraph,
            apiKeyOverride,
            rules: get().rules.filter((r) => r.enabled),
            violations: get().violations,
          }),
        });
        if (res.status === 429) {
          const retry =
            res.headers.get("retry-after") ??
            res.headers.get("x-ratelimit-reset") ??
            "a few seconds";
          const reason = `rate-limited · retry in ${retry}s`;
          get().emitToast(`planner · ${reason}`);
          throw new Error("rate-limited");
        }
        if (!res.ok) throw new Error(`/api/plan returned ${res.status}`);
        const json = (await res.json()) as {
          plan: Plan;
          source: string;
          usedRealLLM: boolean;
          fallbackReason: string | null;
          usage?: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            model: string;
          } | null;
        };
        finalPlan = json.plan;
        const prevSource = get().plannerSource;
        set({
          plannerSource: json.source,
          plannerUsedRealLLM: json.usedRealLLM,
          plannerFallbackReason: json.fallbackReason,
          plannerUsage: json.usage ?? null,
        });
        if (
          !json.usedRealLLM &&
          json.fallbackReason &&
          prevSource !== json.source
        ) {
          get().emitToast(`planner · using mock fallback · ${json.fallbackReason}`);
        }
      } catch (planErr) {
        if (typeof console !== "undefined" && console.debug) {
          console.debug("schema · /api/plan unavailable, using agent loop", planErr);
        }
        // Run the agent loop: streams tool calls to the UI
        usedAgentLoop = true;
        finalPlan = await runAgentLoop({
          prompt: trimmed,
          graph: get().workingGraph,
          apiKeyOverride,
          signal: loopCtrl.signal,
          onEvent: (event) => {
            if (get().planPhase === "idle") return;
            const events = [...get().agentEvents, event];
            set({ agentEvents: events });
            // Highlight affected nodes live
            if (event.nodeIds && event.nodeIds.length > 0) {
              set({ focusTargetIds: new Set(event.nodeIds) });
            }
            // Stream plan steps as they arrive
            if (event.kind === "plan_step" && event.step) {
              const current = get().planPartial;
              const steps = [...(current.steps ?? []), event.step];
              set({ planPartial: { intent: trimmed, steps } });
            }
          },
        });
        // If cancelled (abort) during loop, bail without mock fallback
        if (loopCtrl.signal.aborted || get().planPhase === "idle") return;

        if (!finalPlan) {
          finalPlan = mockPlan(trimmed, get().workingGraph);
        }
        set({
          plannerSource: "agent-loop",
          plannerUsedRealLLM: false,
          plannerFallbackReason: null,
          plannerUsage: null,
        });
      }

      if (get().planPhase === "idle") return;

      if (!usedAgentLoop) {
        // Animate intent streaming for non-agent-loop path
        const intent = finalPlan!.intent;
        let intentSoFar = "";
        for (let i = 0; i < intent.length; i += 3) {
          if (get().planPhase === "idle") return;
          intentSoFar = intent.slice(0, i + 3);
          set({ planPartial: { intent: intentSoFar, steps: [] } });
          await sleep(15);
        }

        if (get().planPhase === "idle") return;

        const partialSteps: Step[] = [];
        for (const step of finalPlan!.steps) {
          if (get().planPhase === "idle") return;
          partialSteps.push(step);
          set({
            planPartial: { intent: finalPlan!.intent, steps: [...partialSteps] },
          });
          await sleep(180);
        }
      }

      if (get().planPhase === "idle") return;

      const ghosts = buildGhostEdges(finalPlan!, get().workingGraph);
      const focus = new Set(
        finalPlan!.steps
          .filter((s) => s.kind === "op")
          .map((s) => (s as { targetId: string }).targetId),
      );

      set({
        plan: finalPlan!,
        planPartial: {},
        planPhase: "preview",
        ghostEdges: ghosts,
        focusTargetIds: focus,
        agentLoopController: null,
      });
    } catch (e) {
      console.error("schema · submitPrompt failed", e);
      set({
        plan: null,
        planPartial: {},
        planPhase: "idle",
        ghostEdges: [],
        focusTargetIds: new Set(),
        agentEvents: [],
        agentLoopController: null,
      });
      const errMsg = e instanceof Error ? e.message : "plan generation failed";
      set({ planError: errMsg });
      get().emitToast(errMsg);
    }
  },

  cancelPlan: () => {
    get().agentLoopController?.abort();
    set({
      plan: null,
      planPartial: {},
      planPhase: "idle",
      planError: null,
      stepRuns: {},
      testOutputLive: "",
      ghostEdges: [],
      focusTargetIds: new Set(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
      agentEvents: [],
      agentLoopController: null,
    });
  },

  cancelTests: () => {
    const ctrl = get().testRunController;
    if (!ctrl) return;
    ctrl.abort();
    set({ testRunController: null });
  },

  dismissProblemsHero: (sig) => set({ problemsHeroDismissedSig: sig }),

  probeDiff: async () => {
    const rootPath = get().repo.rootPath;
    if (!rootPath) {
      set({ diffProbe: null });
      return;
    }
    try {
      const res = await fetchApi("/api/diff/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath }),
      });
      const json = (await res.json()) as
        | DiffProbeResult
        | { error: string; code: string };
      if (!res.ok || "error" in json) {
        set({ diffProbe: null });
        return;
      }
      set({ diffProbe: json });
    } catch {
      // Probe is best-effort; failure just means the toggle won't render.
      set({ diffProbe: null });
    }
  },

  computeDiff: async (opts = {}) => {
    const rootPath = get().repo.rootPath;
    if (!rootPath) {
      get().emitToast("diff requires a real repo");
      return;
    }
    if (get().diffComputing) {
      return;
    }
    set({ diffComputing: true, diffError: null });
    try {
      const res = await fetchApi("/api/diff/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath,
          baseBranch: opts.baseBranch,
          fetch: opts.fetch === true,
        }),
      });
      const json = (await res.json()) as
        | { diff: LocalDiff }
        | { error: string; code: string };
      if (!res.ok || "error" in json) {
        const reason =
          "error" in json ? `${json.code} · ${json.error}` : `HTTP ${res.status}`;
        set({ diffComputing: false, diffError: reason });
        get().emitToast(`diff failed · ${reason}`);
        return;
      }
      const counts = json.diff.graphDelta.counts;
      const total =
        counts.nodesAdded + counts.nodesRemoved + counts.nodesModified;
      set({
        diffOverlay: json.diff,
        diffOverlayMode: "on",
        diffComputing: false,
        diffError: null,
      });
      if (total === 0 && json.diff.fileStats.filesChanged.length === 0) {
        get().emitToast("no changes vs " + json.diff.baseBranch);
      } else {
        get().emitToast(
          `diff · ${counts.nodesAdded}+ / ${counts.nodesRemoved}− / ${counts.nodesModified}~ vs ${json.diff.baseBranch}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ diffComputing: false, diffError: msg });
      get().emitToast(`diff failed · ${msg}`);
    }
  },

  setDiffOverlayMode: (mode) => {
    if (mode === "on" && !get().diffOverlay) {
      // Auto-fetch the diff if user toggles on without one cached.
      void get().computeDiff();
      return;
    }
    set({ diffOverlayMode: mode });
  },

  clearDiff: () =>
    set({
      diffOverlay: null,
      diffOverlayMode: "off",
      diffError: null,
    }),

  approvePlan: async () => {
    const plan = get().plan;
    if (!plan) return;
    if (plan.steps.length === 0) {
      get().emitToast("plan has no steps to apply");
      set({ planPhase: "idle", plan: null });
      return;
    }

    const preSnapshot = get().workingGraph;
    const rootPath = get().repo.rootPath ?? null;
    const filesChangedAggregate = new Set<string>();
    const fileSnapshotsAggregate: FileSnapshotClient[] = [];
    // Git context threads through every step. First /api/op/apply call
    // omits it; server probes + creates the schema branch and sends
    // back a populated context. Subsequent calls echo it back.
    let gitCtx: GitContextClient | null = null;

    // Per-step real-apply results, keyed by step index. Populated when
    // the apply is real (file-writing); read later in the same loop
    // iteration to splice the freshly-extracted graph + rule eval into
    // the next render. Replaces the historical pattern of mutating
    // `(step as any).__realResult = json` which leaked the `any` cast
    // through the rest of the function. Keyed by index so we can keep
    // the Step type pristine.
    const realApplyResults = new Map<
      number,
      {
        graph: Graph;
        rules?: Rule[];
        violations?: Violation[];
        insights?: Insight[];
      }
    >();

    set({ planPhase: "running" });

    try {

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      const stepFocus = step.kind === "op"
        ? new Set([(step as { targetId: string }).targetId])
        : new Set<string>();
      set({
        activeStepIndex: i,
        focusTargetIds: stepFocus,
        stepRuns: { ...get().stepRuns, [i]: { phase: "applying" } },
        testOutputLive: "",
      });
      await sleep(380);

      // Branch: when this is an `op` step against a real repo, hit
      // /api/op/apply for a deterministic codemod that mutates files on
      // disk and returns a freshly-extracted graph. For freeform steps
      // (or no rootPath) fall through to the mock pipeline which only
      // mutates the in-memory graph.
      const realOp = !!rootPath && step.kind === "op";

      let diff: string;
      let filesChanged: string[];
      if (realOp) {
        const res = await fetchApi("/api/op/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootPath,
            opName: step.opName,
            target: step.targetId,
            params: step.params,
            extractedAt: get().extractedAt ?? undefined,
            step: i,
            git: gitCtx ?? undefined,
          }),
        });
        const json = (await res.json()) as
          | {
              graph: Graph;
              filesChanged: string[];
              diff: string;
              blockers: { code: string; message: string }[];
              fileSnapshot?: FileSnapshotClient[];
              rules?: Rule[];
              violations?: Violation[];
              insights?: Insight[];
              git?: GitContextClient;
            }
          | { error: string; code: string };
        if (!res.ok || "error" in json) {
          throw new Error(
            "error" in json
              ? `${json.code} · ${json.error}`
              : `apply failed (HTTP ${res.status})`,
          );
        }
        diff = json.diff;
        filesChanged = json.filesChanged;
        for (const f of json.filesChanged) filesChangedAggregate.add(f);
        if (json.fileSnapshot && json.fileSnapshot.length > 0) {
          fileSnapshotsAggregate.push(...json.fileSnapshot);
        }
        // Update the rolling git context. Even when git is disabled
        // we keep the latest copy around so the UI can surface the
        // disabledReason (e.g. dirty tree) in the plan footer.
        if (json.git) gitCtx = json.git;
        // Each successful apply re-extracted server-side. Advance
        // extractedAt so the next step in the plan doesn't trip its
        // own concurrent-edit guard.
        if (json.filesChanged.length > 0) {
          set({ extractedAt: Date.now() });
        }
        // We'll swap workingGraph in below after the streaming animation
        // completes — stash the freshly-extracted graph + eval here so
        // the next render can splice them in. Keyed by step index so
        // we don't have to widen the Step type with internal scratch.
        realApplyResults.set(i, {
          graph: json.graph,
          rules: json.rules,
          violations: json.violations,
          insights: json.insights,
        });
      } else {
        diff = mockDiff(step, get().workingGraph);
        // The mock pipeline doesn't write to disk; surface a path that
        // reflects the step's actual target so the History panel and
        // toasts read coherently. Route ids encode the source file
        // (`route:src/routes/foo.ts:GET:/x:42`); function ids do too
        // (`fn:src/services/y.ts:listY`). For freeform steps, fall
        // back to the first listed file. Worst case (no recognisable
        // shape), use a generic in-memory marker.
        filesChanged = mockFilesChangedFor(step, get().workingGraph);
      }

      set({
        stepRuns: {
          ...get().stepRuns,
          [i]: {
            phase: "testing",
            diff,
            filesChanged,
          },
        },
      });

      // Mock pipeline streams canned test lines per step. Real-op pipeline
      // skips per-step testing — we run the real repo's test suite once
      // after the loop so we don't pay N spawns for a plan with N steps.
      let acc = "";
      if (realOp) {
        acc = "[schema · tests deferred to end-of-plan run]";
        set({ testOutputLive: acc });
        await sleep(120);
      } else {
        const lines = mockTestLines();
        for (const l of lines) {
          acc = acc ? `${acc}\n${l}` : l;
          set({ testOutputLive: acc });
          await sleep(50);
        }
      }

      set({
        stepRuns: {
          ...get().stepRuns,
          [i]: {
            ...get().stepRuns[i],
            phase: "verifying_intent",
            testOutput: acc,
          },
        },
      });
      await sleep(400);

      // Compute the new graph + recently-added markers.
      let newGraph: Graph;
      let patch: GraphPatch;
      let realRules: Rule[] | undefined;
      let realViolations: Violation[] | undefined;
      let realInsights: Insight[] | undefined;
      if (realOp) {
        // Pulled from the per-step map populated above when this same
        // iteration hit /api/op/apply. Always populated when realOp is
        // true; the non-null assertion is safe because we just put it
        // there a few statements earlier.
        const real = realApplyResults.get(i)!;
        newGraph = real.graph;
        realRules = real.rules;
        realViolations = real.violations;
        realInsights = real.insights;
        // Synthesise a graphPatch by diffing pre vs post edge ids — used
        // for the green-flash highlight only.
        const preIds = new Set(get().workingGraph.edges.map((e) => e.id));
        patch = {
          addNodes: newGraph.nodes.filter(
            (n) => !get().workingGraph.nodes.some((m) => m.id === n.id),
          ),
          addEdges: newGraph.edges.filter((e) => !preIds.has(e.id)),
        };
      } else {
        patch = mockGraphPatch(step, get().workingGraph);
        newGraph = applyPatch(get().workingGraph, patch);
      }
      const addedNodeIds = new Set<string>();
      const addedEdges: { source: string; target: string; relation: string }[] = [];
      for (const e of patch.addEdges ?? [])
        addedEdges.push({
          source: e.source,
          target: e.target,
          relation: e.relation,
        });
      for (const n of patch.addNodes ?? []) addedNodeIds.add(n.id);

      const desc =
        step.kind === "op"
          ? step.description
          : `freeform · ${step.files.length} file(s)`;

      const until = Date.now() + 3500;
      set({
        workingGraph: newGraph,
        recentlyAdded: { nodeIds: addedNodeIds, edges: addedEdges, until },
        // For real ops the API returned freshly-evaluated violations +
        // insights — use them. For the mock path keep the legacy fixture
        // re-evaluator.
        violations: realViolations ?? fixtureViolations(newGraph),
        ...(realInsights ? { insights: realInsights } : {}),
        ...(realRules ? { rules: realRules } : {}),
        stepRuns: {
          ...get().stepRuns,
          [i]: {
            ...get().stepRuns[i],
            phase: "passed",
            graphPatch: patch,
            durationMs: 1620,
            intentCheck: { matches: true, reason: `✓ ${desc}` },
          },
        },
      });

      const clearAt = until;
      setTimeout(() => {
        if (get().recentlyAdded.until === clearAt) {
          set({ recentlyAdded: { nodeIds: new Set(), edges: [], until: 0 } });
        }
      }, 3550);

      await sleep(220);
    }

    const realApply = !!rootPath;

    // After every step has applied, run the repo's actual test suite if
    // we mutated disk. We stream output into testOutputLive so the user
    // sees real test results (replacing the mock per-step stream above).
    if (realApply && filesChangedAggregate.size > 0) {
      const lastIdx = plan.steps.length - 1;
      const ctrl = new AbortController();
      set({ testRunController: ctrl });
      try {
        const res = await fetchApi("/api/run-tests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rootPath }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          set({
            testOutputLive: `[schema · couldn't start test runner · HTTP ${res.status}]`,
          });
        } else {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let acc = "";
          // Streaming loop — flush every chunk so the user sees live output.
          // Stops when the server closes the stream (after the sentinel)
          // or the AbortController fires (cancel button).
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            acc += decoder.decode(value, { stream: true });
            set({ testOutputLive: acc });
          }
          // Final decoder flush
          acc += decoder.decode();
          set({
            testOutputLive: acc,
            stepRuns: {
              ...get().stepRuns,
              [lastIdx]: {
                ...get().stepRuns[lastIdx],
                testOutput: acc,
              },
            },
          });
        }
      } catch (e) {
        const isAbort =
          e instanceof DOMException && e.name === "AbortError";
        if (!isAbort) {
          const msg = e instanceof Error ? e.message : String(e);
          set({ testOutputLive: `[schema · test stream failed] ${msg}` });
        }
        // For abort: testOutputLive already shows whatever the runner
        // streamed before cancel; no extra error text.
      } finally {
        set({ testRunController: null });
      }
    }

    const lastCommit = gitCtx?.commits.at(-1) ?? null;
    const history: HistoryEntry = {
      id: `h:${Date.now()}`,
      prompt: plan.intent,
      intent: plan.intent,
      appliedDescriptions: plan.steps.map((s) =>
        s.kind === "op" ? s.description : `freeform · ${s.files.length} file(s)`,
      ),
      rolledBackDescriptions: [],
      at: Date.now(),
      realApply,
      filesChanged: realApply ? [...filesChangedAggregate] : undefined,
      ...(gitCtx
        ? {
            git: {
              enabled: gitCtx.enabled,
              branchName: gitCtx.branchName,
              baselineSha: gitCtx.baselineSha,
              headShortSha: lastCommit?.shortSha ?? null,
              commitCount: gitCtx.commits.length,
              disabledReason: gitCtx.disabledReason,
            },
          }
        : {}),
    };

    const undo: UndoEntry = {
      snapshot: preSnapshot,
      intent: plan.intent,
      appliedDescriptions: history.appliedDescriptions,
      at: Date.now(),
      realApply,
      ...(realApply && rootPath
        ? {
            rootPath,
            // Apply order is forward; on undo we'll replay in reverse so
            // a step that depended on a previous step's output sees the
            // expected pre-state. Reverse here so callers can iterate
            // in array order on undo.
            fileSnapshots: [...fileSnapshotsAggregate].reverse(),
          }
        : {}),
      // Always thread the git context through (even when disabled) so
      // the PlanDoneFooter can render the "git off · <reason>" line.
      // The UNDO PATH still gates on `git.enabled && commits.length > 0`
      // before attempting a `git reset --hard`; an inert context here
      // is just a UI signal.
      ...(gitCtx ? { git: gitCtx } : {}),
    };

    set({
      planPhase: "done",
      activeStepIndex: null,
      ghostEdges: [],
      focusTargetIds: new Set(),
      hoverInsightTargets: new Set<string>(),
      hoverViolationTargets: new Set<string>(),
      hoverPreviewTargets: new Set<string>(),
      chatHistory: [history, ...get().chatHistory].slice(0, 12),
      undoStack: [undo, ...get().undoStack].slice(0, 12),
      // Bump the lesson-scoped apply counter so lesson 4's "undo last
      // plan" objective can require "applied AND undid IN this lesson"
      // rather than the empty-stack heuristic. No-op when no lesson is
      // active.
      ...(get().activeLessonId
        ? { lessonAppliedCount: get().lessonAppliedCount + 1 }
        : {}),
    });

    if (realApply) {
      get().emitToast(
        `done · ${plan.steps.length} step(s) applied · ${filesChangedAggregate.size} file(s) written`,
      );
      // Vibe-flow auto-trigger: after a real plan lands files on disk,
      // immediately compute the local-vs-remote diff and flip the
      // canvas into overlay mode. The user lands on a "here's what I
      // just did" view without clicking anything. We skip `git fetch`
      // here so the response is snappy — it's fine to compare against
      // whatever origin/<branch> already had cached.
      const probe = get().diffProbe;
      if (probe?.isGitRepo && probe.hasRemote) {
        void get().computeDiff({ fetch: false });
      }
    } else {
      get().emitToast(`done · ${plan.steps.length} step(s) applied`);
    }

    } catch (e) {
      console.error("schema · approvePlan failed mid-step", e);
      // Recover: roll the working graph back to the pre-plan snapshot, mark
      // any in-flight step as failed, surface a toast. The user is free to
      // retry, undo, or close the plan panel.
      const idx = get().activeStepIndex;
      const stepRuns = { ...get().stepRuns };
      if (idx !== null) {
        stepRuns[idx] = {
          ...(stepRuns[idx] ?? {}),
          phase: "failed",
          error: e instanceof Error ? e.message : "Unknown error",
          explanation: "step threw before completing",
        };
        for (let j = idx + 1; j < plan.steps.length; j++) {
          stepRuns[j] = { phase: "skipped" };
        }
      }
      // For real apply: prior steps may have already written files. The
      // pre-snapshot graph is now stale relative to disk. Best-effort
      // re-extract; on failure, fall back to the pre-snapshot so the UI
      // stays alive even if extraction itself blew up.
      let recoveredGraph = preSnapshot;
      if (rootPath && filesChangedAggregate.size > 0) {
        try {
          const res = await fetchApi("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: rootPath }),
          });
          if (res.ok) {
            const j = (await res.json()) as { graph: Graph };
            recoveredGraph = j.graph;
          }
        } catch {
          // ignore — recoveredGraph stays as preSnapshot
        }
      }
      set({
        workingGraph: recoveredGraph,
        violations: fixtureViolations(recoveredGraph),
        stepRuns,
        planPhase: "done",
        activeStepIndex: null,
        ghostEdges: [],
        focusTargetIds: new Set(),
        hoverInsightTargets: new Set<string>(),
        hoverViolationTargets: new Set<string>(),
        hoverPreviewTargets: new Set<string>(),
      });
      if (rootPath && filesChangedAggregate.size > 0) {
        get().emitToast(
          `step threw · ${filesChangedAggregate.size} file(s) already written; check git`,
        );
      } else {
        get().emitToast("plan rolled back · step threw");
      }
    }
  },

  undoLast: async () => {
    const cur = get();
    const last = cur.undoStack[0];
    if (!last) return;
    await applyUndo(get, set, last, [last]);
    set({
      undoStack: cur.undoStack.slice(1),
      chatHistory: cur.chatHistory.slice(1),
    });
  },

  undoTo: async (historyId) => {
    const cur = get();
    const idx = cur.chatHistory.findIndex((h) => h.id === historyId);
    if (idx < 0) return;
    // chatHistory is newest-first; same for undoStack. Restoring entry
    // at idx means we're rewinding past every entry from 0..idx (inclusive).
    const target = cur.undoStack[idx];
    if (!target) {
      // Snapshot was evicted (older than the cap); can't safely restore.
      cur.emitToast("snapshot for this plan is no longer available");
      return;
    }
    // Replay file snapshots from the most-recent entry backwards through
    // the target entry so disk lands on the pre-target state. The
    // entries are newest-first in undoStack; iterate 0..idx in order so
    // we're undoing newest first.
    const toReplay = cur.undoStack.slice(0, idx + 1);
    await applyUndo(get, set, target, toReplay);
    set({
      chatHistory: cur.chatHistory.slice(idx + 1),
      undoStack: cur.undoStack.slice(idx + 1),
      selectedNodeId: null,
    });
  },

  saveSnapshot: (name) => {
    const cur = get();
    const id = `snap:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
    const generatedName = name && name.trim().length > 0
      ? name.trim()
      : `Snapshot ${cur.snapshots.length + 1}`;
    const next = [
      { id, name: generatedName, graph: cur.workingGraph, at: Date.now() },
      ...cur.snapshots,
    ].slice(0, 12);
    set({ snapshots: next });
    cur.emitToast(`saved · ${generatedName}`);
  },

  restoreSnapshot: (id) => {
    const cur = get();
    const snap = cur.snapshots.find((s) => s.id === id);
    if (!snap) return;
    set({
      workingGraph: snap.graph,
      violations: fixtureViolations(snap.graph),
      recentlyAdded: { nodeIds: new Set(), edges: [], until: 0 },
      focusTargetIds: new Set(),
    });
    cur.emitToast(`restored · ${snap.name}`);
  },

  deleteSnapshot: (id) =>
    set({ snapshots: get().snapshots.filter((s) => s.id !== id) }),

  enterLesson: (id) => {
    set({
      activeLessonId: id,
      lessonObjectivesDone: new Set(),
      lessonAppliedCount: 0,
      // Reset workspace state to a clean lesson starting point. The
      // lesson always teaches against the BUNDLED FIXTURE so we wipe
      // any previously-loaded local / GitHub repo's metadata too —
      // otherwise the diff overlay probe + the source viewer would
      // try to read the old rootPath while the canvas shows the
      // fixture, which is confusing.
      workingGraph: fixtureGraph,
      baseGraph: fixtureGraph,
      violations: fixtureViolations(fixtureGraph),
      // Repo metadata: bundled fixture has no rootPath. This re-routes
      // every realApply / probe path through the in-memory mock
      // pipeline for the duration of the lesson.
      repo: { origin: "local", label: "acme/todos-api", subtitle: "tutorial · bundled fixture", rootPath: null },
      extractedAt: null,
      // Diff overlay must be off for the bundled fixture — there's no
      // git repo to diff against. Without this reset the topbar shows
      // a stale "review changes" affordance from the previous repo.
      diffProbe: null,
      diffOverlay: null,
      diffOverlayMode: "off",
      diffError: null,
      // Chat / plan / step transient state
      chatHistory: [],
      plan: null,
      planPhase: "idle",
      planPartial: {},
      stepRuns: {},
      testOutputLive: "",
      activeStepIndex: null,
      agentEvents: [],
      agentLoopController: null,
      // UI: land on Detail (L3) with no drill / no selection so the
      // first lesson's "switch to L1" objective is meaningfully
      // distinct from the entry state.
      level: 3,
      drillPath: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      sidePanelView: null,
      focusTargetIds: new Set(),
      ghostEdges: [],
      recentlyAdded: { nodeIds: new Set(), edges: [], until: 0 },
      // Undo stack must be empty so lesson 4's undo objective can
      // tell "user did the lesson's undo" apart from "user had a
      // pre-existing undo entry to consume".
      undoStack: [],
      cheatSheetOpen: false,
      searchOpen: false,
    });
  },

  exitLesson: () => set({ activeLessonId: null, lessonObjectivesDone: new Set() }),

  markObjectiveDone: (id) =>
    set({ lessonObjectivesDone: new Set([...get().lessonObjectivesDone, id]) }),

  completeLesson: (id) => {
    const cur = get();
    if (cur.completedLessons.includes(id)) return;
    set({ completedLessons: [...cur.completedLessons, id] });
    cur.emitToast(`lesson done · ${id}`);
  },
}));

if (typeof window !== "undefined") {
  useStore.subscribe((state) => persist(state));
}

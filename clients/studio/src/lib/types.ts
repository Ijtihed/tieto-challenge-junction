export type NodeKind =
  | "route_handler"
  | "service"
  | "data_access"
  | "middleware"
  | "model"
  | "external"
  | "utility";

export type EdgeRelation =
  | "imports"
  | "calls"
  | "registers_route"
  | "applies_middleware"
  | "data_flow"
  | "control_flow"
  | "rest_contract"
  | "grpc_contract"
  | "sql_contract"
  | "reads_field"
  | "writes_field";

export interface NodeMeta {
  httpMethod?: string;
  httpPath?: string;
  /** Set on `route_handler` nodes when the route's handler argument is
   *  an inline arrow / function expression rather than a named identifier.
   *  Distinguishes "route bound to inline body" (the dominant Express
   *  pattern) from "route with no handler at all". The orphan-route
   *  rule reads this so it doesn't false-positive on inline arrows. */
  hasInlineHandler?: boolean;
  /** Last line of the inline handler body — present only when
   *  `hasInlineHandler` is true. The Inspector reads this to surface a
   *  "view inline handler body" affordance that opens the source
   *  viewer at the right range, so L3 stays scannable while still
   *  letting the user reach the body in one click. */
  inlineHandlerEndLine?: number;
}

export interface GraphNode {
  id: string;
  name: string;
  kind: NodeKind;
  file: string;
  cluster?: string;
  meta?: NodeMeta;
  sourceRange?: { startLine: number; endLine: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
}

export type CanonicalShape = "service" | "domain" | "library" | "mixed";

export interface Cluster {
  id: string;
  name: string;
  nodeIds: string[];
  entryPointIds?: string[];
  canonicalShape?: CanonicalShape;
  labelTier?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Cluster[];
  rootDir: string;
}

export type Severity = "low" | "medium" | "high";

export interface Insight {
  id: string;
  title: string;
  rationale: string;
  severity: Severity;
  targetIds: string[];
  suggestedPrompt: string;
}

/** Display tag for a rule. The runtime engine has a richer requirement
 *  shape (see `src/server/rules/types.ts → RuleRequirement`); we project
 *  it down to one of these tokens for the UI. */
export type RuleKind =
  | "applies_middleware"
  | "calls"
  | "must_have_inbound"
  | "must_have_outbound"
  | "must_have_handler"
  | "no_cycle"
  // Prose / LLM-evaluated rules don't have a structural requirement.
  // Token surfaced in the panel as "prose".
  | "prose"
  // legacy strings kept to avoid breaking tests / serialised state
  | "no_edge"
  | "must_have_edge"
  | "must_not_exist";

/** Where the rule came from. Drives panel grouping (Imported tab vs
 *  Custom tab vs Built-in section) and gates which fields are editable
 *  in the UI — imported rules are read-only, customs and built-ins can
 *  be toggled, customs alone can be deleted. */
export type RuleSource = "builtin" | "imported" | "custom";

/** How a rule is evaluated.
 *
 *   - "deterministic": graph engine evaluates a structured requirement
 *     (the existing `RuleRequirement` shapes). Always runs.
 *   - "display": prose-only; surfaced in the panel and fed to the
 *     planner prompt, but never produces violations. Default for
 *     imported markdown rules.
 *   - "llm": prose evaluated by a model against the graph; produces
 *     violations when the model flags nodes/edges. Costs a model call
 *     per (rule, graph) pair; cached server-side. Default for natural-
 *     language custom rules. */
export type RuleEvaluation = "deterministic" | "display" | "llm";

export interface Rule {
  id: string;
  description: string;
  kind: RuleKind;
  enabled: boolean;
  prompt: string;
  /** Severity tag for ordering / colouring in the panel. */
  severity?: Severity;
  /** Origin of the rule (drives panel tab + edit affordances). */
  source?: RuleSource;
  /** Repo-relative path of the file this rule was imported from.
   *  Only set when `source === "imported"`. Surfaced in the panel as
   *  a clickable link to open the source. */
  sourcePath?: string;
  /** How the rule is evaluated. Optional for backward compatibility
   *  with persisted state; absent → "deterministic" for built-ins,
   *  "display" otherwise. */
  evaluation?: RuleEvaluation;
  /** Full prose body of an imported / custom prose rule. Empty for
   *  deterministic DSL rules. Markdown-rendered in the panel, fed to
   *  the LLM evaluator + planner prompt. */
  body?: string;
  /** Optional path globs the rule applies to (Cursor `.mdc` frontmatter
   *  `globs`). Filters which graph nodes the LLM evaluator considers. */
  globs?: string[];
}

export interface Violation {
  ruleId: string;
  targetIds: string[];
  message: string;
  suggestedPrompt: string;
}

export type StepRisk = "low" | "medium" | "high";

export type StepPhase =
  | "queued"
  | "applying"
  | "testing"
  | "verifying_intent"
  | "passed"
  | "failed"
  | "skipped";

export interface OpStep {
  kind: "op";
  description: string;
  /**
   * Op identifier. The actual valid set is the registry's `listOps()`
   * keys at runtime; we keep this typed as `string` so adding a new
   * op doesn't require a coordinated edit across every type-checked
   * surface (planner prompts, plan steps, store reducers). Server
   * routes validate against the registry — see
   * `src/server/ops/index.ts → getOp()`.
   */
  opName: string;
  targetId: string;
  params: Record<string, string | number | boolean>;
  risk: StepRisk;
  rationale: string;
}

export interface FreeformStep {
  kind: "freeform";
  description: string;
  files: { path: string; content: string }[];
  risk: StepRisk;
  rationale: string;
}

export type Step = OpStep | FreeformStep;

export interface Plan {
  intent: string;
  steps: Step[];
  notes?: string;
  planId?: string;
}

export interface StepRun {
  phase: StepPhase;
  diff?: string;
  filesChanged?: string[];
  testOutput?: string;
  error?: string;
  explanation?: string;
  durationMs?: number;
  intentCheck?: { matches: boolean; reason: string };
  graphPatch?: GraphPatch;
}

export interface GraphPatch {
  addNodes?: GraphNode[];
  removeNodeIds?: string[];
  addEdges?: GraphEdge[];
  removeEdgeIds?: string[];
}

export interface HistoryEntry {
  id: string;
  prompt: string;
  intent: string;
  appliedDescriptions: string[];
  rolledBackDescriptions: string[];
  at: number;
  /** Set when the plan executed against a real repo (codemods wrote
   *  files). Surfaced in HistoryPanel + PlanDoneFooter so users can tell
   *  in-memory mutations apart from real edits. */
  realApply?: boolean;
  /** Repo-relative POSIX paths that the real ops actually wrote to. */
  filesChanged?: string[];
  /** Git context captured at plan completion. When set + enabled, the
   *  history row shows the schema branch name and short-SHA range. */
  git?: HistoryGitInfo;
}

export interface HistoryGitInfo {
  enabled: boolean;
  branchName: string | null;
  baselineSha: string | null;
  /** Short-SHA of the last commit produced by the plan. */
  headShortSha: string | null;
  /** Number of commits made on the schema branch by this plan. */
  commitCount: number;
  disabledReason?: string;
}

export interface CoverageMap {
  coveredNodeIds: Set<string>;
  totalNodes: number;
}

/* ────────────────────── Diff overlay ────────────────────── */
//
// Mirrors the shapes in `src/server/pr-review/types.ts` but exported from
// the public `@/lib/types` module so client components can import them
// without pulling in server-only modules.

export type NodeDiffStatus = "added" | "removed" | "modified" | "unchanged";

export type NodeChangeReason =
  | "file-touched"
  | "name-changed"
  | "kind-changed"
  | "cluster-changed"
  | "edges-changed";

export interface NodeDiff {
  id: string;
  status: NodeDiffStatus;
  file: string;
  name: string;
  reasons?: NodeChangeReason[];
}

export type EdgeDiffStatus = "added" | "removed" | "unchanged";

export interface EdgeDiff {
  id: string;
  source: string;
  target: string;
  relation: string;
  status: EdgeDiffStatus;
}

export interface GraphDelta {
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  counts: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesModified: number;
    edgesAdded: number;
    edgesRemoved: number;
  };
}

/** Capabilities probe result — used by the topbar to decide whether to
 *  render the diff toggle at all. */
export interface DiffProbeResult {
  isGitRepo: boolean;
  hasRemote: boolean;
  baseBranch: string | null;
  headBranch: string | null;
  ahead: number;
  behind: number;
  workingTreeDirty: boolean;
}

/** Full local-vs-remote diff response. The `LocalDiff` is a superset of
 *  the existing `PrReview`: same base/head graphs + delta + per-rule
 *  evaluations, plus branch metadata for the workspace UI. */
export interface LocalDiff {
  baseSha: string;
  headSha: string;
  baseRef: string;
  baseBranch: string;
  fetched: boolean;
  ahead: number;
  behind: number;
  workingTreeDirty: boolean;
  baseGraph: Graph;
  headGraph: Graph;
  baseEval: { rules: Rule[]; violations: Violation[]; insights: Insight[] };
  headEval: { rules: Rule[]; violations: Violation[]; insights: Insight[] };
  delta: {
    newViolations: Violation[];
    resolvedViolations: Violation[];
    newInsights: Insight[];
    resolvedInsights: Insight[];
  };
  fileStats: {
    filesChanged: string[];
    added: number;
    modified: number;
    deleted: number;
  };
  graphDelta: GraphDelta;
}

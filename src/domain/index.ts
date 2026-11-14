// Per architecture/schema-v3.md §3.3
export { NODE_KINDS, EDGE_RELATIONS, type NodeKind, type EdgeRelation } from "./vocabulary.ts";
export {
  type MultiRepoGraph, type RepoSubgraph, type GraphNode, type GraphEdge,
  type InterRepoEdge, type Cluster, type VocabularyExtensions,
} from "./multi-repo.ts";
export { type GraphPatch, applyPatch } from "./patch.ts";
export {
  type GraphDelta, type NodeDelta, type ImpactSummary, type SemanticDiffSummary,
  type RefactoringClassification, computeDelta,
} from "./delta.ts";
export { computeSemanticDiff, detectRefactorings, computeImpactScores, computeSemanticSummary } from "./semantic-diff.ts";
export { type Locator, idFromLocator, parseLocator } from "./locator.ts";
export {
  CURRENT_WIRE_VERSION, type WireFormatVersion,
} from "./wire-format.ts";
export { graphHash } from "./graph-hash.ts";
export {
  type Insight, type Violation, type Rule, type ImportedRule,
  type Plan, type PlanStep, type PlanRun, type StepRun,
} from "./types.ts";
export { BUILTIN_RULES, type BuiltinRule } from "./builtin-rules.ts";
export { BUNDLED_OPS, getOp, type BundledOp, type OpContext, type OpPreview, type OpApplyResult } from "./bundled-ops.ts";
export { buildRestBridgeEdges, detectFetchCalls, type RouteInfo, type FetchCallInfo } from "./bridge-rest.ts";
export { fnv1a32, bodyFingerprint } from "./body-fingerprint.ts";
export {
  parseDatalog, evaluate as evaluateDatalog, query as queryDatalog,
  populateEdb, type DlProgram, type DlParseError, type EvalResult, type FactDb,
  IncrementalEvaluator, computeEdbDelta, deltaSize, isDeltaEmpty, type EdbDelta,
} from "./datalog/index.ts";
export {
  type OpSignature, type NodeConstraint, type Effect, type ArgSpec,
  type ConstraintContext, type CheckResult, type ConstraintFailure,
  type CompositionCheck,
  checkConstraint, checkAllConstraints, checkComposition, checkSequence,
  registerSignature, getSignature, allSignatures,
} from "./op-signatures.ts";
export {
  type ConstraintPlanStep, type StepValidation, type ArgValidation, type PlanValidation,
  buildConstraintContext, validatePlan, validateSingleOp,
} from "./constraint-solver.ts";
export {
  type ResourceKind, type Resource, type Footprint, type BiAbductionResult,
  type InterferenceResult, type InterferenceConflict,
  computeFootprint, biAbduce, checkInterference, analyzePlanInterference,
} from "./separation-logic.ts";

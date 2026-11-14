// Constraint solver for op plans. Given a graph state and a sequence of ops,
// determines whether the plan is satisfiable:
// 1. Each op's preconditions hold against the current (simulated) graph state
// 2. Each op's postconditions are applied to produce the next state
// 3. Pairwise composition is checked for conflicts
//
// The solver simulates effects symbolically — it doesn't execute the ops,
// it just tracks what kind/edge changes they declare and propagates them
// through the plan.

import type { GraphNode, GraphEdge, MultiRepoGraph } from "./multi-repo.ts";
import {
  type OpSignature, type Effect, type CheckResult, type NodeConstraint,
  type ConstraintContext, type CompositionCheck,
  checkAllConstraints, checkComposition, getSignature,
} from "./op-signatures.ts";

export interface ConstraintPlanStep {
  readonly opId: string;
  readonly nodeId: string;
  readonly args?: Readonly<Record<string, unknown>> | undefined;
}

export interface StepValidation {
  readonly stepIndex: number;
  readonly opId: string;
  readonly nodeId: string;
  readonly preconditionCheck: CheckResult;
  readonly argValidation: ArgValidation;
  readonly compositionCheck?: CompositionCheck | undefined;
}

export interface ArgValidation {
  readonly valid: boolean;
  readonly missing: readonly string[];
  readonly typeErrors: readonly { arg: string; expected: string; got: string }[];
}

export interface PlanValidation {
  readonly valid: boolean;
  readonly steps: readonly StepValidation[];
  readonly summary: string;
}

/**
 * Build a ConstraintContext for a node from the graph.
 */
export function buildConstraintContext(graph: MultiRepoGraph, nodeId: string): ConstraintContext | null {
  let targetNode: GraphNode | null = null;
  const inEdges: GraphEdge[] = [];
  const outEdges: GraphEdge[] = [];

  for (const repo of graph.repos) {
    for (const node of repo.nodes) {
      if (node.id === nodeId) { targetNode = node; break; }
    }
    if (targetNode) {
      for (const edge of repo.edges) {
        if (edge.target === nodeId) inEdges.push(edge);
        if (edge.source === nodeId) outEdges.push(edge);
      }
      break;
    }
  }

  if (!targetNode) return null;
  return { node: targetNode, incomingEdges: inEdges, outgoingEdges: outEdges };
}

function validateArgs(sig: OpSignature, args: Record<string, unknown> | undefined): ArgValidation {
  const missing: string[] = [];
  const typeErrors: { arg: string; expected: string; got: string }[] = [];

  for (const spec of sig.requiredArgs) {
    if (!spec.required) continue;
    const val = args?.[spec.name];
    if (val === undefined || val === null) {
      missing.push(spec.name);
      continue;
    }
    const gotType = typeof val;
    if (gotType !== spec.type) {
      typeErrors.push({ arg: spec.name, expected: spec.type, got: gotType });
    }
  }

  return { valid: missing.length === 0 && typeErrors.length === 0, missing, typeErrors };
}

/**
 * Track symbolic state changes from effects. Does NOT mutate the real graph.
 */
class SymbolicState {
  private kindOverrides = new Map<string, string>();
  private addedEdges = new Map<string, Set<string>>();
  private removedEdges = new Map<string, Set<string>>();
  private removedNodes = new Set<string>();

  applyEffects(nodeId: string, effects: readonly Effect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case "changes_kind":
          this.kindOverrides.set(nodeId, effect.to);
          break;
        case "adds_edge": {
          const key = `${nodeId}:out`;
          if (!this.addedEdges.has(key)) this.addedEdges.set(key, new Set());
          this.addedEdges.get(key)!.add(effect.relation);
          break;
        }
        case "removes_edge": {
          const key = `${nodeId}:out`;
          if (!this.removedEdges.has(key)) this.removedEdges.set(key, new Set());
          this.removedEdges.get(key)!.add(effect.relation);
          break;
        }
        case "removes_node":
          this.removedNodes.add(nodeId);
          break;
      }
    }
  }

  isRemoved(nodeId: string): boolean {
    return this.removedNodes.has(nodeId);
  }

  /**
   * Produce a modified constraint context reflecting symbolic changes.
   */
  adjustContext(ctx: ConstraintContext): ConstraintContext {
    const nodeId = ctx.node.id;
    const kindOverride = this.kindOverrides.get(nodeId);
    const node = kindOverride
      ? { ...ctx.node, kind: kindOverride as GraphNode["kind"] }
      : ctx.node;

    const outKey = `${nodeId}:out`;
    const addedOut = this.addedEdges.get(outKey);
    const removedOut = this.removedEdges.get(outKey);

    let outEdges = [...ctx.outgoingEdges];
    if (removedOut) outEdges = outEdges.filter((e) => !removedOut.has(e.relation));
    if (addedOut) {
      for (const rel of addedOut) {
        if (!outEdges.some((e) => e.relation === rel)) {
          outEdges.push({ id: `sym_${nodeId}_${rel}`, source: nodeId, target: "__symbolic__", relation: rel as GraphEdge["relation"] });
        }
      }
    }

    return { node, incomingEdges: ctx.incomingEdges, outgoingEdges: outEdges };
  }
}

/**
 * Validate a plan (sequence of op steps) against the current graph state.
 */
export function validatePlan(graph: MultiRepoGraph, steps: readonly ConstraintPlanStep[]): PlanValidation {
  const symbolic = new SymbolicState();
  const validations: StepValidation[] = [];
  let allValid = true;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const sig = getSignature(step.opId);

    if (!sig) {
      validations.push({
        stepIndex: i, opId: step.opId, nodeId: step.nodeId,
        preconditionCheck: { satisfied: false, failures: [{ constraint: { kind: "kind_is", value: "__any__" }, reason: `unknown op "${step.opId}"` }] },
        argValidation: { valid: true, missing: [], typeErrors: [] },
      });
      allValid = false;
      continue;
    }

    if (symbolic.isRemoved(step.nodeId)) {
      validations.push({
        stepIndex: i, opId: step.opId, nodeId: step.nodeId,
        preconditionCheck: { satisfied: false, failures: [{ constraint: { kind: "kind_is", value: "__any__" }, reason: `node "${step.nodeId}" was removed by a prior step` }] },
        argValidation: { valid: true, missing: [], typeErrors: [] },
      });
      allValid = false;
      continue;
    }

    const baseCtx = buildConstraintContext(graph, step.nodeId);
    if (!baseCtx) {
      validations.push({
        stepIndex: i, opId: step.opId, nodeId: step.nodeId,
        preconditionCheck: { satisfied: false, failures: [{ constraint: { kind: "kind_is", value: "__any__" }, reason: `node "${step.nodeId}" not found in graph` }] },
        argValidation: { valid: true, missing: [], typeErrors: [] },
      });
      allValid = false;
      continue;
    }

    const ctx = symbolic.adjustContext(baseCtx);
    const preconditionCheck = checkAllConstraints(sig.preconditions, ctx);
    const argValidation = validateArgs(sig, step.args as Record<string, unknown> | undefined);

    let compositionCheck: CompositionCheck | undefined;
    if (i > 0) {
      const prevStep = steps[i - 1]!;
      if (prevStep.nodeId === step.nodeId) {
        const prevSig = getSignature(prevStep.opId);
        if (prevSig) compositionCheck = checkComposition(prevSig, sig);
      }
    }

    const stepValid = preconditionCheck.satisfied && argValidation.valid &&
      (compositionCheck?.compatible ?? true);
    if (!stepValid) allValid = false;

    validations.push({
      stepIndex: i, opId: step.opId, nodeId: step.nodeId,
      preconditionCheck, argValidation, compositionCheck,
    });

    if (preconditionCheck.satisfied) {
      symbolic.applyEffects(step.nodeId, sig.postconditions);
    }
  }

  const failCount = validations.filter((v) =>
    !v.preconditionCheck.satisfied || !v.argValidation.valid ||
    (v.compositionCheck && !v.compositionCheck.compatible),
  ).length;

  const summary = allValid
    ? `Plan valid: ${steps.length} steps, all preconditions satisfied`
    : `Plan invalid: ${failCount}/${steps.length} steps failed validation`;

  return { valid: allValid, steps: validations, summary };
}

/**
 * Validate a single op against a node in the current graph.
 */
export function validateSingleOp(graph: MultiRepoGraph, opId: string, nodeId: string, args?: Record<string, unknown>): StepValidation {
  const result = validatePlan(graph, [{ opId, nodeId, args } satisfies ConstraintPlanStep]);
  return result.steps[0]!;
}

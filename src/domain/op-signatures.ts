// SMT-lite refinement type system for op signatures.
// Encodes pre/post-conditions as constraint sets that can be checked
// without a Z3 dependency. Supports composition checking (can two ops
// be applied in sequence?) and satisfiability validation.

import { NODE_KINDS, EDGE_RELATIONS, type NodeKind, type EdgeRelation } from "./vocabulary.ts";
import type { GraphNode, GraphEdge } from "./multi-repo.ts";

// ── Constraint language ──

export type NodeConstraint =
  | { kind: "kind_is"; value: NodeKind | string }
  | { kind: "kind_not"; value: NodeKind | string }
  | { kind: "has_edge_in"; relation: string }
  | { kind: "has_edge_out"; relation: string }
  | { kind: "no_edge_in"; relation: string }
  | { kind: "no_edge_out"; relation: string }
  | { kind: "has_meta"; key: string }
  | { kind: "in_file_matching"; glob: string }
  | { kind: "name_matches"; pattern: string };

export interface OpSignature {
  readonly opId: string;
  readonly preconditions: readonly NodeConstraint[];
  readonly postconditions: readonly Effect[];
  readonly requiredArgs: readonly ArgSpec[];
}

export interface ArgSpec {
  readonly name: string;
  readonly type: "string" | "number" | "boolean";
  readonly required: boolean;
  readonly description?: string;
}

export type Effect =
  | { kind: "adds_edge"; relation: string }
  | { kind: "removes_edge"; relation: string }
  | { kind: "changes_kind"; from: string; to: string }
  | { kind: "modifies_body" }
  | { kind: "adds_node"; nodeKind: string }
  | { kind: "removes_node" };

// ── Constraint checking ──

export interface ConstraintContext {
  readonly node: GraphNode;
  readonly incomingEdges: readonly GraphEdge[];
  readonly outgoingEdges: readonly GraphEdge[];
}

export interface CheckResult {
  readonly satisfied: boolean;
  readonly failures: readonly ConstraintFailure[];
}

export interface ConstraintFailure {
  readonly constraint: NodeConstraint;
  readonly reason: string;
}

export function checkConstraint(constraint: NodeConstraint, ctx: ConstraintContext): CheckResult {
  switch (constraint.kind) {
    case "kind_is":
      return ctx.node.kind === constraint.value
        ? pass() : fail(constraint, `node kind is "${ctx.node.kind}", expected "${constraint.value}"`);

    case "kind_not":
      return ctx.node.kind !== constraint.value
        ? pass() : fail(constraint, `node kind must not be "${constraint.value}"`);

    case "has_edge_in":
      return ctx.incomingEdges.some((e) => e.relation === constraint.relation)
        ? pass() : fail(constraint, `no incoming "${constraint.relation}" edge found`);

    case "has_edge_out":
      return ctx.outgoingEdges.some((e) => e.relation === constraint.relation)
        ? pass() : fail(constraint, `no outgoing "${constraint.relation}" edge found`);

    case "no_edge_in":
      return !ctx.incomingEdges.some((e) => e.relation === constraint.relation)
        ? pass() : fail(constraint, `unexpected incoming "${constraint.relation}" edge`);

    case "no_edge_out":
      return !ctx.outgoingEdges.some((e) => e.relation === constraint.relation)
        ? pass() : fail(constraint, `unexpected outgoing "${constraint.relation}" edge`);

    case "has_meta": {
      const meta = ctx.node.meta as Record<string, unknown> | undefined;
      return meta && constraint.key in meta
        ? pass() : fail(constraint, `node missing meta key "${constraint.key}"`);
    }

    case "in_file_matching":
      return ctx.node.filePath && globMatch(ctx.node.filePath, constraint.glob)
        ? pass() : fail(constraint, `file path does not match "${constraint.glob}"`);

    case "name_matches": {
      const re = new RegExp(constraint.pattern);
      return re.test(ctx.node.name)
        ? pass() : fail(constraint, `name "${ctx.node.name}" does not match /${constraint.pattern}/`);
    }
  }
}

function pass(): CheckResult { return { satisfied: true, failures: [] }; }
function fail(constraint: NodeConstraint, reason: string): CheckResult {
  return { satisfied: false, failures: [{ constraint, reason }] };
}

function globMatch(path: string, glob: string): boolean {
  // Replace ** before * to avoid corruption. Use a placeholder that
  // cannot appear in a file path or glob.
  const placeholder = "\x00DSTAR\x00";
  const pattern = glob
    .replace(/\*\*/g, placeholder)
    .replace(/\./g, "\\.")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replaceAll(placeholder, ".*");
  return new RegExp(`^${pattern}$`).test(path);
}

export function checkAllConstraints(constraints: readonly NodeConstraint[], ctx: ConstraintContext): CheckResult {
  const failures: ConstraintFailure[] = [];
  for (const c of constraints) {
    const result = checkConstraint(c, ctx);
    if (!result.satisfied) failures.push(...result.failures);
  }
  return { satisfied: failures.length === 0, failures };
}

// ── Signature registry ──

const SIGNATURES: Map<string, OpSignature> = new Map();

export function registerSignature(sig: OpSignature): void {
  SIGNATURES.set(sig.opId, sig);
}

export function getSignature(opId: string): OpSignature | undefined {
  return SIGNATURES.get(opId);
}

export function allSignatures(): readonly OpSignature[] {
  return [...SIGNATURES.values()];
}

// ── Composition checking ──

export interface CompositionCheck {
  readonly compatible: boolean;
  readonly conflicts: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Check whether applying opA then opB on the same node is sound.
 * Conflicts arise when opA's postconditions violate opB's preconditions.
 */
export function checkComposition(sigA: OpSignature, sigB: OpSignature): CompositionCheck {
  const conflicts: string[] = [];
  const warnings: string[] = [];

  for (const post of sigA.postconditions) {
    for (const pre of sigB.preconditions) {
      if (post.kind === "changes_kind" && pre.kind === "kind_is") {
        if (post.to !== pre.value) {
          conflicts.push(`${sigA.opId} changes kind to "${post.to}" but ${sigB.opId} requires kind "${pre.value}"`);
        }
      }

      if (post.kind === "changes_kind" && pre.kind === "kind_not") {
        if (post.to === pre.value) {
          conflicts.push(`${sigA.opId} changes kind to "${post.to}" but ${sigB.opId} forbids kind "${pre.value}"`);
        }
      }

      if (post.kind === "removes_edge" && pre.kind === "has_edge_in" && post.relation === pre.relation) {
        conflicts.push(`${sigA.opId} removes "${post.relation}" edge but ${sigB.opId} requires it as incoming`);
      }
      if (post.kind === "removes_edge" && pre.kind === "has_edge_out" && post.relation === pre.relation) {
        conflicts.push(`${sigA.opId} removes "${post.relation}" edge but ${sigB.opId} requires it as outgoing`);
      }

      if (post.kind === "adds_edge" && pre.kind === "no_edge_in" && post.relation === pre.relation) {
        conflicts.push(`${sigA.opId} adds "${post.relation}" edge but ${sigB.opId} forbids it as incoming`);
      }
      if (post.kind === "adds_edge" && pre.kind === "no_edge_out" && post.relation === pre.relation) {
        conflicts.push(`${sigA.opId} adds "${post.relation}" edge but ${sigB.opId} forbids it as outgoing`);
      }

      if (post.kind === "removes_node") {
        conflicts.push(`${sigA.opId} removes the node, making ${sigB.opId} inapplicable`);
      }
    }
  }

  if (sigA.postconditions.some((p) => p.kind === "modifies_body") &&
      sigB.postconditions.some((p) => p.kind === "modifies_body")) {
    warnings.push(`Both ${sigA.opId} and ${sigB.opId} modify the function body — order matters`);
  }

  return { compatible: conflicts.length === 0, conflicts, warnings };
}

/**
 * Check whether a sequence of ops can be applied to a node.
 * Returns pairwise composition results.
 */
export function checkSequence(opIds: readonly string[]): { valid: boolean; pairResults: { a: string; b: string; result: CompositionCheck }[] } {
  const pairs: { a: string; b: string; result: CompositionCheck }[] = [];
  for (let i = 0; i < opIds.length - 1; i++) {
    const sigA = getSignature(opIds[i]!);
    const sigB = getSignature(opIds[i + 1]!);
    if (!sigA || !sigB) continue;
    const result = checkComposition(sigA, sigB);
    pairs.push({ a: opIds[i]!, b: opIds[i + 1]!, result });
  }
  return { valid: pairs.every((p) => p.result.compatible), pairResults: pairs };
}

// ── Register built-in signatures ──

registerSignature({
  opId: "addMiddleware",
  preconditions: [
    { kind: "kind_is", value: NODE_KINDS.route_handler },
  ],
  postconditions: [
    { kind: "adds_edge", relation: EDGE_RELATIONS.applies_middleware },
  ],
  requiredArgs: [{ name: "name", type: "string", required: false, description: "middleware identifier" }],
});

registerSignature({
  opId: "renameSymbol",
  preconditions: [
    { kind: "kind_not", value: NODE_KINDS.external },
  ],
  postconditions: [
    { kind: "modifies_body" },
  ],
  requiredArgs: [{ name: "newName", type: "string", required: true, description: "new symbol name" }],
});

registerSignature({
  opId: "extractFunction",
  preconditions: [
    { kind: "kind_not", value: NODE_KINDS.external },
    { kind: "kind_not", value: NODE_KINDS.contract },
  ],
  postconditions: [
    { kind: "adds_node", nodeKind: NODE_KINDS.utility },
    { kind: "adds_edge", relation: EDGE_RELATIONS.calls },
    { kind: "modifies_body" },
  ],
  requiredArgs: [
    { name: "functionName", type: "string", required: false, description: "name of extracted function" },
    { name: "startLine", type: "number", required: true, description: "start line of block" },
    { name: "endLine", type: "number", required: true, description: "end line of block" },
  ],
});

registerSignature({
  opId: "extractModule",
  preconditions: [
    { kind: "kind_not", value: NODE_KINDS.external },
    { kind: "kind_not", value: NODE_KINDS.contract },
  ],
  postconditions: [
    { kind: "adds_node", nodeKind: NODE_KINDS.utility },
    { kind: "adds_edge", relation: EDGE_RELATIONS.imports },
    { kind: "modifies_body" },
  ],
  requiredArgs: [{ name: "moduleName", type: "string", required: false, description: "target module name" }],
});

registerSignature({
  opId: "replaceImpl",
  preconditions: [
    { kind: "kind_not", value: NODE_KINDS.external },
    { kind: "kind_not", value: NODE_KINDS.contract },
  ],
  postconditions: [
    { kind: "modifies_body" },
  ],
  requiredArgs: [{ name: "body", type: "string", required: true, description: "new function body" }],
});

registerSignature({
  opId: "addCaching",
  preconditions: [
    { kind: "kind_is", value: NODE_KINDS.service },
  ],
  postconditions: [
    { kind: "modifies_body" },
    { kind: "adds_edge", relation: EDGE_RELATIONS.reads_field },
  ],
  requiredArgs: [
    { name: "cacheName", type: "string", required: false, description: "cache variable name" },
    { name: "ttlMs", type: "number", required: false, description: "cache TTL in milliseconds" },
  ],
});

registerSignature({
  opId: "wrapTransformation",
  preconditions: [
    { kind: "kind_not", value: NODE_KINDS.external },
    { kind: "kind_not", value: NODE_KINDS.contract },
  ],
  postconditions: [
    { kind: "modifies_body" },
  ],
  requiredArgs: [{ name: "wrapperName", type: "string", required: false, description: "wrapper function name" }],
});

registerSignature({
  opId: "addRateLimit",
  preconditions: [
    { kind: "kind_is", value: NODE_KINDS.route_handler },
  ],
  postconditions: [
    { kind: "adds_edge", relation: EDGE_RELATIONS.applies_middleware },
  ],
  requiredArgs: [{ name: "limiterName", type: "string", required: false, description: "rate limiter name" }],
});

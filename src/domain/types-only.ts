// Types-only barrel for frontend consumers:
//   import type { GraphNode, NodeKind } from '@schema-ai/mcp/types'
// No runtime functions that depend on node:crypto / node:fs / node:path.

export { NODE_KINDS, EDGE_RELATIONS, type NodeKind, type EdgeRelation } from "./vocabulary.ts";
export { CURRENT_WIRE_VERSION, type WireFormatVersion } from "./wire-format.ts";

export type {
  GraphNode, GraphEdge, InterRepoEdge, Cluster,
  RepoSubgraph, MultiRepoGraph, VocabularyExtensions,
} from "./multi-repo.ts";

export type { GraphPatch } from "./patch.ts";
export type { GraphDelta } from "./delta.ts";

export type { Rule, Violation, Insight } from "./types.ts";

export type { BundledOp, OpContext, OpPreview, OpApplyResult } from "./bundled-ops.ts";

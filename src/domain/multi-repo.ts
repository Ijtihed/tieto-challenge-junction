// Per architecture/schema-v3.md §4.2 — the canonical graph container
import type { EdgeRelation, NodeKind } from "./vocabulary.ts";
import type { WireFormatVersion } from "./wire-format.ts";

export interface VocabularyExtensions {
  readonly nodeKinds?: readonly string[];
  readonly edgeRelations?: readonly string[];
}

export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind | (string & {});
  readonly name: string;
  readonly locator: string;
  readonly filePath?: string | undefined;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
  readonly bodyFingerprint?: number | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: EdgeRelation | (string & {});
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

export interface InterRepoEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly sourceRepoUri: string;
  readonly targetRepoUri: string;
  readonly relation: EdgeRelation | (string & {});
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Per `architecture/v1-launch-plan.md` Step 7 + research/24
 *  §7.5: the 7-tier label pipeline. The plan supersedes
 *  research/24 where they disagree (per the founder's
 *  instruction; see Step 7 receipts). The canonical 7-member
 *  union is single-source-of-truth per §0.6.2. */
export type ClusterLabelTier =
  | "framework"             // 1. Detected framework name (`Express Router`)
  | "folder-archetype"      // 2. Folder name w/ archetype-aware capitalization
  | "dominant-symbol"       // 3. Dominant file/symbol name (`UserService cluster`)
  | "package-readme"        // 4. Domain inference (`package.json` keywords + README)
  | "common-substring"      // 5. Anquetil-Lethbridge common-substring extraction
  | "llm-byok"              // 6. LLM tier (BYOK only — augments deterministic tiers)
  | "coordinate-fallback";  // 7. `Area at (x,y)` — replaces banned `Module N`/`Other`

export const CLUSTER_LABEL_TIERS: readonly ClusterLabelTier[] = [
  "framework",
  "folder-archetype",
  "dominant-symbol",
  "package-readme",
  "common-substring",
  "llm-byok",
  "coordinate-fallback",
] as const;

/** Step 7b: canonical shape classification for clusters.
 *  Drives Studio layout selection (Service → top-down fan-out;
 *  Domain → centred sink; Library → balanced grid; Mixed →
 *  generic force-directed). Single-source per §0.6.2. */
export type CanonicalShape = "service" | "domain" | "library" | "mixed";

export const CANONICAL_SHAPES: readonly CanonicalShape[] = [
  "service", "domain", "library", "mixed",
] as const;

export interface Cluster {
  readonly id: string;
  readonly name: string;
  readonly nodeIds: readonly string[];
  /** Step 7: per-cluster PageRank importance scores. Maps node
   *  id → score in [0, 1]. Empty until Step 7's PageRank stage
   *  runs (legacy clusters from pre-Step-7 snapshots have no
   *  importance map). */
  readonly importance?: Readonly<Record<string, number>>;
  /** Step 7: top-K node ids by importance, sorted descending.
   *  Step 7a populates this; Step 7b's `graph.entry_points`
   *  consumes it for the `★` hints. Empty until PageRank runs. */
  readonly entryPointIds?: readonly string[];
  /** Step 7: which of the 7 label tiers produced `name`. Used
   *  by tests to assert the `Module N` / `Other` patterns never
   *  reach the user-facing copy (anything from these would have
   *  been tier `coordinate-fallback` with a structured `Area at
   *  (x,y)` instead). Legacy clusters omit this field. */
  readonly labelTier?: ClusterLabelTier;
  /** Step 7b: canonical shape classification. Drives Studio
   *  layout selection. Populated by `detectCanonicalShape` in
   *  `canonical-shape.ts`. Legacy/small clusters omit this. */
  readonly canonicalShape?: CanonicalShape;
  /** Step 7b: hierarchical children (HERCULES recursive
   *  clustering). When `recursive: true` is passed to
   *  `buildClusters`, each cluster may have sub-clusters at
   *  the next depth level. Absent on leaf clusters or when
   *  recursive mode is off. */
  readonly children?: readonly Cluster[];
  /** Step 7b: parent cluster id for sub-clusters. Only set
   *  on depth > 0 clusters in recursive mode. */
  readonly parentId?: string;
  /** Step 7b: depth in the recursive hierarchy (0 = top). */
  readonly depth?: number;
}

export interface RepoSubgraph {
  readonly uri: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly clusters: readonly Cluster[];
}

export interface MultiRepoGraph {
  readonly version: WireFormatVersion;
  readonly repos: readonly RepoSubgraph[];
  readonly interRepoEdges: readonly InterRepoEdge[];
  readonly vocabularyExtensions?: VocabularyExtensions;
}

export function createEmptyGraph(version: WireFormatVersion): MultiRepoGraph {
  return { version, repos: [], interRepoEdges: [] };
}

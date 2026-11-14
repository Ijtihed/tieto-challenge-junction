import type { FsAdapter } from "../adapters/index.ts";
import type { RepoSubgraph } from "../domain/multi-repo.ts";
import type { StatsSink } from "./parser-config.ts";

export type { ExtractorStats, ExtractionStats, ParseFailure, ParseSkipReason } from "../domain/extraction-stats.ts";

export interface ExtractorCapability {
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  readonly introducesNodeKinds: readonly string[];
  readonly introducesEdgeRelations: readonly string[];
  readonly needsAdapters: readonly ("fs")[];
}

export interface ExtractContext {
  readonly repoUri: string;
  readonly fs: FsAdapter;
  readonly signal?: AbortSignal;
  readonly changedFiles?: ReadonlySet<string>;
  /** Optional mutable stats sink. When provided, each extractor records
   *  per-file outcomes (attempted, parsed, skipped, failed) so the
   *  workspace.open layer can surface a single aggregate banner.
   *  Optional so existing tests can ignore the stats path. */
  readonly stats?: StatsSink;
}

export interface ExtractEvent {
  readonly kind: "progress" | "done" | "error";
  readonly data?: RepoSubgraph;
  readonly message?: string;
}

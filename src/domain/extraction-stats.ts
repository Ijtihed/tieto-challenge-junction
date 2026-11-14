// Per `architecture/v1-launch-plan.md` Step 1 + Step 4: a single
// workspace.open pass touches every source file across every bundled
// extractor. When a file is dropped — too large, generated, gitignored,
// unparseable — the failure needs to surface as part of the response,
// not just as a stderr line that no one reads.
//
// These types live in `domain/` rather than `extractors/` so the
// session layer (which is not allowed to import from `extractors/` per
// the import DAG) can carry the latest extraction summary.
//
// Per §0.6.2 — single source of truth for the `FilterReason` and
// `ParseSkipReason` unions. Studio re-uses these via the wire types
// in `clients/studio/src/lib/api.ts`.

export type ParseSkipReason =
  | "too-large"
  | "generated"
  | "parse-failed"
  | "read-failed";

/** Why a file was filtered BEFORE the extractor saw it. Used by
 *  Step 4's `caching.stats.filesFiltered` breakdown. */
export type FilterReason =
  | "gitignore"
  | "always"
  | "filename-pattern"
  | "generated-directory"
  | "header-comment"
  | "codegen-toolchain"
  | "binary-blob";

export const FILTER_REASONS: readonly FilterReason[] = [
  "gitignore",
  "always",
  "filename-pattern",
  "generated-directory",
  "header-comment",
  "codegen-toolchain",
  "binary-blob",
];

export interface ParseFailure {
  readonly filePath: string;
  readonly reason: ParseSkipReason;
  readonly extractorId: string;
  readonly detail?: string;
}

/** A file filtered before extraction (gitignored, generated, binary).
 *  Distinct from `ParseFailure` because the extractor never tried to
 *  parse it — surfacing this lets the Studio banner say "12 vendored
 *  + 5 generated + 2 binary skipped" instead of conflating everything
 *  under "failed." */
export interface FilteredFile {
  readonly filePath: string;
  readonly reason: FilterReason;
  readonly extractorId: string;
  readonly detail?: string;
}

/** Per-reason filter breakdown surfaced on the workspace.open
 *  response. Keys mirror `FilterReason` exactly. */
export type FilterCounts = Record<FilterReason, number>;

export function emptyFilterCounts(): FilterCounts {
  return {
    gitignore: 0,
    always: 0,
    "filename-pattern": 0,
    "generated-directory": 0,
    "header-comment": 0,
    "codegen-toolchain": 0,
    "binary-blob": 0,
  };
}

/** Per-extractor outcome for a single workspace.open pass. */
export interface ExtractorStats {
  readonly extractorId: string;
  readonly filesAttempted: number;
  readonly filesParsed: number;
  readonly filesSkipped: number;
  readonly failures: readonly ParseFailure[];
  /** Step 4: per-reason filter breakdown for this extractor. */
  readonly filtered: FilterCounts;
}

/** Aggregated extraction summary across all bundled extractors. */
export interface ExtractionStats {
  readonly filesAttempted: number;
  readonly filesParsed: number;
  readonly filesSkipped: number;
  readonly failures: readonly ParseFailure[];
  readonly perExtractor: readonly ExtractorStats[];
  /** Step 4: workspace-wide filter breakdown — sum across all
   *  extractors. */
  readonly filtered: FilterCounts;
  /** Step 4: filtered-file detail (capped at the same limit as
   *  failures so the wire payload stays small on huge repos). */
  readonly filteredSample: readonly FilteredFile[];
}

export function emptyExtractionStats(): ExtractionStats {
  return {
    filesAttempted: 0,
    filesParsed: 0,
    filesSkipped: 0,
    failures: [],
    perExtractor: [],
    filtered: emptyFilterCounts(),
    filteredSample: [],
  };
}

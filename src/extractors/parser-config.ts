// Shared parser configuration for all tree-sitter-backed extractors.
//
// Per `architecture/v1-launch-plan.md` Step 1 + Q10 (64 MB buffer).
// The default tree-sitter buffer is 32 KB, which silently fails with
// "Invalid argument" on any source file larger than that. Real-repo
// files routinely exceed 32 KB (the average TS bundle, a generated
// Python migration, a vendored Go file). Without this fix, the
// extractor drops them with a stderr warning and the graph ships
// silently incomplete — the bug the launch plan calls out.
//
// 64 MB is well above any sane single source file. Files larger than
// MAX_PARSE_BYTES are skipped via the pre-check below (avoids
// pathological cases like committed binaries or generated 50-MB
// JSON dumps that would explode tree-sitter's memory).

import type Parser from "tree-sitter";
import { logger } from "../obs/index.ts";
import { isGeneratedFile } from "./generated-detect.ts";
import type { FsAdapter } from "../adapters/index.ts";
import type {
  ParseFailure,
  ParseSkipReason,
  FilterReason,
  FilteredFile,
  FilterCounts,
} from "../domain/extraction-stats.ts";
import { emptyFilterCounts } from "../domain/extraction-stats.ts";

export const PARSER_BUFFER_SIZE = 64 * 1024 * 1024;

export const MAX_PARSE_BYTES = 5 * 1024 * 1024;

export const PARSER_OPTIONS: Parser.Options = {
  bufferSize: PARSER_BUFFER_SIZE,
};

export type { ParseFailure, ParseSkipReason, FilterReason, FilteredFile };

export function shouldSkipForSize(byteLength: number): boolean {
  return byteLength > MAX_PARSE_BYTES;
}

/** Mutable stats sink shared across all 7 extractors during a single
 *  workspace.open pass. Each extractor records `attempted` once per
 *  candidate file, then exactly one of `parsed` / `skipped` / failure.
 *  Plain mutable POJO so each extractor can pass it without ceremony;
 *  the workspace-open layer is responsible for not exposing the sink
 *  itself, only the immutable per-extractor summary derived from it.
 *
 *  Step 4: extended with `filtered` (per-reason counts) +
 *  `filteredSample` (first N filtered-file detail entries) so the
 *  `caching.stats` action can return the breakdown. */
export interface StatsSink {
  attempted: number;
  parsed: number;
  skipped: number;
  failures: ParseFailure[];
  filtered: FilterCounts;
  filteredSample: FilteredFile[];
}

/** Per-sink cap on the filteredSample array. Mirrors the existing
 *  50-failure cap so the wire payload stays small on huge repos. */
const FILTERED_SAMPLE_CAP = 50;

export function createStatsSink(): StatsSink {
  return {
    attempted: 0,
    parsed: 0,
    skipped: 0,
    failures: [],
    filtered: emptyFilterCounts(),
    filteredSample: [],
  };
}

export function recordAttempted(sink: StatsSink): void {
  sink.attempted += 1;
}

export function recordParsed(sink: StatsSink): void {
  sink.parsed += 1;
}

export function recordSkipped(sink: StatsSink): void {
  sink.skipped += 1;
}

export function recordFailure(
  sink: StatsSink,
  failure: ParseFailure,
): void {
  sink.failures.push(failure);
}

/** Step 4: record a filter decision (gitignored, generated,
 *  binary, etc.). Increments the per-reason counter and adds the
 *  detail to `filteredSample` (capped at FILTERED_SAMPLE_CAP). */
export function recordFiltered(
  sink: StatsSink,
  filtered: FilteredFile,
): void {
  sink.filtered[filtered.reason] = (sink.filtered[filtered.reason] ?? 0) + 1;
  if (sink.filteredSample.length < FILTERED_SAMPLE_CAP) {
    sink.filteredSample.push(filtered);
  }
}

export type ReadOutcome =
  | { ok: true; content: string }
  | { ok: false; reason: ParseSkipReason };

/** Read a file and run the universal pre-checks. Each extractor wraps
 *  this so every reason a file is skipped — too large, generated,
 *  unreadable — flows through the same stats sink and the same warning
 *  log. On success returns `{ ok: true, content }`; on skip/error the
 *  failure is already recorded and logged. */
export async function readForParse(
  fs: FsAdapter,
  filePath: string,
  extractorId: string,
  sink: StatsSink | undefined,
): Promise<ReadOutcome> {
  if (sink) recordAttempted(sink);

  let content: string;
  try {
    content = await fs.readFile(filePath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(extractorId, `read failed for ${filePath}`, { error: detail });
    if (sink) {
      recordFailure(sink, { filePath, reason: "read-failed", extractorId, detail });
    }
    return { ok: false, reason: "read-failed" };
  }

  if (shouldSkipForSize(content.length)) {
    const detail = `${(content.length / (1024 * 1024)).toFixed(2)} MB > ${(MAX_PARSE_BYTES / (1024 * 1024)).toFixed(0)} MB`;
    logger.warn(extractorId, `skipping oversized file ${filePath}`, { size: detail });
    if (sink) {
      recordSkipped(sink);
      recordFailure(sink, { filePath, reason: "too-large", extractorId, detail });
    }
    return { ok: false, reason: "too-large" };
  }

  const gen = isGeneratedFile(filePath, content.slice(0, 500));
  if (gen.isGenerated) {
    if (sink) {
      recordSkipped(sink);
      // Step 4: classify into the precise reason (filename-pattern,
      // codegen-toolchain, header-comment, binary-blob,
      // generated-directory). The catch-all "generated" bucket from
      // Step 1 is preserved as a fallback when no specific reason
      // is reported.
      const reason: FilterReason = (gen.reason ?? "filename-pattern") as FilterReason;
      recordFiltered(sink, {
        filePath,
        reason,
        extractorId,
        ...(gen.detail !== undefined ? { detail: gen.detail } : {}),
      });
    }
    return { ok: false, reason: "generated" };
  }

  return { ok: true, content };
}

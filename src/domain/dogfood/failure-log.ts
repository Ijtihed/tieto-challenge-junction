// Per `architecture/v1-launch-plan.md` Step 11a-3.
//
// Failure-log template + classifier.
//
// The Step 11 plan calls for a structured failure log so the
// founder can distinguish "this is broken" (blocks the PMF
// gate) from "v1.1 wishlist" (allowed). Per the plan's pass
// criterion:
//   "Failure log contains only 'v1.1 wishlist' items, not
//    'this is broken' items."
//
// **Three categories** (pinned as canonical set, §0.6.2):
//   - `blocking` — bug that stops daily-driver use. Examples:
//     crashes, data loss, MCP server down. The gate fails
//     until every `blocking` is closed.
//   - `wishlist` — feature absent or rough but not blocking.
//     Examples: "I wish drift.generate showed sparkline".
//     Allowed at the gate; deferred to v1.1.
//   - `known` — already-tracked-elsewhere item (links to a
//     GitHub issue, an existing test in the plan, etc.).
//     Allowed at the gate; not double-counted.
//
// **Pure domain.** No IO. The CLI wraps this for read/write
// from `~/dogfood-failure-log.md`.

export type FailureSeverity = "blocking" | "wishlist" | "known";

export const FAILURE_SEVERITIES: readonly FailureSeverity[] = [
  "blocking",
  "wishlist",
  "known",
];

export interface FailureEntry {
  readonly id: string;
  readonly severity: FailureSeverity;
  readonly title: string;
  readonly description: string;
  /** ISO timestamp when first logged. */
  readonly recordedAt: string;
  /** Optional repro steps (markdown). */
  readonly repro?: string;
  /** Optional link to a tracking issue. */
  readonly link?: string;
}

export interface FailureLog {
  readonly cycle: number;
  readonly entries: readonly FailureEntry[];
}

export interface FailureLogStats {
  readonly total: number;
  readonly blocking: number;
  readonly wishlist: number;
  readonly known: number;
  readonly meetsGate: boolean;
  readonly gateExplanation: string;
}

/** Compute the gate stats from a failure log. The Step 11
 *  plan's pass criterion: zero `blocking` entries. */
export function failureLogStats(log: FailureLog): FailureLogStats {
  const counts: Record<FailureSeverity, number> = {
    blocking: 0,
    wishlist: 0,
    known: 0,
  };
  for (const e of log.entries) counts[e.severity]++;
  const total = log.entries.length;
  const meetsGate = counts.blocking === 0;
  const gateExplanation = meetsGate
    ? `Failure-log gate PASS: 0 blocking entries (${counts.wishlist} wishlist, ${counts.known} known).`
    : `Failure-log gate FAIL: ${counts.blocking} blocking entr${counts.blocking === 1 ? "y" : "ies"} must be closed before Step 11 passes.`;
  return {
    total,
    blocking: counts.blocking,
    wishlist: counts.wishlist,
    known: counts.known,
    meetsGate,
    gateExplanation,
  };
}

/** Render the failure log as a markdown document with the
 *  3 sections in canonical order: blocking → wishlist →
 *  known. Pure. */
export function renderFailureLog(log: FailureLog): string {
  const lines: string[] = [];
  lines.push(`# Dogfood failure log — cycle ${log.cycle}`);
  lines.push("");
  const stats = failureLogStats(log);
  lines.push(`> ${stats.gateExplanation}`);
  lines.push("");

  for (const severity of FAILURE_SEVERITIES) {
    const items = log.entries.filter((e) => e.severity === severity);
    lines.push(`## ${humanSeverity(severity)} (${items.length})`);
    lines.push("");
    if (items.length === 0) {
      lines.push(`_${emptySectionPlaceholder(severity)}_`);
      lines.push("");
      continue;
    }
    for (const e of items) {
      lines.push(`### ${e.title}`);
      lines.push("");
      lines.push(`- **ID:** \`${e.id}\``);
      lines.push(`- **Recorded:** ${e.recordedAt}`);
      if (e.link) lines.push(`- **Tracking:** ${e.link}`);
      lines.push("");
      lines.push(e.description);
      lines.push("");
      if (e.repro) {
        lines.push("**Repro:**");
        lines.push("");
        lines.push(e.repro);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function humanSeverity(s: FailureSeverity): string {
  if (s === "blocking") return "Blocking";
  if (s === "wishlist") return "Wishlist (v1.1+)";
  return "Known (tracked elsewhere)";
}

function emptySectionPlaceholder(s: FailureSeverity): string {
  if (s === "blocking") {
    return "No blocking issues yet — keep this section empty to pass the Step 11 gate.";
  }
  if (s === "wishlist") {
    return "No wishlist items yet — anything that's nice-to-have but not blocking goes here.";
  }
  return "No items tracked elsewhere yet.";
}

/** Build an empty failure-log template for a new dogfood
 *  cycle. Used by the CLI when the file doesn't exist yet. */
export function emptyFailureLog(cycle: number = 1): FailureLog {
  return { cycle, entries: [] };
}

/** Render the empty template — the file the founder gets when
 *  starting a fresh dogfood cycle. The template includes a
 *  pre-filled example wishlist entry so the structure is
 *  immediately legible. */
export function renderEmptyTemplate(cycle: number = 1): string {
  return renderFailureLog({
    cycle,
    entries: [
      {
        id: "example",
        severity: "wishlist",
        title: "Example wishlist entry — delete or replace",
        description:
          "Replace this with the first real item you encounter. " +
          "If something blocks daily-driver use, set severity to `blocking`. " +
          "Otherwise `wishlist` (deferred to v1.1) or `known` (already tracked).",
        recordedAt: new Date().toISOString(),
      },
    ],
  });
}

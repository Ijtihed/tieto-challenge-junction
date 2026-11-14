// Per `architecture/v1-launch-plan.md` Step 11a-1.
//
// Usage aggregator: reads `~/.schema/events.jsonl` (the
// append-only event log written by `src/obs/event-log.ts`)
// and produces a structured summary the founder reads to
// decide whether the Step 11 PMF gate is met.
//
// **Pure domain module.** No IO. Caller reads the JSONL file
// + supplies the parsed events. This module aggregates +
// returns a `UsageSummary`. The CLI surface
// (`src/cli/index.ts dogfood:summary`) does the IO.
//
// The Step 11 plan's pass criterion:
//   - "≥ 50 events over 14 days"
//   - "≥ 5 distinct event kinds"
//   - Sean Ellis "V" (very disappointed if no longer able to
//     use Schema) — measured separately by the survey tool
//
// This module computes both gate conditions + a per-day, per-
// kind breakdown so the founder can spot trends.

import type { SchemaEvent } from "../../obs/event-log.ts";

/** Per-day usage rollup. `dayUTC` is YYYY-MM-DD. */
export interface DailyUsage {
  readonly dayUTC: string;
  readonly eventCount: number;
  readonly distinctKinds: number;
  readonly kindCounts: ReadonlyMap<string, number>;
}

/** Top-level summary returned by `aggregateUsage`. */
export interface UsageSummary {
  readonly totalEvents: number;
  readonly distinctKinds: number;
  readonly distinctSessions: number;
  readonly distinctDays: number;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
  /** Per-day breakdown in ascending date order. */
  readonly perDay: readonly DailyUsage[];
  /** Per-kind totals across the window. */
  readonly perKind: ReadonlyMap<string, number>;
  /** Whether the Step 11 plan's hard gate conditions are met
   *  (≥ 50 events + ≥ 5 distinct kinds over the window). */
  readonly meetsUsageGate: boolean;
  /** Plain-English explanation of the gate result for the
   *  CLI summary output. */
  readonly gateExplanation: string;
}

/** Hard gate thresholds per the Step 11 plan. Exported as a
 *  canonical set per §0.6.2 so a future agent who changes
 *  them gets a test signal. */
export const STEP_11_USAGE_GATE = {
  /** Minimum total events over the window. */
  minTotalEvents: 50,
  /** Minimum distinct event kinds over the window. */
  minDistinctKinds: 5,
  /** Window in days. The Step 11 plan calls for 14. */
  windowDays: 14,
} as const;

/** Pure aggregator. Caller passes events (already parsed
 *  from the JSONL); we compute the summary. */
export function aggregateUsage(events: readonly SchemaEvent[]): UsageSummary {
  if (events.length === 0) {
    return {
      totalEvents: 0,
      distinctKinds: 0,
      distinctSessions: 0,
      distinctDays: 0,
      firstEventAt: null,
      lastEventAt: null,
      perDay: [],
      perKind: new Map(),
      meetsUsageGate: false,
      gateExplanation: emptyGateExplanation(),
    };
  }

  // Sort ascending by timestamp so first / last computations
  // are deterministic regardless of input order. Use a copy
  // so we don't mutate the caller's array.
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));

  const perKind = new Map<string, number>();
  const sessions = new Set<string>();
  const perDayBuckets = new Map<string, { count: number; kinds: Map<string, number> }>();

  for (const event of sorted) {
    perKind.set(event.kind, (perKind.get(event.kind) ?? 0) + 1);
    sessions.add(event.sid);
    const dayUTC = event.ts.slice(0, 10); // YYYY-MM-DD
    let bucket = perDayBuckets.get(dayUTC);
    if (!bucket) {
      bucket = { count: 0, kinds: new Map() };
      perDayBuckets.set(dayUTC, bucket);
    }
    bucket.count += 1;
    bucket.kinds.set(event.kind, (bucket.kinds.get(event.kind) ?? 0) + 1);
  }

  const perDay: DailyUsage[] = [...perDayBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayUTC, b]) => ({
      dayUTC,
      eventCount: b.count,
      distinctKinds: b.kinds.size,
      kindCounts: b.kinds,
    }));

  const totalEvents = sorted.length;
  const distinctKinds = perKind.size;
  const distinctDays = perDay.length;
  const firstEventAt = sorted[0]!.ts;
  const lastEventAt = sorted[sorted.length - 1]!.ts;

  const meetsTotal = totalEvents >= STEP_11_USAGE_GATE.minTotalEvents;
  const meetsKinds = distinctKinds >= STEP_11_USAGE_GATE.minDistinctKinds;
  const meetsUsageGate = meetsTotal && meetsKinds;

  return {
    totalEvents,
    distinctKinds,
    distinctSessions: sessions.size,
    distinctDays,
    firstEventAt,
    lastEventAt,
    perDay,
    perKind,
    meetsUsageGate,
    gateExplanation: explainUsageGate(totalEvents, distinctKinds),
  };
}

function explainUsageGate(totalEvents: number, distinctKinds: number): string {
  const totalOk = totalEvents >= STEP_11_USAGE_GATE.minTotalEvents;
  const kindsOk = distinctKinds >= STEP_11_USAGE_GATE.minDistinctKinds;
  if (totalOk && kindsOk) {
    return (
      `Usage gate PASS: ${totalEvents} events (≥ ${STEP_11_USAGE_GATE.minTotalEvents}) ` +
      `across ${distinctKinds} distinct event kinds (≥ ${STEP_11_USAGE_GATE.minDistinctKinds}).`
    );
  }
  const reasons: string[] = [];
  if (!totalOk) {
    reasons.push(
      `total events ${totalEvents} < required ${STEP_11_USAGE_GATE.minTotalEvents}`,
    );
  }
  if (!kindsOk) {
    reasons.push(
      `distinct kinds ${distinctKinds} < required ${STEP_11_USAGE_GATE.minDistinctKinds}`,
    );
  }
  return `Usage gate FAIL: ${reasons.join("; ")}.`;
}

function emptyGateExplanation(): string {
  return (
    `Usage gate FAIL: 0 events logged. ` +
    `Open Schema + use it for ≥ ${STEP_11_USAGE_GATE.windowDays} days.`
  );
}

/** Render the summary as plain-text markdown suitable for
 *  the CLI or for committing to a daily journal. Pure. */
export function renderUsageMarkdown(summary: UsageSummary): string {
  const lines: string[] = [];
  lines.push("# Schema dogfood usage summary");
  lines.push("");
  lines.push(`> ${summary.gateExplanation}`);
  lines.push("");
  if (summary.totalEvents === 0) {
    lines.push("_No events recorded yet._");
    lines.push("");
    lines.push(
      `Open Schema (\`cd clients/studio && npm run dev\`) + start using it. ` +
        `Events are written to \`~/.schema/events.jsonl\` automatically.`,
    );
    return lines.join("\n");
  }

  lines.push("## At a glance");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Total events | ${summary.totalEvents} |`);
  lines.push(`| Distinct event kinds | ${summary.distinctKinds} |`);
  lines.push(`| Distinct sessions | ${summary.distinctSessions} |`);
  lines.push(`| Distinct days | ${summary.distinctDays} |`);
  lines.push(`| First event | \`${summary.firstEventAt ?? "—"}\` |`);
  lines.push(`| Last event  | \`${summary.lastEventAt ?? "—"}\` |`);
  lines.push("");

  // Per-kind breakdown sorted by count desc (most-used first).
  // §0.6.4 (g) sort-order rule: production users read top-down,
  // so the heaviest-used kind must rank first.
  lines.push("## Per event kind");
  lines.push("");
  lines.push(`| Kind | Count |`);
  lines.push(`|---|---:|`);
  const kindsSorted = [...summary.perKind.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [kind, count] of kindsSorted) {
    lines.push(`| \`${kind}\` | ${count} |`);
  }
  lines.push("");

  // Per-day breakdown ascending (calendar order).
  lines.push("## Per day");
  lines.push("");
  lines.push(`| Day (UTC) | Events | Distinct kinds |`);
  lines.push(`|---|---:|---:|`);
  for (const day of summary.perDay) {
    lines.push(`| ${day.dayUTC} | ${day.eventCount} | ${day.distinctKinds} |`);
  }

  return lines.join("\n");
}

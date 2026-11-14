// Per `architecture/v1-launch-plan.md` Step 11a-5.
//
// CLI surfaces for the Step 11 dogfood kit.
//
// Three commands (invoked via `npx schema dogfood:<cmd>`):
//
//   - `dogfood:summary`   Read ~/.schema/events.jsonl + print the
//                         usage summary. Hard gate: ≥ 50 events +
//                         ≥ 5 distinct kinds.
//   - `dogfood:survey`    Record a Sean Ellis answer (V/S/N) +
//                         persist to ~/.schema/sean-ellis.jsonl.
//   - `dogfood:smoke`     Run the pre-flight smoke harness on a
//                         given repo. Reports per-step latency +
//                         pass/fail.
//
// Each command is a thin shell over the pure domain modules
// in `src/domain/dogfood/`. The DOMAIN modules are unit-
// testable; the CLI commands are smoke-tested against
// Schema's own repo as part of the Step 11a verification.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import {
  aggregateUsage,
  renderUsageMarkdown,
} from "../domain/dogfood/usage-aggregator.ts";
import {
  recordSurveyResponse,
  serializeResponse,
  parseResponse,
  SEAN_ELLIS_ANSWERS,
  SEAN_ELLIS_QUESTION,
  type SeanEllisAnswer,
} from "../domain/dogfood/sean-ellis.ts";
import {
  runSmoke,
  renderSmokeMarkdown,
  SMOKE_STEPS,
  type SmokeStepName,
  type ActionHandler,
} from "../domain/dogfood/smoke-harness.ts";
import {
  emptyFailureLog,
  renderEmptyTemplate,
  renderFailureLog,
  failureLogStats,
} from "../domain/dogfood/failure-log.ts";
import type { SchemaEvent } from "../obs/event-log.ts";

export const DEFAULT_EVENT_LOG_PATH = join(homedir(), ".schema", "events.jsonl");
export const DEFAULT_SURVEY_PATH = join(homedir(), ".schema", "sean-ellis.jsonl");
export const DEFAULT_FAILURE_LOG_PATH = join(homedir(), "dogfood-failure-log.md");

/** Parse the event-log JSONL file. Malformed lines are
 *  silently dropped (per the event-log contract). Returns an
 *  empty array if the file doesn't exist. */
export async function readEventLog(path: string = DEFAULT_EVENT_LOG_PATH): Promise<SchemaEvent[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf-8");
  const events: SchemaEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as SchemaEvent;
      if (obj && typeof obj === "object" && typeof (obj as { kind?: unknown }).kind === "string") {
        events.push(obj);
      }
    } catch {
      // skip malformed
    }
  }
  return events;
}

/** Run `dogfood:summary`. Returns the markdown for the caller
 *  to print + the exit code (0 = gate pass, 1 = fail). */
export async function dogfoodSummary(
  eventLogPath: string = DEFAULT_EVENT_LOG_PATH,
): Promise<{ markdown: string; exitCode: 0 | 1; meetsGate: boolean }> {
  const events = await readEventLog(eventLogPath);
  const summary = aggregateUsage(events);
  return {
    markdown: renderUsageMarkdown(summary),
    exitCode: summary.meetsUsageGate ? 0 : 1,
    meetsGate: summary.meetsUsageGate,
  };
}

/** Record a Sean Ellis survey response. Appends to the JSONL
 *  file at `surveyPath` (default `~/.schema/sean-ellis.jsonl`).
 *  Returns the decision line + exit code. */
export async function dogfoodSurvey(
  answer: string,
  options: {
    note?: string;
    cycle?: number;
    surveyPath?: string;
    ts?: string;
  } = {},
): Promise<{ markdown: string; exitCode: 0 | 1; decision: string }> {
  const path = options.surveyPath ?? DEFAULT_SURVEY_PATH;
  const normalized = answer.toUpperCase().trim().charAt(0) as SeanEllisAnswer;
  if (!SEAN_ELLIS_ANSWERS.includes(normalized)) {
    return {
      markdown: `invalid answer ${answer}; expected V / S / N`,
      exitCode: 1,
      decision: `INVALID: ${answer}`,
    };
  }
  const recordOpts: { note?: string; cycle?: number; ts?: string } = {};
  if (options.note !== undefined) recordOpts.note = options.note;
  if (options.cycle !== undefined) recordOpts.cycle = options.cycle;
  if (options.ts !== undefined) recordOpts.ts = options.ts;
  const result = recordSurveyResponse(normalized, recordOpts);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    serializeResponse(result.response) + "\n",
    { flag: "a", encoding: "utf-8" },
  );
  const md = renderSurveyDecisionMarkdown(result.decision, result.response);
  return {
    markdown: md,
    exitCode: result.classification === "pmf-pass" ? 0 : 1,
    decision: result.decision,
  };
}

function renderSurveyDecisionMarkdown(decision: string, response: { ts: string; answer: string; cycle: number; note?: string }): string {
  const lines = [
    `# Sean Ellis survey response`,
    "",
    `> **Question:** ${SEAN_ELLIS_QUESTION}`,
    "",
    `> ${decision}`,
    "",
    `- **Answer:** \`${response.answer}\``,
    `- **Recorded:** ${response.ts}`,
    `- **Cycle:** ${response.cycle}`,
  ];
  if (response.note) {
    lines.push("", `**Note:**`, "", response.note);
  }
  return lines.join("\n");
}

/** Read all recorded survey responses (most recent answer
 *  wins). Returns null if no surveys recorded yet. */
export async function readLatestSurvey(
  surveyPath: string = DEFAULT_SURVEY_PATH,
): Promise<{ ts: string; answer: SeanEllisAnswer; cycle: number; note?: string } | null> {
  if (!existsSync(surveyPath)) return null;
  const raw = await readFile(surveyPath, "utf-8");
  let latest: ReturnType<typeof parseResponse> = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const r = parseResponse(line);
    if (r && (!latest || r.ts > latest.ts)) latest = r;
  }
  return latest;
}

/** Run `dogfood:smoke` against a workspace path. */
export async function dogfoodSmoke(
  workspaceUri: string,
  actions: Record<SmokeStepName, ActionHandler>,
): Promise<{ markdown: string; exitCode: 0 | 1; meetsGate: boolean }> {
  const report = await runSmoke({ workspaceUri, actions });
  return {
    markdown: renderSmokeMarkdown(report),
    exitCode: report.meetsGate ? 0 : 1,
    meetsGate: report.meetsGate,
  };
}

/** Write a fresh failure-log template if none exists. */
export async function dogfoodInitFailureLog(
  path: string = DEFAULT_FAILURE_LOG_PATH,
  cycle: number = 1,
): Promise<{ created: boolean; path: string }> {
  if (existsSync(path)) return { created: false, path };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderEmptyTemplate(cycle), "utf-8");
  return { created: true, path };
}

/** Make available for testing. */
export const _internals = {
  resolveSmokeStep(name: string): SmokeStepName | null {
    return (SMOKE_STEPS as readonly string[]).includes(name)
      ? (name as SmokeStepName)
      : null;
  },
};

/** Resolve an absolute path from a CLI argument (handles
 *  `~/` expansion). */
export function resolveCliPath(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return pathResolve(p);
}

/** Build a markdown verdict combining usage + survey +
 *  failure-log gates — the Step 11 overall pass criterion.
 *  Pure (modulo the existsSync checks). */
export interface OverallVerdict {
  readonly usageMeetsGate: boolean;
  readonly surveyMeetsGate: boolean | null;
  readonly failureLogMeetsGate: boolean | null;
  readonly meetsStep11: boolean;
  readonly verdict: string;
}

export function buildOverallVerdict(input: {
  readonly usageMeetsGate: boolean;
  readonly latestSurvey: { answer: SeanEllisAnswer } | null;
  readonly failureLogStats: { meetsGate: boolean } | null;
}): OverallVerdict {
  const usage = input.usageMeetsGate;
  const survey = input.latestSurvey ? input.latestSurvey.answer === "V" : null;
  const fail = input.failureLogStats ? input.failureLogStats.meetsGate : null;
  const allKnown = usage !== null && survey !== null && fail !== null;
  const meetsStep11 = allKnown && usage && survey === true && fail === true;
  const verdict = !meetsStep11
    ? "Step 11 NOT YET met. Iterate per the plan."
    : "Step 11 PASS: usage + survey + failure-log gates all green.";
  return {
    usageMeetsGate: usage,
    surveyMeetsGate: survey,
    failureLogMeetsGate: fail,
    meetsStep11,
    verdict,
  };
}

export { failureLogStats, emptyFailureLog, renderFailureLog };

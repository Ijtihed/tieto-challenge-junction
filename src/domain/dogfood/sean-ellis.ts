// Per `architecture/v1-launch-plan.md` Step 11a-2 + Q7
// (Sean Ellis ≥ 40% PMF gate).
//
// Sean Ellis PMF survey tool.
//
// **The Sean Ellis question** (industry standard, Rahul Vohra +
// Sean Ellis 2010): "How would you feel if you could no
// longer use [product]?"
//   - V (very disappointed)
//   - S (somewhat disappointed)
//   - N (not disappointed)
//
// Per research/26 §3 + research/28 §4 + Q7: PMF is defined as
// ≥ 40% of respondents answering "V". Per Q15 (founder-alone
// dogfood), N = 1 for the v1.0 gate — so PMF is binary:
// founder's honest answer is "V" or it's not.
//
// **Pure domain.** No IO. Caller passes the answer + this
// module classifies + persists to a structured record.

export type SeanEllisAnswer = "V" | "S" | "N";

export const SEAN_ELLIS_ANSWERS: readonly SeanEllisAnswer[] = ["V", "S", "N"];

export const SEAN_ELLIS_QUESTION =
  "How would you feel if you could no longer use Schema?";

/** Per-answer human-readable label + classification metadata. */
export const SEAN_ELLIS_META: Record<
  SeanEllisAnswer,
  { label: string; classification: "pmf-pass" | "pmf-marginal" | "pmf-fail" }
> = {
  V: { label: "Very disappointed", classification: "pmf-pass" },
  S: { label: "Somewhat disappointed", classification: "pmf-marginal" },
  N: { label: "Not disappointed", classification: "pmf-fail" },
};

/** A recorded survey response. Persisted as a JSONL line at
 *  `~/.schema/sean-ellis.jsonl`. */
export interface SurveyResponse {
  readonly v: 1;
  readonly ts: string;
  readonly answer: SeanEllisAnswer;
  /** Free-text follow-up from the respondent. */
  readonly note?: string;
  /** The cycle number — v1.0 dogfood is cycle 1; if the gate
   *  fails + the founder iterates, cycle 2, 3, etc. */
  readonly cycle: number;
}

export interface SurveyResult {
  readonly response: SurveyResponse;
  readonly classification: "pmf-pass" | "pmf-marginal" | "pmf-fail";
  readonly label: string;
  /** Single-line decision a CLI/dashboard can show:
   *  "PMF gate PASS: V (Very disappointed)" or
   *  "PMF gate FAIL: N (Not disappointed)". */
  readonly decision: string;
}

/** Pure: classify an answer + build the structured response. */
export function recordSurveyResponse(
  answer: SeanEllisAnswer,
  options: { ts?: string; note?: string; cycle?: number } = {},
): SurveyResult {
  if (!SEAN_ELLIS_ANSWERS.includes(answer)) {
    throw new Error(`invalid Sean Ellis answer: ${answer}`);
  }
  const meta = SEAN_ELLIS_META[answer];
  const ts = options.ts ?? new Date().toISOString();
  const cycle = options.cycle ?? 1;
  const response: SurveyResponse = {
    v: 1,
    ts,
    answer,
    cycle,
    ...(options.note !== undefined ? { note: options.note } : {}),
  };
  return {
    response,
    classification: meta.classification,
    label: meta.label,
    decision: buildDecisionLine(meta.classification, answer, meta.label),
  };
}

function buildDecisionLine(
  classification: "pmf-pass" | "pmf-marginal" | "pmf-fail",
  answer: SeanEllisAnswer,
  label: string,
): string {
  if (classification === "pmf-pass") {
    return `PMF gate PASS: ${answer} (${label}).`;
  }
  if (classification === "pmf-marginal") {
    return (
      `PMF gate MARGINAL: ${answer} (${label}). ` +
      `Iterate per Step 11 plan: address top 3 failure-log items, re-dogfood.`
    );
  }
  return (
    `PMF gate FAIL: ${answer} (${label}). ` +
    `Schema isn't earning its place in the workflow. ` +
    `Iterate before considering launch.`
  );
}

/** Render a single response as a JSONL line. Pure. */
export function serializeResponse(response: SurveyResponse): string {
  return JSON.stringify(response);
}

/** Parse a JSONL line back into a SurveyResponse. Returns
 *  null on any malformed input (per the event-log pattern:
 *  malformed lines are silently dropped from aggregation). */
export function parseResponse(line: string): SurveyResponse | null {
  try {
    const obj = JSON.parse(line) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (o["v"] !== 1) return null;
    if (typeof o["ts"] !== "string") return null;
    if (typeof o["answer"] !== "string") return null;
    if (!SEAN_ELLIS_ANSWERS.includes(o["answer"] as SeanEllisAnswer)) return null;
    if (typeof o["cycle"] !== "number") return null;
    const note = typeof o["note"] === "string" ? o["note"] : undefined;
    return {
      v: 1,
      ts: o["ts"],
      answer: o["answer"] as SeanEllisAnswer,
      cycle: o["cycle"],
      ...(note !== undefined ? { note } : {}),
    };
  } catch {
    return null;
  }
}

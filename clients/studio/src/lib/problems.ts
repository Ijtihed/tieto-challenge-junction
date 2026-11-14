import type { Insight, Rule, Severity, Violation } from "./types";

/**
 * Unified shape for the Problems panel. Insights and rule violations
 * surface to the user as different *flavours* of the same idea — "here's
 * something off about your graph and here's how to fix it." Splitting
 * them across two side-panel tabs added a navigation step without
 * adding clarity, so we merge them here.
 *
 * `kind` lets the UI render a tiny tag (RULE / INSIGHT) so people can
 * still tell them apart at a glance, without forcing them to know the
 * distinction up front.
 */
export interface Problem {
  /** Stable id usable as a React key + testid. */
  id: string;
  kind: "violation" | "insight";
  severity: Severity;
  title: string;
  rationale: string;
  /** Inner node ids the problem applies to — used for hover-highlight
   *  and the canvas focus-on-click jump. */
  targetIds: string[];
  /** Prompt that, when submitted, should produce a fix. Already a
   *  feature of both `Violation` and `Insight`. */
  suggestedPrompt: string;
  /** For violations only: the originating rule id. UI surfaces it as a
   *  small "rule details" link. Undefined for insights. */
  ruleId?: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Merge violations + insights into one severity-sorted Problem list.
 * Violations come first within each severity tier (a missing auth gap
 * is more actionable than a god-cluster suggestion).
 */
export function mergeProblems(
  rules: Rule[],
  violations: Violation[],
  insights: Insight[],
): Problem[] {
  const ruleById = new Map(rules.map((r) => [r.id, r] as const));
  const out: Problem[] = [];

  for (const v of violations) {
    const rule = ruleById.get(v.ruleId);
    out.push({
      id: `violation:${v.ruleId}`,
      kind: "violation",
      severity: rule?.severity ?? "medium",
      title: rule?.description ?? v.message,
      rationale: v.message,
      targetIds: v.targetIds ?? (v as any).nodeIds ?? [],
      suggestedPrompt: v.suggestedPrompt,
      ruleId: v.ruleId,
    });
  }

  for (const i of insights) {
    out.push({
      id: i.id,
      kind: "insight",
      severity: i.severity,
      title: i.title,
      rationale: i.rationale,
      targetIds: i.targetIds ?? [],
      suggestedPrompt: i.suggestedPrompt,
    });
  }

  out.sort((a, b) => {
    const sd = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sd !== 0) return sd;
    // violations before insights at the same severity
    if (a.kind !== b.kind) return a.kind === "violation" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return out;
}

/**
 * Lightweight summary used by the side rail badge + the first-load hero.
 *
 *   { total, violations, insights, topSeverity }
 *
 * `topSeverity` is the most severe rank present (`"high"` if any high
 * violation/insight exists, else `"medium"`, else `"low"`, else null).
 */
export function summariseProblems(problems: Problem[]): {
  total: number;
  violations: number;
  insights: number;
  topSeverity: Severity | null;
} {
  if (problems.length === 0) {
    return { total: 0, violations: 0, insights: 0, topSeverity: null };
  }
  const violations = problems.filter((p) => p.kind === "violation").length;
  const insights = problems.filter((p) => p.kind === "insight").length;
  const ranks = problems.map((p) => SEVERITY_RANK[p.severity]);
  const minRank = Math.min(...ranks);
  const topSeverity: Severity =
    minRank === 0 ? "high" : minRank === 1 ? "medium" : "low";
  return { total: problems.length, violations, insights, topSeverity };
}

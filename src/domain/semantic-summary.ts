// Per architecture/specs/semantic-diff.md §2.3
// PR-level semantic classification and headline generation.

import type { NodeDelta, ImpactSummary, SemanticDiffSummary } from "./delta.ts";

const MECHANICAL_CLASSIFICATIONS = new Set(["renamed", "moved", "signature_changed", "extracted", "inlined"]);

export function computeSemanticSummary(
  nodes: readonly NodeDelta[],
  impactSummary: ImpactSummary,
  totalLinesChanged: number,
): SemanticDiffSummary {
  const changed = nodes.filter((n) => n.status !== "unchanged");
  if (changed.length === 0) {
    return { classification: "semantic_noop", headline: "No changes detected.", substantiveChanges: 0, mechanicalChanges: 0, totalLinesChanged };
  }

  let substantive = 0;
  let mechanical = 0;

  for (const n of changed) {
    if (n.classification && MECHANICAL_CLASSIFICATIONS.has(n.classification)) {
      mechanical++;
    } else {
      substantive++;
    }
  }

  let classification: SemanticDiffSummary["classification"];
  if (substantive === 0) {
    classification = "semantic_noop";
  } else if (mechanical > 0 && substantive > 0) {
    classification = "mixed";
  } else if (substantive < 5 && impactSummary.totalImpactedNodes < 10) {
    classification = "low_impact";
  } else {
    classification = "high_impact";
  }

  const headline = buildHeadline(classification, substantive, mechanical, totalLinesChanged, changed);

  return { classification, headline, substantiveChanges: substantive, mechanicalChanges: mechanical, totalLinesChanged };
}

function buildHeadline(
  cls: SemanticDiffSummary["classification"],
  substantive: number,
  mechanical: number,
  totalLines: number,
  changed: readonly NodeDelta[],
): string {
  if (cls === "semantic_noop") {
    const parts = describeRefactorings(changed);
    return `This ${totalLines}-line diff is semantically a 0-line change. ${parts}`;
  }

  if (cls === "mixed") {
    const parts = describeRefactorings(changed.filter((n) => n.classification && MECHANICAL_CLASSIFICATIONS.has(n.classification)));
    return `This ${totalLines}-line diff is semantically a ${substantive}-node change: ${parts} ${mechanicalSuffix(totalLines, substantive)}`;
  }

  if (cls === "low_impact") {
    return `Low-impact change: ${substantive} node${substantive === 1 ? "" : "s"} substantively modified across ${totalLines} lines.`;
  }

  return `High-impact change: ${substantive} node${substantive === 1 ? "" : "s"} substantively modified across ${totalLines} lines.`;
}

function describeRefactorings(nodes: readonly NodeDelta[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (!n.classification) continue;
    counts.set(n.classification, (counts.get(n.classification) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const [cls, count] of counts) {
    parts.push(`${count} ${cls}`);
  }
  return parts.length > 0 ? parts.join(", ") + "." : "";
}

function mechanicalSuffix(totalLines: number, substantive: number): string {
  if (totalLines > 0 && substantive < totalLines) {
    return `${totalLines - substantive} lines are mechanical consequences.`;
  }
  return "";
}

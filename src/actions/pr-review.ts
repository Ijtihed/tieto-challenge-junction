// Per architecture/schema-v3.md §5.3 action 30 + Step 9 work item 1.
// Combines graph.diff_against + rules.evaluate into a PR comment.
//
// **Hybrid-strict positioning** (per `research/26-senior-engineer-day-to-day.md`
// §6 + Step 9 plan): Schema's `pr.review` outputs a markdown
// review that says **explicitly** "Schema does not have merge
// authority — a human must approve." This is the PanDev 2026
// empirical finding: hybrid-strict (LLM advisor + required
// human approval) ships **40% fewer defects** and runs **55%
// faster** than AI-only review. The marker is **not optional**.
//
// **Promotion-evidence framing** (research/26 §7): the PR
// review comment is one of the four headline Schema artifacts
// senior+ engineers use as Google L6+ promotion evidence. The
// review must be substantive enough to qualify as an
// "institutionalised process" artifact — hence the explicit
// section structure (semantic summary, evidence citations,
// rule violations, atlas deep link).
//
// **Atlas deep link**: when `studioBaseUrl` is supplied, the
// review embeds `${studioBaseUrl}/?pr=<sha>` links so reviewers
// can pivot from the markdown into the live atlas focused on
// the PR's changed clusters. Default URL is
// `http://localhost:5173` (Vite dev server per Q16).
//
// **Step 8b hook (forward-compat)**: when the hybrid-RAG
// retrieval engine ships in 8b, the `hallucinatedApis` field
// will be populated by comparing diff `calls` edges to the
// hybrid index. Step 9a leaves the field defined + empty so
// 8b is a pure addition, no signature change.

import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import { graphDiffAgainst } from "./graph-diff-against.ts";
import { rulesEvaluate } from "./rules-evaluate.ts";
import {
  buildGraphBm25Index,
} from "../domain/retrieval/graph-bm25.ts";
import {
  detectHallucinatedApis,
} from "../domain/retrieval/hallucinated-api.ts";
import type { GraphEdge, GraphNode } from "../domain/multi-repo.ts";

/** Default Studio base URL per Q16 (Vite dev server). The
 *  CLI / MCP host can override via the `studioBaseUrl` arg. */
export const DEFAULT_STUDIO_BASE_URL = "http://localhost:5173";

/** Default base ref for the diff `pr.review` computes against.
 *  Single source of truth (§0.6.2 no-parallel-unions): the
 *  CLI, the CI bridge, the GitHub Actions workflow, and the
 *  action's own input default ALL import this constant. */
export const DEFAULT_PR_REVIEW_BASE_REF = "merge-base origin/main";

/** Hybrid-strict marker text. Pinned by a canonical-set
 *  test (§0.6.2) — research/26 §6 + plan Step 9 work item 1
 *  require this exact framing. */
export const HYBRID_STRICT_MARKER =
  "**Schema does not have merge authority.** This review is " +
  "advisory. A human reviewer must approve any change.";

/** Build the atlas deep link for a given PR sha + optional
 *  focus node id. Pure function (§0.6.4 (a) extracted helper).
 *
 *  **Signature mirrors `clients/studio/src/hooks/usePrMode.ts`'s
 *  `buildAtlasDeepLink`.** The two layers cannot share an
 *  import (Node vs browser), so we duplicate the function +
 *  pin agreement with an integration-boundary equivalence
 *  test per §0.6.4 (d). The Step 9a double-check found a
 *  parameter-count drift here (engine was 2-arg; Studio was
 *  3-arg) — the engine's citation URLs were built inline at
 *  the call site instead of going through this helper, which
 *  meant they couldn't be pinned by the equivalence test.
 *  Both sides now take `(baseUrl, prSha, focusId?)`. */
export function buildAtlasDeepLink(
  baseUrl: string,
  prSha: string,
  focusId?: string | null,
): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ pr: prSha });
  if (focusId) params.set("focus", focusId);
  return `${trimmed}/?${params.toString()}`;
}

export const prReview = {
  name: "pr.review" as const,
  description: "Generate a PR review by combining graph diff analysis, rule evaluation, and (when 8b lands) hallucinated-API detection into a hybrid-strict markdown report. The review is advisory; humans hold merge authority.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      base: { type: "string", description: "Git ref to use as the base for comparison (default 'merge-base origin/main')" },
      prSha: { type: "string", description: "PR head SHA — embedded in the atlas deep link" },
      studioBaseUrl: { type: "string", description: "Base URL for the Studio atlas deep link (default 'http://localhost:5173' per Q16 — Vite dev server)" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) return { ok: false as const, code: "invalid-args", message: "sessionId is required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    if (session.closed) return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };

    session.lastActivityAt = Date.now();

    const base = (args["base"] as string | undefined) ?? DEFAULT_PR_REVIEW_BASE_REF;
    const prSha = (args["prSha"] as string | undefined) ?? "HEAD";
    const studioBaseUrl =
      (args["studioBaseUrl"] as string | undefined) ?? DEFAULT_STUDIO_BASE_URL;
    const atlasDeepLink = buildAtlasDeepLink(studioBaseUrl, prSha);

    const diffResult = await graphDiffAgainst.handle({ sessionId, ref: base, includeFileStats: true });
    const rulesResult = await rulesEvaluate.handle({ sessionId });

    const diffData = diffResult.ok ? diffResult.data as Record<string, unknown> : {};
    const rulesData = rulesResult.ok ? rulesResult.data as { violations: { ruleId: string; severity: string; message: string; nodeId?: string }[] } : { violations: [] };

    const delta = diffData["graphDelta"] as {
      counts?: { nodesModified: number };
      semanticSummary?: { classification: string; headline: string; substantiveChanges: number; mechanicalChanges: number };
      impactSummary?: { totalImpactedNodes: number; totalImpactedContracts: number; highestImpactNode?: { name: string; impact: number } };
      nodes?: { id: string; name?: string; filePath?: string; classification?: string; renamedFrom?: string; movedFrom?: string; extractedFrom?: string; inlinedInto?: string }[];
    } | undefined;
    const fileStats = (diffData["fileStats"] as { path: string; insertions: number; deletions: number }[]) ?? [];

    const lines: string[] = [
      "## Schema PR Review",
      "",
      `> ${HYBRID_STRICT_MARKER}`,
      "",
      `**Base:** \`${base}\` · **Head:** \`${prSha}\` · [View on atlas](${atlasDeepLink})`,
      "",
    ];

    if (delta?.semanticSummary) {
      lines.push("### Semantic summary", "");
      lines.push(`> **${delta.semanticSummary.headline}**`, "");
      lines.push(`Classification: \`${delta.semanticSummary.classification}\``, "");
    }

    if (fileStats.length > 0) {
      lines.push(`### Changed files (${fileStats.length})`, "");
      for (const fs of fileStats) lines.push(`- \`${fs.path}\` (+${fs.insertions}, -${fs.deletions})`);
      lines.push("");
    }

    const classifiedNodes = delta?.nodes?.filter((n) => n.classification) ?? [];
    if (classifiedNodes.length > 0) {
      lines.push("### Refactoring analysis", "");
      for (const n of classifiedNodes) {
        const nodeRef = n.name ? `\`${n.name}\`` : `\`${n.id}\``;
        const fileSuffix = n.filePath ? ` (\`${n.filePath}\`)` : "";
        if (n.renamedFrom) lines.push(`- ${nodeRef} ← renamed from \`${n.renamedFrom}\`${fileSuffix}`);
        else if (n.movedFrom) lines.push(`- ${nodeRef} ← moved from \`${n.movedFrom}\`${fileSuffix}`);
        else if (n.extractedFrom) lines.push(`- ${nodeRef} extracted from \`${n.extractedFrom}\`${fileSuffix}`);
        else if (n.inlinedInto) lines.push(`- ${nodeRef} inlined into \`${n.inlinedInto}\`${fileSuffix}`);
        else lines.push(`- ${nodeRef} (${n.classification})${fileSuffix}`);
      }
      lines.push("");
    }

    if (delta?.counts) {
      lines.push("### Graph impact", "", `- Nodes modified: ${delta.counts.nodesModified}`);
      if (delta.impactSummary) {
        lines.push(`- **${delta.impactSummary.totalImpactedNodes}** nodes transitively impacted`);
        lines.push(`- **${delta.impactSummary.totalImpactedContracts}** contracts impacted`);
        if (delta.impactSummary.highestImpactNode) {
          lines.push(`- Highest-impact node: \`${delta.impactSummary.highestImpactNode.name}\` (${delta.impactSummary.highestImpactNode.impact} connections)`);
        }
      }
      lines.push("");
    }

    if (rulesData.violations.length > 0) {
      lines.push(`### Rule violations (${rulesData.violations.length})`, "");
      for (const v of rulesData.violations) {
        const icon = v.severity === "error" ? "x" : v.severity === "warn" ? "!" : "i";
        // Evidence citation: when the violation carries a
        // nodeId, link the row to the atlas focused on that
        // node so the reviewer can pivot in one click. Goes
        // through `buildAtlasDeepLink` so the URL format
        // can't drift from the header's atlas link.
        const evidence = v.nodeId
          ? ` _(see [${v.nodeId}](${buildAtlasDeepLink(studioBaseUrl, prSha, v.nodeId)}))_`
          : "";
        lines.push(`- [${icon}] **${v.ruleId}**: ${v.message}${evidence}`);
      }
      lines.push("");
    } else {
      lines.push("### Rules", "", "All rules pass.", "");
    }

    // Step 8b: hallucinated-API detection. Compare diff
    // `calls` edges to the head graph; flag every target that
    // doesn't resolve. The hybrid index gives a "did you
    // mean" suggestion per finding. Per research/26 §6
    // hybrid-strict: Schema flags, the human decides.
    //
    // **Step 8b DC bug fix**: the first-pass implementation
    // read a nonexistent `diffData["addedEdges"]` key; the
    // correct surface is `graphDelta.edges.filter(status="added")`.
    // The first-pass tests didn't catch this because they
    // tested the detector + the action surface in isolation;
    // the integration boundary between `pr.review` and
    // `graph.diff_against` was unobserved (§0.6.4 (d) gap).
    const deltaEdges = (delta as { edges?: readonly { id: string; source: string; target: string; relation: string; status: string }[] } | undefined)?.edges ?? [];
    const addedEdges: readonly GraphEdge[] = deltaEdges
      .filter((e) => e.status === "added")
      .map((e) => ({ id: e.id, source: e.source, target: e.target, relation: e.relation }));
    const addedNodes = ((delta?.nodes ?? []).filter(
      (n) => n.classification === "added",
    ) as unknown as readonly GraphNode[]);
    const hallucinatedApis = (() => {
      try {
        const hybridIndex = buildGraphBm25Index(session.graph);
        return detectHallucinatedApis({
          diff: { addedNodes, addedEdges },
          headGraph: session.graph,
          hybridIndex,
        });
      } catch {
        // Detector failures must not block the rest of the
        // review. Return empty so the section just renders
        // nothing (same as zero findings).
        return [];
      }
    })();
    if (hallucinatedApis.length > 0) {
      lines.push(`### Hallucinated APIs (${hallucinatedApis.length})`, "");
      lines.push(
        "_Diff adds calls whose targets don't resolve in the graph. " +
          "Schema flags + suggests; the reviewer decides._",
      );
      lines.push("");
      for (const h of hallucinatedApis) {
        lines.push(
          `- \`${h.call}\` — no matching symbol in the graph` +
            (h.nearestMatch
              ? ` (did you mean \`${h.nearestMatch}\`?)`
              : ""),
        );
      }
      lines.push("");
    }

    const markdown = lines.join("\n");
    const resultId = randomUUID();
    const markdownUri = `markdown://pr.review/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: {
        graphDelta: diffData["graphDelta"] ?? null,
        baseEvalViolations: [],
        headEvalViolations: rulesData.violations,
        fileStats,
        markdownUri,
        atlasDeepLink,
        hybridStrict: true as const,
        hallucinatedApis,
      },
    };
  },
};

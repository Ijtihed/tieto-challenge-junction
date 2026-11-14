// Per architecture/schema-v3.md §5.3 action 11 + §14.5 +
// specs/semantic-diff.md + Step 6 of
// architecture/v1-launch-plan.md (Iceberg/Delta change-query
// vocabulary, research/27 §8).
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import { buildAdapterSet } from "../adapters/index.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import { detectRefactorings } from "../domain/refactoring-detect.ts";
import { computeImpactScores } from "../domain/impact-score.ts";
import { computeSemanticSummary } from "../domain/semantic-summary.ts";
import { computeDelta, applyChangeQueryMode, CHANGE_QUERY_MODES, type ChangeQueryMode } from "../domain/delta.ts";
import type { GraphDelta, NodeDelta } from "../domain/delta.ts";
import type { Violation } from "../domain/types.ts";
import { openStore } from "../domain/persistence/store.ts";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".schema", "graph-cache.db");

interface FileStat {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}

function parseNumstat(line: string): FileStat | null {
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const ins = parseInt(parts[0]!, 10);
  const del = parseInt(parts[1]!, 10);
  const path = parts[2]!;
  if (!path) return null;
  return { path, insertions: isNaN(ins) ? 0 : ins, deletions: isNaN(del) ? 0 : del };
}

export const graphDiffAgainst = {
  name: "graph.diff_against" as const,
  description: "Compute the graph delta between the current workspace state and a git ref, including file stats and rule violations.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      ref: { type: "string", description: "Git ref to diff against (e.g. branch name, commit SHA, HEAD~1)" },
      includeFileStats: { type: "boolean", description: "Whether to include per-file insertion/deletion stats (default true)" },
      mode: {
        type: "string",
        enum: [...CHANGE_QUERY_MODES],
        description: "Change-query mode per research/27 §8 (Iceberg/Delta CDC vocabulary). `append` = inserts only; `upsert` = inserts + modifications; `min-delta` = adds+removes+modifies, no unchanged (DEFAULT); `full-delta` = complete CDC stream including unchanged.",
      },
    },
    required: ["sessionId", "ref"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const ref = args["ref"] as string | undefined;
    if (!ref) {
      return { ok: false as const, code: "invalid-args", message: "ref is required" };
    }

    const modeRaw = args["mode"] as string | undefined;
    let mode: ChangeQueryMode = "min-delta";
    if (modeRaw !== undefined) {
      if (!(CHANGE_QUERY_MODES as readonly string[]).includes(modeRaw)) {
        return {
          ok: false as const,
          code: "invalid-args",
          message: `mode must be one of [${CHANGE_QUERY_MODES.join(", ")}]; got '${modeRaw}'`,
        };
      }
      mode = modeRaw as ChangeQueryMode;
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    // Snapshot-based diff: if ref is a 40-char hex SHA, try loading from cache.
    const is40CharSha = /^[0-9a-f]{40}$/i.test(ref);
    if (is40CharSha) {
      const rootUri0 = session.workspaceUris[0];
      const rootPath0 = rootUri0?.startsWith("file://") ? rootUri0.slice(7) : "";
      if (rootPath0) {
        let store;
        try {
          store = openStore(DB_PATH);
          const snapshotGraph = store.loadSnapshotBySha(rootPath0, ref);
          if (snapshotGraph) {
            const fullDelta = computeDelta(snapshotGraph, session.graph);
            const delta = applyChangeQueryMode(fullDelta, mode);
            const mdId = randomUUID();
            const mdContent = `# Graph diff: snapshot ${ref.slice(0, 7)} → current (mode=${mode})\n\n${delta.counts.nodesAdded} added, ${delta.counts.nodesRemoved} removed, ${delta.counts.nodesModified} modified nodes.`;
            session.markdownResources.set(`markdown://graph.diff_against/${mdId}`, mdContent);
            return {
              ok: true as const,
              data: {
                graphDelta: delta,
                ruleDelta: { headViolations: [], baseViolations: [] },
                markdownUri: `markdown://graph.diff_against/${mdId}`,
                refType: "snapshot" as const,
                mode,
              },
            };
          }
        } catch { /* snapshot load failed, fall through to git */ }
        finally { store?.close(); }
      }
    }

    const includeFileStats = (args["includeFileStats"] as boolean | undefined) ?? true;
    const adapters = buildAdapterSet(session.adapterMode);
    const rootUri = session.workspaceUris[0];
    const rootPath = rootUri?.startsWith("file://") ? rootUri.slice(7) : undefined;

    let changedFiles: string[] = [];
    let fileStats: FileStat[] = [];

    if (rootPath) {
      try {
        const nameResult = await adapters.git.run(
          ["diff", "--name-only", ref],
          { cwd: rootPath },
        );
        if (nameResult.exitCode === 0) {
          changedFiles = nameResult.stdout
            .trim()
            .split("\n")
            .filter((l) => l.length > 0);
        }

        if (includeFileStats) {
          const statResult = await adapters.git.run(
            ["diff", "--numstat", ref],
            { cwd: rootPath },
          );
          if (statResult.exitCode === 0) {
            fileStats = statResult.stdout
              .trim()
              .split("\n")
              .map(parseNumstat)
              .filter((s): s is FileStat => s !== null);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const resultId = randomUUID();
        const markdown = `# Diff against \`${ref}\`\n\n**Warning:** git failed — ${msg}\n\nFalling back to empty diff.`;
        const markdownUri = `markdown://graph.diff_against/${resultId}`;
        session.markdownResources.set(markdownUri, markdown);
        const emptyDelta: GraphDelta = { nodes: [], edges: [], interRepoEdges: [], counts: { nodesAdded: 0, nodesRemoved: 0, nodesModified: 0, edgesAdded: 0, edgesRemoved: 0 } };
        const data: Record<string, unknown> = { graphDelta: emptyDelta, ruleDelta: { headViolations: [], baseViolations: [] }, markdownUri, gitError: msg, mode };
        if (includeFileStats) data["fileStats"] = [];
        return { ok: true as const, data };
      }
    }

    const changedSet = new Set(changedFiles.map((f) => {
      if (rootPath && !f.startsWith("/")) return `${rootPath}/${f}`;
      return f;
    }));

    const allNodes = session.graph.repos.flatMap((r) => r.nodes);
    const allEdges = session.graph.repos.flatMap((r) => r.edges);

    const rawDeltaNodes: NodeDelta[] = [];
    let nodesModified = 0;
    for (const node of allNodes) {
      const fp = node.filePath;
      if (fp && changedSet.has(fp)) {
        rawDeltaNodes.push({ id: node.id, status: "modified" });
        nodesModified++;
      } else {
        rawDeltaNodes.push({ id: node.id, status: "unchanged" });
      }
    }

    const modifiedNodeIds = new Set(rawDeltaNodes.filter((n) => n.status === "modified").map((n) => n.id));
    const deltaEdges: GraphDelta["edges"][number][] = [];
    for (const edge of allEdges) {
      const status = (modifiedNodeIds.has(edge.source) || modifiedNodeIds.has(edge.target))
        ? "added" : "unchanged";
      deltaEdges.push({ id: edge.id, source: edge.source, target: edge.target, relation: edge.relation, status });
    }

    // Semantic enrichment: refactoring detection + impact scoring + summary
    const { enrichedNodes: refactoredNodes } = detectRefactorings(session.graph, session.graph, rawDeltaNodes);
    const totalLines = fileStats.reduce((sum, fs) => sum + fs.insertions + fs.deletions, 0);
    const { enrichedNodes: impactNodes, impactSummary } = computeImpactScores(session.graph, refactoredNodes);
    const semanticSummary = computeSemanticSummary(impactNodes, impactSummary, totalLines);

    const fullGraphDelta: GraphDelta = {
      nodes: impactNodes,
      edges: deltaEdges,
      interRepoEdges: [],
      counts: { nodesAdded: 0, nodesRemoved: 0, nodesModified, edgesAdded: 0, edgesRemoved: 0 },
      impactSummary,
      semanticSummary,
    };
    // Step 6: apply the Iceberg/Delta change-query mode filter.
    // Default mode is `min-delta` which strips unchanged entries
    // — backward-compatible with pre-Step-6 callers that read
    // `graphDelta.nodes` looking only at modified/added/removed
    // entries.
    const graphDelta: GraphDelta = applyChangeQueryMode(fullGraphDelta, mode);

    const violations: Violation[] = [];
    for (const rule of BUILTIN_RULES) {
      violations.push(...rule.evaluate(session.graph));
    }
    const ruleDelta = { headViolations: violations, baseViolations: [] as Violation[] };

    const resultId = randomUUID();
    const markdown = renderDiffMarkdown(ref, changedFiles, fileStats, graphDelta, violations);
    const markdownUri = `markdown://graph.diff_against/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    const data: Record<string, unknown> = { graphDelta, ruleDelta, markdownUri, mode };
    if (includeFileStats) data["fileStats"] = fileStats;

    return { ok: true as const, data };
  },
};

function renderDiffMarkdown(
  ref: string,
  changedFiles: string[],
  fileStats: FileStat[],
  delta: GraphDelta,
  violations: Violation[],
): string {
  const lines: string[] = [`# Diff against \`${ref}\``, ""];

  if (delta.semanticSummary) {
    lines.push("### Semantic summary", "");
    lines.push(`> **${delta.semanticSummary.headline}**`, "");
    lines.push(`Classification: \`${delta.semanticSummary.classification}\``, "");
  }

  if (changedFiles.length === 0) {
    lines.push("No changed files detected.", "");
  } else {
    lines.push(`## Changed files (${changedFiles.length})`, "");
    if (fileStats.length > 0) {
      for (const fs of fileStats) {
        lines.push(`- \`${fs.path}\` (+${fs.insertions}, -${fs.deletions})`);
      }
    } else {
      for (const f of changedFiles) {
        lines.push(`- \`${f}\``);
      }
    }
    lines.push("");
  }

  const classifiedNodes = delta.nodes.filter((n) => n.classification);
  if (classifiedNodes.length > 0) {
    lines.push("### Refactoring analysis", "");
    for (const n of classifiedNodes) {
      const label = n.classification ?? "modified";
      if (n.renamedFrom) {
        lines.push(`- \`${n.id}\` ← \`${n.renamedFrom}\` (renamed)`);
      } else if (n.movedFrom) {
        lines.push(`- \`${n.id}\` ← \`${n.movedFrom}\` (moved)`);
      } else if (n.extractedFrom) {
        lines.push(`- \`${n.id}\` extracted from \`${n.extractedFrom}\``);
      } else if (n.inlinedInto) {
        lines.push(`- \`${n.id}\` inlined into \`${n.inlinedInto}\``);
      } else {
        lines.push(`- \`${n.id}\` (${label})`);
      }
    }
    lines.push("");
  }

  lines.push("## Graph impact", "");
  lines.push(`- Nodes modified: ${delta.counts.nodesModified}`);
  lines.push(`- Total nodes: ${delta.nodes.length}`);

  if (delta.impactSummary) {
    lines.push(`- **${delta.impactSummary.totalImpactedNodes}** nodes transitively impacted`);
    lines.push(`- **${delta.impactSummary.totalImpactedContracts}** contracts impacted`);
    if (delta.impactSummary.highestImpactNode) {
      lines.push(`- Highest-impact node: \`${delta.impactSummary.highestImpactNode.name}\` (${delta.impactSummary.highestImpactNode.impact} upstream+downstream)`);
    }
  }
  lines.push("");

  if (violations.length > 0) {
    lines.push("## Rule violations", "");
    for (const v of violations) {
      const icon = v.severity === "error" ? "❌" : v.severity === "warn" ? "⚠️" : "ℹ️";
      lines.push(`- ${icon} **${v.ruleId}**: ${v.message}`);
    }
    lines.push("");
  } else {
    lines.push("## Rules", "", "All rules pass.", "");
  }

  return lines.join("\n");
}

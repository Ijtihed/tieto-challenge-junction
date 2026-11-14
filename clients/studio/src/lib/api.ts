// Adapter: maps v1's fetch("/api/...") calls to v3's MCP callTool().
// Drop-in replacement — same request/response shapes so store.ts needs minimal changes.

const MCP_ENDPOINT = "/mcp";
const EDGE_CHUNK = 20;

/** Wire-format shape of `workspace.open`'s archetype block per
 *  doc-25 §8 + Step 3 — mirrors the engine `ArchetypeResult`.
 *  The `monorepo` flag is added by the wire adapter from the
 *  parallel `workspace.monorepo` boolean.
 *
 *  IMPORTANT: `primary` is typed as `ArchetypeIdClient` (the
 *  store's union) so the wire layer and the store layer share
 *  a single source of truth. If the union ever drifts, every
 *  call site that lookups the L1 label catches it at compile
 *  time. Found during Step 3's double-check pass — previously
 *  the wire type duplicated the union inline, allowing silent
 *  drift between api.ts and store.ts. */
import type { ArchetypeIdClient } from "@/state/store";

export interface WorkspaceArchetypeWire {
  primary: ArchetypeIdClient;
  secondaries: ArchetypeIdClient[];
  confidence: number;
  scores: Array<{ id: ArchetypeIdClient; score: number }>;
}

/** Wire-format shape of `workspace.open`'s `extraction` field — see
 *  `src/domain/extraction-stats.ts` for the canonical definition.
 *  Step 4: extended with `filtered` (per-reason filter breakdown)
 *  and `filteredSample` (capped sample of filtered files).
 *
 *  Per §0.6.2 — the wire types reference `FilterReasonClient`
 *  + `FilterCountsClient` from the store so the wire layer and
 *  the store layer share a single source of truth. Dropping a
 *  union member from either side is a compile error in this PR. */
import type {
  FilterReasonClient,
  FilterCountsClient,
  FilteredFileClient,
} from "@/state/store";

export type ParseSkipReasonWire =
  | "too-large"
  | "generated"
  | "parse-failed"
  | "read-failed";

export interface ExtractionStatsWire {
  filesAttempted: number;
  filesParsed: number;
  filesSkipped: number;
  failures: Array<{
    filePath: string;
    reason: ParseSkipReasonWire;
    extractorId: string;
    detail?: string;
  }>;
  perExtractor: Array<{
    extractorId: string;
    filesAttempted: number;
    filesParsed: number;
    filesSkipped: number;
    failures: Array<{
      filePath: string;
      reason: ParseSkipReasonWire;
      extractorId: string;
      detail?: string;
    }>;
    filtered?: FilterCountsClient;
  }>;
  filtered?: FilterCountsClient;
  filteredSample?: FilteredFileClient[];
}

export type { FilterReasonClient };

/** Map server-side violation shape (nodeIds) to client-side shape (targetIds). */
function mapViolation(v: any): any {
  return {
    ruleId: v.ruleId ?? "",
    message: v.message ?? "",
    targetIds: v.targetIds ?? v.nodeIds ?? [],
    suggestedPrompt: v.suggestedPrompt ?? v.message ?? "",
  };
}

/** Assemble client-side clusters from server-provided data. Each node from
 *  `graph.list_nodes` carries a `cluster` field (the cluster id it belongs
 *  to). `summaryClusters` carries the human-readable names. We combine the
 *  two into the `{ id, name, nodeIds }` shape Studio expects. */
function assignClusters(
  nodes: any[],
  summaryClusters: any[],
): { nodeToCluster: Map<string, string>; clusters: import("./types.ts").Cluster[] } {
  const nodeToCluster = new Map<string, string>();
  const clusterMeta = new Map<string, import("./types.ts").Cluster>();

  if (Array.isArray(summaryClusters)) {
    for (const c of summaryClusters) {
      if (!c?.id) continue;
      clusterMeta.set(c.id, {
        id: c.id,
        name: c.name ?? "Cluster",
        nodeIds: [],
        ...(c.entryPointIds ? { entryPointIds: c.entryPointIds } : {}),
        ...(c.canonicalShape ? { canonicalShape: c.canonicalShape } : {}),
        ...(c.labelTier ? { labelTier: c.labelTier } : {}),
      });
    }
  }

  // Walk the nodes and assign each one to its server-provided cluster.
  for (const n of nodes) {
    const cid = n.cluster as string | null | undefined;
    if (!cid) continue;
    let cluster = clusterMeta.get(cid);
    if (!cluster) {
      // Cluster missing from summary (rare). Derive a humane name from the id.
      const fallbackName = cid.startsWith("cluster:")
        ? cid.slice("cluster:".length).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : cid;
      cluster = { id: cid, name: fallbackName, nodeIds: [] };
      clusterMeta.set(cid, cluster);
    }
    nodeToCluster.set(n.id, cid);
    cluster.nodeIds.push(n.id);
  }

  // Unassigned nodes go into "Other". This shouldn't happen with the new
  // server-side clustering, but the safety net stays.
  const unassigned = nodes.filter((n: any) => !nodeToCluster.has(n.id));
  if (unassigned.length > 0) {
    const otherId = "cluster:other";
    let other = clusterMeta.get(otherId);
    if (!other) {
      other = { id: otherId, name: "Other", nodeIds: [] };
      clusterMeta.set(otherId, other);
    }
    for (const n of unassigned) {
      nodeToCluster.set(n.id, otherId);
      other.nodeIds.push(n.id);
    }
  }

  // Drop empty clusters (summary metadata for clusters whose nodes were all
  // filtered out elsewhere) and sort biggest first.
  const clusters = [...clusterMeta.values()]
    .filter((c) => c.nodeIds.length > 0)
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length);

  return { nodeToCluster, clusters };
}

/** Extract file paths from unified diff headers (--- a/path, +++ b/path). */
function parseDiffFilePaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    const m = line.match(/^(?:---|\+\+\+)\s+[ab]\/(.+)/);
    if (m && m[1] && m[1] !== "/dev/null") paths.add(m[1]);
  }
  return [...paths];
}

let _setMcpStatus: ((s: "connected" | "disconnected" | "reconnecting") => void) | null = null;
export function bindMcpStatus(setter: (s: "connected" | "disconnected" | "reconnecting") => void) {
  _setMcpStatus = setter;
}

let _bumpApiLoading: ((delta: 1 | -1) => void) | null = null;
export function bindApiLoading(bump: (delta: 1 | -1) => void) {
  _bumpApiLoading = bump;
}

async function callTool<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T> {
  const id = Math.random().toString(36).slice(2);
  _bumpApiLoading?.(1);
  let res: Response;
  try {
    res = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } }),
    });
  } catch (err) {
    _bumpApiLoading?.(-1);
    _setMcpStatus?.("disconnected");
    throw err;
  }
  _setMcpStatus?.("connected");
  const json = await res.json();
  _bumpApiLoading?.(-1);
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  const content = json.result?.content;
  if (!content || content.length === 0) return {} as T;
  const text = content[0]?.text;
  if (!text) return {} as T;
  const parsed = JSON.parse(text);
  if (parsed.ok === false) throw new Error(parsed.message ?? parsed.code ?? "MCP call failed");
  return (parsed.data ?? parsed) as T;
}

export async function probeMcpHealth(): Promise<boolean> {
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "tools/list", params: {} }),
    });
    if (res.ok) { _setMcpStatus?.("connected"); return true; }
  } catch {}
  _setMcpStatus?.("disconnected");
  return false;
}

// Stateful: the adapter stores a sessionId after workspace.open
let _sessionId: string | null = null;
export function getSessionId() { return _sessionId; }
export function setSessionId(id: string | null) { _sessionId = id; }

// Main adapter — intercepts fetch("/api/...") patterns from v1's store
export async function fetchApi(url: string, init?: RequestInit): Promise<Response> {
  const body = init?.body ? JSON.parse(init.body as string) : {};

  // /api/open — just workspace.open, returns sessionId (for SSE subscription before graph load)
  if (url === "/api/open") {
    const rootPath = body.path as string;
    const uri = rootPath.startsWith("file://") ? rootPath : `file://${rootPath}`;
    const openResult = await callTool<{
      sessionId: string;
      fromCache?: boolean;
      extraction?: ExtractionStatsWire;
      workspace?: {
        archetype?: WorkspaceArchetypeWire | null;
        monorepo?: boolean;
      };
    }>("workspace.open", { uris: [uri] });
    _sessionId = openResult.sessionId;
    const archetypeRaw = openResult.workspace?.archetype ?? null;
    const archetype = archetypeRaw
      ? { ...archetypeRaw, monorepo: !!openResult.workspace?.monorepo }
      : null;
    return jsonResponse({
      sessionId: openResult.sessionId,
      fromCache: !!openResult.fromCache,
      extraction: openResult.extraction ?? null,
      archetype,
    });
  }

  // /api/load-graph — fetch nodes/edges/rules/insights for the current session
  if (url === "/api/load-graph") {
    if (!_sessionId) throw new Error("No session — call /api/open first");
    const rootPath = body.path as string ?? "";

    const [summary, nodeData, edgeData] = await Promise.all([
      callTool<any>("graph.summary", { sessionId: _sessionId }),
      callTool<{ nodes: any[] }>("graph.list_nodes", { sessionId: _sessionId, filter: {}, limit: 100_000 }),
      callTool<{ edges: { id: string; source: string; target: string; relation: string }[]; truncated: boolean }>(
        "graph.list_edges", { sessionId: _sessionId, limit: 60_000 },
      ),
    ]);

    const edges = edgeData.edges.map((e: any) => ({
      id: e.id, source: e.source, target: e.target, relation: e.relation ?? "calls",
    }));

    let violations: any[] = [];
    let rulesError: string | null = null;
    try {
      const rulesResult = await callTool<{ violations: any[] }>("rules.evaluate", { sessionId: _sessionId });
      violations = (rulesResult.violations ?? []).map(mapViolation);
    } catch (err) {
      rulesError = err instanceof Error ? err.message : "rules evaluation failed";
    }

    const { nodeToCluster, clusters: resolvedClusters } =
      assignClusters(nodeData.nodes, summary.clusters);

    const graph = {
      rootDir: rootPath,
      nodes: nodeData.nodes.map((n: any) => ({
        id: n.id, name: n.name, kind: n.kind, file: n.filePath ?? "",
        cluster: nodeToCluster.get(n.id) ?? null,
        startLine: n.startLine, endLine: n.endLine, meta: n.meta ?? {},
      })),
      edges,
      clusters: resolvedClusters,
    };

    let rules: any[] = [];
    let insights: any[] = [];
    try {
      const ruleResult = await callTool<any>("rules.list", { sessionId: _sessionId });
      rules = [...(ruleResult.builtins ?? []), ...(ruleResult.rules ?? []), ...(ruleResult.imported ?? [])];
    } catch {}
    try {
      const sumResult = await callTool<any>("graph.summarize", { sessionId: _sessionId, scope: "all" });
      insights = (sumResult.topSmells ?? []).map((s: any) => ({
        id: s.id ?? `insight-${Math.random().toString(36).slice(2)}`,
        severity: s.severity ?? "info",
        title: s.title ?? s.description ?? "",
        description: s.description ?? "",
        targetIds: s.targetIds ?? s.nodeIds ?? [],
        suggestedPrompt: s.suggestedPrompt ?? null,
      }));
    } catch {}

    return jsonResponse({
      graph, violations, insights, rules, rulesError,
      summary: `${summary.totalNodes} nodes, ${summary.totalEdges} edges, ${summary.clusters?.length ?? 0} clusters`,
      readme: "", coverage: { coveredNodeIds: [], totalNodes: graph.nodes.length },
      rootPath, stats: { files: new Set(graph.nodes.map((n: any) => n.file).filter(Boolean)).size, nodes: graph.nodes.length, edges: edges.length },
    });
  }

  // /api/extract — workspace.open + graph extraction (legacy single-call path)
  if (url === "/api/extract") {
    const rootPath = body.path as string;
    const uri = rootPath.startsWith("file://") ? rootPath : `file://${rootPath}`;
    const openResult = await callTool<{
      sessionId: string;
      extraction?: ExtractionStatsWire;
      workspace?: {
        archetype?: WorkspaceArchetypeWire | null;
        monorepo?: boolean;
      };
    }>("workspace.open", { uris: [uri] });
    _sessionId = openResult.sessionId;
    const extractArchetypeRaw = openResult.workspace?.archetype ?? null;
    const extractArchetype = extractArchetypeRaw
      ? { ...extractArchetypeRaw, monorepo: !!openResult.workspace?.monorepo }
      : null;

    const [summary, nodeData, edgeData] = await Promise.all([
      callTool<any>("graph.summary", { sessionId: _sessionId }),
      callTool<{ nodes: any[] }>("graph.list_nodes", { sessionId: _sessionId, filter: {}, limit: 100_000 }),
      callTool<{ edges: { id: string; source: string; target: string; relation: string }[]; truncated: boolean }>(
        "graph.list_edges", { sessionId: _sessionId, limit: 60_000 },
      ),
    ]);

    const edges = edgeData.edges.map((e: any) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relation: e.relation ?? "calls",
    }));

    // Build violations
    let violations: any[] = [];
    let rulesError: string | null = null;
    try {
      const rulesResult = await callTool<{ violations: any[] }>("rules.evaluate", { sessionId: _sessionId });
      violations = (rulesResult.violations ?? []).map(mapViolation);
    } catch (err) {
      rulesError = err instanceof Error ? err.message : "rules evaluation failed";
    }

    const { nodeToCluster, clusters: resolvedClusters } =
      assignClusters(nodeData.nodes, summary.clusters);

    // Map to v1's extract response shape
    const graph = {
      rootDir: rootPath,
      nodes: nodeData.nodes.map((n: any) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        file: n.filePath ?? "",
        cluster: nodeToCluster.get(n.id) ?? null,
        startLine: n.startLine,
        endLine: n.endLine,
        meta: n.meta ?? {},
      })),
      edges,
      clusters: resolvedClusters,
    };

    // Also fetch rules + summarize for insights
    let rules: any[] = [];
    let insights: any[] = [];
    try {
      const ruleResult = await callTool<any>("rules.list", { sessionId: _sessionId });
      rules = [...(ruleResult.builtins ?? []), ...(ruleResult.rules ?? []), ...(ruleResult.imported ?? [])];
    } catch {}
    try {
      const sumResult = await callTool<any>("graph.summarize", { sessionId: _sessionId, scope: "all" });
      insights = (sumResult.topSmells ?? []).map((s: any) => ({
        id: s.id ?? `insight-${Math.random().toString(36).slice(2)}`,
        severity: s.severity ?? "info",
        title: s.title ?? s.description ?? "",
        description: s.description ?? "",
        targetIds: s.targetIds ?? s.nodeIds ?? [],
        suggestedPrompt: s.suggestedPrompt ?? null,
      }));
    } catch {}

    return jsonResponse({
      graph,
      violations,
      insights,
      rules,
      rulesError,
      summary: `${summary.totalNodes} nodes, ${summary.totalEdges} edges, ${summary.clusters?.length ?? 0} clusters`,
      readme: "",
      coverage: { coveredNodeIds: [], totalNodes: graph.nodes.length },
      rootPath: rootPath,
      stats: { files: new Set(graph.nodes.map((n: any) => n.file).filter(Boolean)).size, nodes: graph.nodes.length, edges: edges.length },
      extraction: openResult.extraction ?? null,
      archetype: extractArchetype,
    });
  }

  // /api/plan — plan proposal (v1 expects { plan, source, usedRealLLM, usage })
  if (url === "/api/plan") {
    if (!_sessionId) throw new Error("No session");
    try {
      const result = await callTool<any>("plan.propose", {
        sessionId: _sessionId,
        rationale: body.prompt ?? body.rationale ?? "",
        steps: body.steps ?? [],
        ...(body.apiKeyOverride ? { apiKey: body.apiKeyOverride } : {}),
      });
      const planId = result.planId;
      const rawSteps = result.steps ?? [];
      const steps = rawSteps.map((s: any) => ({
        kind: "op" as const,
        opName: s.op ?? s.opName ?? "unknown",
        targetId: s.symbolId ?? s.targetId ?? "",
        description: s.description ?? "",
        files: s.files ?? [],
        args: s.args ?? {},
      }));
      if (steps.length === 0) {
        throw new Error("plan.propose returned zero steps");
      }
      const vendor = result.vendor ?? "unknown";
      return jsonResponse({
        plan: {
          intent: body.prompt ?? body.rationale ?? "",
          steps,
          notes: result.markdownUri ?? null,
          planId,
        },
        source: "mcp",
        usedRealLLM: vendor !== "mock" && vendor !== "none",
        vendor,
        fallbackReason: null,
        usage: null,
      });
    } catch (err) {
      return jsonResponse({
        plan: { intent: body.prompt ?? "", steps: [], notes: null },
        source: "mock",
        usedRealLLM: false,
        fallbackReason: err instanceof Error ? err.message : "MCP plan failed",
        usage: null,
      });
    }
  }

  // /api/op/preview
  if (url === "/api/op/preview") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("ops.preview", {
      sessionId: _sessionId,
      op: body.opName ?? body.op,
      symbolId: body.target ?? body.symbolId ?? body.targetId,
      args: body.params ?? body.args ?? {},
    });
    return jsonResponse({ patch: result.diff ? { diff: result.diff } : null, ...result });
  }

  // /api/op/apply — v1 sends per-step apply, v3 uses plan.propose+plan.apply
  if (url === "/api/op/apply") {
    if (!_sessionId) throw new Error("No session");
    const opName = body.opName ?? body.op;
    const target = body.target ?? body.symbolId ?? body.targetId;
    const params = body.params ?? body.args ?? {};
    const rootPath: string = body.rootPath ?? "";

    try {
      // 1. Read the target node's file BEFORE apply (for undo snapshots)
      let beforeContent: string | null = null;
      let targetFilePath: string | null = null;
      try {
        const nodeInfo = await callTool<any>("graph.get_node", {
          sessionId: _sessionId, id: target, include: ["snippet"],
        });
        targetFilePath = nodeInfo.filePath ?? nodeInfo.file ?? null;
        if (targetFilePath) {
          const fileResult = await callTool<any>("workspace.read_file", {
            sessionId: _sessionId, path: targetFilePath,
          });
          beforeContent = fileResult.content ?? null;
        }
      } catch { /* best-effort */ }

      // 2. Preview the op for its diff
      const preview = await callTool<any>("ops.preview", {
        sessionId: _sessionId, op: opName, symbolId: target, args: params,
      });
      const diff = preview.diff ?? "";

      // 3. Propose + apply the plan
      const propose = await callTool<any>("plan.propose", {
        sessionId: _sessionId, rationale: `apply ${opName} to ${target}`,
        steps: [{ op: opName, symbolId: target, args: params }],
      });

      let filesChanged: string[] = [];
      if (propose.planId) {
        const applyResult = await callTool<any>("plan.apply", {
          sessionId: _sessionId, planId: propose.planId,
        });

        // Use the planRunId from plan.apply (not the planId from plan.propose)
        const planRunId = applyResult.planRunId;
        if (planRunId) {
          try {
            const status = await callTool<any>("plan.status", {
              sessionId: _sessionId, planRunId,
            });
            filesChanged = status.filesChanged ?? [];
          } catch { /* best-effort */ }
        }
      }

      // Fallback: infer filesChanged from the target node or diff headers
      if (filesChanged.length === 0) {
        if (targetFilePath) {
          filesChanged = [targetFilePath];
        } else {
          const parsed = parseDiffFilePaths(diff);
          if (parsed.length > 0) filesChanged = parsed;
        }
      }

      // 4. Incremental re-extraction: invalidate only the touched files
      if (filesChanged.length > 0) {
        const touchedUris = filesChanged.map((f) =>
          f.startsWith("file://") ? f : `file://${f}`,
        );
        try {
          await callTool<any>("extract.invalidate", {
            sessionId: _sessionId, touchedUris,
          });
        } catch { /* non-critical */ }
      }

      // 5. Re-fetch graph (incremental: server already invalidated stale nodes)
      const [summary, nodeData, rulesResult] = await Promise.all([
        callTool<any>("graph.summary", { sessionId: _sessionId }),
        callTool<{ nodes: any[] }>("graph.list_nodes", { sessionId: _sessionId, filter: {}, limit: 100_000 }),
        callTool<{ violations: any[] }>("rules.evaluate", { sessionId: _sessionId }).catch(() => ({ violations: [] })),
      ]);

      // Rebuild edges — only walk nodes in touched files; reuse existing
      // edges for untouched nodes to avoid O(N) MCP round-trips.
      const touchedFileSet = new Set(filesChanged.map((f) => f.replace(/^file:\/\//, "")));
      const touchedNodes = nodeData.nodes.filter(
        (n: any) => touchedFileSet.has(n.filePath ?? "") || touchedFileSet.has(n.file ?? ""),
      );
      const untouchedNodes = nodeData.nodes.filter(
        (n: any) => !touchedFileSet.has(n.filePath ?? "") && !touchedFileSet.has(n.file ?? ""),
      );

      const edges: any[] = [];
      const seen = new Set<string>();

      // Walk callees for touched nodes (the ones that may have new edges)
      for (let c = 0; c < touchedNodes.length; c += EDGE_CHUNK) {
        const chunk = touchedNodes.slice(c, c + EDGE_CHUNK);
        const results = await Promise.all(
          chunk.map((n: any) =>
            callTool<{ callees: any[] }>("graph.find_callees", {
              sessionId: _sessionId, symbolId: n.id,
            }).catch(() => ({ callees: [] }))
          ),
        );
        for (let j = 0; j < chunk.length; j++) {
          for (const e of (results[j] as { callees: any[] }).callees) {
            if (!seen.has(e.viaEdge)) {
              seen.add(e.viaEdge);
              edges.push({ id: e.viaEdge, source: chunk[j].id, target: e.id, relation: e.relation ?? "calls" });
            }
          }
        }
      }

      // Walk callees for untouched nodes — still needed for complete graph,
      // but these are unlikely to have changed so we batch aggressively.
      const UNTOUCHED_CHUNK = 40;
      for (let c = 0; c < untouchedNodes.length; c += UNTOUCHED_CHUNK) {
        const chunk = untouchedNodes.slice(c, c + UNTOUCHED_CHUNK);
        const results = await Promise.all(
          chunk.map((n: any) =>
            callTool<{ callees: any[] }>("graph.find_callees", {
              sessionId: _sessionId, symbolId: n.id,
            }).catch(() => ({ callees: [] }))
          ),
        );
        for (let j = 0; j < chunk.length; j++) {
          for (const e of (results[j] as { callees: any[] }).callees) {
            if (!seen.has(e.viaEdge)) {
              seen.add(e.viaEdge);
              edges.push({ id: e.viaEdge, source: chunk[j].id, target: e.id, relation: e.relation ?? "calls" });
            }
          }
        }
      }

      const { nodeToCluster: applyNTC, clusters: applyCl } =
        assignClusters(nodeData.nodes, summary.clusters ?? []);

      // 6. Git context — shape must match GitContextClient
      let git: any = null;
      try {
        const gs = await callTool<any>("git.status", { sessionId: _sessionId });
        git = {
          enabled: !(gs.dirty ?? false),
          branchName: gs.branch ?? null,
          baselineSha: null,
          previousBranch: null,
          dirtyAtStart: gs.dirty ?? false,
          commits: [],
        };
        if (gs.dirty) {
          git.disabledReason = "working tree is dirty";
        }
      } catch { /* git may not be available */ }

      // 7. File snapshots — proper shape for undo
      const relRoot = rootPath.replace(/\/$/, "");
      const fileSnapshot = filesChanged.map((f: string) => {
        const relPath = relRoot && f.startsWith(relRoot)
          ? f.slice(relRoot.length).replace(/^\//, "")
          : f;
        return {
          relPath,
          mode: "modified" as const,
          before: f === targetFilePath ? beforeContent : null,
        };
      });

      return jsonResponse({
        graph: {
          rootDir: rootPath,
          nodes: nodeData.nodes.map((n: any) => ({
            id: n.id, name: n.name, kind: n.kind, file: n.filePath ?? "",
            cluster: applyNTC.get(n.id) ?? null, startLine: n.startLine,
            endLine: n.endLine, meta: n.meta ?? {},
          })),
          edges, clusters: applyCl,
        },
        filesChanged, diff, blockers: [],
        violations: (rulesResult.violations ?? []).map(mapViolation),
        insights: [], rules: [],
        git,
        fileSnapshot,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err), code: "apply-failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // /api/op/restore
  if (url === "/api/op/restore") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("plan.restore", { sessionId: _sessionId });
    return jsonResponse(result);
  }

  // /api/op/restore-git
  if (url === "/api/op/restore-git") {
    return jsonResponse({ ok: true });
  }

  // /api/op/open-pr
  if (url === "/api/op/open-pr") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("github.open_pr", {
      sessionId: _sessionId,
      title: body.title,
      body: body.body ?? "",
      base: body.base ?? "main",
    });
    return jsonResponse({ ok: true, url: result.url });
  }

  // /api/rules/import — store expects { rules, violations, insights }
  if (url === "/api/rules/import") {
    if (!_sessionId) throw new Error("No session");
    const [ruleResult, evalResult] = await Promise.all([
      callTool<any>("rules.list", { sessionId: _sessionId }),
      callTool<any>("rules.evaluate", { sessionId: _sessionId }).catch(() => ({ violations: [] })),
    ]);
    return jsonResponse({
      rules: [...(ruleResult.builtins ?? []), ...(ruleResult.rules ?? []), ...(ruleResult.imported ?? [])],
      violations: (evalResult.violations ?? []).map(mapViolation),
      insights: [],
    });
  }

  // /api/rules/save — export rules to schema.config.json + re-evaluate
  if (url === "/api/rules/save") {
    if (!_sessionId) return jsonResponse({ saved: true, rules: [], violations: [], insights: [] });
    try {
      await callTool<any>("rules.export", { sessionId: _sessionId });
      const [ruleResult, evalResult] = await Promise.all([
        callTool<any>("rules.list", { sessionId: _sessionId }),
        callTool<any>("rules.evaluate", { sessionId: _sessionId }).catch(() => ({ violations: [] })),
      ]);
      return jsonResponse({
        saved: true,
        rules: [...(ruleResult.builtins ?? []), ...(ruleResult.rules ?? []), ...(ruleResult.imported ?? [])],
        violations: (evalResult.violations ?? []).map(mapViolation),
        insights: [],
      });
    } catch {
      return jsonResponse({ saved: true, rules: [], violations: [], insights: [] });
    }
  }

  // /api/rules/check
  if (url === "/api/rules/check") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("rules.evaluate", { sessionId: _sessionId });
    return jsonResponse({
      ...result,
      violations: (result.violations ?? []).map(mapViolation),
    });
  }

  // /api/diff/probe
  if (url === "/api/diff/probe") {
    if (!_sessionId) throw new Error("No session");
    try {
      const result = await callTool<any>("git.status", { sessionId: _sessionId });
      return jsonResponse({
        isGitRepo: true,
        hasRemote: true,
        headBranch: result.branch,
        baseBranch: "main",
        ahead: result.ahead ?? 0,
        behind: result.behind ?? 0,
        workingTreeDirty: result.dirty ?? false,
      });
    } catch {
      return jsonResponse({ isGitRepo: false, hasRemote: false, headBranch: null, baseBranch: null, ahead: 0, behind: 0, workingTreeDirty: false });
    }
  }

  // /api/diff/local
  if (url === "/api/diff/local") {
    if (!_sessionId) throw new Error("No session");
    const ref = body.base ?? "HEAD~1";
    const result = await callTool<any>("graph.diff_against", { sessionId: _sessionId, ref, includeFileStats: true });
    return jsonResponse(result);
  }

  // /api/run-tests — return as streaming text for the store's reader loop
  if (url === "/api/run-tests") {
    if (!_sessionId) throw new Error("No session");
    try {
      const result = await callTool<any>("tests.run", { sessionId: _sessionId });
      const log = result.log ?? `tests: ${result.passed ?? 0} passed, ${result.failed ?? 0} failed (${result.durationMs ?? 0}ms)`;
      const sentinel = result.passed !== undefined
        ? `\n[schema:test-result:${result.passed > 0 && result.failed === 0 ? "pass" : "fail"}]`
        : "";
      return new Response(log + sentinel, { status: 200, headers: { "Content-Type": "text/plain" } });
    } catch (err) {
      return new Response(`[schema:test-error] ${err instanceof Error ? err.message : String(err)}`, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
  }

  // /api/git/blame
  if (url === "/api/git/blame") {
    return jsonResponse({ lines: [] });
  }

  // /api/git/probe
  if (url === "/api/git/probe") {
    if (!_sessionId) throw new Error("No session");
    try {
      const result = await callTool<any>("git.status", { sessionId: _sessionId });
      return jsonResponse({
        available: true,
        schemaReady: !result.dirty,
        currentBranch: result.branch,
        headSha: null,
        isDirty: result.dirty ?? false,
        dirtyFiles: result.untracked ?? [],
      });
    } catch {
      return jsonResponse({ available: false, schemaReady: false, currentBranch: null, headSha: null, isDirty: false, dirtyFiles: [] });
    }
  }

  // /api/file
  if (url.startsWith("/api/file")) {
    const filePath = new URL(url, "http://localhost").searchParams.get("path");
    if (!_sessionId || !filePath) return jsonResponse({ content: "" });
    try {
      const result = await callTool<any>("workspace.read_file", { sessionId: _sessionId, path: filePath });
      return jsonResponse({ content: result.content ?? "" });
    } catch {
      return jsonResponse({ content: "" });
    }
  }

  // /api/positions — backed by IndexedDB (no server round trip)
  if (url === "/api/positions" || url.startsWith("/api/positions")) {
    const params = new URL(url, "http://localhost").searchParams;
    const posKey = `${params.get("repoKey") ?? "default"}:${params.get("level") ?? "1"}`;
    const method = init?.method?.toUpperCase() ?? "GET";

    if (method === "DELETE") {
      const { deletePositions } = await import("./idb");
      await deletePositions(posKey);
      return jsonResponse({ ok: true });
    }
    if (method === "POST") {
      const { savePositions } = await import("./idb");
      const positions = body.positions ?? [];
      await savePositions(posKey, positions);
      return jsonResponse({ ok: true });
    }
    // GET
    const { loadPositions } = await import("./idb");
    const positions = await loadPositions(posKey) ?? [];
    return jsonResponse({ positions });
  }

  // /api/pr/review
  if (url === "/api/pr/review") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("pr.review", { sessionId: _sessionId, base: body.base ?? "HEAD~1" });
    return jsonResponse(result);
  }

  // ── v3-specific routes (not in v1's backend) ──

  // /api/agents-md/read
  if (url === "/api/agents-md/read") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("agents_md.read", {
      sessionId: _sessionId,
      includeUserSection: body.includeUserSection ?? false,
    });
    return jsonResponse(result);
  }

  // /api/agents-md/write-facts
  if (url === "/api/agents-md/write-facts") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("agents_md.write_facts", {
      sessionId: _sessionId,
      target: body.target ?? "AGENTS.md",
    });
    return jsonResponse(result);
  }

  // /api/skills/list
  if (url === "/api/skills/list") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("skills.list", { sessionId: _sessionId });
    return jsonResponse(result);
  }

  // /api/canon/search
  if (url === "/api/canon/search") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("canon.search", {
      sessionId: _sessionId,
      query: body.query,
      paradigm: body.paradigm,
      k: body.k ?? 8,
    });
    return jsonResponse(result);
  }

  // /api/canon/read
  if (url === "/api/canon/read") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("canon.read", {
      sessionId: _sessionId,
      uri: body.uri,
    });
    return jsonResponse(result);
  }

  // /api/graph/query
  if (url === "/api/graph/query") {
    if (!_sessionId) throw new Error("No session");
    const args: Record<string, unknown> = { sessionId: _sessionId };
    if (body.bundledQueryId) args.bundledQueryId = body.bundledQueryId;
    else if (body.query) args.query = body.query;
    if (body.limit) args.limit = body.limit;
    const result = await callTool<any>("graph.query", args);
    return jsonResponse(result);
  }

  // /api/graph/list-queries
  if (url === "/api/graph/list-queries") {
    const result = await callTool<any>("graph.list_queries", {});
    return jsonResponse(result);
  }

  // /api/graph/list-snapshots
  if (url === "/api/graph/list-snapshots") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.list_snapshots", { sessionId: _sessionId });
    return jsonResponse(result);
  }

  // /api/graph/delete-snapshot
  if (url === "/api/graph/delete-snapshot") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.delete_snapshot", {
      sessionId: _sessionId,
      snapshotId: body.snapshotId,
    });
    return jsonResponse(result);
  }

  // /api/graph/import
  if (url === "/api/graph/import") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.import", {
      sessionId: _sessionId,
      format: body.format ?? "scip",
      filePath: body.filePath,
    });
    return jsonResponse(result);
  }

  // /api/graph/get-node
  if (url === "/api/graph/get-node") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.get_node", {
      sessionId: _sessionId,
      id: body.id,
      include: body.include ?? ["snippet", "source"],
    });
    return jsonResponse(result);
  }

  // /api/graph/find-callers
  if (url === "/api/graph/find-callers") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.find_callers", {
      sessionId: _sessionId,
      symbolId: body.symbolId,
      depth: body.depth,
    });
    return jsonResponse(result);
  }

  // /api/graph/path
  if (url === "/api/graph/path") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.path", {
      sessionId: _sessionId,
      from: body.from,
      to: body.to,
      maxHops: body.maxHops ?? 6,
    });
    return jsonResponse(result);
  }

  // /api/graph/search
  if (url === "/api/graph/search") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.search", {
      sessionId: _sessionId,
      query: body.query,
      scope: body.scope,
      limit: body.limit,
    });
    return jsonResponse(result);
  }

  // /api/graph/summarize
  if (url === "/api/graph/summarize") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("graph.summarize", {
      sessionId: _sessionId,
      scope: body.scope,
    });
    return jsonResponse(result);
  }

  // /api/rules/add
  if (url === "/api/rules/add") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("rules.add", {
      sessionId: _sessionId,
      rule: body.rule ?? body,
    });
    return jsonResponse(result);
  }

  // /api/rules/export
  if (url === "/api/rules/export") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("rules.export", {
      sessionId: _sessionId,
      target: body.target,
    });
    return jsonResponse(result);
  }

  // /api/ops/list
  if (url === "/api/ops/list") {
    if (!_sessionId) throw new Error("No session");
    const args: Record<string, unknown> = { sessionId: _sessionId };
    if (body.symbolId) args.symbolId = body.symbolId;
    const result = await callTool<any>("ops.list", args);
    return jsonResponse(result);
  }

  // /api/plan/validate
  if (url === "/api/plan/validate") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("plan.validate", {
      sessionId: _sessionId,
      planId: body.planId,
    });
    return jsonResponse(result);
  }

  // /api/plan/interference
  if (url === "/api/plan/interference") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("plan.interference", {
      sessionId: _sessionId,
      planId: body.planId,
    });
    return jsonResponse(result);
  }

  // /api/plan/status
  if (url === "/api/plan/status") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("plan.status", {
      sessionId: _sessionId,
      planRunId: body.planRunId,
    });
    return jsonResponse(result);
  }

  // /api/plan/cancel
  if (url === "/api/plan/cancel") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("plan.cancel", {
      sessionId: _sessionId,
      planRunId: body.planRunId,
    });
    return jsonResponse(result);
  }

  // /api/workspace/describe
  if (url === "/api/workspace/describe") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("workspace.describe", { sessionId: _sessionId });
    return jsonResponse(result);
  }

  // /api/workspace/close
  if (url === "/api/workspace/close") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("workspace.close", { sessionId: _sessionId });
    _sessionId = null;
    return jsonResponse(result);
  }

  // /api/workspace/list-files
  if (url === "/api/workspace/list-files") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("workspace.list_files", {
      sessionId: _sessionId,
      path: body.path,
    });
    return jsonResponse(result);
  }

  // /api/workspace/write-file
  if (url === "/api/workspace/write-file") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("workspace.write_file", {
      sessionId: _sessionId,
      path: body.path,
      content: body.content,
    });
    return jsonResponse(result);
  }

  // /api/extract/invalidate
  if (url === "/api/extract/invalidate") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("extract.invalidate", {
      sessionId: _sessionId,
      touchedUris: body.touchedUris,
    });
    return jsonResponse(result);
  }

  // /api/markdown/read
  if (url === "/api/markdown/read") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("markdown.read", {
      sessionId: _sessionId,
      uri: body.uri,
    });
    return jsonResponse(result);
  }

  // /api/samplers/list
  if (url === "/api/samplers/list") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("samplers.list", { sessionId: _sessionId });
    return jsonResponse(result);
  }

  // /api/ops/signatures
  if (url === "/api/ops/signatures") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("ops.signatures", {
      sessionId: _sessionId,
      checkSequence: body.checkSequence,
    });
    return jsonResponse(result);
  }

  // /api/incremental/stats
  if (url === "/api/incremental/stats") {
    if (!_sessionId) throw new Error("No session");
    const result = await callTool<any>("incremental.stats", { sessionId: _sessionId });
    return jsonResponse(result);
  }

  // Fallback — pass through
  return fetch(url, init);
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

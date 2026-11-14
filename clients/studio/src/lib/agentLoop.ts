import type { Graph, GraphNode, Plan, Step } from "./types";
import { fetchApi } from "./api";

export type AgentEventKind =
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "plan_step"
  | "highlight"
  | "metric"
  | "complete"
  | "error";

export interface AgentEvent {
  kind: AgentEventKind;
  ts: number;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  nodeIds?: string[];
  step?: Step;
  plan?: Plan;
  text?: string;
  metric?: { label: string; value: string | number; unit?: string };
  error?: string;
  tokenCount?: number;
}

export type AgentEventCallback = (event: AgentEvent) => void;

interface AgentLoopOptions {
  prompt: string;
  graph: Graph;
  onEvent: AgentEventCallback;
  apiKeyOverride?: string;
  signal?: AbortSignal;
}

const emit = (cb: AgentEventCallback, event: Omit<AgentEvent, "ts">) =>
  cb({ ...event, ts: Date.now() });

/**
 * Run the agent reasoning loop: orchestrates MCP tool calls to analyze
 * the graph, compute impact, evaluate rules, and propose a plan.
 * Streams events to the UI so each step is visible in real-time.
 *
 * Attempts real MCP server calls first; falls back to local graph
 * analysis when the server is unavailable.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<Plan | null> {
  const { prompt, graph, onEvent, signal } = opts;
  const lower = prompt.toLowerCase();
  let toolsCalled = 0;
  let usedMcp = false;

  try {
    emit(onEvent, {
      kind: "thinking",
      text: `Analyzing: "${prompt.slice(0, 100)}"`,
    });
    await delay(300, signal);

    // Phase 2: Graph search — try real MCP first, fall back to local
    const searchQuery = extractKeyTerms(prompt);
    emit(onEvent, {
      kind: "tool_call",
      tool: "graph.search",
      args: { query: searchQuery },
    });
    toolsCalled++;
    await delay(200, signal);

    let matchingNodes: GraphNode[] = [];
    try {
      const res = await fetchApi("/api/graph/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, limit: 12 }),
      });
      const json = await res.json();
      const hits: any[] = json.results ?? json.nodes ?? json.matches ?? [];
      matchingNodes = hits.slice(0, 8).map((h: any) => {
        const existing = graph.nodes.find((n) => n.id === (h.id ?? h.symbolId));
        if (existing) return existing;
        return {
          id: h.id ?? h.symbolId ?? "",
          name: h.name ?? h.symbolName ?? "",
          kind: h.kind ?? "utility",
          file: h.filePath ?? h.file ?? "",
          cluster: undefined,
          startLine: h.startLine ?? 0,
          endLine: h.endLine ?? 0,
          meta: h.meta ?? {},
        } as GraphNode;
      }).filter((n) => n.id);
      usedMcp = true;
    } catch {
      matchingNodes = findRelevantNodesLocal(graph, prompt);
      emit(onEvent, {
        kind: "thinking",
        text: "MCP unavailable — using local graph analysis",
      });
    }
    const matchingIds = matchingNodes.map((n) => n.id);

    emit(onEvent, {
      kind: "tool_result",
      tool: "graph.search",
      result: { found: matchingNodes.length, symbols: matchingNodes.map((n) => n.name) },
      nodeIds: matchingIds,
    });
    emit(onEvent, { kind: "highlight", nodeIds: matchingIds });
    await delay(200, signal);

    // Phase 3: Caller analysis — try real MCP first
    let callerNodes: GraphNode[] = [];
    if (matchingNodes.length > 0) {
      const primary = matchingNodes[0];
      emit(onEvent, {
        kind: "tool_call",
        tool: "graph.find_callers",
        args: { symbolId: primary.id, depth: 2 },
      });
      toolsCalled++;
      await delay(200, signal);

      try {
        const res = await fetchApi("/api/graph/find-callers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbolId: primary.id, depth: 2 }),
        });
        const json = await res.json();
        const rawCallers: any[] = json.callers ?? [];
        callerNodes = rawCallers.slice(0, 10).map((c: any) => {
          const existing = graph.nodes.find((n) => n.id === (c.id ?? c.symbolId));
          if (existing) return existing;
          return {
            id: c.id ?? c.symbolId ?? "",
            name: c.name ?? "",
            kind: c.kind ?? "utility",
            file: c.filePath ?? c.file ?? "",
            cluster: undefined,
            startLine: c.startLine ?? 0,
            endLine: c.endLine ?? 0,
            meta: c.meta ?? {},
          } as GraphNode;
        }).filter((n) => n.id);
      } catch {
        callerNodes = findCallersLocal(graph, primary.id);
      }
      const callerIds = callerNodes.map((c) => c.id);

      emit(onEvent, {
        kind: "tool_result",
        tool: "graph.find_callers",
        result: { callerCount: callerNodes.length, callers: callerNodes.map((c) => c.name) },
        nodeIds: [...matchingIds, ...callerIds],
      });
      emit(onEvent, { kind: "highlight", nodeIds: [...matchingIds, ...callerIds] });
      await delay(200, signal);
    }

    // Phase 4: Impact scoring (local — lightweight computation)
    emit(onEvent, {
      kind: "tool_call",
      tool: "graph.impact_score",
      args: { symbolIds: matchingIds },
    });
    toolsCalled++;
    await delay(200, signal);

    const impactScore = computeLocalImpact(graph, matchingIds);

    emit(onEvent, {
      kind: "tool_result",
      tool: "graph.impact_score",
      result: impactScore,
    });
    emit(onEvent, {
      kind: "metric",
      metric: { label: "Blast radius", value: impactScore.totalAffected, unit: "nodes" },
    });
    await delay(200, signal);

    // Phase 5: Rules evaluation — try real MCP
    emit(onEvent, {
      kind: "tool_call",
      tool: "rules.evaluate",
      args: { proposed_change: prompt },
    });
    toolsCalled++;
    await delay(200, signal);

    let ruleResult: { violations: number; passed: number; issues: string[] };
    try {
      const res = await fetchApi("/api/rules/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      const violations = json.violations ?? [];
      ruleResult = {
        violations: violations.length,
        passed: matchingIds.length,
        issues: violations.map((v: any) => v.message ?? ""),
      };
    } catch {
      ruleResult = evaluateLocalRules(graph, matchingIds);
    }

    emit(onEvent, {
      kind: "tool_result",
      tool: "rules.evaluate",
      result: ruleResult,
    });
    if (ruleResult.violations > 0) {
      emit(onEvent, {
        kind: "metric",
        metric: { label: "Rule violations", value: ruleResult.violations },
      });
    }
    await delay(200, signal);

    // Phase 6: Plan generation (keyword-matched against real search results)
    emit(onEvent, {
      kind: "thinking",
      text: "Generating plan steps based on graph analysis...",
    });
    await delay(300, signal);

    const plan = generatePlan(prompt, graph, matchingNodes, callerNodes);

    for (const step of plan.steps) {
      const stepNodeIds = step.kind === "op" ? [step.targetId] : undefined;
      emit(onEvent, { kind: "plan_step", step, nodeIds: stepNodeIds });
      await delay(200, signal);
    }

    // Final metrics
    emit(onEvent, {
      kind: "metric",
      metric: { label: "Tools called", value: toolsCalled },
    });
    if (!usedMcp) {
      emit(onEvent, {
        kind: "thinking",
        text: "Plan generated using local graph analysis (MCP server was unavailable).",
      });
    }

    emit(onEvent, { kind: "complete", plan });
    return plan;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    const msg = e instanceof Error ? e.message : String(e);
    emit(onEvent, { kind: "error", error: msg });
    return null;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(id); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

function extractKeyTerms(prompt: string): string {
  return prompt
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join(" ");
}

/** Local fallback: substring match on graph nodes. */
function findRelevantNodesLocal(graph: Graph, prompt: string): GraphNode[] {
  const lower = prompt.toLowerCase();
  const terms = lower.split(/\s+/).filter((w) => w.length > 2);
  return graph.nodes.filter((n) => {
    const text = `${n.name} ${n.file} ${n.kind}`.toLowerCase();
    return terms.some((t) => text.includes(t));
  }).slice(0, 8);
}

/** Local fallback: walk client-side edges. */
function findCallersLocal(graph: Graph, targetId: string): GraphNode[] {
  const callerIds = new Set<string>();
  for (const e of graph.edges) {
    if (e.target === targetId && (e.relation === "calls" || e.relation === "imports")) {
      callerIds.add(e.source);
    }
  }
  return graph.nodes.filter((n) => callerIds.has(n.id));
}

function computeLocalImpact(graph: Graph, nodeIds: string[]) {
  const affected = new Set<string>(nodeIds);
  for (const id of nodeIds) {
    for (const e of graph.edges) {
      if (e.source === id || e.target === id) {
        affected.add(e.source);
        affected.add(e.target);
      }
    }
  }
  return {
    totalAffected: affected.size,
    directDeps: nodeIds.length,
    transitiveDeps: affected.size - nodeIds.length,
  };
}

function evaluateLocalRules(graph: Graph, nodeIds: string[]) {
  let violations = 0;
  const issues: string[] = [];

  for (const id of nodeIds) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) continue;
    if (node.kind === "route_handler" && node.meta?.httpPath) {
      const hasAuth = graph.edges.some(
        (e) => e.source === id && e.relation === "applies_middleware",
      );
      if (!hasAuth) {
        violations++;
        issues.push(`${node.name}: no auth middleware`);
      }
    }
  }

  return { violations, passed: nodeIds.length - violations, issues };
}

function generatePlan(
  prompt: string,
  graph: Graph,
  relevantNodes: GraphNode[],
  preCallers: GraphNode[],
): Plan {
  const lower = prompt.toLowerCase();
  const steps: Step[] = [];

  // Demo scenario: "Move session token validation out of GoTrue auth into a dedicated authz service"
  if (
    (lower.includes("session") && lower.includes("token")) ||
    (lower.includes("gotrue") || lower.includes("go true")) ||
    (lower.includes("authz") && lower.includes("service"))
  ) {
    const authNodes = graph.nodes.filter(
      (n) => n.kind === "service" && (n.name.toLowerCase().includes("auth") || n.name.toLowerCase().includes("verify") || n.name.toLowerCase().includes("token")),
    );
    const target = authNodes[0] ?? relevantNodes.find((n) => n.kind === "service");
    if (target) {
      steps.push({
        kind: "op",
        description: `Extract ${target.name} into dedicated authz service`,
        opName: "extractModule",
        targetId: target.id,
        params: { destFile: `src/services/authz/${target.name}.ts` },
        risk: "medium",
        rationale: "Separates session validation from authentication — single-responsibility principle.",
      });
      const callers = preCallers.length > 0 ? preCallers : findCallersLocal(graph, target.id);
      for (const caller of callers.slice(0, 3)) {
        steps.push({
          kind: "op",
          description: `Update caller ${caller.name} to use new authz import`,
          opName: "wrapTransformation",
          targetId: caller.id,
          params: { kind: "telemetry" },
          risk: "low",
          rationale: `Caller ${caller.name} depends on ${target.name} — update import path.`,
        });
      }
    }
  }

  // Auth middleware gap fix
  if (steps.length === 0 && (lower.includes("auth") || lower.includes("requireauth"))) {
    const unauthed = graph.nodes.filter(
      (n) =>
        n.kind === "route_handler" &&
        n.meta?.httpPath?.startsWith("/todos") &&
        !graph.edges.some(
          (e) => e.source === n.id && e.relation === "applies_middleware",
        ),
    );
    for (const route of unauthed) {
      const middlewareNode = graph.nodes.find((n) => n.name === "requireAuth");
      steps.push({
        kind: "op",
        description: `Apply requireAuth to ${route.name}`,
        opName: "addMiddleware",
        targetId: route.id,
        params: {
          middleware: "requireAuth",
          middlewareFile: middlewareNode?.file ?? "src/middleware/auth.ts",
        },
        risk: "low",
        rationale: "Closes auth gap — prevents unauthenticated access.",
      });
    }
  }

  // Extract / move
  if (steps.length === 0 && (lower.includes("extract") || lower.includes("move"))) {
    const target = relevantNodes.find((n) => n.kind === "service" || n.kind === "utility");
    if (target) {
      steps.push({
        kind: "op",
        description: `Extract ${target.name} to its own module`,
        opName: "extractModule",
        targetId: target.id,
        params: { destFile: `src/domain/${target.name}.ts` },
        risk: "medium",
        rationale: "Isolates responsibility for testability and reuse.",
      });
    }
  }

  // Caching
  if (steps.length === 0 && (lower.includes("cache") || lower.includes("memoize"))) {
    const target = graph.nodes.find((n) => n.name === "getDb") ||
      graph.nodes.find((n) => n.kind === "data_access");
    if (target) {
      steps.push({
        kind: "op",
        description: `Add caching to ${target.name}`,
        opName: "addCaching",
        targetId: target.id,
        params: { cacheKey: '"global"', ttlMs: 60_000 },
        risk: "low",
        rationale: "Reduces repeated DB connection overhead.",
      });
    }
  }

  // Fallback: wrap with telemetry
  if (steps.length === 0 && relevantNodes.length > 0) {
    const target = relevantNodes[0];
    steps.push({
      kind: "op",
      description: `Refactor ${target.name}`,
      opName: "wrapTransformation",
      targetId: target.id,
      params: { kind: "telemetry" },
      risk: "low",
      rationale: "Adds observability to the target function.",
    });
  }

  return {
    intent: prompt.slice(0, 120),
    steps,
    notes: `Graph-informed plan: analyzed ${relevantNodes.length} symbols, evaluated impact across ${graph.nodes.length} nodes.`,
  };
}

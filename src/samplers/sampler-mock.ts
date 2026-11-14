// Per architecture/schema-v3.md §3.7 — graph-heuristic mock sampler.
// Generates plan suggestions from graph shape without an LLM.

import type { Sampler, SamplerRequest, SamplerResponse } from "./index.ts";
import { BUNDLED_OPS } from "../domain/bundled-ops.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../domain/vocabulary.ts";

export const samplerMock: Sampler = {
  id: "sampler-mock",
  vendor: "mock",

  available() { return true; },

  async dispatch(request: SamplerRequest): Promise<SamplerResponse> {
    if (request.task === "plan") {
      return generatePlanFromGraph(request);
    }
    if (request.task === "evaluate-rule") {
      return { vendor: "mock", model: "graph-heuristic", text: JSON.stringify({ ok: true, reason: "Heuristic evaluation passed" }) };
    }
    return { vendor: "mock", model: "graph-heuristic", text: "No heuristic available for this task." };
  },
};

function generatePlanFromGraph(request: SamplerRequest): SamplerResponse {
  const graph = request.graphContext;
  if (!graph) {
    return { vendor: "mock", model: "graph-heuristic", text: JSON.stringify({ steps: [] }) };
  }

  const allNodes = graph.repos.flatMap((r) => r.nodes);
  const allEdges = graph.repos.flatMap((r) => r.edges);
  const steps: { op: string; symbolId: string; args: Record<string, unknown>; reason: string }[] = [];

  const handlers = allNodes.filter((n) => n.kind === NODE_KINDS.route_handler);
  const targets = new Set(allEdges.map((e) => e.target));

  for (const handler of handlers) {
    const hasMiddleware = allEdges.some((e) => e.target === handler.id && e.relation === EDGE_RELATIONS.applies_middleware);
    if (!hasMiddleware && handlers.length > 1) {
      steps.push({
        op: "addMiddleware",
        symbolId: handler.id,
        args: { name: "authMiddleware" },
        reason: `Route handler "${handler.name}" has no middleware applied`,
      });
    }
  }

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const e of allEdges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
  }

  for (const node of allNodes) {
    if ((inDegree.get(node.id) ?? 0) > 8) {
      steps.push({
        op: "extractModule",
        symbolId: node.id,
        args: { moduleName: `${node.name.replace(/\.\w+$/, "")}-extracted` },
        reason: `"${node.name}" has ${inDegree.get(node.id)} incoming edges — consider breaking it up`,
      });
    }
  }

  return {
    vendor: "mock",
    model: "graph-heuristic",
    text: JSON.stringify({ steps }),
  };
}

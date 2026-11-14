import type { GraphNode, Graph, OpStep } from "./types";

export const APPLICABLE_OPS: Record<string, string[]> = {
  route_handler: ["addMiddleware"],
  service: ["addCaching", "wrapTransformation", "extractModule"],
  data_access: ["addCaching", "extractModule"],
  middleware: ["wrapTransformation"],
  model: [],
  external: [],
  utility: ["addCaching", "extractModule", "wrapTransformation"],
};

export function promptForOp(opName: string, name: string): string {
  switch (opName) {
    case "addMiddleware":
      return `Apply requireAuth middleware to ${name}.`;
    case "addCaching":
      return `Memoize ${name} with a 60-second TTL cache.`;
    case "wrapTransformation":
      return `Wrap ${name} with telemetry.`;
    default:
      return `Extract ${name} into src/domain/${name}.ts.`;
  }
}

export function buildPreviewStep(opName: string, node: GraphNode, graph: Graph): OpStep {
  if (opName === "addMiddleware") {
    const mw = graph.nodes.find(
      (n) => n.kind === "middleware" && n.name === "requireAuth",
    );
    return {
      kind: "op",
      description: `Apply requireAuth to ${node.name}`,
      opName: "addMiddleware",
      targetId: node.id,
      params: {
        middleware: "requireAuth",
        middlewareFile: mw?.file ?? "src/middleware/auth.ts",
      },
      risk: "low",
      rationale: "preview",
    };
  }
  if (opName === "addCaching") {
    return {
      kind: "op",
      description: `Memoize ${node.name}`,
      opName: "addCaching",
      targetId: node.id,
      params: { cacheKey: '"global"', ttlMs: 60_000 },
      risk: "low",
      rationale: "preview",
    };
  }
  if (opName === "wrapTransformation") {
    return {
      kind: "op",
      description: `Wrap ${node.name} with telemetry`,
      opName: "wrapTransformation",
      targetId: node.id,
      params: { kind: "telemetry" },
      risk: "low",
      rationale: "preview",
    };
  }
  return {
    kind: "op",
    description: `Extract ${node.name}`,
    opName: "extractModule",
    targetId: node.id,
    params: { destFile: `src/domain/${node.name}.ts` },
    risk: "medium",
    rationale: "preview",
  };
}

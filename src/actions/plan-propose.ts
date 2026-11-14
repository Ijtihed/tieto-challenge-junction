// Per architecture/schema-v3.md §5.3 action 19
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import { getOp } from "../domain/bundled-ops.ts";
import { dispatchSampler } from "../samplers/index.ts";
import type { Plan, PlanStep } from "../domain/types.ts";

export const planPropose = {
  name: "plan.propose" as const,
  description: "Propose a multi-step refactoring plan with a rationale and ordered operation steps. Can auto-generate steps via a sampler if none are provided.",
  sideEffect: "preflightable" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      rationale: { type: "string", description: "Human-readable rationale for the plan" },
      steps: {
        type: "array",
        description: "Ordered list of plan steps (if empty, a sampler may generate them)",
        items: {
          type: "object",
          properties: {
            op: { type: "string", description: "The operation ID" },
            symbolId: { type: "string", description: "The target node ID" },
            args: { type: "object", description: "Additional arguments for the operation" },
          },
          required: ["op", "symbolId"],
        },
      },
      apiKey: { type: "string", description: "Optional API key override for the sampler (bypasses env var)" },
    },
    required: ["sessionId", "rationale"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }
    const rationale = args["rationale"] as string | undefined;
    if (!rationale) {
      return { ok: false as const, code: "invalid-args", message: "rationale is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    let rawSteps = (args["steps"] as { op: string; symbolId: string; args?: Record<string, unknown> }[]) ?? [];
    const apiKey = args["apiKey"] as string | undefined;

    let samplerVendor: string = "none";

    if (rawSteps.length === 0) {
      const availableOps = [...new Set(session.graph.repos.flatMap((r) => r.nodes.map((n) => n.kind)))];
      const systemPrompt = [
        "You are a code architecture planner. Given a codebase graph and a user request,",
        "generate a JSON object with a `steps` array. Each step has `op` (operation ID),",
        "`symbolId` (target node ID from the graph), and optional `args`.",
        `Available node kinds: ${availableOps.join(", ")}.`,
        "Respond ONLY with valid JSON.",
      ].join(" ");

      const samplerResult = await dispatchSampler(session.samplerPrefs, {
        task: "plan",
        systemPrompt,
        userPrompt: rationale,
        graphContext: session.graph,
        ...(apiKey ? { apiKeyOverride: apiKey } : {}),
      });
      if (samplerResult) {
        samplerVendor = samplerResult.vendor;
        try {
          const parsed = JSON.parse(samplerResult.text) as { steps?: typeof rawSteps };
          if (parsed.steps) rawSteps = parsed.steps;
        } catch { /* ignore parse error */ }
      }
    }

    const steps: PlanStep[] = [];
    for (const s of rawSteps) {
      if (!s.op || !s.symbolId) {
        return { ok: false as const, code: "invalid-args", message: "Each step requires op and symbolId" };
      }
      const op = getOp(s.op);
      if (!op) {
        return { ok: false as const, code: "invalid-args", message: `Unknown op: ${s.op}` };
      }
      const base: Omit<PlanStep, "args"> = { op: s.op, symbolId: s.symbolId };
      steps.push(s.args ? { ...base, args: s.args } : base);
    }

    const plan: Plan = {
      id: `plan_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      rationale,
      steps,
      createdAt: Date.now(),
    };

    session.plans.set(plan.id, plan);
    session.eventBus.emit({ kind: "plan.proposed", planId: plan.id, rationale, at: Date.now() });

    const resultId = randomUUID();
    const markdown = [
      `# Plan: ${rationale}`,
      "",
      `**${steps.length} step(s)**`,
      "",
      ...steps.map((s, i) => `${i + 1}. **${s.op}** on \`${s.symbolId}\``),
    ].join("\n");
    const markdownUri = `markdown://plan.propose/${resultId}`;
    session.markdownResources.set(markdownUri, markdown);

    return {
      ok: true as const,
      data: {
        planId: plan.id,
        vendor: samplerVendor,
        steps,
        projectedGraphPatch: null,
        predictedRuleDelta: null,
        projectedTestImpact: null,
        markdownUri,
      },
    };
  },
};

// Per architecture/schema-v3.md §5.3 action 15 + §17.2
import { randomUUID } from "node:crypto";
import { getSession } from "../session/index.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import { parseDatalog, evaluateDatalog, populateEdb } from "../domain/index.ts";
import type { Rule, Violation } from "../domain/types.ts";

export const rulesAdd = {
  name: "rules.add" as const,
  description: "Add a new architectural rule to the session and immediately evaluate it against the current graph.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      rule: {
        type: "object",
        description: "The rule definition to add. Provide either 'body' (text rule) or 'datalog' (Datalog rule), not both.",
        properties: {
          kind: { type: "string", enum: ["structural", "semantic"], description: "Rule type (default 'structural')" },
          body: { type: "string", description: "The rule body/description (text-based rule)" },
          datalog: { type: "string", description: "Datalog rule text — parsed and validated at add time" },
          severity: { type: "string", enum: ["error", "warn", "info"], description: "Violation severity (default 'warn')" },
          evaluation: { type: "string", enum: ["deterministic", "llm"], description: "Evaluation strategy (default 'deterministic')" },
          globs: { type: "array", items: { type: "string" }, description: "File/name patterns to scope the rule" },
        },
      },
    },
    required: ["sessionId", "rule"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const ruleInput = args["rule"] as {
      kind?: string;
      body?: string;
      datalog?: string;
      severity?: string;
      evaluation?: string;
      globs?: string[];
    } | undefined;
    if (!ruleInput || (!ruleInput.body && !ruleInput.datalog)) {
      return { ok: false as const, code: "invalid-args", message: "rule with body or datalog is required" };
    }

    if (ruleInput.datalog) {
      const parsed = parseDatalog(ruleInput.datalog);
      if ("message" in parsed) {
        return { ok: false as const, code: "invalid-datalog", message: `Datalog parse error at line ${parsed.line}:${parsed.column}: ${parsed.message}` };
      }
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const base: Omit<Rule, "globs"> = {
      id: `rule_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      kind: (ruleInput.kind as Rule["kind"]) ?? "structural",
      body: ruleInput.datalog ?? ruleInput.body!,
      severity: (ruleInput.severity as Rule["severity"]) ?? "warn",
      evaluation: (ruleInput.evaluation as Rule["evaluation"]) ?? "deterministic",
    };
    const rule: Rule = ruleInput.globs
      ? { ...base, globs: ruleInput.globs }
      : base;

    (session.rules as Rule[]).push(rule);

    const violations: Violation[] = [];

    if (ruleInput.datalog) {
      const parsed = parseDatalog(ruleInput.datalog);
      if (!("message" in parsed)) {
        session.incrementalEval.addRules(parsed);
        const result = session.incrementalEval.fullEval();
        for (const v of result.violations) {
          violations.push({
            ruleId: v.ruleId,
            severity: (ruleInput.severity as Violation["severity"]) ?? "warn",
            message: v.message ?? `Datalog rule "${v.ruleId}" violated by ${v.nodeId}`,
            nodeIds: [v.nodeId],
          });
        }
      }
    } else {
      for (const builtin of BUILTIN_RULES) {
        violations.push(...builtin.evaluate(session.graph));
      }
    }

    session.eventBus.emit({ kind: "rules.added", ruleId: rule.id, at: Date.now() });

    return {
      ok: true as const,
      data: {
        id: rule.id,
        persistedTo: "session" as const,
        source: ruleInput.datalog ? "datalog" : "text",
        evaluation: { violations },
      },
    };
  },
};

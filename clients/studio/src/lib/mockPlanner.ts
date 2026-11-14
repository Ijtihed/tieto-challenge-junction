import type {
  Graph,
  GraphNode,
  GraphPatch,
  OpStep,
  Plan,
  Step,
} from "./types";

/**
 * Mock planner: takes a prompt + graph and produces a plausible Plan
 * for one of a small set of canned scenarios that match the bundled
 * fixture (acme/todos-api). On any other repo — or any prompt that
 * doesn't match a scenario whose preconditions hold in the graph —
 * returns zero steps with an explicit "no match" notes string.
 *
 * IMPORTANT: this is a development-time stub, NOT a real planner. The
 * real LLM-backed planner lives in `src/server/planner/anthropic.ts`
 * and only kicks in once `ANTHROPIC_API_KEY` is set AND the fetch in
 * that file is wired up. Until then, every plan flows through here.
 *
 * The historical version of this function would, on a keyword match,
 * return a canned "Apply requireAuth to every /todos route" plan even
 * when the user prompt was about something else (e.g. "extract the
 * auth code into its own service"). Each branch below now requires
 * the relevant graph shape to exist before claiming a match — when
 * preconditions don't hold, we fall through to the "no match" return
 * rather than emitting a wrong-intent plan.
 */
export function mockPlan(prompt: string, graph: Graph): Plan {
  const lower = prompt.toLowerCase();
  const triedScenarios: string[] = [];

  // ─── requireAuth gap fix ──────────────────────────────────────
  // Match only when the prompt is unambiguously about requireAuth AND
  // the graph has both the requireAuth middleware node and at least
  // one /todos route that's missing it. Generic "auth"-mentioning
  // prompts no longer match — too many real prompts mention auth
  // without wanting this exact codemod.
  if (lower.includes("requireauth") || /\brequire\s+auth\b/.test(lower)) {
    triedScenarios.push("requireAuth gap fix");
    // Find the requireAuth function node by NAME, not by hardcoded
    // path — different fixtures put it under different files
    // (`src/middleware/auth.ts` for the bundled demo,
    // `src/auth/middleware.ts` for the with-clusters extractor
    // fixture). Prefer kind:"middleware" when ambiguous.
    const requireAuthNode =
      graph.nodes.find(
        (n) => n.name === "requireAuth" && n.kind === "middleware",
      ) ?? graph.nodes.find((n) => n.name === "requireAuth");
    if (requireAuthNode) {
      const requireAuthId = requireAuthNode.id;
      const requireAuthFile = requireAuthNode.file;
      const unauthed = graph.nodes.filter(
        (n) =>
          n.kind === "route_handler" &&
          n.meta?.httpPath?.startsWith("/todos") &&
          !graph.edges.some(
            (e) =>
              e.relation === "applies_middleware" &&
              e.source === n.id &&
              e.target === requireAuthId,
          ),
      );
      if (unauthed.length > 0) {
        const steps: OpStep[] = unauthed.map((route) => ({
          kind: "op",
          description: `Apply requireAuth to ${route.name}`,
          opName: "addMiddleware",
          targetId: route.id,
          params: {
            middleware: "requireAuth",
            middlewareFile: requireAuthFile,
          },
          risk: "low",
          rationale:
            "POST /todos already uses requireAuth; applying it here closes the auth gap without changing semantics.",
        }));
        return {
          intent:
            "Apply requireAuth to every /todos route that doesn't already have it.",
          steps,
          notes:
            "addMiddleware is idempotent — it refuses if the middleware is already applied — so re-running this plan is safe.",
        };
      }
    }
  }

  // ─── Caching ──────────────────────────────────────────────────
  if (
    lower.includes("memoize") ||
    lower.includes("cache") ||
    lower.includes("caching")
  ) {
    triedScenarios.push("memoize a data-access function");
    const target =
      graph.nodes.find((n) => n.name === "getDb") ||
      graph.nodes.find((n) => n.kind === "data_access");
    if (target) {
      return {
        intent: `Memoize ${target.name} with a TTL cache.`,
        steps: [
          {
            kind: "op",
            description: `addCaching · ${target.name} (60s TTL)`,
            opName: "addCaching",
            targetId: target.id,
            params: { cacheKey: '"global"', ttlMs: 60_000 },
            risk: "low",
            rationale:
              "Pure call — same arguments produce the same handle. Memoization is safe and avoids reopening the SQLite connection.",
          },
        ],
      };
    }
  }

  // ─── Telemetry / logging / retry wrapper ──────────────────────
  if (
    lower.includes("telemetry") ||
    lower.includes("logging") ||
    lower.includes("retry")
  ) {
    triedScenarios.push("wrap a service with telemetry/logging/retry");
    const kind: "telemetry" | "logging" | "retry" = lower.includes("retry")
      ? "retry"
      : lower.includes("logging")
        ? "logging"
        : "telemetry";
    const target =
      graph.nodes.find((n) => n.name === "verifyToken") ||
      graph.nodes.find((n) => n.kind === "service");
    if (target) {
      return {
        intent: `Wrap ${target.name} with ${kind}.`,
        steps: [
          {
            kind: "op",
            description: `wrapTransformation · ${target.name} (${kind})`,
            opName: "wrapTransformation",
            targetId: target.id,
            params: { kind },
            risk: "low",
            rationale: `Wrapping ${target.name}Inner preserves call sites; wrapper adds ${kind} around it.`,
          },
        ],
      };
    }
  }

  // ─── Extract module ───────────────────────────────────────────
  // Require the prompt to specify "extract" or "move" AS THE ACTION,
  // not just contain those words. We still keep the keyword check but
  // also require a concrete service / utility target to exist.
  if (lower.includes("extract") || lower.includes("move")) {
    triedScenarios.push("extract a service into its own module");
    const target =
      graph.nodes.find((n) => n.kind === "service") ||
      graph.nodes.find((n) => n.kind === "utility");
    if (target) {
      return {
        intent: `Extract ${target.name} to its own file.`,
        steps: [
          {
            kind: "op",
            description: `extractModule · ${target.name} → src/domain/${target.name}.ts`,
            opName: "extractModule",
            targetId: target.id,
            params: { destFile: `src/domain/${target.name}.ts` },
            risk: "medium",
            rationale:
              "Re-exports the function from the original file — importers keep working without rewrites; the function body lives at the new path.",
          },
        ],
      };
    }
  }

  // ─── No match ─────────────────────────────────────────────────
  // Everything fell through. Be explicit about what we tried and why
  // nothing fit, so the user can tell "we don't have a planner that
  // understands this" apart from "your prompt is ambiguous".
  const tried =
    triedScenarios.length > 0
      ? `Considered: ${triedScenarios.join("; ")}. None matched the current graph.`
      : "No scenario keywords matched (requireAuth / cache / telemetry / extract).";
  return {
    intent: prompt.slice(0, 80),
    steps: [],
    notes: `Mock planner — no codemod matches this prompt. ${tried} Set GEMINI_API_KEY (or paste a Gemini key into the LLM-key popover on /start) to use the real planner.`,
  };
}

/**
 * Mock graph patch for an op step. Mirrors what the real op.graphPatch would
 * return after a successful apply — used to simulate the canvas mutation.
 */
export function mockGraphPatch(step: Step, graph: Graph): GraphPatch {
  if (step.kind !== "op") return {};

  if (step.opName === "addMiddleware") {
    const middleware = String(step.params.middleware ?? "requireAuth");
    const middlewareFile = String(
      step.params.middlewareFile ?? "src/middleware/auth.ts",
    );
    const middlewareNode = graph.nodes.find(
      (n) => n.name === middleware && n.file === middlewareFile,
    );
    if (!middlewareNode) return {};
    return {
      addEdges: [
        {
          id: `e:applies:${step.targetId}:${middlewareNode.id}:${Date.now()}`,
          source: step.targetId,
          target: middlewareNode.id,
          relation: "applies_middleware",
        },
      ],
    };
  }

  if (step.opName === "addCaching") {
    const original = graph.nodes.find((n) => n.id === step.targetId);
    if (!original) return {};
    const newId = `${step.targetId}__cached`;
    const newNode: GraphNode = {
      id: newId,
      name: `${original.name}Cached`,
      kind: "utility",
      file: original.file.replace(/\.ts$/, "Cached.ts"),
      cluster: original.cluster,
    };
    return {
      addNodes: [newNode],
      addEdges: [
        {
          id: `e:wraps:${newId}:${original.id}`,
          source: newId,
          target: original.id,
          relation: "calls",
        },
      ],
    };
  }

  if (step.opName === "wrapTransformation") {
    const original = graph.nodes.find((n) => n.id === step.targetId);
    if (!original) return {};
    const newId = `${step.targetId}__wrapped`;
    const newNode: GraphNode = {
      id: newId,
      name: `${original.name}Wrapped`,
      kind: "utility",
      file: "src/wrappers/index.ts",
      cluster: original.cluster,
    };
    return {
      addNodes: [newNode],
      addEdges: [
        {
          id: `e:wraps:${newId}:${original.id}`,
          source: newId,
          target: original.id,
          relation: "calls",
        },
      ],
    };
  }

  if (step.opName === "extractModule") {
    return {};
  }

  return {};
}

/**
 * Build a fake but believable unified diff for a step.
 */
export function mockDiff(step: Step, graph: Graph): string {
  if (step.kind !== "op") {
    return step.files
      .map(
        (f) =>
          `--- a/${f.path}\n+++ b/${f.path}\n@@\n${f.content
            .split("\n")
            .map((l) => `+${l}`)
            .join("\n")}\n`,
      )
      .join("\n");
  }

  if (step.opName === "addMiddleware") {
    const route = graph.nodes.find((n) => n.id === step.targetId);
    const method = route?.meta?.httpMethod?.toLowerCase() ?? "get";
    const path = route?.meta?.httpPath ?? "/";
    // Use the actual file the route lives in so the diff reads
    // coherently on any repo (not just the bundled fixture).
    const file = route?.file ?? "src/routes/todos.ts";
    return `--- a/${file}
+++ b/${file}
@@ -1,4 +1,5 @@
 import { Router } from "express";
+import { requireAuth } from "../middleware/auth";
 import { listHandler, createHandler, deleteHandler } from "./handlers";
@@ -12,7 +13,7 @@
   const r = Router();
-  r.${method}("${path}", ${method}Handler);
+  r.${method}("${path}", requireAuth, ${method}Handler);
   return r;
 }
`;
  }

  if (step.opName === "addCaching") {
    const target = graph.nodes.find((n) => n.id === step.targetId);
    const name = target?.name ?? "fn";
    return `--- a/src/cache/memoize.ts (new)
+++ b/src/cache/memoize.ts
@@
+export function memoize<T>(fn: () => T, ttlMs: number) {
+  let v: { val: T; at: number } | null = null;
+  return () => {
+    if (v && Date.now() - v.at < ttlMs) return v.val;
+    v = { val: fn(), at: Date.now() };
+    return v.val;
+  };
+}
--- a/src/db/connection.ts
+++ b/src/db/connection.ts
@@
-export function ${name}() { return openSqlite(); }
+import { memoize } from "../cache/memoize";
+const _${name} = () => openSqlite();
+export const ${name}Cached = memoize(_${name}, 60_000);
+export const ${name} = ${name}Cached;
`;
  }

  if (step.opName === "wrapTransformation") {
    const target = graph.nodes.find((n) => n.id === step.targetId);
    const name = target?.name ?? "fn";
    const kind = String(step.params.kind ?? "telemetry");
    return `--- a/src/services/authService.ts
+++ b/src/services/authService.ts
@@
-export function ${name}(token: string) { /* ... */ }
+export function ${name}Inner(token: string) { /* ... */ }
+import { with${kind[0].toUpperCase() + kind.slice(1)} } from "../wrappers";
+export const ${name} = with${kind[0].toUpperCase() + kind.slice(1)}(${name}Inner, "${name}");
`;
  }

  if (step.opName === "extractModule") {
    const target = graph.nodes.find((n) => n.id === step.targetId);
    const name = target?.name ?? "fn";
    const dest = String(step.params.destFile ?? "");
    return `--- /dev/null
+++ b/${dest}
@@
+export function ${name}() { /* moved from ${target?.file} */ }
--- a/${target?.file}
+++ b/${target?.file}
@@
-export function ${name}() { /* ... */ }
+export { ${name} } from "${dest.replace(/\.ts$/, "")}";
`;
  }

  return "";
}

/** Produces fake streaming test output, line by line. */
export function mockTestLines(): string[] {
  return [
    "",
    " RUN  v1.2.3",
    "",
    " ✓ tests/auth.test.ts (3)",
    "   ✓ requireAuth rejects missing token",
    "   ✓ requireAuth rejects malformed token",
    "   ✓ requireAuth accepts valid bearer token",
    " ✓ tests/todos.test.ts (4)",
    "   ✓ GET /todos requires auth",
    "   ✓ POST /todos requires auth",
    "   ✓ DELETE /todos/:id requires auth",
    "   ✓ POST /todos persists to database",
    "",
    " Test Files  2 passed (2)",
    "      Tests  7 passed (7)",
    "   Start at  10:42:01",
    "   Duration  1.42s",
    "",
  ];
}

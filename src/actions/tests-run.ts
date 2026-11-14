// Per architecture/schema-v3.md §5.3 action 24
import { getSession } from "../session/index.ts";
import { buildAdapterSet } from "../adapters/index.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface TestResult {
  passed: boolean;
  failed: number;
  total: number;
  log: string;
  durationMs: number;
}

function detectRunner(rootPath: string): { command: string; args: string[] } | null {
  const pkg = resolve(rootPath, "package.json");
  if (!existsSync(pkg)) return null;

  try {
    const content = require("node:fs").readFileSync(pkg, "utf-8");
    const parsed = JSON.parse(content) as { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> };

    if (parsed.scripts?.["test"]) {
      return { command: "npm", args: ["test", "--", "--no-coverage"] };
    }

    const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
    if (allDeps?.["vitest"]) return { command: "npx", args: ["vitest", "run"] };
    if (allDeps?.["jest"]) return { command: "npx", args: ["jest", "--no-coverage"] };
  } catch {
    // no package.json or parse error
  }

  return null;
}

export const testsRun = {
  name: "tests.run" as const,
  description: "Auto-detect and run the workspace test suite, returning pass/fail status and output logs.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      timeoutMs: { type: "number", description: "Maximum time to wait for tests in milliseconds (default 600000)" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();

    const rootUri = session.workspaceUris[0];
    const rootPath = rootUri?.startsWith("file://") ? rootUri.slice(7) : undefined;

    if (!rootPath) {
      return { ok: false as const, code: "invalid-args", message: "No file:// workspace URI" };
    }

    const runner = detectRunner(rootPath);
    if (!runner) {
      return {
        ok: true as const,
        data: {
          passed: false,
          failed: 0,
          total: 0,
          log: "No test runner detected. Cannot verify.",
          durationMs: 0,
          skipped: true,
        },
      };
    }

    const timeoutMs = (args["timeoutMs"] as number | undefined) ?? 600_000;
    const adapters = buildAdapterSet(session.adapterMode);
    const startMs = Date.now();

    try {
      const result = await adapters.proc.exec(
        runner.command,
        runner.args,
        { cwd: rootPath, timeoutMs },
      );

      const durationMs = Date.now() - startMs;
      const passed = result.exitCode === 0;
      const log = result.stdout + (result.stderr ? "\n" + result.stderr : "");

      session.eventBus.emit({
        kind: "tests.progress",
        logChunk: log.slice(-500),
        at: Date.now(),
      });

      return {
        ok: true as const,
        data: {
          passed,
          failed: passed ? 0 : 1,
          total: 1,
          log,
          durationMs,
        } satisfies TestResult,
      };
    } catch (err) {
      return {
        ok: false as const,
        code: "io-error",
        message: `Test runner failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

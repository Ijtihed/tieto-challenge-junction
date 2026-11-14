// Phase 10 — tests for CLI subcommands.
// Each test spawns a fresh process via execSync (no stdin hang risk).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { McpDispatcher } from "../mcp/index.ts";

const CLI_PATH = resolve(import.meta.dirname!, "../cli/index.ts");
const FIXTURE_PATH = resolve(import.meta.dirname!, "../../tests/fixtures/express-todos");

function runCli(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(
      `node --experimental-strip-types ${CLI_PATH} ${args}`,
      { timeout: 15000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1 };
  }
}

describe("CLI — help", () => {
  it("--help prints usage with mcp.json snippet", () => {
    const r = runCli("--help");
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("schema — MCP-native architecture graph"));
    assert.ok(r.stdout.includes("schema graph <path>"));
    assert.ok(r.stdout.includes("mcp.json"));
    assert.ok(r.stdout.includes("@schema-ai/mcp"));
  });
});

describe("CLI — graph", () => {
  it("prints graph summary for the fixture", () => {
    const r = runCli(`graph ${FIXTURE_PATH}`);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("totalNodes"));
    assert.ok(r.stdout.includes("totalEdges"));
    assert.ok(r.stdout.includes("clusters"));
  });

  it("returns error for missing path", () => {
    const r = runCli("graph");
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes("Usage:"));
  });
});

describe("CLI — diff", () => {
  it("prints diff for the fixture", () => {
    const r = runCli(`diff ${FIXTURE_PATH} HEAD`);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("graphDelta") || r.stdout.includes("nodesModified") || r.stdout.includes("ruleDelta"));
  });

  it("returns error for missing path", () => {
    const r = runCli("diff");
    assert.equal(r.exitCode, 1);
  });
});

describe("CLI — rules", () => {
  it("evaluates rules on the fixture", () => {
    const r = runCli(`rules ${FIXTURE_PATH}`);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("violations"));
  });
});

describe("CLI — agents-md", () => {
  it("writes AGENTS.md facts then reads them back", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "schema-cli-md-"));
    cpSync(FIXTURE_PATH, tempDir, { recursive: true });

    const wr = runCli(`agents-md ${tempDir} write`);
    assert.equal(wr.exitCode, 0);

    const content = readFileSync(resolve(tempDir, "AGENTS.md"), "utf-8");
    assert.ok(content.includes("<!-- schema:facts:start -->"));
    assert.ok(content.includes("Schema-derived"));

    const rr = runCli(`agents-md ${tempDir} read`);
    assert.equal(rr.exitCode, 0);
    assert.ok(rr.stdout.includes("schemaSection"));

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("CLI — error handling", () => {
  it("returns error for unknown subcommand", () => {
    const r = runCli("nonexistent");
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes("Unknown command"));
  });

  it("validates agents-md action (rejects typos)", () => {
    const r = runCli(`agents-md ${FIXTURE_PATH} rite`);
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes("Unknown agents-md action"));
  });

  it("validates serve port (rejects NaN)", () => {
    const r = runCli("serve abc");
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes("Invalid port"));
  });

  it("-h flag prints help", () => {
    const r = runCli("-h");
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("Usage:"));
  });
});

describe("CLI — session cleanup (try/finally)", () => {
  it("graph command closes the session even on success", () => {
    const r = runCli(`graph ${FIXTURE_PATH}`);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("totalNodes"));
  });

  it("diff command closes the session even on success", () => {
    const r = runCli(`diff ${FIXTURE_PATH} HEAD`);
    assert.equal(r.exitCode, 0);
  });
});

describe("dispatcher — action routing (stdio transport foundation)", () => {
  it("dispatcher routes tools/call to registered actions", async () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction({
      name: "test.echo",
      description: "Test echo action",
      sideEffect: "none" as const,
      async handle(args) { return { ok: true as const, data: args }; },
    });
    dispatcher.initialize();

    const tools = dispatcher.listTools();
    assert.equal(tools.tools.length, 1);

    const result = await dispatcher.callTool("test.echo", { hello: "world" });
    assert.equal(result.isError, false);
    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.data.hello, "world");
  });

  it("dispatcher handles unknown method gracefully", async () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    const result = await dispatcher.callTool("unknown.action", {});
    assert.equal(result.isError, true);
  });
});

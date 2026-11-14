#!/usr/bin/env node
// Per architecture/schema-v3.md §14.10 — schema CLI entry point.
import { McpDispatcher } from "../mcp/dispatcher.ts";
import { createStdioTransport } from "../mcp/transport-stdio.ts";
import { createHttpTransport } from "../mcp/transport-http.ts";
import {
  workspaceOpen, workspaceDescribe, workspaceClose,
  graphSummary, graphListNodes, graphGetNode,
  graphFindCallers, graphFindCallees, graphPath,
  graphSearch, graphDiffAgainst, graphSummarize,
  markdownRead,
  rulesList, rulesEvaluate, rulesAdd,
  opsList, opsPreview,
  planPropose, planApply, planStatus, planRestore, planCancel,
  testsRun,
  samplersList,
  agentsMdRead, agentsMdWriteFacts,
  skillsList, canonSearch, canonRead,
  prReview, driftGenerate, graphAsk, graphEntryPoints, rulesExport, extractInvalidate,
  gitStatus, githubOpenPr,
  workspaceListFiles, workspaceReadFile, workspaceWriteFile,
  workspaceWatchStart, workspaceWatchStop,
  graphQuery, incrementalStats,
  planValidate, opsSignatures, planInterference,
  graphListSnapshots, graphDeleteSnapshot,
  graphImport,
  graphListQueries,
  graphListEdges,
  cachingStats,
} from "../actions/index.ts";
import { TRUST_ACTIONS } from "../actions/trust.ts";
import { logger } from "../obs/index.ts";
import { registerSampler, samplerMock } from "../samplers/index.ts";
import { samplerAnthropic } from "../samplers/sampler-anthropic.ts";
import { samplerOpenai } from "../samplers/sampler-openai.ts";
import { samplerGemini } from "../samplers/sampler-gemini.ts";
import { BUNDLED_SKILLS } from "../wisdom/skills/index.ts";
import { readCanonDoc, CANON_DOCS } from "../wisdom/canon/index.ts";

const ALL_ACTIONS = [
  workspaceOpen, workspaceDescribe, workspaceClose,
  graphSummary, graphListNodes, graphGetNode,
  graphFindCallers, graphFindCallees, graphPath,
  graphSearch, graphDiffAgainst, graphSummarize,
  markdownRead,
  rulesList, rulesEvaluate, rulesAdd,
  opsList, opsPreview,
  planPropose, planApply, planStatus, planRestore, planCancel,
  testsRun,
  samplersList,
  agentsMdRead, agentsMdWriteFacts,
  skillsList, canonSearch, canonRead,
  prReview, driftGenerate, graphAsk, graphEntryPoints, rulesExport, extractInvalidate,
  gitStatus, githubOpenPr,
  workspaceListFiles, workspaceReadFile, workspaceWriteFile,
  workspaceWatchStart, workspaceWatchStop,
  graphQuery, incrementalStats,
  planValidate, opsSignatures, planInterference,
  graphListSnapshots, graphDeleteSnapshot,
  graphImport,
  graphListQueries,
  graphListEdges,
  cachingStats,
  ...TRUST_ACTIONS,
];

function createDispatcher(): McpDispatcher {
  registerSampler(samplerAnthropic);
  registerSampler(samplerOpenai);
  registerSampler(samplerGemini);
  registerSampler(samplerMock);
  const dispatcher = new McpDispatcher({ name: "@schema-ai/mcp", version: "0.0.0" });
  for (const action of ALL_ACTIONS) dispatcher.registerAction(action);

  for (const skill of BUNDLED_SKILLS) {
    dispatcher.registerResource({ uri: `skill://${skill.id}`, name: skill.title, description: skill.description, mimeType: "text/markdown" });
  }
  for (const doc of CANON_DOCS) {
    dispatcher.registerResource({ uri: `canon://${doc.paradigm}/${doc.id}#full`, name: doc.title, description: `${doc.paradigm} — ${doc.author}`, mimeType: "text/plain" });
  }
  dispatcher.setResourceReader((uri) => {
    if (uri.startsWith("skill://")) {
      const id = uri.slice("skill://".length);
      const skill = BUNDLED_SKILLS.find((s) => s.id === id);
      if (skill) return { contents: [{ uri, text: skill.body, mimeType: "text/markdown" }] };
    }
    if (uri.startsWith("canon://")) {
      const chunk = readCanonDoc(uri);
      if (chunk) return { contents: [{ uri, text: chunk.body, mimeType: "text/plain" }] };
    }
    return null;
  });

  dispatcher.initialize();
  return dispatcher;
}

async function runStdio(): Promise<void> {
  const dispatcher = createDispatcher();
  const transport = createStdioTransport(dispatcher);
  transport.start();
}

async function runServe(port: number): Promise<void> {
  const dispatcher = createDispatcher();
  const transport = createHttpTransport(dispatcher, { port });
  await transport.listen();
  logger.info("cli", `Schema MCP server ready at ${transport.address}`);
  logger.info("cli", `${dispatcher.toolCount} tools registered`);

  const shutdown = async () => {
    await transport.close();
    await dispatcher.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function withSession(
  uri: string,
  fn: (sessionId: string) => Promise<void>,
): Promise<void> {
  const dispatcher = createDispatcher();
  let sessionId: string | undefined;
  try {
    const openResult = await dispatcher.callTool("workspace.open", { uris: [uri] });
    const parsed = JSON.parse(openResult.content[0]!.text);
    if (!parsed.ok) {
      process.stderr.write(`Error: ${parsed.message}\n`);
      process.exitCode = 1;
      return;
    }
    sessionId = parsed.data.sessionId;
    await fn(sessionId!);
  } finally {
    if (sessionId) {
      await dispatcher.callTool("workspace.close", { sessionId }).catch(() => {});
    }
    await dispatcher.close();
  }
}

async function printToolResult(dispatcher: McpDispatcher, action: string, args: Record<string, unknown>): Promise<void> {
  const result = await dispatcher.callTool(action, args);
  const parsed = JSON.parse(result.content[0]!.text);
  if (parsed.ok) {
    process.stdout.write(JSON.stringify(parsed.data, null, 2) + "\n");
  } else {
    process.stderr.write(`Error: ${parsed.message}\n`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--stdio") {
    await runStdio();
    return;
  }

  switch (cmd) {
    case "serve": {
      const raw = args[1] ? parseInt(args[1], 10) : 7474;
      if (isNaN(raw) || raw < 1 || raw > 65535) {
        process.stderr.write(`Invalid port: ${args[1]}\n`);
        process.exitCode = 1;
        return;
      }
      await runServe(raw);
      return;
    }

    case "graph": {
      const path = args[1];
      if (!path) { process.stderr.write("Usage: schema graph <path>\n"); process.exitCode = 1; return; }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      await withSession(uri, async (sid) => {
        const d = createDispatcher();
        await printToolResult(d, "graph.summary", { sessionId: sid });
      });
      return;
    }

    case "diff": {
      const path = args[1];
      const ref = args[2] ?? "HEAD";
      if (!path) { process.stderr.write("Usage: schema diff <path> [ref]\n"); process.exitCode = 1; return; }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      await withSession(uri, async (sid) => {
        const d = createDispatcher();
        await printToolResult(d, "graph.diff_against", { sessionId: sid, ref });
      });
      return;
    }

    case "rules": {
      const path = args[1];
      if (!path) { process.stderr.write("Usage: schema rules <path>\n"); process.exitCode = 1; return; }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      await withSession(uri, async (sid) => {
        const d = createDispatcher();
        await printToolResult(d, "rules.evaluate", { sessionId: sid });
      });
      return;
    }

    case "agents-md": {
      const path = args[1];
      const action = args[2];
      if (!path) { process.stderr.write("Usage: schema agents-md <path> [read|write]\n"); process.exitCode = 1; return; }
      if (action && action !== "read" && action !== "write") {
        process.stderr.write(`Unknown agents-md action: ${action}. Use 'read' or 'write'.\n`);
        process.exitCode = 1;
        return;
      }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      const toolName = action === "read" ? "agents_md.read" : "agents_md.write_facts";
      await withSession(uri, async (sid) => {
        const d = createDispatcher();
        await printToolResult(d, toolName, { sessionId: sid });
      });
      return;
    }

    case "pr-review": {
      const path = args[1];
      if (!path) { process.stderr.write("Usage: schema pr-review <path> [base-ref]\n"); process.exitCode = 1; return; }
      const { DEFAULT_PR_REVIEW_BASE_REF } = await import("../actions/pr-review.ts");
      const ref = args[2] ?? DEFAULT_PR_REVIEW_BASE_REF;
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      await withSession(uri, async (sid) => {
        const d = createDispatcher();
        await printToolResult(d, "pr.review", { sessionId: sid, base: ref });
      });
      return;
    }

    case "pr-review-md": {
      // Step 9b CI bridge — emits raw markdown (the comment
      // body for `gh pr comment --body-file -`). Distinct from
      // `pr-review` (above) which emits the structured JSON.
      // Usage: `schema pr-review-md <path> [base-ref] [pr-sha] [studio-url]`
      const path = args[1];
      if (!path) {
        process.stderr.write("Usage: schema pr-review-md <path> [base-ref] [pr-sha] [studio-url]\n");
        process.exitCode = 1;
        return;
      }
      const { runPrReviewMarkdown, DEFAULT_PR_REVIEW_BASE } = await import("./ci-bridge.ts");
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      const base = args[2] ?? DEFAULT_PR_REVIEW_BASE;
      const prSha = args[3];
      const studioUrl = args[4];
      const r = await runPrReviewMarkdown(uri, base, prSha, studioUrl);
      process.stdout.write(r.markdown + "\n");
      process.exitCode = r.exitCode;
      return;
    }

    case "drift-md": {
      // Step 9b CI bridge — emits raw markdown (the body for
      // architecture/drift.md). Distinct from `markdown://drift.generate`
      // resource lookup which requires a live session.
      // Usage: `schema drift-md <path> [window-days]`
      const path = args[1];
      if (!path) {
        process.stderr.write("Usage: schema drift-md <path> [window-days]\n");
        process.exitCode = 1;
        return;
      }
      const { runDriftGenerateMarkdown, DEFAULT_DRIFT_WINDOW_DAYS } = await import("./ci-bridge.ts");
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      const winStr = args[2];
      const win = winStr ? parseInt(winStr, 10) : DEFAULT_DRIFT_WINDOW_DAYS;
      if (winStr && (isNaN(win) || win < 1)) {
        process.stderr.write(`Invalid window-days: ${winStr}\n`);
        process.exitCode = 1;
        return;
      }
      const r = await runDriftGenerateMarkdown(uri, win);
      process.stdout.write(r.markdown + "\n");
      process.exitCode = r.exitCode;
      return;
    }

    case "export-rules": {
      const path = args[1];
      if (!path) { process.stderr.write("Usage: schema export-rules <path>\n"); process.exitCode = 1; return; }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      await withSession(uri, async (sid) => {
        const d = createDispatcher();
        await printToolResult(d, "rules.export", { sessionId: sid });
      });
      return;
    }

    case "git-status": {
      const path = args[1];
      if (!path) { process.stderr.write("Usage: schema git-status <path>\n"); process.exitCode = 1; return; }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      await withSession(uri, async (sid) => {
        const d = createDispatcher();
        await printToolResult(d, "git.status", { sessionId: sid });
      });
      return;
    }

    case "doctor":
      await runDoctor();
      return;

    case "dogfood:summary": {
      // Per Step 11a — read ~/.schema/events.jsonl + print
      // the structured usage summary.
      const { dogfoodSummary } = await import("./dogfood.ts");
      const result = await dogfoodSummary();
      process.stdout.write(result.markdown + "\n");
      process.exitCode = result.exitCode;
      return;
    }

    case "dogfood:survey": {
      // Per Step 11a — record the Sean Ellis answer.
      // Usage: `schema dogfood:survey <V|S|N> [note]`
      const answer = args[1];
      const note = args.slice(2).join(" ").trim() || undefined;
      if (!answer) {
        process.stderr.write(
          "Usage: schema dogfood:survey <V|S|N> [optional note]\n",
        );
        process.exitCode = 1;
        return;
      }
      const { dogfoodSurvey } = await import("./dogfood.ts");
      const surveyOpts: { note?: string } = {};
      if (note !== undefined) surveyOpts.note = note;
      const result = await dogfoodSurvey(answer, surveyOpts);
      process.stdout.write(result.markdown + "\n");
      process.exitCode = result.exitCode;
      return;
    }

    case "dogfood:init-failure-log": {
      const { dogfoodInitFailureLog } = await import("./dogfood.ts");
      const r = await dogfoodInitFailureLog();
      if (r.created) {
        process.stdout.write(`Failure log template created at ${r.path}\n`);
      } else {
        process.stdout.write(`Failure log already exists at ${r.path}\n`);
      }
      return;
    }

    case "dogfood:smoke": {
      // Per Step 11a — run the pre-flight smoke harness on
      // a real repo. Usage: `schema dogfood:smoke <path>`.
      const path = args[1];
      if (!path) {
        process.stderr.write("Usage: schema dogfood:smoke <repo-path>\n");
        process.exitCode = 1;
        return;
      }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      const { dogfoodSmoke } = await import("./dogfood.ts");
      const { workspaceOpen, graphSummary, cachingStats, graphListSnapshots, graphAsk, prReview, driftGenerate, agentsMdWriteFacts } = await import("../actions/index.ts");
      const result = await dogfoodSmoke(uri, {
        "workspace.open": workspaceOpen,
        "graph.summary": graphSummary,
        "caching.stats": cachingStats,
        "graph.list_snapshots": graphListSnapshots,
        "graph.ask": graphAsk,
        "pr.review": prReview,
        "drift.generate": driftGenerate,
        "agents_md.write_facts": agentsMdWriteFacts,
      });
      process.stdout.write(result.markdown + "\n");
      process.exitCode = result.exitCode;
      return;
    }

    case "--help":
    case "-h":
    case "help":
      printHelp();
      return;

    default:
      process.stderr.write(`Unknown command: ${cmd}\nRun 'schema --help' for usage.\n`);
      process.exitCode = 1;
  }
}

async function runDoctor(): Promise<void> {
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir, platform } = await import("node:os");

  const home = homedir();
  const PASS = "\x1b[32m✓\x1b[0m";
  const FAIL = "\x1b[31m✗\x1b[0m";
  let allPass = true;

  function check(label: string, ok: boolean, hint?: string): void {
    process.stdout.write(`  ${ok ? PASS : FAIL} ${label}\n`);
    if (!ok && hint) process.stdout.write(`    → ${hint}\n`);
    if (!ok) allPass = false;
  }

  process.stdout.write("schema doctor\n\n");

  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0]!, 10);
  check(`Node.js ${nodeVersion}`, major >= 22, "Node.js 22+ required: brew install node or fnm install 22");

  const npmBin = process.env.npm_config_prefix
    ? join(process.env.npm_config_prefix, "bin")
    : null;
  const pathDirs = (process.env.PATH ?? "").split(":");
  const schemaInPath = pathDirs.some((d) => {
    try { return existsSync(join(d, "schema")); } catch { return false; }
  });
  check("schema in PATH", schemaInPath, "Ensure $(npm config get prefix)/bin is in your PATH");

  const mcpConfigs: { name: string; paths: string[] }[] = [
    {
      name: "Claude Code",
      paths: [
        join(home, ".claude", "mcp.json"),
        join(home, ".config", "claude", "mcp.json"),
      ],
    },
    {
      name: "Cursor",
      paths: [
        join(home, ".cursor", "mcp.json"),
      ],
    },
    {
      name: "Cline",
      paths: platform() === "darwin"
        ? [join(home, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")]
        : [join(home, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")],
    },
  ];

  for (const cfg of mcpConfigs) {
    let found = false;
    let hasSchema = false;
    for (const p of cfg.paths) {
      if (existsSync(p)) {
        found = true;
        try {
          const raw = readFileSync(p, "utf-8");
          const json = JSON.parse(raw);
          const servers = json.mcpServers ?? json;
          if (servers.schema || servers["@schema-ai/mcp"]) hasSchema = true;
        } catch { /* corrupt config */ }
      }
    }
    if (found) {
      check(`${cfg.name} mcp.json — schema entry`, hasSchema,
        `Add "schema": { "command": "npx", "args": ["-y", "@schema-ai/mcp@latest"] } to ${cfg.paths[0]}`);
    } else {
      check(`${cfg.name} mcp.json`, false, `Config not found at ${cfg.paths[0]}`);
    }
  }

  // Java 21+ for CPG deep analysis
  const { detectJava } = await import("../cpg/detect-java.ts");
  const javaInfo = await detectJava();
  if (javaInfo.available) {
    check(`Java ${javaInfo.version} (CPG deep analysis)`, javaInfo.meetsMinimum,
      "Java 21+ required for CPG: brew install openjdk@21");
  } else {
    check("Java (CPG deep analysis)", false,
      "Optional: install Java 21+ for CPG dataflow/control-flow analysis: brew install openjdk@21");
  }

  // CPG distribution
  const cpgDistPaths = [
    join(process.cwd(), "cpg", "build", "install", "cpg", "bin", "cpg"),
    join(process.cwd(), "cpg", "build", "install", "cpg-mcp", "bin", "cpg-mcp"),
  ];
  const cpgDistFound = cpgDistPaths.some((p) => existsSync(p));
  if (javaInfo.meetsMinimum) {
    check("CPG distribution", cpgDistFound,
      "Build CPG: cd cpg && ./gradlew installDist");
  }

  const studioPaths = platform() === "darwin"
    ? ["/Applications/Schema Studio.app", join(home, "Applications", "Schema Studio.app")]
    : [join(home, ".local", "bin", "schema-studio"), "/usr/local/bin/schema-studio"];
  const studioFound = studioPaths.some((p) => existsSync(p));
  check("Schema Studio (desktop app)", studioFound, "Download from https://schema.dev/studio (optional)");

  process.stdout.write(`\n${allPass ? "All checks passed." : "Some checks failed — see hints above."}\n`);
}

function printHelp(): void {
  process.stdout.write(`schema — MCP-native architecture graph

Usage:
  schema                          Start MCP server in stdio mode (for mcp.json)
  schema --stdio                  Same as above (explicit)
  schema serve [port]             Start HTTP server (default: 7474)
  schema graph <path>             Print graph summary for a workspace
  schema diff <path> [ref]        Print diff against a git ref (default: HEAD)
  schema rules <path>             Evaluate rules on a workspace
  schema agents-md <path> [read|write]   Read or write AGENTS.md facts
  schema pr-review <path> [ref]   Generate a PR review summary (JSON)
  schema pr-review-md <path> [ref] [sha] [studio-url]
                                  Same as pr-review but emit raw markdown
                                  ready for 'gh pr comment --body-file -'
  schema drift-md <path> [days]   Generate drift report as raw markdown
                                  ready for architecture/drift.md
  schema export-rules <path>      Export rules as JSON
  schema git-status <path>        Show git status for a workspace
  schema doctor                   Check environment and config

Step 11 dogfood kit:
  schema dogfood:summary          Summarise ~/.schema/events.jsonl usage; gate ≥ 50 events + ≥ 5 kinds
  schema dogfood:survey <V|S|N>   Record a Sean Ellis PMF answer; gate = "V"
  schema dogfood:init-failure-log Create ~/dogfood-failure-log.md template
  schema dogfood:smoke <path>     Run the pre-flight smoke harness on a repo

  schema --help                   Show this help

Install:
  npm install -g @schema-ai/mcp
  curl -fsSL https://schema.dev/install.sh | sh
  brew install schema-ai/tap/schema

MCP config (Claude Code / Cursor / Cline):
  {
    "mcpServers": {
      "schema": {
        "command": "npx",
        "args": ["-y", "@schema-ai/mcp@latest"]
      }
    }
  }
`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

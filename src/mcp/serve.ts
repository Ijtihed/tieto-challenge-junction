// Per architecture/schema-v3.md §11.3 — `schema serve` entry point.
import { McpDispatcher } from "./dispatcher.ts";
import { createHttpTransport } from "./transport-http.ts";
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
import { logger, createEventLogger, type EventLogger } from "../obs/index.ts";
import { getSession } from "../session/session-store.ts";
import { registerSampler, samplerMock } from "../samplers/index.ts";
import { samplerAnthropic } from "../samplers/sampler-anthropic.ts";
import { samplerOpenai } from "../samplers/sampler-openai.ts";
import { samplerGemini } from "../samplers/sampler-gemini.ts";
import { BUNDLED_SKILLS } from "../wisdom/skills/index.ts";
import { readCanonDoc, CANON_DOCS } from "../wisdom/canon/index.ts";
import { TRUST_ACTIONS } from "../actions/trust.ts";

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
] as const;

export function createSchemaServer(options?: { host?: string; port?: number; eventLogger?: EventLogger }) {
  const eventLog = options?.eventLogger ?? createEventLogger();

  const dispatcher = new McpDispatcher(
    { name: "@schema-ai/mcp", version: "0.0.0" },
    getSession,
    eventLog,
  );

  for (const action of ALL_ACTIONS) {
    dispatcher.registerAction(action);
  }

  registerSampler(samplerAnthropic);
  registerSampler(samplerOpenai);
  registerSampler(samplerGemini);
  registerSampler(samplerMock);

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
  return { dispatcher, transport: createHttpTransport(dispatcher, options), eventLog };
}

async function main() {
  const { dispatcher, transport, eventLog } = createSchemaServer();
  await transport.listen();

  logger.info("serve", `Schema MCP server ready at ${transport.address}`);
  logger.info("serve", `${dispatcher.toolCount} tools registered`);

  const shutdown = async () => {
    await eventLog.close();
    await transport.close();
    await dispatcher.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

import { basename } from "node:path";
const entryBase = basename(process.argv[1] ?? "").replace(/\.(ts|js)$/, "");
const isDirectRun = entryBase === "serve";
if (isDirectRun) {
  main().catch((err) => {
    logger.error("serve", "fatal", { error: String(err) });
    process.exit(1);
  });
}

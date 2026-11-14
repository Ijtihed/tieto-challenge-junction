// Phase 8 — generic config parser for protobuf, OpenAPI YAML, SQL DDL.
// Emits contract nodes from spec/config files.
import type { ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { GraphNode } from "../../domain/multi-repo.ts";
import { NODE_KINDS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { logger } from "../../obs/index.ts";
import { readForParse, recordFailure, recordParsed } from "../parser-config.ts";

function makeContractNode(name: string, filePath: string, scheme: string, startRow: number, endRow: number): GraphNode {
  const locator = { scheme, raw: `${scheme}://${name}` };
  return { id: idFromLocator(locator), kind: NODE_KINDS.contract, name, locator: locator.raw, filePath, startLine: startRow, endLine: endRow };
}

function parseProto(filePath: string, content: string): GraphNode[] {
  const nodes: GraphNode[] = [];
  const serviceRe = /^service\s+(\w+)/gm;
  const rpcRe = /rpc\s+(\w+)\s*\(/g;
  const messageRe = /^message\s+(\w+)/gm;

  for (const m of content.matchAll(serviceRe)) {
    nodes.push(makeContractNode(`proto:${m[1]}`, filePath, "proto", 0, 0));
  }
  for (const m of content.matchAll(rpcRe)) {
    nodes.push(makeContractNode(`proto:rpc:${m[1]}`, filePath, "proto", 0, 0));
  }
  for (const m of content.matchAll(messageRe)) {
    nodes.push(makeContractNode(`proto:msg:${m[1]}`, filePath, "proto", 0, 0));
  }
  return nodes;
}

function parseOpenApiYaml(filePath: string, content: string): GraphNode[] {
  const nodes: GraphNode[] = [];
  const pathRe = /^\s{2}(\/[^\s:]+):/gm;
  const methodRe = /^\s{4}(get|post|put|delete|patch|options|head):/gm;

  let lastPath = "";
  for (const line of content.split("\n")) {
    const pathMatch = /^\s{2}(\/\S+):/.exec(line);
    if (pathMatch) { lastPath = pathMatch[1]!; continue; }
    const methodMatch = /^\s{4}(get|post|put|delete|patch|options|head):/.exec(line);
    if (methodMatch && lastPath) {
      nodes.push(makeContractNode(`openapi:${methodMatch[1]!.toUpperCase()} ${lastPath}`, filePath, "openapi", 0, 0));
    }
  }
  return nodes;
}

function parseSqlDdl(filePath: string, content: string): GraphNode[] {
  const nodes: GraphNode[] = [];
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/gi;

  for (const m of content.matchAll(tableRe)) {
    nodes.push(makeContractNode(`sql:table:${m[1]}`, filePath, "sql", 0, 0));
  }
  return nodes;
}

function parseGraphql(filePath: string, content: string): GraphNode[] {
  const nodes: GraphNode[] = [];
  const typeRe = /^type\s+(\w+)/gm;
  const queryRe = /^\s+(\w+)\s*[\(:{]/gm;

  for (const m of content.matchAll(typeRe)) {
    nodes.push(makeContractNode(`graphql:type:${m[1]}`, filePath, "graphql", 0, 0));
  }
  for (const m of content.matchAll(/^(type\s+Query|type\s+Mutation|type\s+Subscription)/gm)) {
    const blockStart = content.indexOf(m[0]);
    const blockEnd = content.indexOf("}", blockStart);
    if (blockEnd === -1) continue;
    const block = content.slice(blockStart, blockEnd);
    for (const field of block.matchAll(/^\s+(\w+)\s*[\(:{]/gm)) {
      nodes.push(makeContractNode(`graphql:field:${field[1]}`, filePath, "graphql", 0, 0));
    }
  }
  return nodes;
}

function parseTerraform(filePath: string, content: string): GraphNode[] {
  const nodes: GraphNode[] = [];
  const resourceRe = /resource\s+"([^"]+)"\s+"([^"]+)"/g;
  const dataRe = /data\s+"([^"]+)"\s+"([^"]+)"/g;

  for (const m of content.matchAll(resourceRe)) {
    nodes.push(makeContractNode(`iac:resource:${m[1]}.${m[2]}`, filePath, "iac", 0, 0));
  }
  for (const m of content.matchAll(dataRe)) {
    nodes.push(makeContractNode(`iac:data:${m[1]}.${m[2]}`, filePath, "iac", 0, 0));
  }
  return nodes;
}

export const extractorGenericConfig = {
  id: "extractor-generic-config",
  declare() {
    return {
      languages: ["protobuf", "openapi", "sql", "graphql", "yaml", "terraform"] as readonly string[],
      frameworks: [] as readonly string[],
      introducesNodeKinds: [NODE_KINDS.contract],
      introducesEdgeRelations: [] as readonly string[],
      needsAdapters: ["fs"] as readonly ("fs")[],
    };
  },

  async *extract(ctx: ExtractContext): AsyncGenerator<ExtractEvent> {
    const rootPath = ctx.repoUri.startsWith("file://") ? ctx.repoUri.slice(7) : ctx.repoUri;
    let files: string[];
    try { files = await ctx.fs.listDir(rootPath, { recursive: true }); } catch (err) {
      yield { kind: "error", message: String(err) }; return;
    }

    const configFiles = files.filter((f) =>
      f.endsWith(".proto") || f.endsWith(".sql") || f.endsWith(".graphql") || f.endsWith(".gql") ||
      f.endsWith(".tf") ||
      (f.match(/openapi|swagger/) && (f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json")))
    );

    if (configFiles.length === 0) {
      yield { kind: "done", data: { uri: ctx.repoUri, nodes: [], edges: [], clusters: [] } };
      return;
    }

    yield { kind: "progress", message: `parsing ${configFiles.length} config files` };
    const nodes: GraphNode[] = [];

    for (const fp of configFiles) {
      if (ctx.changedFiles && !ctx.changedFiles.has(fp)) continue;
      const outcome = await readForParse(ctx.fs, fp, "extractor-generic-config", ctx.stats);
      if (!outcome.ok) continue;
      const content = outcome.content;
      try {
        if (fp.endsWith(".proto")) nodes.push(...parseProto(fp, content));
        else if (fp.endsWith(".sql")) nodes.push(...parseSqlDdl(fp, content));
        else if (fp.endsWith(".graphql") || fp.endsWith(".gql")) nodes.push(...parseGraphql(fp, content));
        else if (fp.endsWith(".tf")) nodes.push(...parseTerraform(fp, content));
        else nodes.push(...parseOpenApiYaml(fp, content));
        if (ctx.stats) recordParsed(ctx.stats);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("extractor-generic-config", `parse failed for ${fp}`, { error: detail });
        if (ctx.stats) {
          recordFailure(ctx.stats, { filePath: fp, reason: "parse-failed", extractorId: "extractor-generic-config", detail });
        }
      }
    }

    yield { kind: "done", data: { uri: ctx.repoUri, nodes, edges: [], clusters: [] } };
  },
};

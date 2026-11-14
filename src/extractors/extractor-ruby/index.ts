// Ruby extractor with Rails route recognition + imports + calls edges.
import Parser from "tree-sitter";
import Ruby from "tree-sitter-ruby";
import type { ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { RepoSubgraph, GraphNode, GraphEdge } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { logger } from "../../obs/index.ts";
import { bodyFingerprint } from "../../domain/body-fingerprint.ts";
import { PARSER_OPTIONS, readForParse, recordFailure, recordParsed } from "../parser-config.ts";
import { createHash } from "node:crypto";

const rubyParser = new Parser();
rubyParser.setLanguage(Ruby);
type TSNode = Parser.SyntaxNode;

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

function makeNode(name: string, filePath: string, kind: string, startRow: number, endRow: number, bodyText?: string): GraphNode {
  const locator = { scheme: "file", raw: `file://${filePath}#L${startRow}-L${endRow}` };
  const node: GraphNode = { id: idFromLocator(locator), kind, name, locator: locator.raw, filePath, startLine: startRow, endLine: endRow };
  if (bodyText) return { ...node, bodyFingerprint: bodyFingerprint(bodyText) };
  return node;
}

interface EnvAccess { envVar: string; kind: "read" | "write"; enclosingNodeId: string; }
interface FieldAccess { fieldName: string; kind: "read" | "write"; enclosingNodeId: string; }

const RAILS_ROUTE = /^\s*(get|post|put|patch|delete|resources|resource)\s+["':]/;
const REQUIRE_RE = /require(?:_relative)?\s+["']([^"']+)["']/;

function findCallsEnvAndFields(root: TSNode, nodeIndex: Map<string, GraphNode>): {
  calls: { callerNodeId: string; calleeName: string }[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
} {
  const calls: { callerNodeId: string; calleeName: string }[] = [];
  const envAccesses: EnvAccess[] = [];
  const fieldAccesses: FieldAccess[] = [];
  const seen = new Set<string>();
  const seenEnv = new Set<string>();
  const seenFields = new Set<string>();

  function walk(node: TSNode, enclosingId: string | null) {
    if (node.type === "call" || node.type === "method_call") {
      const nameNode = node.childForFieldName("method");
      if (nameNode && enclosingId) {
        const key = `${enclosingId}→${nameNode.text}`;
        if (!seen.has(key)) { seen.add(key); calls.push({ callerNodeId: enclosingId, calleeName: nameNode.text }); }
      }
    }

    // ENV["X"] or ENV["X"] = val — tree-sitter type: element_reference
    if (node.type === "element_reference" && enclosingId) {
      const receiver = node.children[0];
      if (receiver?.text === "ENV") {
        const argNode = node.children.find((c) => c.type === "string" || c.type === "simple_symbol");
        const envVar = argNode?.text.replace(/["']/g, "");
        if (envVar) {
          const parent = node.parent;
          const isWrite = parent?.type === "assignment" && parent.childForFieldName("left")?.id === node.id;
          const envKey = `${enclosingId}:${envVar}:${isWrite ? "w" : "r"}`;
          if (!seenEnv.has(envKey)) {
            seenEnv.add(envKey);
            envAccesses.push({ envVar, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingId });
          }
        }
      }
    }

    // ENV.fetch("X") — tree-sitter type: call with receiver ENV, method fetch
    if ((node.type === "call" || node.type === "method_call") && enclosingId) {
      const recv = node.childForFieldName("receiver");
      const meth = node.childForFieldName("method");
      if (recv?.text === "ENV" && meth?.text === "fetch") {
        const args = node.childForFieldName("arguments");
        const firstArg = args?.children.find((c) => c.type === "string" || c.type === "simple_symbol");
        const envVar = firstArg?.text.replace(/["']/g, "");
        if (envVar) {
          const envKey = `${enclosingId}:${envVar}:r`;
          if (!seenEnv.has(envKey)) {
            seenEnv.add(envKey);
            envAccesses.push({ envVar, kind: "read", enclosingNodeId: enclosingId });
          }
        }
      }
    }

    // @field — instance_variable nodes
    if (node.type === "instance_variable" && enclosingId) {
      const fieldName = node.text.replace(/^@/, "");
      const parent = node.parent;
      const isWrite = parent?.type === "assignment" && parent.childForFieldName("left")?.id === node.id;
      const fieldKey = `${enclosingId}:${fieldName}:${isWrite ? "w" : "r"}`;
      if (!seenFields.has(fieldKey)) {
        seenFields.add(fieldKey);
        fieldAccesses.push({ fieldName, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingId });
      }
    }

    for (const child of node.children) {
      let next = enclosingId;
      if (child.type === "method" || child.type === "singleton_method") {
        const n = child.childForFieldName("name");
        if (n) { const m = nodeIndex.get(n.text); if (m) next = m.id; }
      }
      walk(child, next);
    }
  }
  walk(root, null);
  return { calls, envAccesses, fieldAccesses };
}

function parseRubyFile(filePath: string, content: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: { method: string; path: string; handlerName: string; filePath: string }[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
} {
  const tree = rubyParser.parse(content, undefined, PARSER_OPTIONS);
  const root = tree.rootNode;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const routes: typeof edges extends unknown[] ? { method: string; path: string; handlerName: string; filePath: string }[] : never = [];

  const fileLocator = { scheme: "file", raw: `file://${filePath}` };
  const fileNode: GraphNode = { id: idFromLocator(fileLocator), kind: NODE_KINDS.utility, name: filePath.split("/").pop() ?? filePath, locator: fileLocator.raw, filePath, startLine: 1, endLine: root.endPosition.row + 1 };
  nodes.push(fileNode);

  for (const child of root.children) {
    const sr = child.startPosition.row + 1;
    const er = child.endPosition.row + 1;

    if (child.type === "method" || child.type === "singleton_method") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.utility, sr, er, child.text));
    }

    if (child.type === "class") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        const isController = nameNode.text.endsWith("Controller");
        nodes.push(makeNode(nameNode.text, filePath, isController ? NODE_KINDS.service : NODE_KINDS.model, sr, er, child.text));
      }
    }

    if (child.type === "module") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.utility, sr, er));
    }
  }

  for (const line of content.split("\n")) {
    const reqMatch = REQUIRE_RE.exec(line);
    if (reqMatch) {
      const targetLoc = { scheme: "ruby", raw: `ruby://${reqMatch[1]}` };
      edges.push({ id: edgeId(fileNode.id, idFromLocator(targetLoc), EDGE_RELATIONS.imports), source: fileNode.id, target: idFromLocator(targetLoc), relation: EDGE_RELATIONS.imports });
    }

    const routeMatch = RAILS_ROUTE.exec(line);
    if (routeMatch) {
      const pathMatch = line.match(/["']([^"']+)["']/);
      if (pathMatch) routes.push({ method: routeMatch[1]!.toUpperCase(), path: pathMatch[1]!, handlerName: pathMatch[1]!, filePath });
    }
  }

  const nodeIndex = new Map(nodes.filter((n) => n !== fileNode).map((n) => [n.name, n]));
  const { calls, envAccesses, fieldAccesses } = findCallsEnvAndFields(root, nodeIndex);
  for (const call of calls) {
    const calleeNode = nodeIndex.get(call.calleeName);
    if (calleeNode) {
      edges.push({ id: edgeId(call.callerNodeId, calleeNode.id, EDGE_RELATIONS.calls), source: call.callerNodeId, target: calleeNode.id, relation: EDGE_RELATIONS.calls });
    }
  }

  return { nodes, edges, routes, envAccesses, fieldAccesses };
}

export const extractorRuby = {
  id: "extractor-ruby",
  declare() {
    return {
      languages: ["ruby"] as readonly string[],
      frameworks: ["rails", "sinatra"] as readonly string[],
      introducesNodeKinds: [NODE_KINDS.utility, NODE_KINDS.service, NODE_KINDS.model, NODE_KINDS.external],
      introducesEdgeRelations: [EDGE_RELATIONS.imports, EDGE_RELATIONS.calls, EDGE_RELATIONS.reads_field, EDGE_RELATIONS.writes_field, EDGE_RELATIONS.reads_env, EDGE_RELATIONS.writes_env],
      needsAdapters: ["fs"] as readonly ("fs")[],
    };
  },

  async *extract(ctx: ExtractContext): AsyncGenerator<ExtractEvent> {
    const rootPath = ctx.repoUri.startsWith("file://") ? ctx.repoUri.slice(7) : ctx.repoUri;
    let files: string[];
    try { files = await ctx.fs.listDir(rootPath, { recursive: true }); } catch (err) {
      yield { kind: "error", message: String(err) }; return;
    }

    const rbFiles = files.filter((f) => f.endsWith(".rb") && !f.includes("/vendor/"));
    if (rbFiles.length === 0) { yield { kind: "done", data: { uri: ctx.repoUri, nodes: [], edges: [], clusters: [] } }; return; }

    yield { kind: "progress", message: `parsing ${rbFiles.length} Ruby files` };
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const allRoutes: { method: string; path: string; handlerName: string; filePath: string }[] = [];

    for (const fp of rbFiles) {
      if (ctx.changedFiles && !ctx.changedFiles.has(fp)) continue;
      const outcome = await readForParse(ctx.fs, fp, "extractor-ruby", ctx.stats);
      if (!outcome.ok) continue;
      const content = outcome.content;
      try {
        const result = parseRubyFile(fp, content);
        if (ctx.stats) recordParsed(ctx.stats);
        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
        allRoutes.push(...result.routes);

        for (const field of result.fieldAccesses) {
          const rel = field.kind === "write" ? EDGE_RELATIONS.writes_field : EDGE_RELATIONS.reads_field;
          const targetId = `field:${field.fieldName}`;
          allEdges.push({
            id: edgeId(field.enclosingNodeId, targetId, rel),
            source: field.enclosingNodeId, target: targetId, relation: rel,
          });
        }

        for (const env of result.envAccesses) {
          const envNodeLoc = { scheme: "env", raw: `env://${env.envVar}` };
          const envNodeId = idFromLocator(envNodeLoc);
          if (!allNodes.some((n) => n.id === envNodeId)) {
            allNodes.push({ id: envNodeId, kind: NODE_KINDS.external, name: env.envVar, locator: envNodeLoc.raw });
          }
          const rel = env.kind === "write" ? EDGE_RELATIONS.writes_env : EDGE_RELATIONS.reads_env;
          allEdges.push({
            id: edgeId(env.enclosingNodeId, envNodeId, rel),
            source: env.enclosingNodeId, target: envNodeId, relation: rel,
          });
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("extractor-ruby", `parse failed for ${fp}`, { error: detail });
        if (ctx.stats) {
          recordFailure(ctx.stats, { filePath: fp, reason: "parse-failed", extractorId: "extractor-ruby", detail });
        }
      }
    }

    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i]!;
      const nodeEdges = allEdges.filter((e) => e.source === node.id);
      const reads: string[] = [];
      const writes: string[] = [];
      const calls: string[] = [];

      for (const e of nodeEdges) {
        if (e.relation === EDGE_RELATIONS.reads_field || e.relation === EDGE_RELATIONS.reads_env || e.relation === EDGE_RELATIONS.reads_table) {
          reads.push(e.target);
        } else if (e.relation === EDGE_RELATIONS.writes_field || e.relation === EDGE_RELATIONS.writes_env || e.relation === EDGE_RELATIONS.writes_table) {
          writes.push(e.target);
        } else if (e.relation === EDGE_RELATIONS.calls) {
          calls.push(e.target);
        }
      }

      if (reads.length > 0 || writes.length > 0 || calls.length > 0) {
        allNodes[i] = { ...node, meta: { ...node.meta, effects: { reads, writes, calls } } };
      }
    }

    yield { kind: "done", data: { uri: ctx.repoUri, nodes: allNodes, edges: allEdges, clusters: [], meta: { routes: allRoutes } } as RepoSubgraph & { meta?: unknown } };
  },
};

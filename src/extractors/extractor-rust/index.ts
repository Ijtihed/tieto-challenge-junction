// Rust extractor with Actix/Axum/Rocket handler recognition + imports + calls edges.
import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";
import type { ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { RepoSubgraph, GraphNode, GraphEdge } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { logger } from "../../obs/index.ts";
import { bodyFingerprint } from "../../domain/body-fingerprint.ts";
import { PARSER_OPTIONS, readForParse, recordFailure, recordParsed } from "../parser-config.ts";
import { createHash } from "node:crypto";

const rustParser = new Parser();
rustParser.setLanguage(Rust);
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

const ACTIX_ROUTE = /#\[(get|post|put|delete|patch)\s*\(\s*"([^"]+)"/;
const ENV_READ_RE = /^(?:std::env::var|env::var|std::env::var_os|env::var_os)$/;
const ENV_WRITE_RE = /^(?:std::env::set_var|env::set_var|std::env::remove_var|env::remove_var)$/;

interface EnvAccess { envVar: string; kind: "read" | "write"; enclosingNodeId: string }
interface FieldAccess { fieldName: string; kind: "read" | "write"; enclosingNodeId: string }

function findCallsAndAccesses(root: TSNode, nodeIndex: Map<string, GraphNode>): {
  calls: { callerNodeId: string; calleeName: string }[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
} {
  const calls: { callerNodeId: string; calleeName: string }[] = [];
  const envAccesses: EnvAccess[] = [];
  const fieldAccesses: FieldAccess[] = [];
  const seenCalls = new Set<string>();
  const seenEnv = new Set<string>();
  const seenField = new Set<string>();

  function walk(node: TSNode, enclosingId: string | null) {
    if (node.type === "call_expression" && enclosingId) {
      const fnNode = node.childForFieldName("function");
      if (fnNode) {
        const calleeName = fnNode.text;
        const callKey = `${enclosingId}→${calleeName}`;
        if (!seenCalls.has(callKey)) { seenCalls.add(callKey); calls.push({ callerNodeId: enclosingId, calleeName }); }

        if (ENV_READ_RE.test(calleeName) || ENV_WRITE_RE.test(calleeName)) {
          const args = node.childForFieldName("arguments");
          const firstArg = args?.children.find((c) => c.type === "string_literal");
          if (firstArg) {
            const envVar = firstArg.text.replace(/^"|"$/g, "");
            const kind = ENV_WRITE_RE.test(calleeName) ? "write" as const : "read" as const;
            const envKey = `${enclosingId}→${envVar}→${kind}`;
            if (!seenEnv.has(envKey)) { seenEnv.add(envKey); envAccesses.push({ envVar, kind, enclosingNodeId: enclosingId }); }
          }
        }
      }
    }

    if (node.type === "field_expression" && enclosingId) {
      const value = node.childForFieldName("value");
      const field = node.childForFieldName("field");
      if (value?.text === "self" && field) {
        const parent = node.parent;
        const isWrite = parent?.type === "assignment_expression" && parent.childForFieldName("left") === node;
        const kind = isWrite ? "write" as const : "read" as const;
        const fieldKey = `${enclosingId}→${field.text}→${kind}`;
        if (!seenField.has(fieldKey)) { seenField.add(fieldKey); fieldAccesses.push({ fieldName: field.text, kind, enclosingNodeId: enclosingId }); }
      }
    }

    for (const child of node.children) {
      let next = enclosingId;
      if (child.type === "function_item") {
        const n = child.childForFieldName("name");
        if (n) { const m = nodeIndex.get(n.text); if (m) next = m.id; }
      }
      walk(child, next);
    }
  }
  walk(root, null);
  return { calls, envAccesses, fieldAccesses };
}

function parseRustFile(filePath: string, content: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: { method: string; path: string; handlerName: string; filePath: string }[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
} {
  const tree = rustParser.parse(content, undefined, PARSER_OPTIONS);
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

    if (child.type === "use_declaration") {
      const argNode = child.childForFieldName("argument");
      if (argNode) {
        const targetLoc = { scheme: "rust", raw: `rust://${argNode.text}` };
        edges.push({ id: edgeId(fileNode.id, idFromLocator(targetLoc), EDGE_RELATIONS.imports), source: fileNode.id, target: idFromLocator(targetLoc), relation: EDGE_RELATIONS.imports });
      }
    }

    if (child.type === "function_item") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        const priorText = content.slice(Math.max(0, child.startIndex - 100), child.startIndex);
        const routeMatch = ACTIX_ROUTE.exec(priorText);
        if (routeMatch) {
          routes.push({ method: routeMatch[1]!.toUpperCase(), path: routeMatch[2]!, handlerName: nameNode.text, filePath });
          nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.route_handler, sr, er, child.text));
        } else {
          nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.utility, sr, er, child.text));
        }
      }
    }

    if (child.type === "struct_item") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.model, sr, er, child.text));
    }

    if (child.type === "enum_item") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.utility, sr, er));
    }

    if (child.type === "impl_item") {
      const typeNode = child.childForFieldName("type");
      const body = child.childForFieldName("body");
      if (typeNode && body) {
        for (const member of body.children) {
          if (member.type === "function_item") {
            const methodName = member.childForFieldName("name");
            if (methodName) nodes.push(makeNode(`${typeNode.text}.${methodName.text}`, filePath, NODE_KINDS.utility, member.startPosition.row + 1, member.endPosition.row + 1, member.text));
          }
        }
      }
    }

    if (child.type === "trait_item") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.contract, sr, er, child.text));
    }
  }

  const nodeIndex = new Map(nodes.filter((n) => n !== fileNode).map((n) => [n.name, n]));
  const { calls, envAccesses, fieldAccesses } = findCallsAndAccesses(root, nodeIndex);
  for (const call of calls) {
    const calleeNode = nodeIndex.get(call.calleeName);
    if (calleeNode) {
      edges.push({ id: edgeId(call.callerNodeId, calleeNode.id, EDGE_RELATIONS.calls), source: call.callerNodeId, target: calleeNode.id, relation: EDGE_RELATIONS.calls });
    }
  }

  return { nodes, edges, routes, envAccesses, fieldAccesses };
}

export const extractorRust = {
  id: "extractor-rust",
  declare() {
    return {
      languages: ["rust"] as readonly string[],
      frameworks: ["actix-web", "axum", "rocket"] as readonly string[],
      introducesNodeKinds: [NODE_KINDS.utility, NODE_KINDS.route_handler, NODE_KINDS.model, NODE_KINDS.contract, NODE_KINDS.external],
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

    const rsFiles = files.filter((f) => f.endsWith(".rs") && !f.includes("/target/"));
    if (rsFiles.length === 0) { yield { kind: "done", data: { uri: ctx.repoUri, nodes: [], edges: [], clusters: [] } }; return; }

    yield { kind: "progress", message: `parsing ${rsFiles.length} Rust files` };
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const allRoutes: { method: string; path: string; handlerName: string; filePath: string }[] = [];

    for (const fp of rsFiles) {
      if (ctx.changedFiles && !ctx.changedFiles.has(fp)) continue;
      const outcome = await readForParse(ctx.fs, fp, "extractor-rust", ctx.stats);
      if (!outcome.ok) continue;
      const content = outcome.content;
      try {
        const result = parseRustFile(fp, content);
        if (ctx.stats) recordParsed(ctx.stats);
        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
        allRoutes.push(...result.routes);

        for (const field of result.fieldAccesses) {
          const rel = field.kind === "write" ? EDGE_RELATIONS.writes_field : EDGE_RELATIONS.reads_field;
          const targetId = `field:${field.fieldName}`;
          allEdges.push({ id: edgeId(field.enclosingNodeId, targetId, rel), source: field.enclosingNodeId, target: targetId, relation: rel });
        }

        for (const env of result.envAccesses) {
          const envNodeLoc = { scheme: "env", raw: `env://${env.envVar}` };
          const envNodeId = idFromLocator(envNodeLoc);
          if (!allNodes.some((n) => n.id === envNodeId)) {
            allNodes.push({ id: envNodeId, kind: NODE_KINDS.external, name: env.envVar, locator: envNodeLoc.raw });
          }
          const rel = env.kind === "write" ? EDGE_RELATIONS.writes_env : EDGE_RELATIONS.reads_env;
          allEdges.push({ id: edgeId(env.enclosingNodeId, envNodeId, rel), source: env.enclosingNodeId, target: envNodeId, relation: rel });
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("extractor-rust", `parse failed for ${fp}`, { error: detail });
        if (ctx.stats) {
          recordFailure(ctx.stats, { filePath: fp, reason: "parse-failed", extractorId: "extractor-rust", detail });
        }
      }
    }

    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i]!;
      const nodeEdges = allEdges.filter((e) => e.source === node.id);
      const reads: string[] = [];
      const writes: string[] = [];
      const callsList: string[] = [];
      for (const e of nodeEdges) {
        if (e.relation === EDGE_RELATIONS.reads_field || e.relation === EDGE_RELATIONS.reads_env) reads.push(e.target);
        else if (e.relation === EDGE_RELATIONS.writes_field || e.relation === EDGE_RELATIONS.writes_env) writes.push(e.target);
        else if (e.relation === EDGE_RELATIONS.calls) callsList.push(e.target);
      }
      if (reads.length > 0 || writes.length > 0 || callsList.length > 0) {
        allNodes[i] = { ...node, meta: { ...node.meta, effects: { reads, writes, calls: callsList } } };
      }
    }

    yield { kind: "done", data: { uri: ctx.repoUri, nodes: allNodes, edges: allEdges, clusters: [], meta: { routes: allRoutes } } as RepoSubgraph & { meta?: unknown } };
  },
};

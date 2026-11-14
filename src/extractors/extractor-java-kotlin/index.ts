// Java/Kotlin extractor with Spring annotation recognition + calls edges.
import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import type { ExtractContext, ExtractEvent } from "../extract-types.ts";
import type { RepoSubgraph, GraphNode, GraphEdge } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { logger } from "../../obs/index.ts";
import { bodyFingerprint } from "../../domain/body-fingerprint.ts";
import { PARSER_OPTIONS, readForParse, recordFailure, recordParsed } from "../parser-config.ts";
import { createHash } from "node:crypto";

const javaParser = new Parser();
javaParser.setLanguage(Java);

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

function makeNode(name: string, filePath: string, kind: string, startRow: number, endRow: number, bodyText?: string): GraphNode {
  const locator = { scheme: "file", raw: `file://${filePath}#L${startRow}-L${endRow}` };
  const node: GraphNode = { id: idFromLocator(locator), kind, name, locator: locator.raw, filePath, startLine: startRow, endLine: endRow };
  if (bodyText) return { ...node, bodyFingerprint: bodyFingerprint(bodyText) };
  return node;
}

type TSNode = Parser.SyntaxNode;
type EnvAccess = { envVar: string; kind: "read" | "write"; enclosingNodeId: string };
type FieldAccess = { fieldName: string; kind: "read" | "write"; enclosingNodeId: string };
const SPRING_MAPPING = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/;

function findCalls(root: TSNode, nodeIndex: Map<string, GraphNode>): {
  calls: { callerNodeId: string; calleeName: string }[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
} {
  const calls: { callerNodeId: string; calleeName: string }[] = [];
  const envAccesses: EnvAccess[] = [];
  const fieldAccesses: FieldAccess[] = [];
  const seen = new Set<string>();
  const seenFields = new Set<string>();

  function walk(node: TSNode, enclosingId: string | null) {
    if (node.type === "method_invocation" && enclosingId) {
      const nameNode = node.childForFieldName("name");
      const objNode = node.childForFieldName("object");
      if (nameNode) {
        const key = `${enclosingId}→${nameNode.text}`;
        if (!seen.has(key)) { seen.add(key); calls.push({ callerNodeId: enclosingId, calleeName: nameNode.text }); }
      }
      if (objNode && nameNode && objNode.text === "System" && nameNode.text === "getenv") {
        const args = node.childForFieldName("arguments");
        if (args) {
          const firstArg = args.children.find((c) => c.type === "string_literal");
          if (firstArg) {
            const envVar = firstArg.text.replace(/^["']|["']$/g, "");
            if (envVar) envAccesses.push({ envVar, kind: "read", enclosingNodeId: enclosingId });
          }
        }
      }
    }

    if ((node.type === "field_access" || node.type === "member_expression") && enclosingId) {
      const obj = node.childForFieldName("object");
      const field = node.childForFieldName("field") ?? node.childForFieldName("property");
      if (obj && field && obj.text === "this") {
        const fieldName = field.text;
        const parent = node.parent;
        const isWrite = parent?.type === "assignment_expression" && parent.childForFieldName("left")?.id === node.id;
        const fieldKey = `${enclosingId}:${fieldName}:${isWrite ? "w" : "r"}`;
        if (!seenFields.has(fieldKey)) {
          seenFields.add(fieldKey);
          fieldAccesses.push({ fieldName, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingId });
        }
      }
    }

    for (const child of node.children) {
      let next = enclosingId;
      if (child.type === "method_declaration") {
        const n = child.childForFieldName("name");
        if (n) { const m = nodeIndex.get(n.text); if (m) next = m.id; }
      }
      walk(child, next);
    }
  }
  walk(root, null);
  return { calls, envAccesses, fieldAccesses };
}

function parseJavaFile(filePath: string, content: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: { method: string; path: string; handlerName: string; filePath: string }[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
} {
  const tree = javaParser.parse(content, undefined, PARSER_OPTIONS);
  const root = tree.rootNode;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const routes: typeof nodes extends unknown[] ? { method: string; path: string; handlerName: string; filePath: string }[] : never = [];

  const fileLocator = { scheme: "file", raw: `file://${filePath}` };
  nodes.push({ id: idFromLocator(fileLocator), kind: NODE_KINDS.utility, name: filePath.split("/").pop() ?? filePath, locator: fileLocator.raw, filePath, startLine: 1, endLine: root.endPosition.row + 1 });

  for (const child of root.children) {
    if (child.type === "import_declaration") {
      const pathText = child.text.replace(/^import\s+(static\s+)?/, "").replace(/;$/, "").trim();
      if (pathText) {
        const targetLoc = { scheme: "java", raw: `java://${pathText}` };
        const fileNode = nodes[0]!;
        edges.push({ id: edgeId(fileNode.id, idFromLocator(targetLoc), EDGE_RELATIONS.imports), source: fileNode.id, target: idFromLocator(targetLoc), relation: EDGE_RELATIONS.imports });
      }
    }

    if (child.type === "class_declaration") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        const className = nameNode.text;
        nodes.push(makeNode(className, filePath, NODE_KINDS.service, child.startPosition.row + 1, child.endPosition.row + 1, child.text));

        const body = child.childForFieldName("body");
        if (body) {
          for (const member of body.children) {
            if (member.type === "method_declaration") {
              const methodName = member.childForFieldName("name");
              if (methodName) {
                const fullText = content.slice(Math.max(0, member.startIndex - 200), member.startIndex);
                const springMatch = SPRING_MAPPING.exec(fullText);
                if (springMatch) {
                  const mapping = springMatch[1]!;
                  const method = mapping.replace("Mapping", "").toUpperCase() || "GET";
                  routes.push({ method: method === "REQUEST" ? "GET" : method, path: springMatch[2]!, handlerName: methodName.text, filePath });
                  nodes.push(makeNode(`${className}.${methodName.text}`, filePath, NODE_KINDS.route_handler, member.startPosition.row + 1, member.endPosition.row + 1, member.text));
                } else {
                  nodes.push(makeNode(`${className}.${methodName.text}`, filePath, NODE_KINDS.utility, member.startPosition.row + 1, member.endPosition.row + 1, member.text));
                }
              }
            }
          }
        }
      }
    }

    if (child.type === "interface_declaration") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.contract, child.startPosition.row + 1, child.endPosition.row + 1));
    }
  }

  const nodeIndex = new Map(nodes.filter((n) => !n.locator.endsWith(filePath)).map((n) => [n.name.split(".").pop()!, n]));
  const { calls, envAccesses, fieldAccesses } = findCalls(root, nodeIndex);
  for (const call of calls) {
    const calleeNode = nodeIndex.get(call.calleeName);
    if (calleeNode) {
      edges.push({ id: edgeId(call.callerNodeId, calleeNode.id, EDGE_RELATIONS.calls), source: call.callerNodeId, target: calleeNode.id, relation: EDGE_RELATIONS.calls });
    }
  }

  return { nodes, edges, routes, envAccesses, fieldAccesses };
}

const KOTLIN_DATA_CLASS_RE = /\bdata\s+class\s+(\w+)/;
const KOTLIN_CLASS_RE = /\bclass\s+(\w+)/;
const KOTLIN_OBJECT_RE = /\bobject\s+(\w+)/;
const KOTLIN_FUN_RE = /\bfun\s+(?:<[^>]+>\s+)?(\w+)/;
const KOTLIN_IMPORT_RE = /^\s*import\s+([\w.]+(?:\.\*)?)/;
const KOTLIN_SPRING_ROUTE_RE = /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']\)/;
const KOTLIN_REQUEST_MAPPING_RE = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']\)/;

const KOTLIN_GETENV_RE = /System\.getenv\(\s*["'](\w+)["']\s*\)/g;
const KOTLIN_THIS_FIELD_RE = /this\.(\w+)/g;

function parseKotlinFile(filePath: string, content: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: { method: string; path: string; handlerName: string; filePath: string }[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
} {
  const lines = content.split("\n");
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const routes: { method: string; path: string; handlerName: string; filePath: string }[] = [];
  const envAccesses: EnvAccess[] = [];
  const fieldAccesses: FieldAccess[] = [];
  const seenFields = new Set<string>();

  const fileLocator = { scheme: "file", raw: `file://${filePath}` };
  const fileNode: GraphNode = {
    id: idFromLocator(fileLocator), kind: NODE_KINDS.utility,
    name: filePath.split("/").pop() ?? filePath, locator: fileLocator.raw,
    filePath, startLine: 1, endLine: lines.length,
  };
  nodes.push(fileNode);

  let currentClass: string | null = null;
  let classBraceCount = 0;
  let pendingRoute: { method: string; path: string } | null = null;
  let currentFuncNodeId: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    if (currentClass) {
      classBraceCount += opens - closes;
      if (classBraceCount <= 0) {
        currentClass = null;
        classBraceCount = 0;
      }
    }

    const importMatch = KOTLIN_IMPORT_RE.exec(line);
    if (importMatch) {
      const targetLoc = { scheme: "kotlin", raw: `kotlin://${importMatch[1]}` };
      edges.push({
        id: edgeId(fileNode.id, idFromLocator(targetLoc), EDGE_RELATIONS.imports),
        source: fileNode.id, target: idFromLocator(targetLoc), relation: EDGE_RELATIONS.imports,
      });
      continue;
    }

    const springMatch = KOTLIN_SPRING_ROUTE_RE.exec(line);
    if (springMatch) {
      pendingRoute = { method: springMatch[1]!.toUpperCase(), path: springMatch[2]! };
      continue;
    }
    const reqMapMatch = KOTLIN_REQUEST_MAPPING_RE.exec(line);
    if (reqMapMatch) {
      pendingRoute = { method: "GET", path: reqMapMatch[1]! };
      continue;
    }

    const dataMatch = KOTLIN_DATA_CLASS_RE.exec(line);
    if (dataMatch) {
      nodes.push(makeNode(dataMatch[1]!, filePath, NODE_KINDS.model, lineNum, lineNum));
      currentClass = dataMatch[1]!;
      classBraceCount = opens - closes;
      continue;
    }

    const classMatch = KOTLIN_CLASS_RE.exec(line);
    if (classMatch) {
      nodes.push(makeNode(classMatch[1]!, filePath, NODE_KINDS.service, lineNum, lineNum));
      currentClass = classMatch[1]!;
      classBraceCount = opens - closes;
      continue;
    }

    const objMatch = KOTLIN_OBJECT_RE.exec(line);
    if (objMatch) {
      nodes.push(makeNode(objMatch[1]!, filePath, NODE_KINDS.service, lineNum, lineNum));
      continue;
    }

    const funMatch = KOTLIN_FUN_RE.exec(line);
    if (funMatch) {
      const funName = funMatch[1]!;
      const qualifiedName = currentClass ? `${currentClass}.${funName}` : funName;
      if (pendingRoute) {
        routes.push({ method: pendingRoute.method, path: pendingRoute.path, handlerName: qualifiedName, filePath });
        const funNode = makeNode(qualifiedName, filePath, NODE_KINDS.route_handler, lineNum, lineNum);
        nodes.push(funNode);
        currentFuncNodeId = funNode.id;
        pendingRoute = null;
      } else {
        const funNode = makeNode(qualifiedName, filePath, NODE_KINDS.utility, lineNum, lineNum);
        nodes.push(funNode);
        currentFuncNodeId = funNode.id;
      }
      continue;
    }

    if (pendingRoute && line.trim() && !line.trim().startsWith("@") && !line.trim().startsWith("//")) {
      pendingRoute = null;
    }

    if (currentFuncNodeId) {
      let envM: RegExpExecArray | null;
      KOTLIN_GETENV_RE.lastIndex = 0;
      while ((envM = KOTLIN_GETENV_RE.exec(line)) !== null) {
        envAccesses.push({ envVar: envM[1]!, kind: "read", enclosingNodeId: currentFuncNodeId });
      }

      let fieldM: RegExpExecArray | null;
      KOTLIN_THIS_FIELD_RE.lastIndex = 0;
      while ((fieldM = KOTLIN_THIS_FIELD_RE.exec(line)) !== null) {
        const fieldName = fieldM[1]!;
        const isWrite = line.includes(`this.${fieldName}`) && /this\.\w+\s*=/.test(line);
        const fieldKey = `${currentFuncNodeId}:${fieldName}:${isWrite ? "w" : "r"}`;
        if (!seenFields.has(fieldKey)) {
          seenFields.add(fieldKey);
          fieldAccesses.push({ fieldName, kind: isWrite ? "write" : "read", enclosingNodeId: currentFuncNodeId });
        }
      }
    }
  }

  return { nodes, edges, routes, envAccesses, fieldAccesses };
}

export const extractorJavaKotlin = {
  id: "extractor-java-kotlin",
  declare() {
    return {
      languages: ["java", "kotlin"] as readonly string[],
      frameworks: ["spring", "spring-boot"] as readonly string[],
      introducesNodeKinds: [NODE_KINDS.utility, NODE_KINDS.service, NODE_KINDS.route_handler, NODE_KINDS.contract, NODE_KINDS.model],
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

    const javaFiles = files.filter((f) => (f.endsWith(".java") || f.endsWith(".kt") || f.endsWith(".kts")) && !f.includes("/build/") && !f.includes("/target/"));
    if (javaFiles.length === 0) { yield { kind: "done", data: { uri: ctx.repoUri, nodes: [], edges: [], clusters: [] } }; return; }

    yield { kind: "progress", message: `parsing ${javaFiles.length} Java/Kotlin files` };
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const allRoutes: { method: string; path: string; handlerName: string; filePath: string }[] = [];
    const allEnvAccesses: EnvAccess[] = [];
    const allFieldAccesses: FieldAccess[] = [];

    for (const fp of javaFiles) {
      if (ctx.changedFiles && !ctx.changedFiles.has(fp)) continue;
      const outcome = await readForParse(ctx.fs, fp, "extractor-java-kotlin", ctx.stats);
      if (!outcome.ok) continue;
      const content = outcome.content;
      try {
        if (fp.endsWith(".kt") || fp.endsWith(".kts")) {
          const result = parseKotlinFile(fp, content);
          if (ctx.stats) recordParsed(ctx.stats);
          allNodes.push(...result.nodes);
          allEdges.push(...result.edges);
          allRoutes.push(...result.routes);
          allEnvAccesses.push(...result.envAccesses);
          allFieldAccesses.push(...result.fieldAccesses);
          continue;
        }
        const result = parseJavaFile(fp, content);
        if (ctx.stats) recordParsed(ctx.stats);
        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
        allRoutes.push(...result.routes);
        allEnvAccesses.push(...result.envAccesses);
        allFieldAccesses.push(...result.fieldAccesses);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("extractor-java-kotlin", `parse failed for ${fp}`, { error: detail });
        if (ctx.stats) {
          recordFailure(ctx.stats, { filePath: fp, reason: "parse-failed", extractorId: "extractor-java-kotlin", detail });
        }
      }
    }

    for (const field of allFieldAccesses) {
      const rel = field.kind === "write" ? EDGE_RELATIONS.writes_field : EDGE_RELATIONS.reads_field;
      const targetId = `field:${field.fieldName}`;
      allEdges.push({
        id: edgeId(field.enclosingNodeId, targetId, rel),
        source: field.enclosingNodeId, target: targetId, relation: rel,
      });
    }

    for (const env of allEnvAccesses) {
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

    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i]!;
      const nodeEdges = allEdges.filter((e) => e.source === node.id);
      const reads: string[] = [];
      const writes: string[] = [];
      const callTargets: string[] = [];

      for (const e of nodeEdges) {
        if (e.relation === EDGE_RELATIONS.reads_field || e.relation === EDGE_RELATIONS.reads_env || e.relation === EDGE_RELATIONS.reads_table) {
          reads.push(e.target);
        } else if (e.relation === EDGE_RELATIONS.writes_field || e.relation === EDGE_RELATIONS.writes_env || e.relation === EDGE_RELATIONS.writes_table) {
          writes.push(e.target);
        } else if (e.relation === EDGE_RELATIONS.calls) {
          callTargets.push(e.target);
        }
      }

      if (reads.length > 0 || writes.length > 0 || callTargets.length > 0) {
        allNodes[i] = { ...node, meta: { ...node.meta, effects: { reads, writes, calls: callTargets } } };
      }
    }

    yield { kind: "done", data: { uri: ctx.repoUri, nodes: allNodes, edges: allEdges, clusters: [], meta: { routes: allRoutes } } as RepoSubgraph & { meta?: unknown } };
  },
};

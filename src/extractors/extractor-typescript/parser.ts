// Per architecture/schema-v3.md §14.2 — tree-sitter parser for TS/JS.
// Emits: file nodes, function/class/method nodes, import edges, calls edges,
// Express/Fastify/Koa route_handler recognition + registers_route edges.

import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import type { GraphNode } from "../../domain/multi-repo.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { bodyFingerprint } from "../../domain/body-fingerprint.ts";
import { PARSER_OPTIONS } from "../parser-config.ts";
import { resolve, dirname } from "node:path";

const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript);

const jsParser = new Parser();
jsParser.setLanguage(TypeScript.tsx);

export interface CallInfo {
  callerNodeId: string;
  calleeName: string;
}

export interface RouteRegistration {
  method: string;
  path: string;
  handlerName: string;
  filePath: string;
  registrarNodeId: string;
}

export interface EnvAccess {
  envVar: string;
  kind: "read" | "write";
  enclosingNodeId: string;
}

export interface FieldAccess {
  fieldName: string;
  kind: "read" | "write";
  enclosingNodeId: string;
}

export interface ParseResult {
  nodes: GraphNode[];
  imports: { source: string; resolvedPath: string }[];
  calls: CallInfo[];
  routes: RouteRegistration[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
}

function getParser(filePath: string): Parser {
  if (filePath.endsWith(".js") || filePath.endsWith(".jsx") || filePath.endsWith(".tsx")) {
    return jsParser;
  }
  return tsParser;
}

function makeNode(name: string, filePath: string, kind: string, startRow: number, endRow: number, bodyText?: string): GraphNode {
  const locator = { scheme: "file", raw: `file://${filePath}#L${startRow}-L${endRow}` };
  const node: GraphNode = { id: idFromLocator(locator), kind, name, locator: locator.raw, filePath, startLine: startRow, endLine: endRow };
  if (bodyText) return { ...node, bodyFingerprint: bodyFingerprint(bodyText) };
  return node;
}

type TSNode = Parser.SyntaxNode;

function extractFunctionName(node: TSNode): string | null {
  const nameNode = node.childForFieldName("name");
  return nameNode?.text ?? null;
}

function extractClass(classNode: TSNode, filePath: string): GraphNode[] {
  const nodes: GraphNode[] = [];
  const name = extractFunctionName(classNode);
  if (!name) return nodes;

  const classBody = classNode.childForFieldName("body");
  nodes.push(makeNode(name, filePath, NODE_KINDS.service, classNode.startPosition.row + 1, classNode.endPosition.row + 1, classBody?.text));

  if (classBody) {
    for (const member of classBody.children) {
      if (member.type === "method_definition" || member.type === "public_field_definition") {
        const methodName = extractFunctionName(member);
        if (methodName) {
          const methodBody = member.childForFieldName("body");
          nodes.push(makeNode(`${name}.${methodName}`, filePath, NODE_KINDS.utility, member.startPosition.row + 1, member.endPosition.row + 1, methodBody?.text));
        }
      }
    }
  }
  return nodes;
}

function extractLexicalFunctions(declNode: TSNode, filePath: string, startRow: number, endRow: number): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const declarator of declNode.children) {
    if (declarator.type === "variable_declarator") {
      const varName = extractFunctionName(declarator);
      const value = declarator.childForFieldName("value");
      if (varName && value && (value.type === "arrow_function" || value.type === "function_expression")) {
        const fnBody = value.childForFieldName("body");
        nodes.push(makeNode(varName, filePath, NODE_KINDS.utility, startRow, endRow, fnBody?.text));
      }
    }
  }
  return nodes;
}

const ROUTE_METHOD_RE = /^(get|post|put|delete|patch|options|head|all|use)$/;

function findCallsRoutesAndEnv(root: TSNode, filePath: string, nodeIndex: Map<string, GraphNode>): { calls: CallInfo[]; routes: RouteRegistration[]; envAccesses: EnvAccess[]; fieldAccesses: FieldAccess[] } {
  const calls: CallInfo[] = [];
  const routes: RouteRegistration[] = [];
  const envAccesses: EnvAccess[] = [];
  const fieldAccesses: FieldAccess[] = [];
  const seen = new Set<string>();
  const seenFields = new Set<string>();

  function walk(node: TSNode, enclosingFuncId: string | null) {
    if (node.type === "member_expression" && enclosingFuncId) {
      const text = node.text;

      // Detect process.env.X
      const envMatch = text.match(/^process\.env\.(\w+)$/);
      if (envMatch) {
        const envVar = envMatch[1]!;
        const parent = node.parent;
        const isWrite = parent?.type === "assignment_expression" && parent.childForFieldName("left")?.id === node.id;
        envAccesses.push({ envVar, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingFuncId });
      }

      // Detect this.field and obj.field access
      const obj = node.childForFieldName("object");
      const prop = node.childForFieldName("property");
      if (obj && prop && prop.type === "property_identifier" && (obj.text === "this" || obj.type === "identifier")) {
        const fieldName = prop.text;
        const parent = node.parent;
        const isWrite = parent?.type === "assignment_expression" && parent.childForFieldName("left")?.id === node.id;
        const fieldKey = `${enclosingFuncId}:${fieldName}:${isWrite ? "w" : "r"}`;
        if (!seenFields.has(fieldKey)) {
          seenFields.add(fieldKey);
          fieldAccesses.push({ fieldName, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingFuncId });
        }
      }
    }

    if (node.type === "call_expression") {
      const fnNode = node.childForFieldName("function");
      if (fnNode) {
        let calleeName = "";
        if (fnNode.type === "identifier") {
          calleeName = fnNode.text;
        } else if (fnNode.type === "member_expression") {
          const obj = fnNode.childForFieldName("object");
          const prop = fnNode.childForFieldName("property");
          if (obj && prop) {
            calleeName = `${obj.text}.${prop.text}`;

            if (ROUTE_METHOD_RE.test(prop.text)) {
              const argsNode = node.childForFieldName("arguments");
              if (argsNode) {
                const argsList = argsNode.children.filter((c) => c.type !== "(" && c.type !== ")" && c.type !== ",");
                if (argsList.length >= 2) {
                  const pathArg = argsList[0];
                  const handlerArg = argsList[argsList.length - 1];
                  if (pathArg && handlerArg && (pathArg.type === "string" || pathArg.type === "template_string")) {
                    const pathStr = pathArg.text.replace(/['"` ]/g, "");
                    const handlerName = handlerArg.type === "identifier" ? handlerArg.text : null;
                    if (pathStr.startsWith("/") && handlerName) {
                      routes.push({
                        method: prop.text.toUpperCase(),
                        path: pathStr,
                        handlerName,
                        filePath,
                        registrarNodeId: enclosingFuncId ?? "",
                      });
                    }
                  }
                }
              }
            }
          }
        }

        if (calleeName && enclosingFuncId) {
          const key = `${enclosingFuncId}→${calleeName}`;
          if (!seen.has(key)) {
            seen.add(key);
            calls.push({ callerNodeId: enclosingFuncId, calleeName });
          }
        }
      }
    }

    for (const child of node.children) {
      let nextEnclosing = enclosingFuncId;
      if (child.type === "function_declaration" || child.type === "method_definition" || child.type === "arrow_function" || child.type === "function_expression") {
        const name = extractFunctionName(child);
        if (name) {
          const matched = nodeIndex.get(name);
          if (matched) nextEnclosing = matched.id;
        }
      }
      walk(child, nextEnclosing);
    }
  }

  walk(root, null);
  return { calls, routes, envAccesses, fieldAccesses };
}

function walkTopLevel(root: TSNode, filePath: string): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const child of root.children) {
    const startRow = child.startPosition.row + 1;
    const endRow = child.endPosition.row + 1;

    switch (child.type) {
      case "function_declaration": {
        const name = extractFunctionName(child);
        const fnBody = child.childForFieldName("body");
        if (name) nodes.push(makeNode(name, filePath, NODE_KINDS.utility, startRow, endRow, fnBody?.text));
        break;
      }
      case "class_declaration":
        nodes.push(...extractClass(child, filePath));
        break;
      case "export_statement": {
        for (const inner of child.children) {
          if (inner.type === "function_declaration") {
            const name = extractFunctionName(inner);
            const fnBody = inner.childForFieldName("body");
            if (name) nodes.push(makeNode(name, filePath, NODE_KINDS.utility, startRow, endRow, fnBody?.text));
          } else if (inner.type === "class_declaration") {
            nodes.push(...extractClass(inner, filePath));
          } else if (inner.type === "lexical_declaration") {
            nodes.push(...extractLexicalFunctions(inner, filePath, startRow, endRow));
          }
        }
        break;
      }
      case "lexical_declaration":
      case "variable_declaration":
        nodes.push(...extractLexicalFunctions(child, filePath, startRow, endRow));
        break;
    }
  }
  return nodes;
}

export function parseFile(filePath: string, content: string, _repoUri: string): ParseResult {
  const parser = getParser(filePath);
  const tree = parser.parse(content, undefined, PARSER_OPTIONS);
  const root = tree.rootNode;

  const nodes: GraphNode[] = [];
  const imports: { source: string; resolvedPath: string }[] = [];

  const fileLocator = { scheme: "file", raw: `file://${filePath}` };
  nodes.push({
    id: idFromLocator(fileLocator), kind: NODE_KINDS.utility,
    name: filePath.split("/").pop() ?? filePath, locator: fileLocator.raw,
    filePath, startLine: 1, endLine: root.endPosition.row + 1,
  });

  nodes.push(...walkTopLevel(root, filePath));

  const nodeIndex = new Map(nodes.filter((n) => !n.locator.endsWith(filePath)).map((n) => [n.name, n]));
  const { calls, routes, envAccesses, fieldAccesses } = findCallsRoutesAndEnv(root, filePath, nodeIndex);

  for (const route of routes) {
    const handlerNode = nodeIndex.get(route.handlerName);
    if (handlerNode && handlerNode.kind !== NODE_KINDS.route_handler) {
      const idx = nodes.indexOf(handlerNode);
      if (idx !== -1) {
        nodes[idx] = { ...handlerNode, kind: NODE_KINDS.route_handler };
        nodeIndex.set(route.handlerName, nodes[idx]!);
      }
    }
  }

  for (const child of root.children) {
    if (child.type === "import_statement") {
      const sourceNode = child.childForFieldName("source");
      if (sourceNode) {
        const importSource = sourceNode.text.replace(/['"]/g, "");
        let resolvedPath = importSource;
        if (importSource.startsWith(".")) {
          resolvedPath = resolve(dirname(filePath), importSource);
          if (!resolvedPath.match(/\.(ts|js|tsx|jsx)$/)) resolvedPath += ".ts";
        }
        imports.push({ source: importSource, resolvedPath });
      }
    }
  }

  return { nodes, imports, calls, routes, envAccesses, fieldAccesses };
}

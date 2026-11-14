// Tree-sitter parser for Python.
// Emits: file nodes, function defs, class defs, imports, calls edges,
// FastAPI/Flask/Django route decorators → route_handler nodes.

import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import type { GraphNode } from "../../domain/multi-repo.ts";
import { NODE_KINDS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { bodyFingerprint } from "../../domain/body-fingerprint.ts";
import { PARSER_OPTIONS } from "../parser-config.ts";

const pyParser = new Parser();
pyParser.setLanguage(Python);

export interface CallInfo {
  callerNodeId: string;
  calleeName: string;
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

export interface PyParseResult {
  nodes: GraphNode[];
  imports: { module: string; resolvedPath: string }[];
  routes: { method: string; path: string; handlerName: string; filePath: string }[];
  calls: CallInfo[];
  envAccesses: EnvAccess[];
  fieldAccesses: FieldAccess[];
}

type TSNode = Parser.SyntaxNode;

function makeNode(name: string, filePath: string, kind: string, startRow: number, endRow: number, bodyText?: string): GraphNode {
  const locator = { scheme: "file", raw: `file://${filePath}#L${startRow}-L${endRow}` };
  const node: GraphNode = { id: idFromLocator(locator), kind, name, locator: locator.raw, filePath, startLine: startRow, endLine: endRow };
  if (bodyText) return { ...node, bodyFingerprint: bodyFingerprint(bodyText) };
  return node;
}

const ROUTE_DECORATORS = /^@(app|router|blueprint)\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']/;
const DJANGO_PATH = /path\s*\(\s*["']([^"']+)["']\s*,\s*(\w[\w.]*)/;

function extractDecorators(node: TSNode): { method: string; path: string } | null {
  for (const child of node.children) {
    if (child.type === "decorator") {
      const match = ROUTE_DECORATORS.exec(child.text);
      if (match) return { method: match[2]!.toUpperCase(), path: match[3]! };
    }
  }
  return null;
}

function findCallsAndAccess(root: TSNode, nodeIndex: Map<string, GraphNode>): { calls: CallInfo[]; envAccesses: EnvAccess[]; fieldAccesses: FieldAccess[] } {
  const calls: CallInfo[] = [];
  const envAccesses: EnvAccess[] = [];
  const fieldAccesses: FieldAccess[] = [];
  const seen = new Set<string>();
  const seenFields = new Set<string>();

  function walk(node: TSNode, enclosingId: string | null) {
    if (node.type === "call" && enclosingId) {
      const fnNode = node.childForFieldName("function");
      if (fnNode) {
        const calleeName = fnNode.type === "identifier" ? fnNode.text
          : fnNode.type === "attribute" ? fnNode.text.replace(/\./g, ".") : null;
        if (calleeName) {
          const key = `${enclosingId}→${calleeName}`;
          if (!seen.has(key)) { seen.add(key); calls.push({ callerNodeId: enclosingId, calleeName }); }
        }

        // os.environ.get("X") or os.getenv("X")
        const fnText = fnNode.text;
        if (fnText === "os.environ.get" || fnText === "os.getenv") {
          const argsNode = node.childForFieldName("arguments");
          if (argsNode) {
            const firstArg = argsNode.children.find((c) => c.type === "string");
            if (firstArg) {
              const envVar = firstArg.text.replace(/['"]/g, "");
              if (envVar) envAccesses.push({ envVar, kind: "read", enclosingNodeId: enclosingId });
            }
          }
        }
      }
    }

    // os.environ["X"] read/write via subscript
    if (node.type === "subscript" && enclosingId) {
      const obj = node.childForFieldName("value");
      const sub = node.childForFieldName("subscript");
      if (obj && obj.text === "os.environ" && sub && sub.type === "string") {
        const envVar = sub.text.replace(/['"]/g, "");
        if (envVar) {
          const parent = node.parent;
          const isWrite = parent?.type === "assignment" && parent.childForFieldName("left")?.id === node.id;
          envAccesses.push({ envVar, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingId });
        }
      }
    }

    // self.field access
    if (node.type === "attribute" && enclosingId) {
      const obj = node.childForFieldName("object");
      const attr = node.childForFieldName("attribute");
      if (obj && obj.text === "self" && attr) {
        const fieldName = attr.text;
        const parent = node.parent;
        const isWrite = parent?.type === "assignment" && parent.childForFieldName("left")?.id === node.id;
        const fieldKey = `${enclosingId}:${fieldName}:${isWrite ? "w" : "r"}`;
        if (!seenFields.has(fieldKey)) {
          seenFields.add(fieldKey);
          fieldAccesses.push({ fieldName, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingId });
        }
      }
    }

    for (const child of node.children) {
      let nextEnclosing = enclosingId;
      if (child.type === "function_definition") {
        const nameNode = child.childForFieldName("name");
        if (nameNode) {
          const matched = nodeIndex.get(nameNode.text);
          if (matched) nextEnclosing = matched.id;
        }
      }
      walk(child, nextEnclosing);
    }
  }

  walk(root, null);
  return { calls, envAccesses, fieldAccesses };
}

export function parsePythonFile(filePath: string, content: string, _repoUri: string): PyParseResult {
  const tree = pyParser.parse(content, undefined, PARSER_OPTIONS);
  const root = tree.rootNode;

  const nodes: GraphNode[] = [];
  const imports: { module: string; resolvedPath: string }[] = [];
  const routes: PyParseResult["routes"] = [];

  const fileLocator = { scheme: "file", raw: `file://${filePath}` };
  nodes.push({
    id: idFromLocator(fileLocator), kind: NODE_KINDS.utility,
    name: filePath.split("/").pop() ?? filePath, locator: fileLocator.raw,
    filePath, startLine: 1, endLine: root.endPosition.row + 1,
  });

  for (const child of root.children) {
    const startRow = child.startPosition.row + 1;
    const endRow = child.endPosition.row + 1;

    if (child.type === "function_definition" || child.type === "decorated_definition") {
      const funcNode = child.type === "decorated_definition"
        ? child.children.find((c) => c.type === "function_definition") : child;
      if (!funcNode) continue;

      const nameNode = funcNode.childForFieldName("name");
      const name = nameNode?.text;
      if (!name) continue;

      const route = child.type === "decorated_definition" ? extractDecorators(child) : null;
      if (route) {
        nodes.push(makeNode(name, filePath, NODE_KINDS.route_handler, startRow, endRow, funcNode.text));
        routes.push({ method: route.method, path: route.path, handlerName: name, filePath });
      } else {
        nodes.push(makeNode(name, filePath, NODE_KINDS.utility, startRow, endRow, funcNode.text));
      }
    }

    if (child.type === "class_definition") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        nodes.push(makeNode(nameNode.text, filePath, NODE_KINDS.model, startRow, endRow, child.text));
        const body = child.childForFieldName("body");
        if (body) {
          for (const member of body.children) {
            if (member.type === "function_definition") {
              const methodName = member.childForFieldName("name");
              if (methodName) {
                nodes.push(makeNode(
                  `${nameNode.text}.${methodName.text}`, filePath, NODE_KINDS.utility,
                  member.startPosition.row + 1, member.endPosition.row + 1, member.text,
                ));
              }
            }
          }
        }
      }
    }

    if (child.type === "import_statement" || child.type === "import_from_statement") {
      const moduleNode = child.childForFieldName("module_name") ?? child.children.find((c) => c.type === "dotted_name");
      if (moduleNode) imports.push({ module: moduleNode.text, resolvedPath: moduleNode.text });
    }

    if (child.type === "expression_statement") {
      const djangoMatch = DJANGO_PATH.exec(child.text);
      if (djangoMatch) {
        routes.push({ method: "GET", path: `/${djangoMatch[1]}`, handlerName: djangoMatch[2]!, filePath });
      }
    }
  }

  const nodeIndex = new Map<string, GraphNode>();
  for (const n of nodes) {
    if (n.locator.endsWith(filePath)) continue;
    nodeIndex.set(n.name, n);
    const dotIdx = n.name.indexOf(".");
    if (dotIdx >= 0 && !nodeIndex.has(n.name.slice(dotIdx + 1))) {
      nodeIndex.set(n.name.slice(dotIdx + 1), n);
    }
  }
  const { calls, envAccesses, fieldAccesses } = findCallsAndAccess(root, nodeIndex);

  return { nodes, imports, routes, calls, envAccesses, fieldAccesses };
}

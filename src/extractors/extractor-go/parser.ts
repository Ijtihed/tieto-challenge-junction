// Tree-sitter parser for Go.
// Emits: file nodes, function/method/type defs, imports, calls edges,
// net/http + Gin/Echo/Chi handler recognition.

import Parser from "tree-sitter";
import Go from "tree-sitter-go";
import type { GraphNode } from "../../domain/multi-repo.ts";
import { NODE_KINDS } from "../../domain/vocabulary.ts";
import { idFromLocator } from "../../domain/locator.ts";
import { bodyFingerprint } from "../../domain/body-fingerprint.ts";
import { PARSER_OPTIONS } from "../parser-config.ts";

const goParser = new Parser();
goParser.setLanguage(Go);

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

export interface GoParseResult {
  nodes: GraphNode[];
  imports: { path: string }[];
  routes: { path: string; handlerName: string; filePath: string }[];
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

function findRouteRegistrations(root: TSNode, filePath: string): GoParseResult["routes"] {
  const routes: GoParseResult["routes"] = [];
  const source = root.text;

  for (const match of source.matchAll(/(?:http\.HandleFunc|\.(?:GET|POST|PUT|DELETE|PATCH|Handle|Group))\s*\(\s*"([^"]+)"\s*,\s*(\w+)/g)) {
    routes.push({ path: match[1]!, handlerName: match[2]!, filePath });
  }

  return routes;
}

function findCallsAndAccess(root: TSNode, nodeIndex: Map<string, GraphNode>): { calls: CallInfo[]; envAccesses: EnvAccess[]; fieldAccesses: FieldAccess[] } {
  const calls: CallInfo[] = [];
  const envAccesses: EnvAccess[] = [];
  const fieldAccesses: FieldAccess[] = [];
  const seen = new Set<string>();
  const seenFields = new Set<string>();

  function walk(node: TSNode, enclosingId: string | null) {
    if (node.type === "call_expression" && enclosingId) {
      const fnNode = node.childForFieldName("function");
      if (fnNode) {
        const calleeName = fnNode.text;
        if (calleeName) {
          const key = `${enclosingId}→${calleeName}`;
          if (!seen.has(key)) { seen.add(key); calls.push({ callerNodeId: enclosingId, calleeName }); }
        }

        const fnText = fnNode.text;
        if (fnText === "os.Getenv" || fnText === "os.Setenv") {
          const argsNode = node.childForFieldName("arguments");
          if (argsNode) {
            const firstArg = argsNode.children.find((c) => c.type === "interpreted_string_literal");
            if (firstArg) {
              const envVar = firstArg.text.replace(/"/g, "");
              if (envVar) envAccesses.push({ envVar, kind: fnText === "os.Setenv" ? "write" : "read", enclosingNodeId: enclosingId });
            }
          }
        }
      }
    }

    if (node.type === "selector_expression" && enclosingId) {
      const operand = node.childForFieldName("operand");
      const field = node.childForFieldName("field");
      if (operand && field && operand.type === "identifier") {
        const fieldName = field.text;
        const parent = node.parent;
        const isWrite = parent?.type === "assignment_statement" && parent.childForFieldName("left")?.id === node.id;
        const fieldKey = `${enclosingId}:${fieldName}:${isWrite ? "w" : "r"}`;
        if (!seenFields.has(fieldKey)) {
          seenFields.add(fieldKey);
          fieldAccesses.push({ fieldName, kind: isWrite ? "write" : "read", enclosingNodeId: enclosingId });
        }
      }
    }

    for (const child of node.children) {
      let nextEnclosing = enclosingId;
      if (child.type === "function_declaration" || child.type === "method_declaration") {
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

export function parseGoFile(filePath: string, content: string, _repoUri: string): GoParseResult {
  const tree = goParser.parse(content, undefined, PARSER_OPTIONS);
  const root = tree.rootNode;

  const nodes: GraphNode[] = [];
  const imports: { path: string }[] = [];
  const routes = findRouteRegistrations(root, filePath);
  const routeHandlerNames = new Set(routes.map((r) => r.handlerName));

  const fileLocator = { scheme: "file", raw: `file://${filePath}` };
  nodes.push({
    id: idFromLocator(fileLocator), kind: NODE_KINDS.utility,
    name: filePath.split("/").pop() ?? filePath, locator: fileLocator.raw,
    filePath, startLine: 1, endLine: root.endPosition.row + 1,
  });

  for (const child of root.children) {
    const startRow = child.startPosition.row + 1;
    const endRow = child.endPosition.row + 1;

    if (child.type === "function_declaration") {
      const nameNode = child.childForFieldName("name");
      const name = nameNode?.text;
      if (name) {
        const kind = routeHandlerNames.has(name) ? NODE_KINDS.route_handler : NODE_KINDS.utility;
        nodes.push(makeNode(name, filePath, kind, startRow, endRow, child.text));
      }
    }

    if (child.type === "method_declaration") {
      const nameNode = child.childForFieldName("name");
      const receiverNode = child.childForFieldName("receiver");
      const name = nameNode?.text;
      const receiverText = receiverNode?.text ?? "";
      const typeMatch = receiverText.match(/\w+\s+\*?(\w+)/);
      const receiverType = typeMatch?.[1];
      if (name && receiverType) {
        nodes.push(makeNode(`${receiverType}.${name}`, filePath, NODE_KINDS.utility, startRow, endRow, child.text));
      }
    }

    if (child.type === "type_declaration") {
      for (const spec of child.children) {
        if (spec.type === "type_spec") {
          const nameNode = spec.childForFieldName("name");
          const typeNode = spec.childForFieldName("type");
          if (nameNode) {
            const kind = typeNode?.type === "struct_type" ? NODE_KINDS.model : NODE_KINDS.utility;
            nodes.push(makeNode(nameNode.text, filePath, kind, startRow, endRow, child.text));
          }
        }
      }
    }

    if (child.type === "import_declaration") {
      for (const spec of child.descendantsOfType("import_spec")) {
        const pathNode = spec.childForFieldName("path");
        if (pathNode) imports.push({ path: pathNode.text.replace(/"/g, "") });
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

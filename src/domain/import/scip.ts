// SCIP index file importer — per architecture/specs/graph-import.md.
// Parses the SCIP protobuf format and maps to Schema's graph model.
import protobufModule from "protobufjs";
const protobuf = protobufModule;
import type { GraphNode, GraphEdge } from "../multi-repo.ts";
import { idFromLocator } from "../locator.ts";
import { NODE_KINDS, EDGE_RELATIONS } from "../vocabulary.ts";
import { logger } from "../../obs/index.ts";

// ── SCIP protobuf type stubs (minimal decode without .proto compilation) ──

interface ScipOccurrence {
  range: number[];
  symbol: string;
  symbolRoles: number;
  overrideDocumentation?: string[];
  syntaxKind?: number;
  diagnostics?: unknown[];
  enclosingRange?: number[];
}

interface ScipSymbolInformation {
  symbol: string;
  documentation?: string[];
  relationships?: { symbol: string; isReference?: boolean; isImplementation?: boolean; isTypeDefinition?: boolean; isDefinition?: boolean }[];
  kind?: number;
  displayName?: string;
  signatureDocumentation?: unknown;
  enclosingSymbol?: string;
}

interface ScipDocument {
  language: string;
  relativePath: string;
  occurrences: ScipOccurrence[];
  symbols: ScipSymbolInformation[];
  text?: string;
}

interface ScipIndex {
  metadata?: {
    version?: number;
    toolInfo?: { name: string; version: string; arguments?: string[] };
    projectRoot?: string;
    textDocumentEncoding?: number;
  };
  documents: ScipDocument[];
  externalSymbols?: ScipSymbolInformation[];
}

export interface ImportResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    tool: string;
    version: string;
    documentCount: number;
    symbolCount: number;
    occurrenceCount: number;
  };
}

// SCIP SymbolRole bit flags
const DEFINITION = 0x1;

// SCIP Kind enum mapping to Schema NodeKind
const SCIP_KIND_MAP: Record<number, string> = {
  2: NODE_KINDS.utility,       // Function
  6: NODE_KINDS.utility,       // Method
  5: NODE_KINDS.model,         // Class
  23: NODE_KINDS.model,        // Struct
  11: NODE_KINDS.model,        // Interface
  14: NODE_KINDS.utility,      // Namespace
  3: NODE_KINDS.utility,       // Module
  8: NODE_KINDS.model,         // Enum
  19: NODE_KINDS.utility,      // Constructor
  20: NODE_KINDS.utility,      // Constant
  21: NODE_KINDS.utility,      // Variable
};

function scipKindToNodeKind(kind: number | undefined): string {
  if (kind == null) return NODE_KINDS.utility;
  return SCIP_KIND_MAP[kind] ?? NODE_KINDS.utility;
}

function symbolToName(symbol: string): string {
  const parts = symbol.split(/\s+/);
  if (parts.length < 3) return symbol;
  const descriptorPart = parts.slice(3).join(" ");
  const match = descriptorPart.match(/([^/.#([\]`]+)[.#(]/);
  if (match) return match[1]!;
  const lastSegment = descriptorPart.replace(/[.#()\[\]`]/g, " ").trim().split(/\s+/).pop();
  return lastSegment ?? symbol;
}

function isDefinitionOccurrence(occ: ScipOccurrence): boolean {
  return (occ.symbolRoles & DEFINITION) !== 0;
}

function occurrenceRange(occ: ScipOccurrence): { startLine: number; endLine: number; startCol: number; endCol: number } {
  const r = occ.range;
  if (!r || r.length < 3) return { startLine: 0, endLine: 0, startCol: 0, endCol: 0 };
  if (r.length === 3) {
    return { startLine: r[0]!, endLine: r[0]!, startCol: r[1]!, endCol: r[2]! };
  }
  return { startLine: r[0]!, endLine: r[2]!, startCol: r[1]!, endCol: r[3]! };
}

export function importScip(scipBuffer: Uint8Array, projectRoot: string): ImportResult {
  const root = protobuf.Root.fromJSON({
    nested: {
      scip: {
        nested: {
          Index: { fields: {
            metadata: { type: "Metadata", id: 1 },
            documents: { rule: "repeated", type: "Document", id: 2 },
            externalSymbols: { rule: "repeated", type: "SymbolInformation", id: 3 },
          }},
          Metadata: { fields: {
            version: { type: "int32", id: 1 },
            toolInfo: { type: "ToolInfo", id: 2 },
            projectRoot: { type: "string", id: 3 },
            textDocumentEncoding: { type: "int32", id: 4 },
          }},
          ToolInfo: { fields: {
            name: { type: "string", id: 1 },
            version: { type: "string", id: 2 },
            arguments: { rule: "repeated", type: "string", id: 3 },
          }},
          Document: { fields: {
            language: { type: "string", id: 4 },
            relativePath: { type: "string", id: 1 },
            occurrences: { rule: "repeated", type: "Occurrence", id: 2 },
            symbols: { rule: "repeated", type: "SymbolInformation", id: 3 },
            text: { type: "string", id: 5 },
            positionEncoding: { type: "int32", id: 6 },
          }},
          Occurrence: { fields: {
            range: { rule: "repeated", type: "int32", id: 1, options: { packed: true } },
            symbol: { type: "string", id: 2 },
            symbolRoles: { type: "int32", id: 3 },
            overrideDocumentation: { rule: "repeated", type: "string", id: 4 },
            syntaxKind: { type: "int32", id: 5 },
            enclosingRange: { rule: "repeated", type: "int32", id: 7, options: { packed: true } },
          }},
          SymbolInformation: { fields: {
            symbol: { type: "string", id: 1 },
            documentation: { rule: "repeated", type: "string", id: 3 },
            relationships: { rule: "repeated", type: "Relationship", id: 4 },
            kind: { type: "int32", id: 5 },
            displayName: { type: "string", id: 6 },
            enclosingSymbol: { type: "string", id: 7 },
          }},
          Relationship: { fields: {
            symbol: { type: "string", id: 1 },
            isReference: { type: "bool", id: 2 },
            isImplementation: { type: "bool", id: 3 },
            isTypeDefinition: { type: "bool", id: 4 },
            isDefinition: { type: "bool", id: 5 },
          }},
        },
      },
    },
  });

  const IndexType = root.lookupType("scip.Index");
  let index: ScipIndex;
  try {
    index = IndexType.decode(scipBuffer) as unknown as ScipIndex;
  } catch (err) {
    throw new Error(`Failed to decode SCIP index: ${err instanceof Error ? err.message : String(err)}`);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const symbolToNodeId = new Map<string, string>();
  const seenNodeIds = new Set<string>();
  let totalOccurrences = 0;
  let totalSymbols = 0;

  for (const doc of index.documents) {
    const filePath = doc.relativePath;

    for (const sym of doc.symbols) {
      totalSymbols++;
      const name = sym.displayName || symbolToName(sym.symbol);
      const kind = scipKindToNodeKind(sym.kind);

      const defOcc = doc.occurrences.find(
        (o) => o.symbol === sym.symbol && isDefinitionOccurrence(o),
      );
      const range = defOcc ? occurrenceRange(defOcc) : { startLine: 0, endLine: 0, startCol: 0, endCol: 0 };

      const locator = { scheme: "file" as const, raw: `file://${projectRoot}/${filePath}#L${range.startLine}-L${range.endLine}` };
      const nodeId = idFromLocator(locator);

      if (!seenNodeIds.has(nodeId)) {
        seenNodeIds.add(nodeId);
        nodes.push({
          id: nodeId,
          kind,
          name,
          locator: locator.raw,
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          meta: { source: "scip", scipSymbol: sym.symbol },
        });
        symbolToNodeId.set(sym.symbol, nodeId);
      }

      for (const rel of sym.relationships ?? []) {
        if (rel.isImplementation) {
          const targetId = symbolToNodeId.get(rel.symbol);
          if (targetId) {
            edges.push({
              id: `scip:impl:${nodeId}:${targetId}`,
              source: nodeId,
              target: targetId,
              relation: EDGE_RELATIONS.implements_contract,
              meta: { source: "scip" },
            });
          }
        }
      }
    }

    for (const occ of doc.occurrences) {
      totalOccurrences++;
      if (isDefinitionOccurrence(occ)) continue;
      if (occ.symbol.startsWith("local ")) continue;

      const targetNodeId = symbolToNodeId.get(occ.symbol);
      if (!targetNodeId) continue;

      const range = occurrenceRange(occ);
      const refLocator = { scheme: "file" as const, raw: `file://${projectRoot}/${filePath}#L${range.startLine}-L${range.startLine}` };
      const sourceNodeId = findEnclosingNode(nodes, filePath, range.startLine);

      if (sourceNodeId && sourceNodeId !== targetNodeId) {
        const edgeId = `scip:ref:${sourceNodeId}:${targetNodeId}`;
        if (!edges.some((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source: sourceNodeId,
            target: targetNodeId,
            relation: EDGE_RELATIONS.calls,
            meta: { source: "scip" },
          });
        }
      }
    }
  }

  logger.info("scip-import", `imported ${nodes.length} nodes, ${edges.length} edges from ${index.documents.length} documents`);

  return {
    nodes,
    edges,
    metadata: {
      tool: index.metadata?.toolInfo?.name ?? "unknown",
      version: index.metadata?.toolInfo?.version ?? "unknown",
      documentCount: index.documents.length,
      symbolCount: totalSymbols,
      occurrenceCount: totalOccurrences,
    },
  };
}

function findEnclosingNode(nodes: GraphNode[], filePath: string, line: number): string | undefined {
  let best: GraphNode | undefined;
  let bestSpan = Infinity;
  for (const n of nodes) {
    if (n.filePath !== filePath) continue;
    const start = n.startLine ?? 0;
    const end = n.endLine ?? Infinity;
    if (line >= start && line <= end) {
      const span = end - start;
      if (span < bestSpan) { bestSpan = span; best = n; }
    }
  }
  return best?.id;
}

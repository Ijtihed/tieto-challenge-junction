# Graph Import from External Analyzers — SCIP (v1.0 Moat Slice M-B)

Per architecture/schema-v3.md §17.8. Implements SCIP index file
ingestion for compiler-precise cross-references.

---

## 1. Goal + Non-goals

**Goal:** Import SCIP index files (`.scip` protobuf) into Schema's
`MultiRepoGraph` to supplement tree-sitter extraction with
compiler-precise cross-references. "Schema is the substrate;
bring your own analyzer."

**Non-goals (deferred to v1.2):**
- Joern CPG export import (JSON/CSV)
- Infer report import (JSON)
- Automatic SCIP generation (the user runs their indexer)
- LSIF import (predecessor format, superseded by SCIP)

---

## 2. SCIP Format Summary

SCIP (Source Code Intelligence Protocol) is a protobuf-encoded
index file that contains:

- **Metadata:** tool info, project root, encoding
- **Documents:** one per source file, each containing:
  - **Occurrences:** symbol references with precise positions
    (line, column, end line, end column)
  - **SymbolInformation:** definitions with kind, documentation,
    relationships (implements, type definition, etc.)
- **External symbols:** hover docs for cross-package references

SCIP symbol strings encode fully-qualified names in a structured
format: `scheme package descriptor+` (e.g.,
`scip-typescript npm @types/node 18.0.0 path/posix.join().`).

---

## 3. Mapping: SCIP → Schema Graph

| SCIP concept | Schema concept |
|---|---|
| Document | Cluster context (file grouping) |
| SymbolInformation (definition) | GraphNode with kind from SCIP Kind |
| Occurrence (definition) | Node location (filePath, startLine, endLine) |
| Occurrence (reference) | GraphEdge with relation "calls" or "references" |
| Relationship.is_implementation | GraphEdge "implements_contract" |
| Relationship.is_type_definition | GraphEdge "type_definition" |

### SCIP Kind → Schema NodeKind

| SCIP Kind | Schema NodeKind |
|---|---|
| Function, Method | "utility" (promoted to "service" if annotated) |
| Class, Struct, Interface | "model" |
| Module, Namespace, Package | "utility" |
| Variable, Property, Field | (skip unless referenced) |
| Constructor | "utility" |

---

## 4. Implementation

### Module: `src/domain/import/scip.ts`

```
importScip(scipBuffer: Uint8Array, projectRoot: string): ImportResult

ImportResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: { tool: string; version: string; documentCount: number };
}
```

### Action: `src/actions/graph-import.ts`

```
name: "graph.import"
sideEffect: "final"
in:  { sessionId, format: "scip", filePath: string }
out: { nodesImported, edgesImported, conflicts, metadata }
```

Conflicts: nodes/edges that already exist from tree-sitter.
Strategy: keep both, tag imported ones with
`meta.source = "scip"`.

### Datalog EDB: `src/domain/datalog/edb.ts`

Add `source(NodeId, Source)` fact for imported nodes.
Existing Datalog queries continue to work; new queries can
filter by `source(N, "scip")`.

---

## 5. Test Matrix (20+ tests)

- Parse a fixture `.scip` file
- Imported nodes have correct kind/name/location
- Cross-file references produce edges
- Conflicts detected when tree-sitter and SCIP overlap
- Datalog queries filter by source tag
- Invalid/corrupt SCIP file returns structured error
- Empty SCIP file produces 0 nodes
- graph.import + graph.find_callers returns SCIP-precision results

---

## 6. Acceptance Criteria

1. `scip-typescript index` on a TS project → `.scip` file
2. `graph.import` ingests it → nodes/edges merged
3. `graph.find_callers` on a function returns SCIP-precision
   results (catches call sites that tree-sitter misses)
4. Tests green. Action count rises by 1.

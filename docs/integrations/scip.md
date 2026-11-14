# Importing SCIP Indexes into Schema

Schema can import [SCIP](https://github.com/sourcegraph/scip) index
files to supplement its tree-sitter extraction with compiler-precise
cross-references. SCIP provides precision that tree-sitter (which
operates without type information) cannot match.

## Why import SCIP?

Schema's built-in extractors use tree-sitter for fast, zero-config
parsing. This works well for most codebases, but misses:

- **Reflection-based call sites** (e.g., Java reflection, dynamic
  dispatch through interfaces)
- **Generic type resolution** (e.g., `List<User>.get()` resolving
  to `User`)
- **Precise cross-package references** (e.g., which overload of a
  method is called)

SCIP indexes are produced by compiler-backed indexers that have
full type information. Importing a SCIP index fills these gaps.

## Step 1: Generate a SCIP index

### TypeScript / JavaScript

```bash
npm install -g @sourcegraph/scip-typescript
cd your-project
scip-typescript index
# Produces index.scip in the current directory
```

### Java

```bash
# Use scip-java (requires Gradle or Maven)
# See https://sourcegraph.github.io/scip-java/
coursier launch com.sourcegraph:scip-java_2.13:latest.release -- index
```

### Rust

```bash
# rust-analyzer produces SCIP natively
rust-analyzer scip .
# Produces index.scip
```

### Go

```bash
go install github.com/sourcegraph/scip-go@latest
scip-go
```

### C/C++

```bash
# scip-clang via compile_commands.json
# See https://github.com/nicovank/scip-clang
scip-clang --compdb=compile_commands.json
```

## Step 2: Import into Schema

### Via MCP (Claude Code / Cursor / Cline)

Your MCP agent can call:

```json
{
  "name": "graph.import",
  "arguments": {
    "sessionId": "<your-session>",
    "format": "scip",
    "filePath": "/path/to/your-project/index.scip"
  }
}
```

### Via CLI (coming in v1.1)

```bash
schema import --format scip /path/to/index.scip
```

## Step 3: Verify

After import, SCIP-derived nodes appear in the graph with
`source: "scip"` in their metadata. You can query them:

- `graph.find_callers` now returns SCIP-precision results
- `graph.search` includes imported symbols
- Datalog queries can filter by source:
  `source(N, "scip"), node(N, K, Name)`

## What gets imported

| SCIP concept | Schema mapping |
|---|---|
| Symbol definition | GraphNode (kind from SCIP Kind enum) |
| Reference occurrence | GraphEdge (relation: "calls") |
| Implementation relationship | GraphEdge (relation: "implements_contract") |

Conflicts (nodes that already exist from tree-sitter extraction)
are skipped; the tree-sitter version is kept. The import report
shows the conflict count.

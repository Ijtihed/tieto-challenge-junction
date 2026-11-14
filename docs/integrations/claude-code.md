# Using Schema with Claude Code

Schema gives Claude Code a live architecture graph of your codebase. Every refactoring decision gets structural visibility — who calls what, which rules break, and what the diff looks like before you commit.

## Setup (30 seconds)

### 1. Install Schema

```bash
npm install -g @schema-ai/mcp
```

Verify it works:

```bash
schema --help
schema doctor    # checks Node version, PATH, and MCP config
```

### 2. Add to Claude Code's MCP config

Claude Code reads MCP servers from `~/.claude/mcp.json` (global) or `.mcp.json` in your project root (per-project).

**Global (recommended for first setup):**

Create or edit `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "schema": {
      "command": "npx",
      "args": ["-y", "@schema-ai/mcp@latest"]
    }
  }
}
```

**Per-project (for team-shared config):**

Create `.mcp.json` in your project root with the same content. Commit it so teammates get Schema automatically.

### Config paths by OS

| OS | Global config path |
|---|---|
| macOS | `~/.claude/mcp.json` |
| Linux | `~/.claude/mcp.json` |
| Windows | `%USERPROFILE%\.claude\mcp.json` |

### 3. Restart Claude Code

Close and reopen Claude Code (or restart the conversation). Schema starts automatically when Claude Code connects to the MCP server.

### 4. Verify it works (5-second smoke test)

In Claude Code, type:

> "List your available MCP tools."

You should see Schema's tools (`workspace.open`, `graph.summary`, `graph.find_callers`, etc.) in the list. If you don't, see **Troubleshooting** below.

Then try:

> "Use Schema to summarize the architecture of this workspace."

Claude Code will call `workspace.open` to start a session, then `graph.summary` to show the node/edge/cluster breakdown. If this works, Schema is fully wired up.

## What Claude Code can do with Schema

Once configured, Claude Code has access to Schema's full MCP action surface. The most useful for day-to-day work:

| Action | What it does |
|---|---|
| `workspace.open` | Start a session for a codebase (called automatically) |
| `graph.summary` | Cluster overview — nodes, edges, clusters |
| `graph.find_callers` | Who calls this function/service/route? |
| `graph.find_callees` | What does this function depend on? |
| `graph.search` | Find nodes by name, kind, or path |
| `graph.diff_against` | Structural diff against any git ref |
| `rules.evaluate` | Check all architectural rules, get violations |
| `ops.preview` | Preview a refactoring op before applying |
| `plan.propose` | Propose a multi-step refactoring plan |
| `plan.apply` | Apply a proposed plan (with auto-rollback on failure) |
| `canon.search` | Search the architecture knowledge base (OTP, STM, CQRS, distributed systems) |
| `agents_md.write_facts` | Write architectural facts to AGENTS.md |
| `pr.review` | Generate a structural PR review summary |

## Recommended prompts

### Before a refactor

> "Before I refactor the `UserService`, use Schema to find all callers and callees. Tell me the blast radius."

### Architecture review

> "Use Schema to evaluate all rules on this codebase. Summarize the violations and suggest fixes."

### Structural diff

> "Use Schema to diff the graph against `main`. What structural changes did I introduce in this branch?"

### Understanding a new codebase

> "Use Schema to summarize this workspace. What are the main clusters, how many nodes in each, and how do they connect?"

### Writing AGENTS.md

> "Use Schema to extract the architectural facts from this codebase and write them to AGENTS.md."

### PR review

> "Use Schema to generate a PR review summary comparing my branch against `origin/main`."

### Architecture knowledge

> "Use Schema's canon to find guidance on implementing saga orchestration for this distributed workflow."

## How it works

Schema runs as a local MCP server started by `npx`. No cloud, no telemetry, no LLM calls. When Claude Code opens your workspace:

1. Schema extracts the architecture graph using tree-sitter parsers (TypeScript, Python, Go, Java, Kotlin, Ruby, Rust, C#, and config files).
2. Detects cross-language bridges (REST routes ↔ handlers, gRPC services, SQL queries ↔ ORM models).
3. Evaluates architectural rules (no-cycle, must-auth, layer boundary, etc.).
4. Makes all of this available as MCP tools that Claude Code can call.

Claude Code queries the graph, previews operations, and checks rules — all before writing code.

## Troubleshooting

### "Schema: Action failed" or MCP connection errors

The MCP server may not be starting. Test manually:

```bash
schema serve
# Should print: Schema MCP server ready at http://127.0.0.1:7474
```

If this fails, run `schema doctor` to diagnose.

### Claude Code doesn't show Schema tools

1. Verify the config file exists at the correct path (`~/.claude/mcp.json`).
2. Verify the JSON is valid — a trailing comma will break it.
3. Restart Claude Code completely (not just the conversation).
4. Check Claude Code's output panel for MCP connection errors.

### Schema starts but finds no nodes

1. Ensure you opened a **folder** in Claude Code, not a single file.
2. Check that the folder contains supported source files (`.ts`, `.py`, `.go`, `.java`, `.rb`, `.rs`, etc.).
3. For monorepos, open the root directory — Schema detects languages automatically.

### Slow graph extraction on large repos

First extraction parses every file with tree-sitter (5-15 seconds for 10k+ files). Subsequent calls in the same session use the cached graph. The cache is per-session — restarting Claude Code triggers a fresh extraction.

### "Access denied" on file operations

Schema restricts file access to the workspace root by default. If your project references files outside the workspace, you can expand the allow-list by passing additional paths when the MCP server starts, or configure `schema.allowedPaths` in the VS Code extension settings.

# Using Schema with Cursor

Schema gives Cursor's AI features (Composer, Chat, Cmd+K) a live architecture graph of your codebase. The agent can see callers, callees, clusters, and rule violations before proposing changes.

## Setup (30 seconds)

### 1. Install Schema

```bash
npm install -g @schema-ai/mcp
```

Verify:

```bash
schema doctor
```

### 2. Add to Cursor's MCP config

Create or edit `~/.cursor/mcp.json`:

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

Alternatively, create `.cursor/mcp.json` in your project root for per-project config.

### Config paths by OS

| OS | Global config path |
|---|---|
| macOS | `~/.cursor/mcp.json` |
| Linux | `~/.cursor/mcp.json` |
| Windows | `%USERPROFILE%\.cursor\mcp.json` |

### 3. Restart Cursor

Close and reopen Cursor. Schema starts automatically when Cursor's agent connects to MCP servers.

### 4. Verify

In Composer (Agent mode), ask:

> "List your MCP tools."

You should see Schema's tools. Then:

> "Use Schema to summarize this workspace's architecture."

## Using Schema in Cursor

### Composer (Agent mode)

Cursor's Composer agent can call Schema tools directly. Ask it to:

- Check callers before renaming a function
- Evaluate rules before submitting a PR
- Diff the graph against `main` to see structural changes
- Propose a refactoring plan using `plan.propose`

### VS Code extension (optional)

For a richer experience, also install the Schema VS Code extension (`.vsix` from the Schema repo). This adds:

- Sidebar tree views for the graph summary and rule violations
- Diagnostics inline in the editor for rule violations and diffs
- Commands in the command palette (`Cmd+Shift+P`)

The extension and the MCP server share the same engine — they complement each other.

## Recommended prompts

> "Before I refactor `AuthMiddleware`, use Schema to find all callers. What's the blast radius?"

> "Use Schema to evaluate architectural rules. Are there any violations I should fix before this PR?"

> "Use Schema to diff the graph against `origin/main`. Summarize the structural impact of my changes."

> "Use Schema's canon to find best practices for implementing a supervision tree in this Elixir service."

## Troubleshooting

**Cursor doesn't show Schema tools** — Verify `~/.cursor/mcp.json` exists and has valid JSON. Restart Cursor completely.

**"Connection refused"** — Schema's MCP server starts on demand via `npx`. If it fails, test manually with `schema serve` and check `schema doctor`.

**Slow first extraction** — Expected for large repos (5-15s for 10k+ files). Subsequent calls in the same session use the cache.

# Schema — Architecture Graph for VS Code

See what your AI coding agent is doing to your codebase before you approve it.

Schema extracts a multi-language **architecture graph** from your code — functions, routes, services, contracts, database tables, deploy targets, and all the edges between them. This extension puts that graph inside VS Code, Cursor, and Cline so you can verify changes, enforce architectural rules, and catch structural drift before it ships.

## Quick Start

**1. Install the Schema engine:**

```bash
npm install -g @schema-ai/mcp
```

Or via curl:

```bash
curl -fsSL https://schema.dev/install.sh | sh
```

**2. Install this extension** from the VS Code Marketplace (or `.vsix`).

**3. Open a workspace** and run `Schema: Open Architecture Graph` from the command palette (`Cmd+Shift+P`). The extension starts the Schema MCP server, extracts the graph, and populates the sidebar.

That's it. No config files, no YAML, no project setup.

## Commands

All commands are available from the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | What it does |
|---|---|
| **Open Architecture Graph** | Extract the graph for the current workspace. Populates the sidebar tree views. |
| **Evaluate Rules** | Run all architectural rules. Violations appear inline in the editor and in the Problems panel. |
| **Diff Against Git Ref** | Compare the graph against any git ref (e.g. `HEAD~1`, `main`, a tag). Added/removed/modified nodes show as diagnostics. |
| **Find Callers of Selected Symbol** | Select a function or class name, then see every graph node that calls it. |
| **Find Callees of Selected Symbol** | Select a function or class name, then see everything it calls. |
| **Show Graph for Current File** | List all graph nodes in the active file. |
| **Generate PR Summary** | Generate a structural PR review and copy the markdown to your clipboard. Paste it into GitHub/GitLab. |
| **Add Architectural Rule** | Add a `no-cycle`, `must-auth`, or custom rule from the command palette. |
| **Open in Schema Desktop** | Open the current workspace in Schema Studio (the desktop app) for a full visual graph canvas. |

## Sidebar

The Schema activity bar icon (the structure icon in the left sidebar) opens two tree views:

- **Summary** — total node count, edge count, clusters, and a breakdown of each cluster with its size.
- **Rules & Violations** — live list of rule evaluation results. Green check when all rules pass; error/warning icons for violations.

## Settings

| Setting | Default | Description |
|---|---|---|
| `schema.serverPort` | `7474` | Port for the Schema MCP server when running in HTTP mode. |
| `schema.serverCommand` | `npx -y @schema-ai/mcp@latest` | Command to start the Schema server if it isn't running. |
| `schema.autoEvaluateRules` | `true` | Re-evaluate rules automatically on every file save. |
| `schema.allowedPaths` | `[]` | Additional file paths the Schema server is allowed to read/write. The workspace root is always allowed. |

## How It Works

The extension connects to the Schema MCP server over HTTP (default port 7474). The server extracts architecture information from your source code using language-aware parsers — no LLM calls, no cloud, no telemetry. Everything runs locally.

When you run **Evaluate Rules**, violations are mapped back to specific source locations and shown as VS Code diagnostics (squiggly underlines in the editor + entries in the Problems panel).

When you run **Diff Against Git Ref**, the extension compares the current graph against a previous version and highlights structural changes: functions added, removed, or modified; new dependencies; broken contracts.

## Polyglot Support

Schema extracts graphs from TypeScript, JavaScript, Python, Go, Rust, Java, C#, Ruby, and more. Cross-language edges (REST routes, gRPC services, database tables, message bus topics) are detected automatically.

## Works In

- VS Code 1.90+
- Cursor
- Cline
- Any VS Code API-compatible editor (via Open VSX)

## Troubleshooting

**"Cannot connect to Schema server"** — Make sure the Schema engine is installed (`schema --help` should print usage). Check that port 7474 isn't blocked or in use.

**No graph nodes found** — The workspace must contain supported source files. Open a folder (not a single file). If you're using a monorepo, open the root.

**Rules show no violations** — That's a good thing. Add custom rules with `Schema: Add Architectural Rule` or create a `.schema/rules.json` in your workspace.

## Links

- [GitHub](https://github.com/schema-ai/schema)
- [Schema Studio](https://schema.dev) (desktop app)
- [Documentation](https://schema.dev/docs)
- [Claude Code Integration](https://schema.dev/docs/integrations/claude-code)

## License

MIT

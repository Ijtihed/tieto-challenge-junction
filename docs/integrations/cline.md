# Using Schema with Cline

Schema gives Cline a live architecture graph of your codebase. Cline can check callers, evaluate rules, and preview refactoring plans before writing code.

## Setup (30 seconds)

### 1. Install Schema

```bash
npm install -g @schema-ai/mcp
```

Verify:

```bash
schema doctor
```

### 2. Add to Cline's MCP config

Cline stores MCP server configuration in its VS Code extension settings. There are two ways to configure it:

**Option A: Via Cline's MCP settings UI**

1. Open VS Code / Cursor with Cline installed.
2. Open the Cline sidebar panel.
3. Click the MCP settings icon (server icon at the top).
4. Click "Add Server" and enter:
   - **Name:** `schema`
   - **Command:** `npx`
   - **Args:** `-y @schema-ai/mcp@latest`

**Option B: Edit the settings file directly**

The config file lives at:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Linux | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Windows | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |

Add Schema to the `mcpServers` object:

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

### 3. Restart the Cline extension

Reload VS Code (`Cmd+Shift+P` → "Developer: Reload Window") or restart the editor. Cline will connect to the Schema MCP server on the next conversation.

### 4. Verify

In the Cline chat, ask:

> "List your available MCP tools."

You should see Schema's tools (`workspace.open`, `graph.summary`, etc.). Then:

> "Use Schema to summarize this workspace's architecture."

## Recommended prompts

> "Before I move `PaymentService` to a new package, use Schema to find all its callers and show me the blast radius."

> "Use Schema to evaluate all architectural rules. Are there violations I need to fix?"

> "Use Schema to diff the graph against `main`. What structural changes will this PR introduce?"

> "Use Schema to write architectural facts about this codebase into AGENTS.md."

## Troubleshooting

**Cline doesn't show Schema tools** — Verify the MCP config is correct. The most common issue is the config file path — it varies between VS Code and Cursor. Run `schema doctor` to see where Schema expects the config.

**"Command not found: npx"** — Cline needs `npx` in PATH. If you use `nvm` or `fnm`, make sure the shell Cline uses has the correct Node version. You can specify the full path: `"command": "/usr/local/bin/npx"`.

**Slow first response** — First extraction parses every file (5-15s for large repos). Subsequent calls in the same session are fast.

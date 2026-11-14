# Installing Schema as an MCP server

> **Per Q14 (no public publishing in v1.0).** Schema isn't on
> the npm registry, the VS Code Marketplace, or Homebrew yet.
> This document covers the **local-clone install** for the 4
> MCP-aware clients Schema supports today.

Schema is an **MCP server**. Once installed in your AI client,
every codebase question — *"where is auth handled?"*,
*"what calls UserService.create?"*, *"what changed in this
PR?"* — runs against the verified graph instead of the model's
freeform guessing.

The full 54 MCP actions are listed in `schema --help`. The
ones you'll use daily are:

| Action | When to use |
|---|---|
| `graph.ask` | Any natural-language codebase question |
| `pr.review` | Before merging any PR |
| `drift.generate` | Weekly to surface architectural drift |
| `graph.summary` | First-open atlas overview |
| `agents_md.write_facts` | Keep AGENTS.md in sync with the graph |

---

## Prerequisites

- macOS or Linux (Windows: WSL2 works; native Windows is
  best-effort per the dogfood README's known follow-up).
- Node.js 22+ (`node --version` to check).
- Git (for `pr.review` + `drift.generate`).
- A local clone of `schemav3` at a stable path. The examples
  below assume `~/schemav3`.

```bash
# 1. Clone the repo (if you haven't already).
cd ~
git clone https://github.com/schema-ai/schemav3.git schemav3
cd schemav3

# 2. Install dependencies.
npm install

# 3. Verify the install with the diagnostic checker.
node --experimental-strip-types src/cli/index.ts doctor
# All checks should print ✓. If any fail, follow the hint.
```

---

## Cursor

Cursor uses **`mcp.json`** at `~/.cursor/mcp.json`. If the
file doesn't exist yet, create it.

```jsonc
{
  "mcpServers": {
    "schema": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/Users/YOU/schemav3/src/cli/index.ts",
        "--stdio"
      ]
    }
  }
}
```

Restart Cursor. The Schema MCP server should appear in the
**MCP Tools** panel (look for `graph.ask`, `pr.review`, etc.).

**Recommended Cursor rules** (paste into `.cursor/rules/`):

```text
When the user asks a question about the codebase architecture,
flow, or "where" / "what calls" / "what depends on" / "what
changed", call the Schema MCP action graph.ask first with the
question as the query.

When reviewing a PR or about to merge a branch, call
pr.review with the base ref. Schema returns a hybrid-strict
review — surface its findings but do NOT auto-approve.
```

---

## Claude Code

Claude Code reads `~/.config/claude-code/mcp.json` (or
`%APPDATA%\claude-code\mcp.json` on Windows).

```jsonc
{
  "mcpServers": {
    "schema": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/Users/YOU/schemav3/src/cli/index.ts",
        "--stdio"
      ]
    }
  }
}
```

Restart Claude Code. Test with `@schema graph.ask "where is
auth handled?"` in a chat.

**Recommended CLAUDE.md addition** (in your work-repo root):

```markdown
## Tooling

This repo has a Schema MCP server installed. For any
architectural question or PR review, prefer calling the
Schema action over freeform reasoning:

- `graph.ask` — natural-language code search grounded in
  the typed graph
- `pr.review` — hybrid-strict PR review (advisory only;
  human must approve)
- `drift.generate` — weekly architectural drift report
```

Schema's `agents_md.write_facts` automatically appends the
Schema-fenced facts section to CLAUDE.md (or AGENTS.md if
present) on every workspace open. Don't edit inside the
fence — the next run will overwrite it.

---

## Cline

Cline (VS Code extension) reads `cline_mcp_settings.json`
from the extension's data directory. The Cline UI also has a
GUI installer at **Cline → Settings → MCP Servers → Add**.

Manual JSON:

```jsonc
{
  "mcpServers": {
    "schema": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/Users/YOU/schemav3/src/cli/index.ts",
        "--stdio"
      ],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

The `autoApprove: []` is important: per research/26 §6 +
Schema's hybrid-strict design, no Schema action should
auto-execute. Every call is a deliberate ask.

---

## Continue

Continue uses `~/.continue/config.json` (top-level
`mcpServers` array, not the older `experimental.mcpServers`).

```jsonc
{
  "mcpServers": [
    {
      "name": "schema",
      "transport": "stdio",
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/Users/YOU/schemav3/src/cli/index.ts",
        "--stdio"
      ]
    }
  ]
}
```

Restart Continue (Reload Window in VS Code / JetBrains).

---

## Troubleshooting

**"command not found: node"**

You're on Node < 22 or missing a global install. Try:

```bash
which node
node --version
# Need ≥ 22. Use fnm / volta / nvm to install:
fnm install 22 && fnm use 22
```

**"--experimental-strip-types is not a known option"**

You're on Node < 22.6. Upgrade to Node 22.6+.

**"MCP server failed to start"**

Run the same command in your terminal to see the actual
error:

```bash
node --experimental-strip-types /path/to/schemav3/src/cli/index.ts --stdio
```

If it prints JSON-RPC ready messages, the server's fine —
the client may not be passing stdin correctly. Check the
client's logs.

**"graph.ask returns no hits"**

Open a workspace first. Every Schema action takes a
`sessionId` parameter; you get one from `workspace.open`. In
MCP clients this happens transparently when you call
`graph.ask` for the first time per workspace.

**Schema's events log is filling up**

Schema writes `~/.schema/events.jsonl` automatically. It
rotates at 10 MB. To disable entirely:

```bash
export SCHEMA_EVENT_LOG=off
```

---

## What's next

- Step 11b (the 2-week founder dogfood) is the v1.0 launch
  gate. See `architecture/dogfood-readme.md` for the literal
  Day 0 / Day 1 / Day 14 checklist.
- Bug reports, feature requests, and general feedback go to
  GitHub issues at github.com/schema-ai/schemav3.

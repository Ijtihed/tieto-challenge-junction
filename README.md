# Schema

> The trust layer for vibe coding.
>
> When AI agents change your codebase, Schema shows you what
> changed structurally — not as a diff, as a graph — and enforces
> the architectural rules your team has set. Senior engineers
> stop blindly trusting AI agents. They start verifying.

**Junction 2026, Tieto "Earned Trust in AI Code":** start at [`junction/README.md`](junction/README.md)
(how to run it) and [`junction/CONCEPT.md`](junction/CONCEPT.md) (concept card). Architecture spec at
[`architecture/schema-v3.md`](architecture/schema-v3.md).

Schema gives AI agents and senior+ engineers a queryable project
graph over MCP. Point it at any repo — TypeScript, Python, Go,
Java, Kotlin, Ruby, or Rust — and get a structural understanding
of the codebase: what depends on what, which routes exist, where
the cross-language contracts are, and what changed between two
git refs.

The graph powers architectural code review, drift detection,
cross-language reference tracing, and copy-ready markdown
artifacts you paste into PRs, ADRs, and design docs.

---

## Install

**MCP clients (Claude Desktop, Cursor, Cline, Windsurf, Zed)** —
paste into your `mcp.json`:

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

**CLI** — for direct use and scripting:

```bash
npm install -g @schema-ai/mcp
```

**Schema Studio (desktop app)** — download from
[schema.dev](https://schema.dev) or build from source:

```bash
cd clients/studio && npm install && npm run tauri:build
```

**VS Code / Cursor extension** — search "Schema" in the extension
marketplace, or install from `clients/vscode/`.

**Verify your setup:**

```bash
schema doctor
```

---

## What it does

| Capability | How it works |
|---|---|
| **Architecture graph** | 7 extractors (TS/JS, Python, Go, Java/Kotlin, Ruby, Rust, config files) build a typed node+edge graph from your source using tree-sitter. |
| **Cross-language bridges** | 3 bridges: REST (fetch() calls to route handlers), gRPC (proto services to Go/Java/TS impls), SQL (DDL tables to ORM models). Emit `implements_contract` and `consumes_contract` edges across languages. |
| **48 MCP actions** | `graph.summary`, `graph.search`, `graph.list_edges`, `graph.diff_against`, `graph.query`, `graph.import`, `rules.evaluate`, `plan.propose`, `workspace.list_files`, `workspace.read_file`, `workspace.write_file`, and 37 more. |
| **4 built-in rules** | `no-cycle`, `must-have-handler`, `must-have-inbound`, `must-have-outbound` — stack-neutral structural checks that run on any graph. |
| **Diff overlay** | `graph.diff_against` shows which nodes changed between git refs, with a copy-ready markdown comment for PR descriptions. |
| **Plan flow** | `plan.propose` → `plan.apply` → `plan.restore` — codemods with auto-rollback on failure and file snapshots. |
| **AGENTS.md round-trip** | Reads your AGENTS.md, writes Schema-derived facts (languages, node counts, route handlers, contracts, violations) into a fenced section. Idempotent. |
| **9 bundled skills** | Procedural guides (refactor handler into service, detect architectural drift, Claude Code workflow) + paradigm-specific knowledge (OTP supervision, CQRS, Jepsen fault classes). |
| **60-doc canon** | Searchable corpus: OTP/BEAM (12), STM/functional concurrency (12), CQRS/Event Sourcing (12), distributed systems + Jepsen (24). BM25 scoring. |
| **Schema Studio** | Tauri 2.x desktop app with react-flow graph canvas, Monaco code editor, diff visualizer, rule authoring, and file tree. Auto-starts the MCP server as a sidecar. Free + OSS + MIT. |

---

## CLI commands

```
schema                          Start MCP server in stdio mode (for mcp.json)
schema --stdio                  Same as above (explicit)
schema serve [port]             Start HTTP server (default: 7474)
schema graph <path>             Print graph summary for a workspace
schema diff <path> [ref]        Print diff against a git ref (default: HEAD)
schema rules <path>             Evaluate rules on a workspace
schema agents-md <path> read    Read the Schema-fenced AGENTS.md section
schema agents-md <path> write   Write graph-derived facts to AGENTS.md
schema pr-review <path> [ref]   Generate a PR review summary
schema export-rules <path>      Export rules as JSON
schema git-status <path>        Show git status for a workspace
schema doctor                   Check environment and config
schema --help                   Show help
```

**Examples:**

```bash
# See the architecture of any repo
schema graph ~/projects/my-app

# Evaluate rules and check for violations
schema rules ~/projects/my-app

# Diff against main branch
schema diff ~/projects/my-app "merge-base origin/main"

# Write architectural facts to AGENTS.md
schema agents-md ~/projects/my-app write

# Generate a PR review comment
schema pr-review ~/projects/my-app origin/main

# Check your environment is set up correctly
schema doctor
```

---

## Quick start

```bash
# Start the HTTP server (for Studio or web dashboard)
schema serve

# In another terminal — open the web dashboard
cd clients/web && npm install && npm run dev
# Open http://localhost:5173
```

Or use Schema Studio (desktop app — starts the server automatically):

```bash
cd clients/studio && npm install && npm run tauri:dev
```

---

## The 48 MCP actions

| # | Action | What it does |
|---|--------|-------------|
| 1 | `workspace.open` | Open a workspace, run all extractors, build the graph |
| 2 | `workspace.describe` | Return workspace metadata (languages, extractors, samplers) |
| 3 | `workspace.close` | Close a session |
| 4 | `workspace.list_files` | List workspace files (respects .gitignore) |
| 5 | `workspace.read_file` | Read a file from the workspace |
| 6 | `workspace.write_file` | Write a file + trigger re-extraction |
| 7 | `graph.summary` | Cluster-level summary with node/edge counts |
| 8 | `graph.list_nodes` | Paginated node listing with filters |
| 9 | `graph.list_edges` | Bulk edge listing with optional relation/source/target filters |
| 10 | `graph.get_node` | Get a single node with optional source/snippet |
| 11 | `graph.find_callers` | Walk incoming edges (depth-configurable) |
| 12 | `graph.find_callees` | Walk outgoing edges (depth-configurable) |
| 13 | `graph.path` | BFS shortest path between two nodes |
| 14 | `graph.search` | Fuzzy name search across nodes |
| 15 | `graph.diff_against` | Diff current graph against a git ref or cached snapshot |
| 16 | `graph.summarize` | Architectural summary with edge stats and smells |
| 17 | `graph.query` | Run Datalog queries against the graph |
| 18 | `graph.list_queries` | List bundled architectural search queries |
| 19 | `graph.import` | Import SCIP index for compiler-precise cross-references |
| 20 | `graph.list_snapshots` | List persisted graph snapshots for a workspace |
| 21 | `graph.delete_snapshot` | Delete a persisted graph snapshot |
| 22 | `rules.list` | List all rules (builtins + session + imported) |
| 23 | `rules.evaluate` | Evaluate rules, return violations |
| 24 | `rules.add` | Add a session-level rule |
| 25 | `rules.export` | Export rules to schema.config.json |
| 26 | `ops.list` | List available codemods |
| 27 | `ops.preview` | Preview a codemod (diff + blockers) |
| 28 | `ops.signatures` | Get op preconditions and postconditions |
| 29 | `plan.propose` | Create a multi-step plan (supports BYOK LLM) |
| 30 | `plan.apply` | Apply a plan (auto-rollback on failure) |
| 31 | `plan.restore` | Restore files from snapshots |
| 32 | `plan.cancel` | Cancel a running plan |
| 33 | `plan.status` | Check plan run state |
| 34 | `plan.validate` | Validate plan steps against preconditions |
| 35 | `plan.interference` | Detect conflicts between plan steps |
| 36 | `tests.run` | Detect and run test suite |
| 37 | `markdown.read` | Fetch a stored markdown variant by URI |
| 38 | `samplers.list` | List available LLM samplers |
| 39 | `agents_md.read` | Read the Schema-fenced AGENTS.md section |
| 40 | `agents_md.write_facts` | Write graph-derived facts to AGENTS.md |
| 41 | `skills.list` | List bundled skills |
| 42 | `canon.search` | Search the paradigm canon (BM25) |
| 43 | `canon.read` | Read a specific canon document |
| 44 | `pr.review` | Generate a PR review with violations and diff |
| 45 | `extract.invalidate` | Invalidate graph nodes for changed files |
| 46 | `incremental.stats` | Get incremental extraction statistics |
| 47 | `git.status` | Get git status for the workspace |
| 48 | `github.open_pr` | Open a GitHub PR with Schema review |

---

## Schema Studio

Tauri 2.x desktop app. Auto-starts the MCP server, native folder
picker, graph visualization with ELK layout, Monaco editor, rule
authoring, and plan execution.

```bash
# Development
cd clients/studio
npm install
npm run tauri:dev

# Production build (.dmg / .msi / .AppImage)
npm run tauri:build
```

Studio features:
- **4-level zoom**: Overview → Architecture (clusters) → Modules (files) → Functions (symbols)
- **Auto-resume**: close and reopen without losing your graph, rules, or plan
- **Canvas persistence**: node positions survive reload (IndexedDB)
- **LLM planning**: paste an API key (Anthropic/OpenAI/Gemini) in Settings for AI-powered refactoring plans
- **Progress streaming**: per-extractor progress via SSE during graph extraction
- **Large graph heuristic**: repos with 300+ nodes auto-start at cluster view

---

## LLM integration (BYOK)

Schema supports Bring Your Own Key for AI planning. Set one of
these environment variables for the MCP server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AI...
```

Or paste a key in Schema Studio's Settings panel. The key is
passed through to `plan.propose` without Schema storing it.

Sampler priority: Anthropic → Gemini → OpenAI → mock (graph heuristic).
Without any key, `plan.propose` falls back to a deterministic
graph-heuristic planner.

---

## For teams

**[Schema Hub](https://hub.schema.dev)** adds cross-repo
capabilities on top of the OSS core:

- **Cross-repo AGENTS.md publishing** — set a canonical template
  once at the org level; Hub writes Schema-fenced facts to every
  subscribed repo on each commit.
- **Shared rule packs** — define rules centrally; violations surface
  as PR comments via the Schema GitHub App.
- **Automatic PR review** — architectural-impact review posted as a
  GitHub comment on every PR. Same artifact you'd paste manually,
  but automatic and at scale.
- **Multi-repo polyglot graph** — query across all repos in your org.

Founder tier: **$99/month flat.** The OSS core stays MIT, BYOK,
no-telemetry forever.

---

## Architecture

Schema is an MCP server. Every client — Studio, the CLI, the
VS Code extension, Claude Desktop, Cursor, any MCP-speaking
agent — talks to it over the same wire protocol. The server owns
all state (sessions, graphs, plans, rules). Clients hold a
`sessionId` and a subscription.

```
┌─────────────────────────────────────────────┐
│  MCP clients (Studio, CLI, VS Code, Claude, │
│  Cursor, Cline, any MCP-speaking agent)     │
└──────────────────┬──────────────────────────┘
                   │ stdio or Streamable HTTP
┌──────────────────▼──────────────────────────┐
│  MCP server                                 │
│  transport → protocol → dispatcher          │
│  48 actions · 7 extractors · 3 bridges      │
│  4 rules · 8 ops · 9 skills · 60-doc canon  │
│  session store · event bus · file snapshots  │
│  SQLite graph cache · BYOK LLM samplers     │
└─────────────────────────────────────────────┘
```

Module DAG (enforced by ESLint):
`obs → domain → adapters → session/extractors/samplers/wisdom → actions → mcp → clients (wire only)`

---

## Development

```bash
# Install dependencies
npm install

# Typecheck
npm run typecheck

# Run all 798 tests
npm test

# Lint (DAG + vocabulary enforcement)
npm run lint

# Build for publishing
npm run build

# Build standalone binaries (requires @yao-pkg/pkg)
npm run pkg
```

### Studio development

```bash
cd clients/studio
npm install
npm run dev          # Vite dev server on :5173
npm run tauri:dev    # Tauri desktop app (auto-starts MCP server)
npm run tauri:build  # Production build
npm run test:e2e     # Playwright e2e tests
```

### Web dashboard

```bash
cd clients/web
npm install
npm run dev          # Vite on :5173 (needs `schema serve` running)
```

### VS Code extension

```bash
cd clients/vscode
npm install
npm run build        # Compile extension
npm run package      # Build .vsix
```

## Environment variables

| Variable | Required | Used by |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | No | `plan.propose` LLM sampler |
| `OPENAI_API_KEY` | No | `plan.propose` LLM sampler |
| `GEMINI_API_KEY` | No | `plan.propose` LLM sampler (also accepts `GOOGLE_API_KEY`) |
| `DATABASE_URL` | Site only | Neon Postgres for waitlist + users |
| `RESEND_API_KEY` | Site only | Magic link emails |
| `STRIPE_SECRET_KEY` | Site only | Subscription billing |
| `SESSION_SECRET` | Site only | JWT session signing |

---

## License

MIT

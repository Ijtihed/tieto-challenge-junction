# Earned Trust in AI Code: reference implementation

Schema, repurposed to review agent-written C# changes. The AI produces a receipt with evidence; a named human signs.

- [CONCEPT.md](CONCEPT.md): recommendation, principles, trade-offs, limits
- [FAILURE-MODES.md](FAILURE-MODES.md): what went wrong and what the engine missed
- [LESSONS-LOG.md](LESSONS-LOG.md): decisions while building
- `requirements/`: one file per sample change (written from the public upstream issues)
- `policy.json`: risk areas, tiers, silencing patterns, earned-trust rule
- `receipts/`, `signoffs/`, `test-runs/`, `ledger/`: produced at runtime

## Run

Prerequisites: Node 22+, .NET SDK 8 (`~/.dotnet` is picked up automatically), and a clone of the challenge repo with its `ju26-*` branches fetched.

```bash
npm install
npm run build:csharp                                                # Roslyn AST tool
SCHEMA_TRUST_REPO=~/junction26-messagepack-csharp npm run serve     # MCP server, :7475
cd clients/studio && npm install && SCHEMA_PORT=7475 npx vite --port 5175   # Studio, :5175
```

Open http://localhost:5175 and press Open (the path comes from the server). The saved REQ-2234 run, receipt
and sign-off load without any keys; `trust.receipt` builds a fresh receipt for any of the four sample branches.

"Fix it with Claude Code" needs more: the `claude` CLI logged in, `gh` logged in, and your own copy of the
challenge repo as a git remote. CI runs on CRACI through `junction/ci/schema-ci.yml` (copy it to the repo's
`.github/workflows/` on `main`); `SCHEMA_CI=local` runs build, tests and the vulnerable-package scan locally.

| Variable | Default |
|---|---|
| `SCHEMA_TRUST_REPO` | `~/junction26-messagepack-csharp` |
| `SCHEMA_TRUST_PR_REPO` / `SCHEMA_TRUST_PR_REMOTE` | `Ijtihed/junction26-messagepack-csharp` / `copy` |
| `SCHEMA_CI` | `craci` (`local` to run CI in the agent's worktree) |
| `SCHEMA_PAGE_BASE` | `http://localhost:5175` (link to the live PR page) |

## Actions

| Action | Does |
|---|---|
| `trust.list_requirements` | Requirements and saved receipts |
| `trust.receipt` | Builds the receipt (AST diff, graph, claims, refusals, tier, read list) |
| `trust.graph` | Evidence subgraph: tests, call path, changed code |
| `trust.run_tests` | Runs the test classes that reach the change, records the result as evidence |
| `trust.signoff` | Named owner's decision; refuses to accept while refusals are unanswered |
| `trust.record_escape` | Records a defect that got past review; withdraws earned trust in that area |
| `trust.ledger` | Area track record and decision log |

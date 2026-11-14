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
npm run build:csharp                       # builds tools/csharp-ast (Roslyn)
SCHEMA_TRUST_REPO=~/junction26-messagepack-csharp npm run serve   # :7474
cd clients/web && npm install && npx vite  # :5173, "Review" tab
```

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

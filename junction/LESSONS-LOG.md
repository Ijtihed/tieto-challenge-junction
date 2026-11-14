# Lessons and decision log

Short entries, newest last. The machine log of every receipt and sign-off is `ledger/decisions.jsonl`.

## 2026-11-13

- **Base: Schema (architecture graph over MCP).** It already treats AI review as advisory: `github.review` posts comments and never approves. We kept that rule.
- **C# via Roslyn, not tree-sitter.** Roslyn binds symbols, so call edges are real, not name guesses. Cost: a .NET 8 sidecar (`tools/csharp-ast`). Schema's `graph.import` only takes SCIP, so we wrote a native extractor instead of an importer; workspace open, clustering and rules then work on C# unchanged.
- **Symbol-keyed node ids.** Schema's other extractors key nodes by line range. For review, ids must survive line shifts, so C# nodes are keyed by `Namespace.Type.Member(params)`.
- **Member-level AST diff.** The diff compares token streams per member, so whitespace or comment edits are separated from body, signature, accessibility and attribute changes.
- **Deterministic claims first.** No model key was available at the start. That turned out to be the right default: every claim on the receipt today is decided by AST, graph, git, policy or requirement data. A model can be added for the story and for extra questions.
- **Refusals block acceptance.** An owner can request changes without answering them, but cannot accept.
- **Generated files grouped by exact edit signature.** "Uniform" was first a count of distinct lines and flagged all 222 files on #2297. Grouping by signature cleared 221 and isolated the one real outlier.
- **Static test reachability had false negatives** through framework dispatch and generic type arguments (see failure mode 1). Fixed in the extractor, not by loosening the claim.
- **Owner-reads metric counts changed lines only.** The first version counted member spans and produced "753 of 228".

## 2026-11-14

- **Graph-guided agent.** Before Claude Code starts, Schema builds a "where to look" brief from the graph and puts it in the prompt. Two strategies: Gemini Flash ranks the curated components when `GEMINI_API_KEY` is set; otherwise a free ranker matches issue identifiers to symbol names, literal mentions in source (catches lookups by string name the graph cannot see) and module descriptions, then expands along graph connections.
- **Measured, not assumed.** Ground truth = pre-existing source files changed by the organisers' branches and by Claude's runs. Recall of the brief's top 8 files: 1/30 for symbol matching alone, 13/28 after adding literal mentions and module relevance (2283: 1/1, 2297: 9/13, 2129: 3/13, 2234: 0/1). The misses are issues described in product terms; that is the case for the cheap LLM. Re-run with a Gemini key to compare.
- **Canvas animates only on edits.** Reads and searches made the map flicker without meaning anything; only edits now move it.
- **CI before PR.** Local CI (build, tests, SBOM, introduced-vulnerability scan) runs on every agent commit; failures go back to the same agent session at most twice. Pre-existing vulnerable test dependencies (NuGet.Packaging 6.8.0, System.Formats.Asn1 6.0.0) are reported, not blamed on the change.

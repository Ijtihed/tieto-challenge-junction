# Extract Package from Monolith

Move a cohesive set of modules into a separate package with a clear API boundary.

## When to use

- A directory has high internal cohesion (modules mostly call each other) and low external coupling (few outside callers)
- You want to enforce encapsulation — internal modules should not be imported directly by consumers
- The code is a candidate for an independent versioning/release cycle

## Steps

1. **Identify the cluster.** Run `graph.summary` and look for a group of nodes with dense internal edges and sparse external edges. A cluster with >70% internal edges is a strong extraction candidate.
2. **Map external consumers.** For each module in the cluster, run `graph.find_callers` to enumerate every external caller. This is your migration surface — every call site you'll need to rewire.
3. **Define the public API.** Create an `index.ts` (or equivalent) that re-exports only the symbols external callers actually use. Everything else becomes package-internal.
4. **Create the package boundary.** Move files into a new package directory with its own manifest (`package.json`, `Cargo.toml`, etc.). Configure path aliases or workspace references so the build resolves.
5. **Rewrite external imports.** Update every caller found in step 2 to import from the package's public API, not from internal paths. Run `graph.find_callers` again to confirm no internal imports remain.
6. **Add a boundary rule.** Use `rules.evaluate` with a rule that forbids direct imports of internal modules from outside the package. This prevents future coupling.
7. **Validate.** Run `graph.diff_against` your pre-extraction baseline to confirm the dependency graph simplified (fewer cross-boundary edges, no new cycles).

## Anti-patterns

- Extracting a package that still depends on 15 modules in the monolith (you moved the boundary but not the cohesion)
- Exposing every internal symbol in the public API "just in case"
- Skipping the boundary rule — within a month, someone will import an internal module directly

## Example

A `billing/` directory contains `invoice.ts`, `tax.ts`, `currency.ts`, and `stripe-adapter.ts`. Running `graph.find_callers` shows only `invoice.create` and `invoice.refund` are called externally. The new `@app/billing` package exports those two functions. The 14 internal helpers become invisible to the rest of the codebase, and a lint rule enforces the boundary.

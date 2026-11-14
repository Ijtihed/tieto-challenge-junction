# Detect Architectural Drift

Compare the current dependency graph to a baseline to find unintended structural changes.

## When to use

- Regularly per-sprint or per-milestone to catch structural erosion early
- After a large merge or feature branch lands
- Before a release, to confirm the architecture matches the intended design
- When onboarding to a codebase to understand how far reality has drifted from documentation

## Steps

1. **Capture or locate the baseline.** Your baseline is the last-known-good graph snapshot. If you don't have one, run `graph.summary` now and save the output — this becomes your baseline for next time.
2. **Run the diff.** Execute `graph.diff_against` comparing the current graph to the baseline. The output shows added nodes, removed nodes, added edges, removed edges, and new cycles.
3. **Check for new cycles.** Any new cycle is a red flag. Cycles between layers (e.g., `domain → adapters → domain`) indicate a dependency inversion violation. Prioritize these — they compound fast.
4. **Check for orphans.** New nodes with zero incoming edges may be dead code, or they may be a new entry point missing integration. Confirm which.
5. **Check cross-boundary imports.** Look for new edges that cross package or layer boundaries unexpectedly. A new `ui → database` edge is almost always wrong.
6. **Assess severity.** Not all drift is bad. A new edge from `api → service` is expected growth. A new edge from `service → api` is a layering violation. Classify each change as intended, accidental, or concerning.
7. **Act on findings.** For accidental drift: fix now. For concerning drift: file a tech-debt item. For intended changes: update the baseline. Run `graph.summary` and save the new snapshot.
8. **Update AGENTS.md.** If drift reveals a structural pattern the team should follow (or avoid), add it to the project's `AGENTS.md` so future AI-assisted work respects the constraint.

## Anti-patterns

- Running drift detection only when something breaks (by then, 20 violations have accumulated)
- Treating every new edge as a violation (growth is expected; the question is whether it respects boundaries)
- Updating the baseline without reviewing the diff (rubber-stamping drift)

## Example

After a two-week sprint, `graph.diff_against` reveals 3 new nodes, 8 new edges, and 1 new cycle: `payments → notifications → payments`. Investigation shows a developer added a "notify on refund" call from `notifications` back into `payments` to check refund status. The fix: `notifications` receives refund status as a parameter instead of importing `payments`. The cycle disappears, and a `rules.evaluate` rule is added to prevent `notifications → payments` edges in the future.

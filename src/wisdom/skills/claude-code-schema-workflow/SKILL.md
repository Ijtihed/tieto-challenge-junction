# Claude Code + Schema Workflow

Use Schema effectively from Claude Code for architecture-aware refactoring.

## When to use

- Using Claude Code (or any MCP-capable agent) with a Schema MCP server connected
- Any refactoring, migration, or structural change where you want the agent to understand the architecture before acting
- When you want the agent to validate its changes against architectural rules after acting

## Steps

### First: Open the workspace

0. **Start a session.** If you haven't already opened the workspace in this conversation, call `workspace.open` with the workspace URI (e.g., `file:///path/to/repo`). This starts a session and triggers graph extraction. All subsequent calls require the `sessionId` returned here. If a session is already open (you can tell because prior tool calls used a `sessionId`), skip this step.

### Before: Understand the structure

1. **Get the big picture.** Call `graph.summary` to see the full node/edge map. Identify the layers, the clusters, and the current dependency flow. Always do this before proposing a plan — you need to know what the codebase looks like before deciding how to change it.
2. **Scope the change.** Call `graph.find_callers` on the module you're about to modify. This tells you the blast radius — every caller that might break.
3. **Trace dependencies.** Call `graph.find_callees` on the same module. This tells you what the module depends on — constraints on what you can change without cascading.
4. **Check existing rules.** Call `rules.evaluate` to see if any architectural rules already constrain your planned change (e.g., "controllers must not import repositories directly").

### During: Make changes with guardrails

5. **Preview before applying.** Use `ops.preview` on any structural operation to see the before/after diff without committing. Review the preview before proceeding.
6. **Use `plan.propose` for multi-step changes; write files directly only for single-file edits.** If the refactor touches 2+ files or has ordering constraints (e.g., update callers before deleting the old module), use `plan.propose` to generate a sequenced plan. For trivial single-file changes (rename a variable, add a comment), writing files directly is fine — but still run `rules.evaluate` afterward.
7. **Evaluate incrementally.** After each significant change, run `rules.evaluate` to catch violations early. Don't wait until the end — a violation in step 3 of 8 is cheaper to fix than one discovered at step 8.

### After: Validate and record

8. **Run full rule evaluation.** Call `rules.evaluate` one final time against the complete changeset.
9. **Diff against baseline.** Call `graph.diff_against` to confirm the structural change matches your intent. Look for unexpected new edges or cycles.
10. **Commit with context.** Include the `graph.diff_against` summary in your commit message so reviewers see the structural impact alongside the code diff.

## Anti-patterns

- Forgetting to call `workspace.open` at the start of a new conversation (all other calls will fail without a sessionId)
- Jumping straight to code changes without calling `graph.summary` first (flying blind)
- Skipping `graph.find_callers` and discovering broken imports after the fact
- Using `plan.propose` for a one-line change (overkill) or writing files directly for a 5-file migration (no sequencing, no rollback)
- Running `rules.evaluate` only at the end and facing a cascade of violations
- Trusting `ops.preview` output but not reading it (the preview is only useful if you actually review it)

## Example

Task: move `UserService` from `modules/users/` to a new `@app/identity` package. Before: `graph.find_callers('UserService')` reveals 14 callers across 6 modules. During: `plan.propose` generates an 8-step migration plan — create package, define API, update callers in dependency order, remove old module. After each step, `rules.evaluate` confirms no cross-boundary violations. After: `graph.diff_against` shows 14 rewired edges, 0 new cycles, 1 removed node. The commit message includes "structural impact: 14 edges rewired, UserService moved to @app/identity, no new cycles."

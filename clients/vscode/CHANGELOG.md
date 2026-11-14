# Changelog

All notable changes to the Schema VS Code extension.

## [0.1.0] - 2026-05-12

### Added

- **9 commands**: Open Architecture Graph, Evaluate Rules, Diff Against Git Ref, Find Callers, Find Callees, Show Graph for Current File, Generate PR Summary, Add Architectural Rule, Open in Schema Desktop.
- **2 sidebar tree views**: Summary (nodes, edges, clusters) and Rules & Violations.
- **Diagnostics integration**: rule violations and diff results appear as inline diagnostics in the editor and in the Problems panel.
- **Status bar**: shows violation count, clickable to re-evaluate rules.
- **Auto-evaluate on save**: rules re-evaluate when any file is saved (configurable via `schema.autoEvaluateRules`).
- **Settings**: `schema.serverPort`, `schema.serverCommand`, `schema.autoEvaluateRules`, `schema.allowedPaths`.
- **Session lifecycle**: automatic session open on first command, clean close on deactivation.
- **Polyglot support**: works with any language the Schema engine supports (TypeScript, Python, Go, Rust, Java, C#, Ruby, and more).

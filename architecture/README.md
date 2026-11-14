# Schemav3/architecture

> **Status:** v3 architecture spec landed at
> [`schema-v3.md`](schema-v3.md). Binding once user-approved.

This folder holds:

- **[`schema-v3.md`](schema-v3.md)** — the v3 architecture spec.
  2,369 lines · 130 research citations · 94 sections. Synthesises
  the 14 binding research docs in `../research/` + the vocabulary
  kit at `../marketing/vocabulary-kit.md`. Every architectural
  decision cites at least one research finding.
- **`audits/`** — historical audits.
  - [`case-study-empty-extraction-ux-gap.md`](audits/case-study-empty-extraction-ux-gap.md)
    — v2 UX failure carried forward as a case study. Cited in
    `schema-v3.md` §12 (F2) + Rule 9.

When code commits begin (per Rule 11 of `schema-v3.md` §1), this
folder will also hold:

- `dag.json` — the v3 module DAG, source of truth for the lint
  rule that enforces §3.12's forbidden cycles.
- `deviations.md` — the v3 deviations log. Per Rule 2: should have
  ≤ 10 rows over v3's lifetime (vs v2's 72). If it grows above
  that, the architecture doc was wrong; fix the architecture, not
  the build.

## What v3's architecture decides

In rank order of importance:

1. **MCP as the only contract.** Rule 1.
2. **Plug-and-play binding constraint.** Rule 3 — the v2 → v3
   inversion.
3. **Server-owned state.** Rule 4, inherited.
4. **The 32-action surface.** §5, 30 active day-one.
5. **The 7 bundled extractors.** §3.6, all in the binary.
6. **The wisdom layer.** §10, ~75 MB of 8 skills + 60-doc canon +
   AGENTS.md round-trip writer.
7. **Node.js LTS runtime.** §11, with `@yao-pkg/pkg` standalone
   binaries + `npx -y @schema-ai/mcp@latest` as the primary install.
8. **One product, ships when ready.** Shift 3 in
   [`../README.md`](../README.md).

## What `schema-v3.md` does NOT decide

- The v1 / v2 deletion timeline (user's call).
- The launch date (when v3 is ready).
- Year-2 monetisation (separate decision, post-launch).
- Specific UI/UX details inside the web app (the spec defines the
  wire contract; rendering is the web-app builder's call).

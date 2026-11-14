# Phase 13 — The product surface

> **Status:** spec, draft 1. Binding once approved.
>
> **Read order:** `../VISION.md` → this doc → `schema-v3.md` (the
> engineering spec). The vision says *what* we build; this spec
> says *how* + *in what order* + *by what gate*.
>
> **What this doc decides.** The five tracks (T1–T5) for Phase 13.
> Per-track scope, deliverables, dependencies, success criteria,
> and the v1.0 launch gate.
>
> **What this doc does NOT decide.** Engineering modules / DAG /
> action surface — those live in `schema-v3.md`. The product
> narrative — that lives in `../VISION.md`. The IDE-vs-viewer call —
> that's `../research/15-ide-revisit.md` (Path A binding).
>
> **The 30-second summary.** Phase 1-12 built the engine
> (extractors, 30 MCP actions, rules, codemods, web dashboard
> shell). Phase 13 builds the **product** users actually see and
> pay for: a polished Desktop viewer (T1), a real VS Code/Cursor
> extension (T2), Schema Hub MVP for revenue (T3), rule authoring
> UX (T4), and Claude Code integration polish (T5). Ship T1-T3 in
> 10-12 weeks (revised from 6-10 per v1-readiness.md). T4 + T5 as fast-followers. Private alpha first;
> public launch after retention is real.

---

## 1. Scope summary

| Track | What | Why | Surface | Status |
|---|---|---|---|---|
| **T1** | **Schema Studio** — Tauri 2.x app with full Monaco editor + graph viewer + diff visualizer + rules UX | Primary user-facing surface (`VISION.md §2.1, §6, §8`); the visualization-as-app that makes vibe coding trustable. **Path B' per `research/15` postscript (2026-05-11 amendment).** | Standalone desktop app (macOS, Linux, Windows) | New build |
| **T2** | Real VS Code / Cursor / Cline extension | Where users already live; lowest install friction; in-editor diff overlay | VS Code marketplace, Cursor marketplace, OpenVSX | Replaces Phase 10 alpha |
| **T3** | Schema Hub MVP | Revenue surface; the GitHub-App + hosted-Web that justifies $20/seat | `hub.schema.dev` (TBC); GitHub App; Stripe billing | New build |
| **T4** | Rule authoring UX | Schema's vision is rule enforcement; the engine exists, the UX doesn't | Lives inside T1 + T2 + T3 | New build |
| **T5** | Claude Code integration polish | Acquisition narrative depends on Claude Code adoption (`VISION.md §4.3`) | The MCP server's interaction shape + Schema-aware system prompts | Continuous; first version ships with T1 |

**Phase 13 = T1 + T2 + T3 minimum to ship v1.0.** T4 + T5 ship
within 2 weeks of v1.0 launch as the v1.1 patch + continuous
improvement.

---

## 2. Track 1 — Schema Studio (renamed from Schema Desktop, 2026-05-11)

### 2.1 Mandate

Build the Tauri 2.x app that ships as the primary user-facing
surface. Per `../VISION.md §6` (Path B' binding) +
`../research/15-ide-revisit.md` postscript: **Schema Studio is a
Tauri 2.x app with the graph viewer + diff visualizer + rules UX
+ a full Monaco code editor (free edit, save-as-you-type) but
explicitly NO AI agent inside.** Schema Studio composes with
Cursor / Claude Code / Cline for AI assistance; it is where users
SEE and VERIFY the structural impact.

**Per the Obsidian model:** Schema Studio is **FREE + OSS + MIT
forever.** Not a paid tier. Schema Hub is the paid hosted layer
(T3 below); Schema Studio itself is the recommended way to USE
the free OSS install.

**Posture (per CTO 2026-05-11 evening direction):** Ship the MVP
ASAP and iterate. v1.0 launches with reasonable defaults; polish
accumulates post-launch via continuous shipping. The "feature-
complete at v1.0" framing from earlier conversations is
overturned — Schema Studio v1.0 is a working viewer + Monaco
editor + diff visualizer, not a polished masterpiece. The
masterpiece is what v1.x ships toward.

**Frontend reference.** v1 (the legacy Next.js schema-coral app)
shipped a workspace UI the CTO "somewhat likes." A stripped-down
copy lives at [`../inherited/v1-frontend-reference/`](../inherited/v1-frontend-reference/)
(51 files, ~540 KB — tool shell only; no marketing, no auth, no
backend, no pages). The companion doc
[`./frontend-reference.md`](./frontend-reference.md) names what
to crib from v1 (the shell layout, the keyboard shortcuts, the
design tokens in globals.css, the React Flow + dagre canvas
patterns, the ⌘K command bar, the inspector + plan-flow + diff-
overlay panels) and what NOT to crib (the god-object store, the
HTTP API surface, the bundled-fixture imports, the Next.js shell,
the Supabase auth). The Schema Studio builder reads
frontend-reference.md before starting UI work.

### 2.2 Framework + binary

- **Tauri 2.x** (Rust shell + system webview). Per `../research/15`
  decision: Tauri over Electron because (a) ~10 MB binaries vs
  ~150 MB, matches Schema's plug-and-play posture from
  `schema-v3.md §11.2`; (b) Rust is already in Schema's stack via
  `@ast-grep/napi`, `tantivy`, `usearch`, and the tree-sitter
  bindings; (c) forward-compatibility for embedding Monaco / CodeMirror
  in a future "editor panel" is straightforward in Tauri 2.x.
- **Frontend.** React 19 + Vite — the same stack the current
  `clients/web/` uses. The Tauri shell wraps a Vite-built bundle.
- **Backend.** None separate. Schema Desktop spawns the local MCP
  server as a child process (stdio) per `schema-v3.md §11.3`. The
  MCP server is the engine; Tauri is the chrome.

### 2.3 Forward-compatibility hooks (per `research/15 §7`)

The viewer ships with these three architectural choices:

1. **Panel-slot abstraction.** UI surfaces are composable panels:
   - Graph canvas (primary; T1.3)
   - Summary panel (left rail; T1.4)
   - Rules panel (right rail; T1.5 — also a T4 surface)
   - Diff visualizer (modal or tab; T1.6)
   - Events stream (debug; T1.7)
   - Future: code editor panel (deliberately not built; the slot exists)
2. **Multi-document data model.** Sessions can hold N workspaces
   + N pinned diffs. Mirrors what an editor would need if the
   editor decision later flips.
3. **Full-action MCP layer with write actions wired but disabled.**
   The desktop's MCP client knows how to call `plan.apply`,
   `ops.preview`, `rules.add` — but no UI surfaces them in v1.
   Re-enabling later = feature flag toggle, not a refactor.

### 2.4 Per-component scope

**T1.1 — Tauri shell + menubar + window management.**

- macOS-arm64 + macOS-x64 + linux-x64 + linux-arm64 + win-x64
  binaries via GitHub Actions release pipeline (mirrors
  `schema-v3.md §11.2`'s standalone-binary strategy).
- Native menu bar with: File (Open Workspace…), Edit, View (panel
  toggles), Window, Help (Documentation, Report Issue, About).
- Cmd-Shift-O / Ctrl-Shift-O global hotkey to open workspace.
- Auto-update via Tauri's built-in updater (off by default; opt-in
  per `schema-v3.md §11.4`'s no-auto-update default; can be
  enabled by user explicitly).

**T1.2 — MCP client integration.**

- Spawns `npx -y @schema-ai/mcp@latest` (or the user-configured
  binary path) as a stdio child process on app launch.
- Reconnect on crash.
- `Mcp-Session-Id` lifecycle managed by the desktop; clients
  inside Tauri (the React UI) talk to the desktop's MCP client via
  Tauri's IPC, not directly to the MCP server.
- Streamable HTTP fallback for the future Hub-connected mode.

**T1.3 — Graph canvas.**

- Force-directed layout for ≤1000 nodes; cluster + module level
  for >1000 nodes (clusters are pre-computed via `graph.summary`).
- Pan, zoom, fit-to-view, node search.
- Click node → inspect panel (right rail) shows source snippet
  via `graph.get_node({ include: ["source", "snippet", "blame"] })`.
- Right-click node → context menu with: Find Callers, Find Callees,
  Show Path To, Copy Locator URI.
- Edge styling per relation (`registers_route` gold, `applies_middleware`
  dashed purple, `calls` neutral, `imports` thin gray, `implements_contract`
  thick green, `consumes_contract` dashed green, `deploys_to`
  amber).
- Filter by node kind, cluster, framework.
- Time-travel: select a Git ref to view the graph at that commit
  (uses `graph.diff_against` infrastructure).

**T1.4 — Summary panel (left rail).**

- Cluster list with node counts + edge counts.
- Languages, frameworks, build systems detected.
- Top architectural smells (from `graph.summarize`).
- Recent commits with structural-impact preview.
- Workspace metadata (name, root URI, last extraction).

**T1.5 — Rules panel (right rail; also T4 surface).**

- List of active rules (builtin + session + imported).
- Per-rule: severity, source, last violation count, last evaluated.
- Click a rule → see all violations.
- Click a violation → jump to the node on the graph canvas.
- Authoring UX (T4) lives here: "+ Add rule" button → rule wizard.

**T1.6 — Diff visualizer (the killer feature).**

- Two modes:
  - **Compare two refs.** User picks base + head (defaults to
    `merge-base origin/main` → `HEAD`). Schema renders the graph
    diff side-by-side.
  - **AI-agent watch mode.** Desktop watches for new commits made
    by AI agents (commit author = `schema-bot` / `cursor` /
    `claude-code` / configurable patterns). When detected, shows
    a notification + opens the diff modal.
- Visual diff: added nodes green, removed dashed-red, modified
  amber. Highlight edges added/removed in matching colors.
- Rule violations on the diff overlay are inline (per the existing
  `graph.diff_against` markdown comment, but visually).
- "Copy as PR comment" button → fetches `markdown.read` for the
  diff's markdown variant; copies to clipboard.

**T1.7 — Events stream (debug).**

- Live tail of `SessionEvent`s from the MCP server.
- Useful for debugging, demoing, and validating "what did Schema
  just do."
- Hidden behind a developer-mode toggle by default.

**T1.8 — Onboarding.**

- First-launch wizard: "Open your first workspace" → pick a folder
  → run extractors → show the graph.
- "Don't have a workspace yet?" → preload the bundled fixture
  (the polyglot todo app).
- Tutorial overlay: 5 hotspots highlighting the panels, the diff
  visualizer, and the Monaco editor.

**T1.9 — Monaco code editor pane** (NEW under Path B' / 2026-05-11
amendment).

- Embed Microsoft's Monaco editor (the same engine VS Code uses)
  in the center panel of Schema Studio.
- Free edit + save-as-you-type. Like any IDE.
- Syntax highlighting for all 7 supported languages (TS / JS,
  Python, Go, Java, Kotlin, Ruby, Rust) + the generic-config
  formats (proto, openapi, graphql, sql, hcl, yaml).
- **Schema integration:**
  - Rule violations show as inline Monaco diagnostics (squiggly
    underlines + hover tooltips).
  - Right-click on a symbol → "Find callers", "Find callees",
    "Go to graph node" (jumps the graph canvas to the node).
  - Right-click → "Apply Schema op" → opens an op picker; on
    select, runs `ops.preview` and shows the diff before
    applying.
  - Save triggers `extract.invalidate` so the graph picks up
    changes incrementally.
- File save goes through `adapters.fs` (the MCP server's fs
  adapter); no direct Node fs writes from the Tauri shell.
- Find/replace + multi-cursor + standard keyboard shortcuts via
  Monaco's built-in capabilities.

**T1.10 — File tree pane** (NEW under Path B' / 2026-05-11
amendment).

- Workspace file browser on the left rail (above or below the
  summary panel; layout TBD in design).
- Tree view of the workspace's file system, respecting the
  workspace URIs allow-list.
- Click a file → opens in Monaco.
- Right-click → "Find in graph" → jumps the graph canvas to the
  nodes from that file.
- Respects `.gitignore` + Schema's own ignore patterns.

### 2.5 Out-of-scope for T1

Per Path B' binding (`VISION.md §6`):

- **No AI agent inside Tauri.** Schema Studio does NOT have a
  chat panel, autocomplete, agent panel, or Schema-driven
  refactor agent. Users still use Cursor / Claude Code / Cline /
  Continue for AI assistance; Schema Studio is the verification
  + visualization surface. Samplers run via the MCP server (BYOK)
  for things like `rules.evaluate({ llm: true })` and `graph.summarize`,
  but the user does not interact with samplers via chat in Studio.
- **No extension marketplace / plugin system.** Schema Studio's
  ops are the 8 bundled codemods. No third-party extension
  ecosystem.
- **No terminal integration.** Users use their existing terminal.
- **No multi-window.** v1 ships single-window-per-workspace.
- **No Git commit / branch UI.** Users use their existing Git
  tools. Schema Studio reads Git state (current branch, dirty,
  merge-base) for the diff visualizer; it does not WRITE Git
  state.
- **No language server protocol (LSP).** Monaco gets syntax
  highlighting only, not LSP-powered intellisense. (LSP could
  ship in v1.1 or later via Tauri's sidecar pattern; deferred.)

### 2.6 Success criteria

T1 ships when:

- Renders the bundled polyglot fixture (TS + Python + Go) at <2
  seconds from cold start.
- Renders the kubernetes/kubernetes repo (1.5M LoC Go) at <30
  seconds with clustering enabled.
- Renders `vercel/next.js` (2.4M LoC TS) at <30 seconds with
  clustering enabled.
- All seven extractors work end-to-end from Schema Studio (the
  user picks any of TS, Python, Go, Java, Kotlin, Ruby, Rust
  repos).
- Diff visualizer correctly handles a 50-file PR on the bundled
  fixture.
- Time-travel works for any commit reachable from HEAD.
- **Monaco editor opens any source file in the workspace,
  syntax-highlights it, saves edits via the fs adapter, and
  triggers incremental re-extraction on save** (Path B' new
  requirement).
- **Inline rule violations show in Monaco as diagnostics** within
  500ms of save (Path B' new requirement).
- **Right-click "Apply Schema op" works end-to-end** for at least
  3 of the 8 bundled ops on the polyglot fixture (Path B' new
  requirement).
- No telemetry leaves the device (per `schema-v3.md §11.4` +
  Rule 7).
- Cold-start memory < 200 MB for a typical repo (raised from
  150 MB under Path A — Monaco adds ~30-50 MB resident).

### 2.7 Salvage from current `clients/web/`

The current `clients/web/` (force-directed React canvas, summary
panel, events stream) is the starting point for T1's frontend.
What ports forward:

- Force-directed canvas (with significant polish — color, spacing,
  labels, performance).
- Summary panel layout.
- Events stream (becomes T1.7 debug surface).
- MCP client (via Tauri IPC to the desktop's spawned MCP server).

What gets newly built:

- Tauri shell + native menus + window mgmt (T1.1).
- Diff visualizer (T1.6 — the killer feature; doesn't exist today).
- Time-travel (T1.3 last bullet).
- Rules panel with violation drilldown (T1.5).
- Onboarding wizard (T1.8).
- **Monaco editor pane (T1.9)** — embed monaco-editor npm package
  in the Tauri webview. Schema-specific Monaco bindings (rule-
  violation diagnostics, right-click menu, op-apply flow). New
  vs Path A.
- **File tree pane (T1.10)** — workspace file browser. New vs
  Path A.

---

## 3. Track 2 — Real VS Code / Cursor / Cline extension

### 3.1 Mandate

The current extension (from Phase 10) is alpha-quality. T2
replaces it with the production extension that's:

- Marketplace-listed (VS Code marketplace + OpenVSX).
- Installable in Cursor (via OpenVSX or VS Code marketplace
  depending on Cursor's policy at ship time).
- Installable in Cline / Continue / Windsurf / Zed (where their
  extension story supports it).

### 3.2 Surface

**Activity-bar icon** — Schema logo, opens the Schema panel.

**Schema panel** (within the IDE sidebar):

- Mini graph canvas (zoom out only — full canvas lives in T1
  Desktop).
- Inspector for the current file: which nodes are in this file,
  which depend on it, what changes when you edit it.
- Active rules list.
- Recent violations.
- "Open in Schema Desktop" button.

**Inline editor overlays:**

- When an AI agent (Cursor's agent / Claude Code / Cline) proposes
  a refactor, the extension intercepts via the MCP client and
  shows a tooltip with the structural impact:
  - "This change introduces a `consumes_contract` edge to a new
    OpenAPI operation."
  - "This change creates a circular import."
  - "This change violates rule X."
- Tooltip is dismissible; doesn't block the AI flow.

**Status bar item** — shows current workspace's violation count;
click → opens the Schema panel.

**Commands** (Cmd+Shift+P):

- `Schema: Open workspace in Schema Desktop`
- `Schema: Evaluate rules`
- `Schema: Generate PR summary` (runs `pr.review` and copies to
  clipboard)
- `Schema: Show graph for current file`
- `Schema: Find callers of selected symbol`
- `Schema: Add architectural rule`

### 3.3 Cross-IDE compatibility

The extension targets VS Code's stable extension API surface
(not Cursor-specific or Cline-specific APIs). Per
`research/15 §1.2`: Microsoft's April 2025 extension-binary
enforcement applies to binary-only extensions; Schema's extension
is source-distributed via OpenVSX and works in any VS-Code-API-
compatible editor.

Where IDE-specific features exist (Cursor's agent integration,
Cline's autocomplete), the extension adapts gracefully:

- If `cursor` is detected, register additional commands for
  Cursor agent integration.
- If `cline` is detected, integrate with Cline's diff approval flow.

### 3.4 Success criteria

T2 ships when:

- Published to VS Code marketplace + OpenVSX.
- Works in: VS Code, Cursor, Cline (tested end-to-end against
  the polyglot fixture in each).
- The mini graph + rules panel renders correctly.
- The inline tooltip fires when Cursor's agent or Claude Code
  proposes a change.
- ≤1 second startup latency from IDE launch to "Schema panel
  ready."

---

## 4. Track 3 — Schema Hub MVP

### 4.1 Mandate

Build the revenue surface per `schema-v3.md §15.2 + §15.4`. Hub
unlocks:

- Cross-repo AGENTS.md publishing.
- Shared rule packs.
- Automatic `pr.review` comment on every team PR via GitHub App.
- Multi-repo polyglot graph.
- WorkOS SSO (week 4+ feature; v1 of Hub is GitHub OAuth-only).

### 4.2 Stack

- **Backend.** Node.js (same runtime as the OSS MCP server per
  `schema-v3.md §11.1`). Reuses 90% of the existing
  `src/extractors/` + `src/actions/` + `src/session/` code.
  Hub-specific layers: GitHub App webhook handler, Stripe billing
  webhook handler, team-membership model, multi-repo orchestrator.
- **Database.** PostgreSQL (or SQLite via better-sqlite3 in the
  early days; Postgres when scale demands). Hosted on
  Supabase / Neon / Railway (TBD; pick one before T3 starts).
- **Deployment.** Vercel / Fly / Render — pick one. Recommendation:
  Render or Fly because they handle long-running background jobs
  (GitHub webhook → extract → post comment can take 30-90 seconds).
- **Domain.** `hub.schema.dev` (or equivalent). DNS + SSL setup.
- **Auth.** GitHub OAuth (v1); WorkOS SSO (v1.1).
- **Billing.** Stripe Subscriptions API. Standard SaaS billing.

### 4.3 Per-component scope

**T3.1 — Auth + team management.**

- GitHub OAuth sign-in.
- Create / join a Schema team.
- Invite teammates by email or GitHub handle.
- Team admin role; member role.
- Stripe billing connected to team (admin-managed).

**T3.2 — GitHub App.**

- Install the Schema GitHub App into a user's repos.
- Required permissions: `read` on repos (clone for extraction),
  `write` on PR comments (post review markdown), `read` on PR
  metadata (diff base + head).
- Webhook on `pull_request.opened` + `pull_request.synchronize`.

**T3.3 — Hub backend.**

- Receive GitHub webhook → clone repo (or fetch incremental) →
  extract both base + head graphs → compute delta → evaluate
  rules → generate markdown comment → post to PR thread within
  60 seconds.
- Cache extraction results by `(repo_id, sha)` to amortize cost
  across PRs.

**T3.4 — Cross-repo AGENTS.md publishing.**

- Admin defines a template AGENTS.md at the team level.
- Hub propagates `<!-- schema:facts:start ... end -->` fences to
  every subscribed repo on every push (or on a configurable
  cadence).
- Idempotent: re-running doesn't churn the fenced section.

**T3.5 — Shared rule packs.**

- Admin defines rules at the team level.
- Rules propagate to every subscribed repo's `pr.review`
  evaluation.
- Per-repo override via `.schema/rules.json` (the repo's local
  rules win on conflict).

**T3.6 — Hub web dashboard (the management surface).**

- React + Vite app at `hub.schema.dev`.
- Team management, billing, repo selection, rule pack editor,
  AGENTS.md template editor.
- Activity log: see every PR comment posted, every rule
  evaluation, every AGENTS.md propagation.

**T3.7 — Pricing page + signup flow.**

- `hub.schema.dev/pricing` shows three tiers (Free / Team /
  Enterprise per `schema-v3.md §15.2`).
- Free signup is "you don't need an account; install the OSS."
- Team signup hits GitHub App install + Stripe subscription.
- Enterprise signup is "talk to sales" (a form; no automation
  v1).

### 4.4 Out-of-scope for T3 v1

- WorkOS SSO (ships in T3 v1.1, ~1 month after v1).
- Self-hosted Hub (deferred to Enterprise tier, demand-driven per
  `schema-v3.md §15.6`).
- Schema-bundled LLM inference (per `schema-v3.md §15.5`: BYOK
  forever; Hub does NOT proxy LLM calls).
- Hub-side telemetry beyond billing + feature delivery (per
  `schema-v3.md §15.5`).
- v3.1 features (`handoff.export`, `handoff.import`).

### 4.5 Success criteria

T3 ships when:

- One paying team (could be a friend's company) is on the Team
  tier at $20/seat/month, paying via Stripe.
- The GitHub App posts a `pr.review` markdown comment within 60
  seconds of a PR opening, on a real customer repo.
- Cross-repo AGENTS.md publishing works across ≥3 repos in a
  test team.
- Shared rule packs propagate to ≥3 repos.
- Hub dashboard is usable for non-technical team admins.

---

## 5. Track 4 — Rule authoring UX

### 5.1 Mandate

Schema's vision (`VISION.md §2.2 #3`) names rule enforcement as
one of the four product capabilities. The engine exists
(`src/session/rules.ts`, the `rules.evaluate` action); the UX
does not. T4 builds the authoring surface inside T1, T2, and T3.

### 5.2 Per-surface scope

**Inside Schema Desktop (T1.5 Rules panel):**

- "+ Add rule" wizard:
  - Step 1: pick a rule kind (structural / prose).
  - Step 2: write the rule body (plain English for prose; YAML
    for structural).
  - Step 3: see preview violations against the current workspace.
  - Step 4: save (session-only or persist to `schema.config.json`).
- Edit / delete existing rules.
- Test a rule against a specific node or cluster.

**Inside the VS Code / Cursor extension (T2):**

- `Schema: Add architectural rule` command opens a side panel
  with the same wizard.

**Inside Schema Hub (T3.5 Shared rule packs):**

- Team admin defines rules at the team level.
- Same wizard as Desktop, but additionally:
  - "Apply to all repos" toggle.
  - "Apply to repos matching pattern" config.

### 5.3 Out-of-scope for T4 v1

- AI-assisted rule authoring (where Schema suggests rules based
  on architectural smells). v3.1.
- Natural-language rule evaluation (the `rules.evaluate({ llm:
  true })` path is opt-in; the UX doesn't surface this v1).
- Rule debugging UI (tracing which exact nodes trip a rule;
  helpful but not blocking for v1).

### 5.4 Success criteria

T4 ships when:

- A user can author a structural rule in Desktop and see
  violations appear within 5 seconds.
- A team admin can author a rule in Hub and see it propagate to
  3 subscribed repos.
- The 5 most-requested rule patterns (no-cycle, must-have-handler,
  must-have-inbound, must-have-outbound, no-cross-module-imports)
  are pre-templated in the wizard.

---

## 6. Track 5 — Claude Code integration polish

### 6.1 Mandate

Per `VISION.md §4.3`: the acquisition narrative depends on Claude
Code adoption. Currently Schema's MCP integration works with
Claude Code (it's a generic MCP client), but "works" ≠ "killer
feature."

T5 builds the specific shape that makes Claude Code 10x better
on large codebases:

- Schema-aware system prompts (pre-loaded context about Schema's
  capabilities).
- The rules + canon surfaced as MCP resources in Claude Code's
  resource picker.
- Agentic flows that call Schema actions in sequence (e.g.
  "before any refactor, call `graph.find_callers`; after, call
  `rules.evaluate`").

### 6.2 Per-component scope

**T5.1 — A canonical Claude Code MCP config.**

- Published at `hub.schema.dev/claude-code-config` and in the
  README.
- One-liner the user pastes into `~/.config/claude-code/config.json`.
- Pre-configured with samplerPrefs, default rule pack, demo
  workspace.

**T5.2 — Schema-aware Claude Code skill.**

- A `claude-code-schema-workflow` skill bundled in `src/wisdom/`
  that explains to the model how to use Schema effectively.
- Loaded via the MCP server's `skills.list` + `skills.read`.
- Walks the model through: "Before refactoring, call
  `graph.find_callers`. Use `ops.preview` before `plan.apply`.
  Run `rules.evaluate` before merging."

**T5.3 — Demo workflow recording.**

- A 90-second screencast showing Claude Code + Schema doing a
  cross-language refactor that Claude Code alone cannot do.
- Published on YouTube + linked from `schema.dev` landing.
- Used as the v1.0 launch artifact.

**T5.4 — Adoption-measurement infrastructure.**

- A way to measure "how many Claude Code users run Schema."
- Pure-opt-in: when the user's MCP client identifies as Claude
  Code, Schema can ask (one-time elicitation): "Help us
  understand Schema adoption — opt in to anonymous usage
  reporting?" Off by default.
- Aggregated counts only (no per-user data, no source code, no
  prompts).

### 6.3 Out-of-scope for T5 v1

- Per-IDE adoption metrics beyond Claude Code (would require
  similar opt-in infrastructure per IDE; deferred).
- AB-testable system prompts (research project; not v1).

### 6.4 Success criteria

T5 ships when:

- The 90-second demo video is published.
- ≥10 staff+ engineers from the private alpha (per §7) report
  that "Schema makes Claude Code feel different" in some
  meaningful way.
- The README has a "For Claude Code users" section that walks
  through the 3-step setup.

---

## 7. Private alpha + public launch

### 7.1 Private alpha (weeks 4-8)

Once T1 + T2 ship a usable v0.9 (T3 doesn't have to be live yet),
recruit 10-20 staff+ engineers from the user's network:

- Personal contacts at FAANG / Stripe / Linear / Vercel /
  Anthropic / OpenAI / mid-market companies.
- The user's biz cofounder's network.
- ≥3 must use Claude Code as their primary AI agent (the
  acquisition-narrative cohort).
- ≥3 must work on polyglot monorepos.
- ≥2 must be at companies with 100+ engineers (the Hub revenue
  cohort).

Alpha gate: **≥60% of alpha users use Schema Desktop 3+ times in
week 1**. If retention is below 60%, defer public launch and
iterate. If retention is above 60%, proceed to v1.0.

### 7.2 v1.0 launch (weeks 8-10)

The public launch artifacts (per `research/05.§5.4`):

1. **Literate-programming launch essay.** 3,500-4,500 words on a
   real polyglot OSS repo (e.g. kubernetes/kubernetes or
   vercel/next.js). Shows the architecture summary +
   cross-language bridge resolution + PR-comment artifact +
   AGENTS.md round-trip. Submitted to HN as a regular
   submission, not Show HN.
2. **The 90-second demo video** (T5.3).
3. **The Pragmatic Engineer / lethain / StaffEng outreach** —
   pitch the literate essay to 3-5 targeted newsletter writers
   ~1 week before HN submission. Earned media before paid
   amplification.
4. **The `schema.dev` landing page** with download/install
   instructions for Desktop + extension + CLI + Hub signup.

### 7.3 Launch gate criteria

Before submitting to HN, all of these must be green:

- T1 Schema Desktop polished + 5 staff+ engineers say "I'd pay
  for this" / "I'd recommend this to my team."
- T2 extension on VS Code marketplace + OpenVSX, tested in
  Cursor + Cline + VS Code.
- T3 Hub MVP accepts payment; ≥1 paying team.
- T5.3 demo video published; T5.2 skill in `src/wisdom/`.
- Vocabulary kit pass on every user-facing surface (per
  `marketing/vocabulary-kit.md` cutover-gate checklist).
- README updated to lead with the new "trust layer for vibe
  coding" positioning (already done in commit `0cbe067`).
- `schema.dev` landing page live.

---

## 8. Speed posture + timeline

Per `VISION.md §12` answer ("speed-to-market") + the Path B'
amendment (2026-05-11) which adds Monaco editor scope to T1:

| Week | Milestone |
|---|---|
| 1-2 | T1.1 + T1.2 (Tauri shell + MCP integration). T2.1 (extension scaffold). T3.1 (Hub auth + team mgmt). |
| 3-4 | T1.3 + T1.4 + T1.5 (graph canvas + summary + rules panels). T1.9 monaco-editor integration (basic embedding + syntax highlighting). T2.2 (extension UI). T3.2 + T3.3 (GitHub App + backend). |
| 5-6 | T1.6 (diff visualizer). **T1.9 Schema integration (violations as diagnostics, right-click ops, save-triggers-extract)**. T1.10 (file tree). T2.3 (inline overlays). T3.4 + T3.5 (cross-repo AGENTS + rule packs). T4 (rule authoring inside T1+T2). |
| 7-9 | Private alpha. Bug fixes. Polish (Monaco UX, diff visualizer animations). T5.1 + T5.2 (Claude Code config + skill). |
| 10-12 | T5.3 demo recording. Launch artifacts (essay, landing page, newsletter outreach). v1.0 public launch. |

**Timeline extended from 6-10 weeks to 10-12 weeks** to accommodate
the Path B' Monaco editor scope. This is the cost of the
amendment; the benefit is shipping the actual product the CTO
wanted (visualization-as-app, not viewer-only).

**This is still aggressive.** Two founders + occasional
contracted design help. If T3 (Hub MVP) slips, T1 + T2 can ship
without it (OSS-only launch with Hub coming as v1.1). If T1
Monaco integration slips, ship T1 as viewer-only initially and
Monaco as a v1.1 patch (this is the Path A → Path B' fallback —
acceptable if pressure-test conditions warrant).

**The single must-ship artifact is T1 (with Monaco) + T2 + the
demo + the essay.** Hub MVP (T3) is acceptable to slip; Studio
without Monaco is acceptable to slip; both slipping is not
acceptable for v1.0.

---

## 9. Out-of-scope for Phase 13

Per `VISION.md §8 + §10.2`:

- **No new extractors.** The 7 in Phases 1-12 are sufficient.
- **No new cross-language bridges.** The 3 day-one bridges
  (REST/OpenAPI + gRPC + SQL) cover the polyglot demo. AsyncAPI +
  GraphQL parsers exist; bridge logic deferred per `research/12`.
- **No new MCP actions.** The 30 day-one actions cover Phase 13's
  needs.
- **No new ops.** The 8 day-one codemods are enough.
- **No editor (per Path A).** The forward-compat hooks are built;
  the editor is not.
- **No fine-tuning.** No model weights bundled beyond the
  embedding model for canon retrieval.
- **No telemetry on the OSS surface.** Telemetry stays off forever
  on OSS; Hub collects only billing + feature delivery data.

---

## 10. Risks

| Risk | Why it's real | Mitigation |
|---|---|---|
| **Tauri 2.x learning curve** | The team doesn't have Tauri experience; first ramp could be 2-3 weeks. | Build a Tauri prototype in week 1 with just T1.1 + T1.2 (shell + MCP client) before committing to the full T1 scope. If Tauri proves intractable, fall back to Electron (heavier binary; acceptable v1 tradeoff). |
| **Monaco integration complexity** (NEW under Path B') | Embedding Monaco in a Tauri webview + wiring it to Schema's rule + op systems is non-trivial. Inline diagnostics + right-click "Apply Schema op" + save-triggers-incremental-extract all need careful design. Estimated 2-3 weeks of work. | Time-box Monaco integration to week 3-4 (basic embedding + syntax highlighting only) + week 5-6 (Schema integration). If Schema integration slips past week 6, ship Monaco as pure viewer (no diagnostics, no op-apply menu) in v1 and add integration as v1.1. The Monaco scope is bounded; the integration scope is what could blow out. |
| **GitHub App scope creep** | Hub's GitHub App needs careful permission scoping; one wrong permission and security-conscious teams won't install. | Use minimal permissions (read repo + write PR comments + read PR metadata). No code-write permissions. |
| **Private alpha retention < 60%** | If the alpha doesn't hit 60% retention, public launch must defer. Could push v1.0 by 4-8 weeks. | Iterate fast on alpha feedback; have a 2-week "polish + retention drive" buffer before the launch deadline. |
| **Cursor/Anthropic ships competing feature mid-Phase-13** | If Cursor adds "architectural review" or Anthropic adds polyglot-graph to Claude Code in the Phase 13 window, Schema's wedge gets crowded. | Schema's wedge is OSS + local-first + polyglot + visualization — Cursor/Anthropic can't match all four. Differentiate hard on the visualization (T1.6) — that's the part nobody else is investing in. |
| **Two-founder bandwidth** | T1 + T2 + T3 in 10-12 weeks is heavy. Engineering load could break the founders. | Pre-commit to the 10-12 week scope; if it slips, the doc names which tracks can defer (T3 → v1.1; T4 → v1.1). |

---

## 11. The relationship to research/15

`research/15-ide-revisit.md` was originally the binding authority
on the Path A (viewer not IDE) decision. After the CTO 20-question
pressure-test on 2026-05-11, **research/15 was superseded** by
its own postscript section (§P) which introduced **Path B'**
(Schema Studio with Monaco). Phase 13 T1 implements Path B' as
specified in research/15 §P.5.

Re-evaluation triggers for "Path B' → Path B (full Cursor-
competing IDE)" are defined in `VISION.md §6` and `research/15
§P.6` — all four must fire simultaneously at month 18:

1. Schema Studio reaches ≥10k weekly active users.
2. ≥40% of those users explicitly request AI agent functionality
   inside Schema Studio.
3. Schema has ≥$3M ARR or ≥$10M committed venture funding.
4. The Microsoft marketplace situation has changed materially.

If fewer than four fire at month 18, Path B' remains binding.
Path B is not forbidden — it requires all four, not "any one of."

---

## 12. Approval gate

This spec is binding once approved. Approval = the user reads end
to end + says "approved" or flags specific edits.

Once approved:

1. Phase 13 begins.
2. Code commits cite this doc's section IDs (`// Per
   architecture/phase-13.md §2.4 T1.3`).
3. Deviations from this spec land in
   `architecture/deviations.md` (the future v3 deviations log)
   only when material; trivial implementation choices don't go in
   the log.

---

> **End of Phase 13 spec draft 1.**

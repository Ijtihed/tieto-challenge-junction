# Frontend reference — what to crib from v1

> **Status:** reference, not authority. The CTO said "I somewhat
> like the frontend of v1" on 2026-05-11 evening; this doc points
> the Phase 13 T1 (Schema Studio) builder at the parts of v1's
> frontend worth preserving in v3.
>
> **Location of the reference.** `../inherited/v1-frontend-reference/`
> in this repo. 51 files, ~540 KB. Pure look + behavior — no
> backend, no marketing pages, no auth, no Supabase, no landing
> page. Just the tool shell.
>
> **What this doc does NOT decide.** The visual design language
> of Schema Studio (designer's job, not architecture). The exact
> component tree (builder's choice based on Tauri's component
> system). This doc names what's worth preserving CONCEPTUALLY —
> the patterns, the keyboard shortcuts, the panel layout, the
> motion design, the typography choices — so the Studio builder
> doesn't re-invent what v1 already got right.

---

## 1. The MVP-first posture

Per the CTO's binding answer on 2026-05-11: **ship the MVP ASAP
and iterate from there.** This overturns the prior "feature-
complete at v1.0" framing. Schema Studio v1.0 is a *working
viewer + Monaco editor + diff visualizer*; polish accumulates
post-launch via continuous shipping.

**The reference below is for the polish trajectory**, not v1.0
day-one. v1.0 ships with reasonable defaults; v1.x adds the
density + craft that v1 (the Next.js app) demonstrates.

---

## 2. What v1 got right (the patterns to preserve)

### 2.1 The shell

v1's `/app` page (`inherited/v1-frontend-reference/app/app/page.tsx`)
is a workspace shell with:

- **TopBar** (`components/workspace/TopBar.tsx`) — repo name,
  current ref, level toggle (Architecture / Modules / Detail),
  diff overlay toggle, branch pill, command bar trigger.
- **SideRail** (`components/workspace/SideRail.tsx`) — icon
  column on the left. View switcher (Summary / Rules / Plan /
  History / Changes / Problems).
- **SidePanel** (`components/workspace/SidePanel.tsx`) — the
  rail's selected view, rendered as a resizable panel.
- **GraphCanvas** (`components/canvas/GraphCanvas.tsx`) — React
  Flow + dagre, the central surface.
- **Inspector** (`components/workspace/Inspector.tsx`) — right
  rail, slides in when a node is selected.
- **Breadcrumb** (`components/workspace/Breadcrumb.tsx`) — drill
  path through the cluster → module → function hierarchy.

**Schema Studio's shell** in Tauri should map directly:

| v1 | Schema Studio (Tauri) |
|---|---|
| `TopBar` | Native menu bar + a thin top bar in the webview for app-level controls (level toggle, diff toggle, command bar) |
| `SideRail` | Left rail panel with icon column |
| `SidePanel` | Resizable left panel content (Summary / Rules / Plan / etc.) |
| `GraphCanvas` | Center panel — graph canvas |
| `Inspector` | Right panel (slides in on node click) |
| (new in Studio) | Monaco editor pane — center panel alternate view (toggled from graph) OR center pane in editor mode |
| (new in Studio) | File tree pane — addition to the left rail |

### 2.2 The keyboard shortcuts (cheat sheet)

v1's `CheatSheet.tsx` + `Shortcuts.tsx` define the keyboard
surface:

- **`?`** — toggle the cheat sheet itself.
- **`⌘K`** — open the command bar (fuzzy search across action +
  node + file).
- **`1` / `2` / `3`** — switch level (Architecture / Modules /
  Detail).
- **`i` / `r` / `h` / `a`** — switch right panel view (Inspector
  / Rules / History / Changes).
- **`/`** — open the search overlay.
- **`esc`** — close current overlay / panel.
- **`Backspace`** — drill out one level.
- **`⌘Z`** — undo last plan.

**Schema Studio inherits these unchanged.** Keyboard-first is the
power-user signal that maps to the Raycast aesthetic the CTO
likes. Add to Schema Studio:

- **`⌘O`** — open workspace.
- **`⌘P`** — switch file (when in editor mode).
- **`⌘B`** — toggle file tree.
- **`⌘\`** — toggle right panel.

The cheat sheet (`?`) is the single screen that documents this;
preserve that pattern.

### 2.3 The visual design tokens

`app/globals.css` (559 lines) is v1's design system:

- **Color palette.** Dark-mode-first. Schema's "applying" /
  "testing" / "passed" / "failed" phase pills have colors. The
  cluster colors are deterministic (per `lib/clusterColor.ts`).
  Edge styles per relation: gold for `registers_route`, dashed
  purple for `applies_middleware`, neutral for `calls`.
- **Typography.** Mono for code surfaces; system sans for chrome;
  display weight for headings.
- **Spacing.** Tight, dense. Power-user app spacing — not
  marketing-page-airy.
- **Motion.** Subtle. Cluster-boundary follow-on-drag. Green flash
  + drop-shadow on freshly-patched edges (per the README — "live
  boundary follow; ghost edges during plan preview").
- **Borders + radii.** Subtle dividers; small radii. The Linear
  aesthetic.

**Schema Studio's design system** should fork from this file as
the starting point. Tailwind v4 `@theme` tokens or CSS variables
— same shape, same values. **Don't redesign from scratch; iterate
from what works.**

### 2.4 The canvas behavior

`components/canvas/GraphCanvas.tsx` is the core surface. v1
shipped:

- **React Flow + dagre LR layout.** v1 uses React Flow 12.
- **Compound-graph layout at level 3** — cluster boundaries
  drawn as labelled tabs in distinct cluster colors. Asserted
  non-overlapping in unit tests.
- **Bold left-stripe per node kind** (route / middleware / service /
  data / model / external / utility). Kind distinction unmistakable.
- **Draggable nodes** with live boundary follow. Positions reset
  on level switch or graph mutation (which v3 might revise —
  positions persisting across mutations is probably desirable).
- **Edge styles per relation** (above).
- **Ghost edges during plan preview, green flash + drop-shadow
  on freshly-patched edges.**
- **Per-node `git blame` strip** (`components/workspace/BlameStrip.tsx`)
  shows author + sha + summary inline. Uncommitted lines render
  in the "applying" colour with an italic "uncommitted" label.

**Schema Studio's canvas** uses the same React Flow + dagre
substrate. The Monaco editor is a *sibling* panel, not a
replacement for the canvas. The canvas stays the central
visualization; Monaco is for source viewing/editing of the
currently-selected node.

### 2.5 The Inspector

`components/workspace/Inspector.tsx` is the right rail. v1 shows:

- **For a function node:** name, file, line, applicable ops
  (addMiddleware / addCaching / wrapTransformation / extractModule).
- **Op hover preview** — inline diff under each op button before
  clicking. The `ops.preview` action's UI manifestation.
- **Connection list** (in/out + relation) — Schema's graph
  traversal made visual.
- **"Open in editor"** — `cursor://file/<abs>:<line>` deep link
  from the inspector header (toggle to `vscode://` if preferred;
  the choice persists in `localStorage[schema:editor_pref]`).
  **In Schema Studio: this opens Monaco internally instead of
  deep-linking to an external editor** (since Studio has its own
  editor pane).
- **Per-node git blame strip** as above.

**Schema Studio's Inspector** mirrors v1's pattern. The op hover
preview is the polish detail that makes it feel craft-shaped.

### 2.6 The command bar

`components/workspace/CommandBar.tsx` is v1's `⌘K` surface.
Fuzzy search across:

- Action names (`graph.summary`, `plan.propose`, etc.)
- Node names (every function / class / route in the workspace)
- File paths (per `lib/fuzzy.ts` — subsequence-match scoring)

This is the **Raycast pattern the CTO likes**. Schema Studio
should preserve this as the primary navigation. `lib/fuzzy.ts` +
`lib/actions.ts` (the action catalogue with visibility predicates)
port forward.

### 2.7 The panels

Each of v1's workspace panels has a specific purpose worth
preserving:

| Panel | v1 file | What it shows |
|---|---|---|
| **SummaryPanel** | `SummaryPanel.tsx` | Cluster list, kind mix, totals, top smells |
| **RulesPanel** | `RulesPanel.tsx` | Active rules, violations, fix prompts |
| **PlanPanel** | `PlanPanel.tsx` | The plan flow: per-step phase pills (applying → testing → verifying → passed/failed). Streamed vitest output. |
| **ChangesPanel** | `ChangesPanel.tsx` | The diff overlay surface — rule delta, per-file changes, uncovered changed nodes. The "review + commit" handoff link. |
| **HistoryPanel** | `HistoryPanel.tsx` | Past plans + ⌘Z undo button |
| **SnapshotsPanel** | `SnapshotsPanel.tsx` | File snapshots from undo. |
| **InsightsRail** | `InsightsRail.tsx` | Auto-detected architectural smells with severity + one-click `suggestedPrompt` |
| **ProblemsHero** + **ProblemsRail** | — | Unified problems list (rules ∪ violations ∪ insights) |
| **EdgeInspector** | `EdgeInspector.tsx` | Inspector variant for edges (when an edge is selected, not a node) |
| **SourceViewer** | `SourceViewer.tsx` | Inline source snippet view (Schema Studio replaces this with Monaco) |
| **SearchOverlay** | `SearchOverlay.tsx` | Full-screen `/` search overlay |
| **Onboarding** | `Onboarding.tsx` | First-launch tutorial overlay |

**Each panel ports forward conceptually.** Schema Studio
rebuilds them in Tauri+React+Vite but mirrors the v1 information
architecture.

### 2.8 The state shape

`state/store.ts` is v1's god-object Zustand store (~2,200 LOC).
**Most of this does NOT port forward** because v3's R1 (server-
owned execution state) explicitly inverts it. But specific parts
do:

- **Selection state** (which node is selected, hover, drill path) —
  stays in the client.
- **UI preferences** (panel layout, level toggle, theme, editor
  pref) — stays in the client.
- **Recently-opened workspaces** — stays in the client.

v1 mixed plan state, undo state, extractor state, fixture state
into the store. v3 puts all of that in `session/` on the MCP
server. Schema Studio's React/Tauri state is render-only —
selection, hover, panel layout, nothing more.

**Don't port `state/store.ts` whole.** Port the *selection +
panel-layout slice* shape; everything else comes from
`SessionEvent` subscriptions over MCP.

### 2.9 The marketing-page motion graphics

The CTO explicitly said **don't include the marketing + page
stuff** — those are NOT in the reference dir (they were stripped
during the 2026-05-11 cleanup). The original v1 had nice motion
graphics in `components/marketing/` (GraphDiffMotion,
PlanTerminalMotion, PrCardMotion, MarqueeStrip) — these are
**out of scope** for Schema Studio. Schema Studio is the tool;
the marketing site is separate (and per VISION.md §11, not even
in scope for Phase 13).

If marketing motion graphics return later (post-v1.0, when
schema.dev landing gets serious attention), the patterns from
v1's marketing components are good reference. But for now: not
in scope.

---

## 3. What v1 got wrong (don't preserve these)

### 3.1 The god-object store

Per audit:L7 + L21 (in `inherited/legacy-audit-v1-v2.md`): v1's
`src/state/store.ts` is ~2,200 LOC mixing 20+ concerns. Schema
Studio's state is render-only; everything else is server-owned
per R1.

### 3.2 The bundled fixture hard-imports

Per audit:L7 + L23: v1 imports `fixtureGraph` into every SSR
bundle. Schema Studio loads its demo workspace through the same
`workspace.open` MCP action any user flow uses. No hard imports
of fixtures into the build.

### 3.3 The HTTP API surface

Per audit:L6: v1's 14 `/api/*` routes were the real API. Schema
Studio talks to the MCP server only — no HTTP routes in the
Tauri shell, no `/api/*` parallel surface.

### 3.4 The Next.js shell

v1 is a Next.js App Router app. Schema Studio is Tauri +
Vite + React 19. The patterns port forward; the framework does
not.

### 3.5 The Supabase auth integration

Per VISION.md §3 + audit:L22: v3's OSS Studio has no auth. Hub
(separate; not in Studio) handles auth via WorkOS/GitHub OAuth.
The v1 Supabase code is excluded from this reference.

---

## 4. Specific files to read first

The Phase 13 T1 builder should read these files (in order) before
starting Schema Studio's UI:

1. **`app/globals.css`** — the design tokens (~559 lines).
   This is the visual foundation.
2. **`app/app/page.tsx`** — the workspace shell layout. How the
   Top + Side + Center + Inspector compose.
3. **`components/workspace/TopBar.tsx`** — the top-bar pattern.
4. **`components/workspace/SideRail.tsx` + `SidePanel.tsx`** —
   the left-rail pattern.
5. **`components/canvas/GraphCanvas.tsx`** — the canvas
   implementation. React Flow + dagre setup, edge styling, drag
   behavior, ghost edges.
6. **`components/canvas/nodeKindMeta.ts`** — the per-node-kind
   color + icon table.
7. **`components/workspace/Inspector.tsx`** — the inspector
   pattern.
8. **`components/workspace/CommandBar.tsx`** + `lib/fuzzy.ts` —
   the ⌘K pattern.
9. **`components/workspace/CheatSheet.tsx`** + `Shortcuts.tsx` —
   the keyboard surface.
10. **`components/workspace/PlanPanel.tsx`** — the plan-flow UI.
    Per-step phase pills. Streamed vitest output. Critical for
    v3's plan flow surface (T1.6 in phase-13.md).
11. **`components/workspace/ChangesPanel.tsx`** + `DiffToggle.tsx` —
    the diff overlay UI. Critical for Schema Studio's diff
    visualizer (T1.6).

Skim the rest as needed.

---

## 5. How this reference relates to Phase 13

Phase 13 T1 spec (`./phase-13.md §2`) names Schema Studio's
components abstractly: "graph canvas (T1.3)", "summary panel
(T1.4)", "rules panel (T1.5)", etc. This frontend-reference doc
is the **concrete reference for each of those components** — what
v1 already shipped, what worked, what didn't.

**The Schema Studio builder's loop:**

1. Read `phase-13.md §2.4 T1.X` — what's the goal for this
   component?
2. Read this doc's §2.X — what did v1 already do?
3. Read the specific v1 files referenced.
4. Build the Tauri+React equivalent. Steal the patterns; rewrite
   the code (different stack).
5. Iterate on polish post-v1.0 per the MVP-first posture (§1).

---

## 6. The reference is frozen

The reference at `inherited/v1-frontend-reference/` is a
**snapshot** captured 2026-05-11 evening. v1 (the schema01 repo)
may continue to ship updates; this reference does NOT track
them. v1 is "dead-to-v3" per the AGENTS.md hard rule; if v1
ships something genuinely new and worth preserving, copy that
specific addition into the reference manually.

The reference is not authority. v3's architecture (`schema-v3.md`)
+ Phase 13 spec (`./phase-13.md`) are authority. This is *taste*
documentation, not architectural authority.

---

> **End of doc.** Phase 13 T1 builds Schema Studio's UI. This
> reference exists so the builder has concrete patterns to crib
> from instead of inventing from scratch. v1's UI was good; v3's
> Studio should be at least as good, ideally better.

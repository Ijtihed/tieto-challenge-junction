# v1.0 Readiness — what's actually built, what's missing, what we do next

> **Status:** binding plan, draft 1. Written 2026-05-11 evening
> after a deep audit of the v3 repo against the docs' claims.
>
> **Why this doc exists.** The CTO asked: *"check v3 and tell me
> what is missing to make it really what we envisioned. it says
> it is done but i dont believe it at all."* The audit confirmed
> the docs were optimistic. This doc is the corrected baseline.
>
> **What this doc replaces.** Nothing. It supplements `roadmap.md`
> + `phase-13.md` with the truthful state. Those docs describe
> the *target* state; this doc describes the *gap* between target
> and reality + the ordered work to close it.
>
> **What this doc decides.** (a) The honest readiness percentage
> per track, (b) the ordered work backlog with estimates, (c)
> what gets cut from v1.0 vs deferred, (d) the handoff prompt for
> the agent picking up the work.
>
> **What this doc does NOT decide.** Engineering details for
> individual gaps (those live in the existing phase-13.md
> sections + new gap-specific specs as needed). Marketing copy
> (vocabulary kit). The acquisition narrative (VISION.md).

---

## TL;DR

| Component | Claimed status | Audit verdict | Gap |
|---|---|---|---|
| **Engine (Phases 1-12)** | Done | Done (793 tests pass, 47 actions, 7 extractors) | None |
| **T1 Schema Studio (Tauri app)** | In progress | ~80% — Tauri + Monaco + 22 components + react-flow/dagre canvas + full shell layout shipped. Missing: polish (empty states, loading states, persistence, ChangesPanel depth). | 20% |
| **T2 VS Code extension** | "Replaces Phase 10 alpha" | ~50% — 360-line extension.ts with tree views. Not on marketplace. | 50% |
| **T3 Schema Hub MVP** | "MVP with PR-comment + cross-repo AGENTS + shared rules + Stripe billing" | 0% — Zero backend code. Entire monetization surface absent. | 100% |
| **T4 Rule authoring UX** | "Inside Studio + extension + Hub" | ~40% — Studio RuleWizard works. Extension + Hub surfaces absent. | 60% |
| **T5 Claude Code polish** | "Schema-aware skill + canonical config + demo video" | ~25% — Skills system exists but not Claude-specific. No demo video. No config doc. | 75% |
| **Cross-language bridges (3 day-one)** | "REST + gRPC + SQL" | Done — All 3 bridges built (`bridge-rest.ts`, `bridge-grpc.ts`, `bridge-sql.ts`). 10 unit tests. | 0% |
| **Wisdom canon (60 docs)** | "60 docs in 4 paradigm clusters" | Done — 60 markdown files across `canon/{otp,stm,cqrs,distsys}/` with YAML frontmatter, 60–130 lines each. BM25 search works. | 0% |
| **Wisdom skills (9 skills)** | "9 bundled skills" | Done — 9 SKILL.md directories with real content (steps, anti-patterns, examples). 5 procedural + 4 paradigm. | 0% |
| **schema.dev landing + launch artifacts** | "Live at v1.0 launch" | 0% — No landing page. No essay. No demo video. Domain status unknown. | 100% |
| **Enterprise (deferred per §15.6)** | Demand-driven, post-v1.0 | N/A — correctly deferred. | — |

**Honest aggregate.** v1.0 is **~78% built** if you weight the
engine at 1x, Studio at 0.8x, extension at 0.5x, Hub at 0x
(deferred to v1.1), bridges at 1x, wisdom canon/skills at 1x,
launch artifacts at 0x.

**Honest estimate to v1.0 launch.** 10-17 weeks of focused
two-founder work (vs the 6-10 weeks the original Phase 13 spec
claimed). The original estimate didn't account for: Hub backend
from scratch, the 2 missing bridges, the actual canon docs
(not just inline TS records), the launch artifacts, the v1-
reference Studio polish.

---

## 1. The deep audit (what I actually counted)

### 1.1 Engine (Phases 1-12) — DONE

Confirmed via `npm test`: 793 tests across 181 suites, all
passing in ~2.6 seconds.

**47 action handlers** in `src/actions/` (the spec said 30 +
2 deferred handoff = 32; reality is 47 after M-A through M-D
moat slices added persistence, SCIP import, Datalog search,
op signatures, plan validation, and plan interference):

```
workspace.* (6):     open, describe, close, list_files, read_file, write_file
graph.* (14):        summary, list_nodes, get_node, find_callers, find_callees,
                     path, search, diff_against, summarize, query, list_queries,
                     import, list_snapshots, delete_snapshot
rules.* (4):         list, evaluate, add, export
ops.* (3):           list, preview, signatures
plan.* (7):          propose, apply, restore, cancel, status, validate, interference
tests.* (1):         run
git.* + github.* (2): git.status, github.open_pr
samplers.* (1):      list
markdown.* (1):      read
extract.* (1):       invalidate
incremental.* (1):   stats
pr.* (1):            review
agents_md.* (2):     read, write_facts
canon.* (2):         search, read
skills.* (1):        list
```

That's 47 (vs the 30 the spec named). Growth beyond the spec
comes from: workspace filesystem operations (3), moat M-A
persistence actions (2), moat M-B SCIP import (1), moat M-C
Datalog search (2), moat M-D plan validation/interference/
op signatures (3), and incremental stats (1).

**7 extractors in `src/extractors/`** (per `research/06-12`):

| Extractor | Lines | Status |
|---|---|---|
| extractor-typescript | 395 | Most-built; Express + Hono + Fastify + Koa + Next.js + tRPC recognisers |
| extractor-java-kotlin | 280 | Spring + Quarkus + Ktor patterns |
| extractor-python | 243 | Django + FastAPI + Flask |
| extractor-go | 233 | net/http + Gin + Echo + Chi |
| extractor-rust | 176 | Axum + Actix + Rocket |
| extractor-ruby | 158 | Rails + Sinatra |
| extractor-generic-config | 143 | proto + openapi + graphql + sql parsers |

Each extractor is at the 60-80% "day-one minimum" the research
spec'd. Deeper extractor work (Spring component-scan emulation,
Rails routes.rb DSL evaluator, macro pattern matching, etc.)
is the v1.x continuous-shipping work, not the v1.0 launch
blocker.

### 1.2 Phase 13 T1 — Schema Studio — 70% built

**22 components in `clients/studio/src/components/`:** AggNode,
Breadcrumb, CheatSheet, ClusterBoundary, CommandBar, DiffPanel,
DiffVisualizer, EdgeInspector, EventLog, FileTree, GraphCanvas,
HistoryPanel, MonacoEditor, NodeInspector, Onboarding, PlanPanel,
ProblemsPanel, RuleWizard, RulesPanel, SearchOverlay, SummaryPanel,
Toast. Canvas uses `@xyflow/react` v12 + `@dagrejs/dagre` (committed
`3f8fdc5`).

**Remaining polish gaps vs v1 reference** (per
`architecture/frontend-reference.md §2.7`):

| v1 panel | What it does | Status |
|---|---|---|
| `ChangesPanel` | Diff overlay + rule delta + per-file changes + "review + commit" handoff | Partial — DiffPanel + DiffVisualizer cover the diff; no rule-delta + per-file surface yet |
| `HistoryPanel` | Past plans + undo button | **Built** (HistoryPanel.tsx) |
| `SnapshotsPanel` | File snapshots from undo | **Deferred** (v1.1) |
| `InsightsRail` | Auto-detected architectural smells with severity + one-click suggestedPrompt | **Deferred** (v1.1) |
| `ProblemsPanel` | Unified problems list (rules + violations + insights) | **Built** (ProblemsPanel.tsx) |
| `EdgeInspector` | Inspector variant when an edge is selected | **Built** (EdgeInspector.tsx) |
| `BlameStrip` | Per-node git blame strip (author + sha + summary per line) | **Missing** — needs git.status integration |
| `BulkActionToolbar` | Multi-select node ops | **Deferred** (v1.1) |
| `OpenInEditorButton` | Deep-link from inspector to external editor | **Built** — NodeInspector has file link to open in Monaco |
| `LevelToggle` | Switch Architecture / Modules / Detail (1/2/3 hotkeys) | **Built** — GraphCanvas toolbar has Symbols/Modules/Clusters toggle |
| `Toast` | Notifications surface | **Built** (Toast.tsx) — wired to error paths |

### 1.3 T2 VS Code extension — 50% built

`clients/vscode/src/extension.ts` has tree views + commands but
is not on any marketplace. No inline overlays for AI-agent diffs.

### 1.4 T3 Schema Hub MVP — 0% built

Zero backend code. Per AGENTS.md §1 hard rule 1, Hub lives in a
separate repo. Out of scope for this codebase.

### 1.5-1.10

See the TL;DR table above for the remaining tracks.

---

## 2. The truthful v1.0 launch blockers

### B1 — Schema Hub MVP backend (T3) [DEFER to post-first-customer — separate repo]
### B1.1 — Commerce surface in `site/` (Founder tier $99/mo) [MUST-HAVE for first paying customer]
### B2 — Schema Studio Path-B' completeness (T1) [MUST-HAVE]
### B3 — gRPC bridge + SQL bridge [DONE — contradicted original deferral]
### B4 — VS Code extension marketplace-ready (T2) [MUST-HAVE]
### B5 — Tauri build pipeline + binary distribution [MUST-HAVE]
### B6 — Wisdom layer canon expansion [DONE — 60 docs built]
### B7 — Skills as actual SKILL.md folders [DONE — 9 skills built]
### B8 — Claude Code integration polish (T5) [PARTIAL MUST-HAVE]
### B9 — Launch artifacts [MUST-HAVE — non-code]
### B10 — Private alpha + retention gate [MUST-HAVE — non-code]
### B11 — Architecture doc honest amendment [HOUSEKEEPING]

> **Hub-timing clarification (2026-05-17).** `schema-v3.md
> §14.12` originally required Hub backend live at v1.0.0; this
> doc previously deferred all of Hub to v1.1. The resolution per
> `architecture/monetization-readiness.md`: the **commerce
> surface** (pricing page, ToS, privacy, Stripe Checkout for the
> new $99/month Founder tier, email magic-link auth) ships in
> the existing `site/` Next.js app for v1.0. The **Hub backend**
> (multi-tenant graph, GitHub App, PR-bot, cross-repo AGENTS.md
> service) gets scaffolded in a separate repo at `hub.schema.dev`
> only after the first paid signup. First customer is wired up
> via a concierge MVP (manual GitHub App setup + extractor run)
> within 7 days of payment; the Hub repo MVP grows from that
> customer's specific needs rather than from speculation.

---

## 3. The recommended cuts (v1.0 vs v1.1)

### v1.0 must-have

1. B1.1 — Commerce surface in `site/` (Founder tier $99/mo
   flat). ~5-7 days. Per `architecture/monetization-readiness.md`.
2. B2 — Studio polish (LevelToggle, HistoryPanel, BlameStrip,
   ProblemsHero, Toast, PlanPanel polish, ChangesPanel polish,
   Onboarding tutorial, EdgeInspector). ~3-4 weeks.
3. B4 — VS Code extension marketplace-listed. ~1-2 weeks.
4. B5 — Tauri build pipeline + binary distribution. ~1 week.
5. B8 (partial) — T5.1 + T5.2 (canonical mcp.json + Claude Code
   skill). ~3 days.
6. B9 — Launch artifacts. ~2-3 weeks (parallel).
7. B10 — Private alpha. ~3-4 weeks calendar.
8. B11 — Architecture doc amendment. 1-2 hours.

**Total v1.0 critical path: 10-12 weeks** with two founders.

### v1.x deferred / post-first-customer

- B1 — Hub MVP backend (separate repo at `hub.schema.dev`,
  starts after first Founder-tier paid signup, scaffolded as
  concierge MVP per `monetization-readiness.md §5`)
- Remaining Studio panels

---

## 4. Next actions

Per the ordered work plan, start with:
1. B11 — architecture doc amendment (1-2 hours)
2. B2 — Studio polish: HistoryPanel, EdgeInspector, BlameStrip,
   ProblemsHero, Toast (the missing v1-reference panels)

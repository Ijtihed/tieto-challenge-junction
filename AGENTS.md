# schemav3 · agent entry-point

> **For any AI agent (Cursor, Claude Code, MCP-driven, subagent)
> working in this repo.** Read this file first. This is the v3
> standalone repository; v1 and v2 live in a separate repo
> (formerly `schema01/`) and are off-limits to v3 work.

---

## 0. Read order (do this before anything else)

1. **`README.md`** — what v3 is, the three binding shifts, the folder
   map. ~3 minutes.
2. **`INHERITED-SUMMARY.md`** — the 10-minute briefing on every
   binding research finding + v2 architecture + legacy audit + the
   hard rules already locked in. **This is the file that gives you
   full context fast.** Mandatory. (Includes §11, the compressed
   monetisation decision.)
3. **`architecture/schema-v3.md`** — the binding architecture spec
   if it exists yet (§14 = phased build plan, §15 = business model
   + Schema Hub + IDE-fork-non-goal). Mandatory once the doc lands;
   skip if you're a research subagent in Step 1 below.
4. **This file**, §1 onward, for the operational rules + the
   step-by-step NEXT STEPS checklist below.

If you skip step 2, you will reinvent decisions that have already
been made and cite assumptions the binding research has already
overturned. The 72-row deviations log v2 produced is the receipt for
that failure mode; v3 prevents it by making `INHERITED-SUMMARY.md`
mandatory reading.

---

## 1. Hard rules

The eight hard rules locked in by the binding research live in
[`INHERITED-SUMMARY.md`](INHERITED-SUMMARY.md) §8. Read them there.
The four operational rules below are agent-mechanics, not
architectural:

1. **Don't edit outside this repo.** v1 + v2 live in a separate
 repository (formerly `schema01/`) and are off-limits to v3
 agents. (And vice versa: v1/v2 agents don't touch this repo.)
 **Schema Hub** (the monetisation tier per
 `architecture/schema-v3.md §15`) also lives in its own separate
 repo at `hub.schema.dev` — agents working in this repo
 (`Schemav3/`) ship the OSS core only. Don't add Hub-specific
 features, hosted-only flags, GitHub-App glue, billing code, or
 multi-tenant state to `Schemav3/src/`. If a feature would only
 work in Hub, it belongs in the Hub repo, not here.
2. **The `inherited/` folder is reference, NOT authority.** v2's
 architecture doc and the legacy audit live there as historical
 context. v3's architecture is allowed to disagree with v2 on any
 point as long as the disagreement cites a binding research
 finding.

 **Fresh-start policy.** v3 does NOT port v1/v2 source code.
 The `inherited/` folder contains architecture docs and the
 legacy audit for historical context only — no code snapshots.
 v3 implementations are written from scratch against the
 `architecture/schema-v3.md` spec. The salvage notes in the
 architecture doc's §3.2–§3.10 ("Salvages from v2. …") are
 **design-intent references**, not literal port instructions:
 they name v2 modules whose *responsibility* v3 reimplements,
 not code v3 copies.
3. **Citations follow the `[research:NN.§S.S]` pattern.** `NN` is
   the two-digit research doc number (01 through 14); `§S.S` is the
   section. Conventions in `research/README.md`.
4. **No subagent recursion.** Each numbered next-step is one agent.
   Subagents launching their own subagents creates citation-chain
   ambiguity. If a sub-question feels like a separate research doc,
   name it as future work in the parent doc.
5. **No public publishing without explicit founder sign-off.**
   Per `architecture/v1-launch-plan.md` Q14 (locked judgment call):
   no `npm publish`, no Tauri signed builds, no VS Code
   marketplace listing, no Homebrew tap, no schema.dev domain
   pushes, no landing page rewrite. v1.0 is a **locally-runnable
   technical milestone**, not a public launch. Distribution +
   commerce + marketing happen as a separate effort triggered
   only when the founder flips the launch switch.
6. **Run the Agent Operating Protocol before any code change.**
   Per `architecture/v1-launch-plan.md §0`: exploratory check
   (~30 min), mandatory research reading (~2 hr), identify current
   step, confirm with user. No exceptions.

---

## 2. NEXT STEPS · the literal checklist

Do these in order. Each step has a **trigger** (when to start it),
an **owner** (which agent does it), a **deliverable** (what lands
in the tree), and a **done-when** (the gate to the next step).

### Steps 0–6 · COMPLETED

These steps built the foundation. Summarised here for context;
the details are in git history.

| Step | Deliverable | Status |
|---|---|---|
| 0 | Pre-research: inherited docs + vocabulary kit | Done |
| 1 | `research/03`, `04`, `05` (three parallel subagents) | Done |
| 2 | User review of research docs | Done |
| 3 | `architecture/schema-v3.md` (binding architecture spec) | Done |
| 4 | Architecture review + amendments (§15 monetisation, §15.1 Studio) | Done |
| 5 | Scaffold: `src/`, `tests/`, `package.json`, DAG enforcement | Done |
| 6 | First vertical slice (workspace.open → graph.summary) | Done |

---

### Step 7 · Successive slices (CURRENT — see `architecture/v1-launch-plan.md`)

**THE BINDING EXECUTION DOC IS `architecture/v1-launch-plan.md`**
(authored 2026-05-21). It supersedes the old gap framing in
`v1-readiness.md` after docs 24-29 expanded the MVP scope.

Every agent picking up work in Step 7 **MUST** complete the
Agent Operating Protocol (`architecture/v1-launch-plan.md §0`)
before writing any code:

1. Run the mandatory exploratory check (~30 min): verify current
   state matches plan assumptions, run baseline tests, run real-
   repo smoke test on Schema's own source.
2. Read the mandatory research docs (~2 hr) in the order
   prescribed in §0.2 of the plan.
3. Identify the current step (by reading recent commits + PRs +
   running previous step's verification commands).
4. Read the step-specific pre-reads (§0.3) for that step.
5. **Read the prior step's `Implementation receipts (YYYY-MM-DD)`
   subsection** so you start from facts, not from the
   prescription alone. Step 1's receipts (in
   `architecture/v1-launch-plan.md` Step 1) are the canonical
   shape for what every future-step receipts subsection looks
   like.
6. Confirm with the user which step is current.
7. Begin work on that step only. Do not skip ahead.
8. At step completion: run all 3 verification levels (automated
   CI, real-repo smoke, manual review). Do not start the next
   step until all 3 pass.
9. **Append your own `Implementation receipts (YYYY-MM-DD)`
   subsection** to the step you just finished, following the
   six-part shape locked in `architecture/v1-launch-plan.md §0.6`
   (what shipped (engine), what shipped (clients), why this
   design, empirical receipts, plan deviations, known
   follow-ups). This is the v3 replacement for v2's 72-row
   deviations log and is non-negotiable.
10. **If your step lands any new gate (test suite, lint rule,
    CI job), include a Level-3 deliberate-regression check per
    `architecture/v1-launch-plan.md §0.6.1` ("verify the
    verifier"):** for each distinct gate, break the code on
    purpose, confirm the gate fires, record the exact failure
    output, revert. Step 2's double-check pass found a real
    `lint:dag` rule bug + 6 hidden architectural violations
    via exactly this discipline — every future-step gate must
    earn the same proof.
11. **If your step introduces any cross-layer enum / union
    (wire type ↔ store type ↔ engine type, or any other
    parallel set of string-literal members), follow
    `architecture/v1-launch-plan.md §0.6.2` ("no parallel
    unions"):** declare the union once and import it in all
    other layers via `import type`; add a canonical-set test
    on every layer pinning cardinality + exhaustive coverage.
    Step 3's double-check pass found a silent wire-vs-store
    drift that typechecked green — single-source unions plus
    canonical-set tests are now the binding pattern for every
    such enum.
12. **If your step is step 3, 6, 9, or 11 (the last of a
    trio), build a rolling visualization per
    `architecture/v1-launch-plan.md §0.6.3`:** a single
    self-contained HTML file at
    `.tmp-visualization-steps-X-Y.html` covering the trio's
    before/after, per-step what-shipped, new disciplines, and
    readiness lineage. Open it for founder review; delete
    when confirmed. The receipts persist; the visualization
    is ephemeral — re-projecting the receipts into one
    glanceable view, not a new permanent artefact.
13. **Before declaring "done", run the adversarial
    verification pass per
    `architecture/v1-launch-plan.md §0.6.4`:** inventory all
    cross-layer types (including dead exports), mutation-test
    every new gate (at least 3 mutations; more if the step
    adds 5+ new tests), re-verify all prior-step receipts
    still reproduce, document any fast-path / slow-path
    asymmetries, produce a perf table for any numeric claim
    in your plan, and run the full test suite 3× to confirm
    no flakes. Step 4's double-check pass found a §0.6.2
    violation (dead export) + a documented cache asymmetry
    + 3 mutations that survived the first pass — every
    future step earns the same proof.

**Current state (2026-05-22, post-Step-9b DC):**
- 1,303 engine tests + 158 Studio unit tests + 27 Studio e2e
  tests + 3 Studio visual regression baselines =
  **1,491 tests across the stack** (1,303 engine + 158 studio
  unit + 27 e2e + 3 visual); typecheck clean; build clean
  with **no Vite warnings**. Engine: 7/10 runs stable at
  1,303; 3/10 hit a pre-existing clustering test-runner
  flake at 1,298 (cluster.test.ts — `--test-force-exit`
  timing on a 4467-node fixture, pre-dates 9b; 0 fails
  across all 10 runs). Studio 3×158 + visual 3×3 fully
  deterministic.
- **53 MCP actions** (48 baseline + caching.stats + workspace.watch_*
  ×2 + drift.generate + **graph.ask** from Step 8b).
- **pr.review is now feature-complete**: hybrid-strict marker
  + atlas deep link + evidence citations + hallucinated-API
  detection (Step 9a placeholder closed by Step 8b).
- **Step 11 dogfood kit is live**: 4 CLI commands
  (`dogfood:summary`, `dogfood:survey`, `dogfood:init-failure-log`,
  `dogfood:smoke`) backed by 4 pure-domain modules under
  `src/domain/dogfood/`. Pre-flight smoke deterministic across
  Schema (856 ms p50) + express (249 ms p50) + cli/cli
  (506 ms p50) on 5 runs each — **8/8 actions PASS on every
  run**.
- **53 MCP actions** (48 baseline + `caching.stats` from Step 1
  extended in Step 4 + `workspace.watch_start` + `workspace.watch_stop`
  from Step 5a + `drift.generate` from Step 9a + **`graph.ask`
  from Step 8b as #53**), 7 extractors, 3 active bridges, 8
  archetypes recognised, 8 codegen toolchains detected
- **6-job blocking CI** (engine typecheck + test + lint, studio
  typecheck + unit + e2e) per Step 2
- **0 lint baseline** (was 90; -90 fixed in Step 2)
- 50 bundled Datalog rules, 60 canon docs (test-verified), 9 skills
- **Persistence schema at v3** (Step 8a DC migration from v2):
  `clusters` table now stores Step 7a's `importance` +
  `entryPointIds` + `labelTier` fields. Idempotent in-place
  ALTER on legacy DBs.
- **New `src/domain/retrieval/` module from Step 8a**: shared BM25F
  (`bm25.ts` with **O(T × P)** inverted-loop searchIndex,
  900× faster on 9.5k-node graphs than the naive draft) + graph
  BM25 (`graph-bm25.ts` with Sourcegraph name>path>kind>meta
  weights) + graph traversal (`graph-traversal.ts` with BFS +
  per-hop decay + same-cluster bonus + `seedScores` override) +
  RRF (`rrf.ts` k=60 Cormack default) + hybrid orchestrator
  (`hybrid.ts` with hardened hydrate-step that drops
  unresolvable docIds). Canon migrated to shared BM25 with zero
  behaviour regression.
- Studio canvas with 34 + 9 components + extended `<ExtractionBanner />`
  with Step 4 filter breakdown (dual-palette: amber for failure,
  neutral for filter-only) + extracted `<Breadcrumb>` archetype
  labels + doc-25 leveling + Step 5a `<LiveAtlasIndicator />`
  pulse in `<TopBar>` for L1 file-watch events; VS Code extension
  at 0.1.0
- **Honest readiness: ~96%** (Steps 1+2+3+4+5a+6+7a+8a+8b+9a+9b+10a+11a
  all done; 7a/8a/8b/9a/9b/10a/11a double-checked). Step 9b
  shipped two composite GitHub Actions (`.github/actions/schema-pr-review` +
  `.github/actions/schema-drift`) wired through
  `.github/workflows/schema.yml`. New `src/cli/ci-bridge.ts`
  exposes `pr-review-md` and `drift-md` CLI subcommands.
  **Step 9b DC surfaced 4 real bugs + 6 round-2 mutation gaps**:
  (1) failure markdown didn't carry the sticky-comment marker
  (every Schema-engine flake would stack a new ❌ comment instead
  of replacing the prior ✅ review); (2) drift action would
  clobber the last good `architecture/drift.md` on any bridge
  failure (bash redirect happens regardless of exit code);
  (3) drift cron's `git diff --quiet HEAD` short-circuit never
  fired because the drift report's `Generated YYYY-MM-DD` header
  changes every day (would have opened a no-op drift PR every
  Monday); (4) two §0.6.2 parallel-union violations
  (`DEFAULT_DRIFT_WINDOW_DAYS = 30` in bridge shadowed action's
  `7`; `merge-base origin/main` literal in 3 files). All 4
  fixed + pinned by §0.6.4 firing tests. **6 round-2 mutation
  gaps closed**: J (CI green on engine crash), K (sticky-marker
  spoof via user PR description without bot-author check), L
  (drift cron no-op PR), M (PR review frozen at first push
  without `synchronize`), N (cron cadence drift weekly→daily),
  O (`--force` instead of `--force-with-lease`), P (push target
  defaults to `main`). New **§0.6.4 (l)** rule added: idempotency
  checks on generated artefacts must strip dynamic fields
  (dates / uuids / timestamps) before comparing. Step 8b DC
  silent producer/consumer bug fixes (pr.review reading
  nonexistent `addedEdges`; smoke harness reading
  `nodeCount`/`edgeCount`) still in place. Remaining 4% is Step 5b
  L2/L3 live atlas + 7b recursive clustering + 10b animation
  choreography + 11b 2-week founder dogfood (human-only).
- Known bugs after Step 9a: no tree-sitter incremental parsing
  (Step 5b), no per-file fact-equality cutoff (Step 5b), no
  reactive memoization (Step 5b), no full-rebuild fallback
  (Step 5b), no `graph.ask` MCP action (Step 8b), no
  hallucinated-API guard populating `pr.review.hallucinatedApis`
  (Step 8b — placeholder wired), no recursive clustering /
  entry-points action / Studio ★ / canonical-shape detection
  (Step 7b), no GitHub Actions for `pr.review` / weekly drift
  (Step 9b).
- Step 1 closed: TS extractor silent-drop bug.
- Step 2 closed: zero Studio tests + no CI for Studio. §0.6.1
  added.
- Step 3 closed: v1-era level labels + leaky breadcrumb + no
  archetype detector. §0.6.2 added.
- Step 4 closed: no `.gitignore` reading + thin codegen detection.
  Schema's own source now filters 38,944 gitignored + 2,480
  always-ignored files; 0 vendor/, 0 node_modules/, 0 .pb.go in
  the graph. **§0.6.4 ("adversarial verification") added** —
  every step from Step 5 onward MUST inventory cross-layer
  types (including dead exports), mutation-test every new gate,
  re-verify prior-step receipts, document fast/slow-path
  asymmetries, produce a perf table for numeric claims, and
  3× the test suite. Receipts at `architecture/v1-launch-plan.md`
  Step 4 (including the double-check addendum).
- Step 5a closed: zero file watching. `chokidar@5.0.0` wired
  via `src/adapters/fs/file-watch.ts` with 100 ms debounce +
  burst coalescer + Step 4 filter reuse + editor-event forwarding.
  2 new MCP actions (`workspace.watch_start` / `watch_stop`)
  routed through the existing SSE channel. Studio wired with
  `liveAtlas` slice + `<LiveAtlasIndicator />` pulse. **§0.6.4
  bug found + fixed**: original `pickKind` was dead code (post-
  `set()` overwrite). Now caught by an adversarial mutation test.
  **Double-check pass** added 3 harder mutations (idempotent-
  start, filter-disable, missing-export — all caught) and
  surfaced **one real coverage gap**: `session.close()` watcher
  teardown was untested. 3 new tests added (session.close()
  integration + multi-session independence); gap closed.
  Rigorous perf table: p50 = 113 ms across all workspace sizes
  (141-1,568 files), 3× under the 350 ms G1 L1-component gate.
  Lesson encoded for future steps: when a component integrates
  with existing infrastructure (session lifecycle, event bus,
  snapshot store, MCP transport), **mutation-test the integration
  boundary as carefully as the component itself**. Step 5b
  (L2 tree-sitter incremental + L3 fact-equality + `@reactively/core`
  memoized queries + full-rebuild fallback + perf gates G4-G10)
  is paused for review. Receipts + double-check addendum at
  `architecture/v1-launch-plan.md` Step 5a.
- Step 7a closed: clustering had only 2 of 5 stages + emitted
  `Module N` and `Other` (banned by doc 24). Full 5-stage
  pipeline now ships (A edge weighting → B Leiden → C merge
  same-dir → D per-cluster PageRank via `ngraph.pagerank` → E
  7-tier labels). Tiers per the PLAN's prescription: framework
  / folder-archetype / dominant-symbol / package-readme /
  common-substring / llm-byok (placeholder for 7b) /
  coordinate-fallback (`Area at (x,y)` replaces banned
  patterns). `Module N` / `Other` / `Cluster N` banned at 3
  layers: tier 7 data, `isBannedLabel` pure check, and
  `assertNotBanned` defence-in-depth runtime guard
  (extracted as exported helper after the §0.6.4 verification
  found the original buried guard had no test). 47 new
  tests in `clustering.test.ts` (38 first-pass + 9 from the
  double-check: 4 threshold-boundary + 1 integration
  equivalence + 4 `assertNotBanned`). Real-repo Level 2:
  **0 banned-label clusters across 204 clusters from 4 OSS
  repos** (Schema 38, express 6, cli/cli 123, turborepo 37).
  **Tier 7 actively fires in production** (Schema 2 / cli 1
  / turborepo 1 — defence-in-depth verified end-to-end).
  `buildClusters` perf: <1 ms on express (196 nodes), 40 ms
  on cli/cli (4.5k nodes), 44 ms on turborepo (9.5k nodes).
  `Cluster` interface extended with `importance` map +
  `entryPointIds` (top-3) + `labelTier` (sources for Step
  7b's `graph.entry_points` action + Studio ★ rendering).
  **Double-check pass** ran 5 more mutations (F-J): F + G
  surfaced threshold-pinning coverage gaps (Tier 4 + Tier 5
  thresholds only tested at 100%-share fixtures) → 4 new
  boundary tests → caught. J surfaced integration-boundary
  equivalence (production callsite uses auto-detection
  fallback transparently) → 1 new equivalence test pinning
  the contract. **Two §0.6.4 refinements added**: (c)
  threshold-pinning rule (boundary must be tested from both
  sides); (d) integration-boundary equivalence rule (when
  callsites use a callee default, pin the equivalence).
  Step 7b (HERCULES recursive clustering + entry-points
  action + Studio ★ + canonical-shape detection) paused for
  review. Receipts + double-check addendum at
  `architecture/v1-launch-plan.md` Step 7a.
- Step 6 closed: no stacked-overlay persistence. In-place
  v1 → v2 schema migration adds `parent_snapshot_id` +
  `overlay_unit_uris_json` to `snapshots`. `saveSnapshot`
  computes per-file overlay units + fires L5 early cutoff
  when units empty. `loadGraphFromSnapshot` walks the chain
  (base → leaf) merging by repo. Chain depth bounded at 50;
  LRU eviction made leaf-only after the §0.6.4 verification
  pass surfaced a CASCADE-over-eviction bug (naive LRU on a
  chain wiped 55 → 4 snapshots). `graph.list_snapshots`
  returns `chains[]` via the pure `buildSnapshotChains`
  helper (extracted during double-check for testability);
  `graph.delete_snapshot` returns `cascadedIds[]`.
  `graph.diff_against` gains `mode` param (4 Iceberg/Delta
  CDC forms; default `min-delta`). G3 = 60 ms p50 cached
  SHA load; G4 = 36 ms p50 mid-chain load; G5 = 9.8×
  storage reduction with realistic edges (passes <0.15×
  ratio gate). Load latency grows linearly +1 ms / layer;
  56 ms at chain depth 48 (half the G3 budget).   **Double-
  check pass** ran 5 more mutations (F-J) and found 2 real
  coverage gaps (per-overlay subset persistence + buried
  action-helper logic) → 3 new tests pin subset persistence
  + cluster wholesale-replacement + edge-orphan eviction;
  5 new tests for the extracted `buildSnapshotChains`
  helper. **Also fixed a ~10-15% real flake** in the
  `deleteSnapshot removes the snapshot` test (timestamp-
  ordering at 1 ms resolution); 12 consecutive clean runs
  confirm. End-to-end overlay verified on Schema's real
  graph. **Three binding lessons encoded for future steps**:
  (1) storage-win optimizations need tests that assert
  the optimization actually fires (not just that
  correctness is preserved); (2) when an action handler
  has >5 lines of non-IO logic, extract a pure helper +
  unit-test it; (3) assume non-deterministic ordering
  whenever timestamps are involved in test assertions.
  Log-only mutations are acceptable §0.6.4 exceptions.
  All Steps 1-5a receipts hold post Step 6. Receipts +
  double-check addendum at `architecture/v1-launch-plan.md`
  Step 6.
- 4/4 OSS archetype detections match doc-25 Appendix A.
- 8/8 codegen toolchains detected (protoc, swagger-codegen,
  openapi-generator, prisma, sqlc, sqlboiler,
  datamodel-code-generator, oapi-codegen).
- Filter audit perf measured at 13-182 ms per workspace
  (≤ 1.8% of total extraction time on Schema / turborepo /
  cli/cli / express).
- Step 8b closed: no `graph.ask`, no hallucinated-API
  detection, no MCP install docs. **New `src/actions/graph-ask.ts`**
  (action #53) wraps Step 8a's `queryHybrid` with a
  session-scoped WeakMap index cache (first ask builds the
  index, every subsequent ask reuses; cache freshness via
  node-count + edge-count signal). Pure `renderHitsMarkdown`
  emits a markdown evidence block at
  `markdown://graph.ask/<uuid>`. Hybrid-strict: returns
  evidence, the LLM synthesises. **New `src/domain/retrieval/hallucinated-api.ts`**
  (pure detector): compares diff `calls` edges to head graph
  membership; uses Step 8a BM25 for "did you mean"
  suggestions gated by `MIN_NEAREST_MATCH_SCORE = 0.5` +
  `MAX_HALLUCINATIONS_REPORTED = 20`. **`pr.review.hallucinatedApis`
  placeholder from Step 9a is now populated** — closes the
  loop, makes `pr.review` feature-complete. **New
  `docs/mcp-install.md`**: per-client install for Cursor /
  Claude Code / Cline / Continue with prerequisites +
  recommended rules + troubleshooting. **SMOKE_STEPS swaps
  `graph.search` → `graph.ask`** (closes Step 11a known
  follow-up). **+32 engine tests** = **1,253 / 1,246 pass +
  7 skip**. Real-repo smoke on Schema: 8/8 actions PASS warm
  in 735 ms; `graph.ask` 26 ms warm. §0.6.4: 6 mutations
  (A-F), **all 6 caught immediately** by day-1 tests. **No
  split** — the 3 work items are tightly coupled to Step 8a
  outputs + Step 9a placeholders. Receipts at
  `architecture/v1-launch-plan.md` Step 8b.
- Step 11a closed: no usage aggregator, no Sean Ellis survey
  tool, no failure-log template, no pre-flight smoke harness.
  **New `src/domain/dogfood/` module**: pure
  `usage-aggregator.ts` (STEP_11_USAGE_GATE canonical:
  `minTotalEvents=50, minDistinctKinds=5, windowDays=14`) +
  `sean-ellis.ts` (V/S/N classification per Q7 strict gate;
  JSONL round-trip; cycle tracking for iterative dogfood) +
  `failure-log.ts` (blocking/wishlist/known canonical; gate =
  zero blocking) + `smoke-harness.ts` (8 daily-driver actions
  E2E: workspace.open → graph.summary → caching.stats →
  graph.list_snapshots → graph.search → pr.review →
  drift.generate → agents_md.write_facts). **New `src/cli/dogfood.ts`**
  + 4 CLI commands (`schema dogfood:summary`, `schema dogfood:survey`,
  `schema dogfood:init-failure-log`, `schema dogfood:smoke`).
  **New `architecture/dogfood-readme.md`**: literal founder
  checklist for Day 0 pre-flight + Day 1 setup + 2-week
  daily-driver flow + Day 14 verdict. Per Q15 + Q13: the
  human 2-week session is **Step 11b** — agent cannot
  perform; founder-only. **+61 engine tests** = 1,215 /
  1,208 pass + 7 skip. Real-repo smoke on Schema itself:
  **8/8 PASS in 648 ms** (workspace.open 547ms, pr.review
  67ms, drift.generate 15ms, etc.). dogfood:summary on real
  ~/.schema/events.jsonl correctly reports gate FAIL (2,585
  events but only 3 distinct kinds < 5 required —
  development-only usage shouldn't pass the founder-dogfood
  gate). §0.6.4: 8 mutations (A-H), 7 caught immediately +
  1 no-op due to short-circuit.
  **Step 11a DC** (2026-05-22 early): 8 mutations (I-P),
  6 caught immediately + 2 surfaced firing-test gaps
  (Mutation K: smoke harness silently skipped missing
  actions; Mutation P: `emptyFailureLog(cycle)` ignored
  the cycle argument across multi-cycle iteration).
  Fixed by 5 new tests + 1 new cross-layer pin
  (`SMOKE_STEPS` ↔ `actions/index.ts` `.name` fields).
  **+6 engine tests** (= 1,221) + 0 Studio = **1,409
  across stack**. Definitive perf table: smoke warm
  249-856 ms p50 across 3 OSS repos (Schema/express/cli);
  aggregator O(N), sub-50 ms at 100k events; survey +
  failure-log IO sub-2 ms. Real-repo smoke deterministic:
  8/8 actions PASS on every run across 5 runs × 3 repos.
  **One new §0.6.4 refinement**: (j) cross-layer-name
  pinning rule — when a domain array of strings identifies
  real engine surfaces, pin each string ↔ a real exported
  `.name` via equivalence test, so renames fail at test
  time, not at Step 11b runtime.
  Receipts + double-check addendum at
  `architecture/v1-launch-plan.md` Step 11a.
- Step 10a closed: no framer-motion, no skeleton library, no
  empty-state hero, no visual regression. **New
  `framer-motion@^11.18.2`** installed per Q4 for Step 10b
  animations. **`lessons.ts` refactored** from imperative
  `script()` thunk with lazy `import("@/state/store")` to
  declarative `LessonScript = LessonScriptStep[]` + exported
  `playLesson(steps, getState)` runner that accepts the store
  accessor from the caller. Vite dual-import build warning
  resolved. **`canvas-utils.ts` extracted from GraphCanvas.tsx**
  (4 pure helpers + `RELATION_STYLE` 11-relation monochrome
  table); GraphCanvas 1,307→1,237 lines (final decomposition
  to 4-6 concern modules deferred to Step 10b per Step 5a/7a
  precedent: extract pure helpers, defer React-coupled surfaces
  to the layer that needs them). **New
  `src/components/skeleton/` library**: `Skeleton`,
  `SkeletonText` (deterministic 4-width cycle), `SkeletonCard`,
  `SkeletonCanvas` (4-cluster placeholder for `<Suspense>`).
  **New `WelcomeHero` empty-state**: archetype card + 5-sentence
  English summary (deterministic per Q14 offline-first; no LLM
  calls; snapshot-safe). `ARCHETYPE_META` canonical (9 archetypes
  exhaustive). `buildWelcomeSummary` pure helper with §0.6.4 (c)
  confidence threshold at 0.6 + grammar variants for 1/2/3+
  languages + singular/plural formatting. Conditional render in
  App when `repoOpened && nodes.length < 5`. **Playwright visual
  regression harness**: `maxDiffPixelRatio: 0.005` + `maxDiffPixels: 500`
  (dual bound discovered via §0.6.1 verify-the-verifier — single
  ratio missed headline-scale changes), `animations: "disabled"`,
  `reducedMotion: "reduce"`, `colorScheme: "dark"`, fixed
  `viewport: 1280×800`. 3 canonical baselines: `studio-landing`,
  `studio-skeleton-canvas`, `studio-welcome-hero` (Step 10b adds
  the remaining 7). **+47 studio tests** = 134 unit + 3 visual =
  **1,318 across stack** (was 1,268; +50). §0.6.4: 8 mutations
  (A-H), 7 caught immediately + 1 surfaced firing-test gap
  (Mutation G: `playLesson` inter-step delay was unobserved →
  added §0.6.4 (b) firing test asserting elapsed ≥ 50 ms for
  2 × 30 ms steps → caught). Step 10b (animation choreography
  + onboarding guided flow + colour token audit + remaining 7
  visual regression views + GraphCanvas final decomposition)
  paused for review.
  **Step 10a DC** (2026-05-21 evening): 9 mutations (I-Q),
  7 caught immediately + 2 surfaced firing-test gaps
  (Mutation L: WelcomeHero gating threshold was inline +
  unobserved; Mutation O: `RELATION_STYLE` 11-relation
  table had no tests). Fixed by extracting
  `WELCOME_HERO_NODE_THRESHOLD = 5` + `shouldShowWelcomeHero`
  pure helper + 6 boundary tests; added `canvas-utils.test.ts`
  with 15 tests pinning cardinality + monochrome contract +
  20-period animated dasharray + canonical animated set.
  Three-way archetype cross-layer pin added in
  `archetype.test.ts` (engine ArchetypeId ↔ store
  ArchetypeIdClient ↔ WelcomeHero ARCHETYPE_META +
  ARCHETYPE_IDS). **+24 studio tests** = 158 + 3 visual =
  **1,342 across stack**. **Two new §0.6.4 refinements**:
  (h) multi-consumer canonical-set rule — at N > 2
  consumers, pairwise pins are binding (transitive A↔B↔C
  doesn't guarantee A↔C if B hides drift); (i)
  threshold-via-helper rule — inline numeric thresholds
  in component code are forbidden, must be exported
  constants + pure helpers so §0.6.4 (c) threshold-pinning
  can actually catch numeric drift.
  Receipts + double-check addendum at
  `architecture/v1-launch-plan.md` Step 10a.
- Step 9a closed: no hybrid-strict marker, no atlas deep link,
  no drift report, no AGENTS.md auto-trigger, no Studio `?pr=`
  route. **`pr.review`** now emits the binding "Schema does
  not have merge authority" marker at the top + atlas deep
  link in header + evidence citations (rule violations with
  `nodeId` get `?pr=<sha>&focus=<id>` links via the unified
  3-arg `buildAtlasDeepLink` helper that the Step 9a DC
  unified across engine + Studio) + exposes
  `hallucinatedApis: []` placeholder for Step 8b. **New
  `src/domain/drift.ts`** (pure, ~370 LOC) computes 4-section
  report (areas grown/shrunk, new cross-cluster deps,
  deprecation candidates, rule-violation trend) with
  canonical `DRIFT_THRESHOLDS`. **New `drift.generate` action
  (#52)** drives off Step 6's snapshot store. **`workspace.open`
  auto-trigger**: writes Schema-fenced facts into AGENTS.md
  or CLAUDE.md if either pre-exists, **never creates new
  files**. **Studio**: `usePrMode` + `<PrModeBanner />` +
  `selectNode(focusId)`. **+58 engine tests + 8 studio tests**
  (51 pre-DC + 7 from DC; 18 pr-review + 40 drift) =
  **1,268 across stack**. Definitive perf (5-iter p50/p95
  across 4 OSS repos): pr.review 25-228 ms; drift.generate
  1-32 ms; sub-linear scaling. Multi-snapshot synthetic
  drift fires all 4 sections in 0 ms compute + 1 ms render.
  §0.6.4 stack: 21 mutations total (A-W), 14 caught
  immediately + 6 surfaced real gaps (Q/Q'/Q'' sort orders
  unobserved across all 3 ranked drift sections; N empty-
  section placeholder unobserved; R off-by-one rounding) +
  1 real cross-layer signature drift (engine vs Studio
  `buildAtlasDeepLink`). **1 new §0.6.4 refinement**: (g)
  sort-order pinning rule — ranked-list tests must use
  adversarial fixtures where alphabetic and primary-sort
  orderings disagree, otherwise sort-replacement mutations
  slip past. Step 9b (two GitHub Actions + workflow YAML)
  paused for review. Receipts + double-check addendum at
  `architecture/v1-launch-plan.md` Step 9a.
- Step 8a closed: no `graph.ask`, no BM25, no RRF, no hybrid
  retrieval. New `src/domain/retrieval/` module: shared BM25F
  (`bm25.ts`) powers both canon and graph; tokenizer
  identifier-splits camelCase + retains compound. `graph-bm25.ts`
  indexes nodes across 4 Sourcegraph-weighted fields
  (name=3 > path=2 > kind=0.7 > meta=0.5). `graph-traversal.ts`
  does BFS expansion from BM25 seeds with per-relation edge
  weights + per-hop decay + same-cluster bonus + a `seedScores`
  override. `rrf.ts` fuses with k=60 Cormack default. `hybrid.ts`
  orchestrates + has hardened hydrate-step that drops
  unresolvable docIds. **+61 engine tests** in
  `hybrid-rag.test.ts` + 3 v2→v3 persistence migration tests
  in `stacked-overlay.test.ts`. Canon migrated to shared BM25
  **with zero behaviour regression**.
  **Double-check pass found and fixed two real bugs:**
  (1) **O(C×T×P) BM25 perf regression** — turborepo warm queries
  took 2,732 ms p50 before the inverted-loop fix; after, 3 ms
  p50 (**900× speedup**). Scale fixture + hard latency bound
  test pins the new perf contract. (2) **Silent persistence
  regression dating back to Step 7a** — the `clusters` table
  dropped `importance` + `entryPointIds` + `labelTier` on
  save/load; v2→v3 in-place migration + 3 round-trip tests
  fix it; bridge clusters in `workspace-open.ts` now carry
  explicit `labelTier`.
  **Empirical receipts**: 20-task synthetic benchmark passes
  at **100% top-3** (well above 70% gate); 20-query
  token-presence benchmark on 4 OSS repos: **85.5% aggregate
  top-3 hit rate** (Schema 17/20, express 12/16, cli 20/20,
  turborepo 20/20). Definitive perf: build p50 = 23-100 ms
  across 196-9,521 nodes; cold query p50 ≤ 1 ms; warm p50
  ≤ 3 ms; **sub-linear scaling preserved** post-optimization.
  **§0.6.4 stack**: 19 mutations total (A-S), 13 caught
  immediately + 4 surfaced real gaps (all closed) + 2
  acceptable parameter-tuning exceptions. **2 new §0.6.4
  refinements**: (e) perf regressions need scale fixtures +
  hard bounds — single-doc perf tests don't expose
  complexity-class bugs; (f) cross-step persistence drift —
  any domain-interface extension must include a "round-trip
  through persistence" test for the new fields, otherwise
  later steps silently consume `undefined` from cached data.
  Step 8b (`graph.ask` MCP action + hallucinated-API guard
  in `pr.review` + MCP install docs) paused for review.
  Receipts + double-check addendum at
  `architecture/v1-launch-plan.md` Step 8a.

**What's next in Step 7:**
The 11-step plan in `architecture/v1-launch-plan.md`:

1. Fix extractors (silent-drop bug) — 3-4 days
2. Wire Studio CI + restore unit tests — 2 days
3. Doc 25 leveling + archetype detection — 1 week
4. `.gitignore` reading + generated-code filtering — 3 days
5. Live atlas (chokidar + tree-sitter incremental + reactive) — 2 weeks
6. Stacked-overlay persistence + branch switch — 3-5 days
7. Recursive clustering + PageRank + 7-tier labels — 2 weeks
8. Hybrid RAG (graph.ask + BM25 + RRF) — 1.5-2 weeks
9. pr.review + GitHub Action + drift report — 1 week
10. Studio polish + animations — 1.5-2 weeks
11. Internal dogfood gate (founder, 2 weeks, Sean Ellis 40%) — 2-3 weeks

Total: 7-10 weeks of build + 2-3 weeks dogfood = ~10-13 weeks.

**v1.0 scope deliberately excludes (per locked judgment calls):**
- Commerce (Stripe Founder tier) — Q8
- Public launch (landing/essay/HN/demo) — Q9 + Q12
- Publishing (npm/Tauri/VS Code marketplace/brew) — Q14
- External design partner recruiting — Q15
- Tauri build (Vite dev server only) — Q16
- Vector embedding half of hybrid RAG (BM25 + graph only) — Q2

These all happen as a separate effort whenever the founder
flips the launch switch.

The v1/v2 cleanup question (when to delete the existing trees) gets
its own step at some point — that's a user decision, not the
architecture doc's.

---

### Step 8 · Moat-building slices (post-v1.0)

> **Context.** A May 2026 moat research survey identified 15
> moat-building ideas (M1–M15). These were reconciled against
> v3's locked-in constraints in `architecture/schema-v3.md §17`.
> Detailed specs live in `architecture/specs/`.

**Trigger:** v1.0.0 ships (Phase 12 gate in §14.12 fires).

**Owner:** the user decides ordering; agents implement slices.

The moat items are grouped into three milestones. Each slice
within a milestone is independent and can be built in any order.

#### Step 8a · v1.1 moat slices (months 1–3 post-launch)

These fit the current Node.js + TypeScript stack with no new
native dependencies:

| Slice | Spec | Key deliverable |
|---|---|---|
| **Semantic diff** | `architecture/specs/semantic-diff.md` | Refactoring detection, behavioral impact scores, semantic-no-op classification in `pr.review` |
| **Datalog-Lite rules** | `architecture/specs/datalog-lite.md` | TypeScript Datalog evaluator, 50 bundled rules, `.schema/rules/*.dl` user rules |
| **Event log** | `architecture/specs/event-log.md` | Local JSONL event log at `~/.schema/events.jsonl` for PRM data collection |
| **Data-flow-lite edges** | `schema-v3.md §17.1` | `reads_field`, `writes_field`, `reads_table`, `writes_table`, `reads_env`, `writes_env` edge relations |
| **Effect annotations** | `schema-v3.md §17.4` | Per-function `{reads, writes, calls, throws}` inferred from tree-sitter |
| **Op preconditions** | `schema-v3.md §17.3` (stage 1) | Declarative precondition predicates on bundled ops |
| **Graph persistence** | `schema-v3.md §17.7` (stage 1) | SQLite-backed graph persistence, git-SHA-tagged snapshots |

**Done-when:** `pr.review` outputs a semantic summary with
refactoring classification + impact score + semantic-no-op
headline. `rules.evaluate` runs Datalog rules. Event log is
collecting data.

#### Step 8b · v1.2 / Series A moat slices (months 4–12)

These may require native addons or new hires:

| Slice | Ref | Key deliverable |
|---|---|---|
| **Op precondition DSL** | `schema-v3.md §17.3` (stage 2) | Declarative DSL with optional Z3 discharge |
| **Graph import** | `schema-v3.md §17.8` | `graph.import` action ingesting SCIP / Joern / Infer output |
| **Architectural search** | `schema-v3.md §17.9` | `graph.query` action accepting Datalog; query builder in Studio |
| **Hybrid canon retrieval** | `schema-v3.md §17.2` (tantivy + USearch) | BM25 + HNSW + RRF for canon search |

#### Step 8c · Series B moat slices (months 12–24, contingent on ARR)

Heavy verification and ML items:

| Slice | Ref | Key deliverable |
|---|---|---|
| **Z3 verifier** | `schema-v3.md §17.12` | Optional `schema verify` command |
| **Pulse/Infer integration** | `schema-v3.md §17.12` | C/Java side-effect analysis via `graph.import` |
| **PRM training** | `schema-v3.md §17.12` | Hub-side PRM on event log data |
| **HAMT versioned graph** | `schema-v3.md §17.7` (stage 2) | O(Δ) persistent graph snapshots |
| **Cross-language equivalence** | `schema-v3.md §17.12` | Semantic equivalence checking for ports/rewrites |

---

### Step 9+ · Competitive response slices

Triggered by competitor actions per `architecture/competitive.md`.
Not pre-planned — the competitive doc defines the thresholds
that activate these slices.

---

## 3. The three research-subagent briefs (COMPLETED — historical reference)

> **Status:** Steps 1–2 are done. The three research docs exist
> at `research/03`, `research/04`, `research/05`. The briefs
> below are kept as historical context for how the research was
> scoped. Do NOT re-run these subagents.

Each brief below is what the parent agent in Step 1 copy-pasted
into a Task tool call. They ran in parallel; each subagent wrote
one doc.

---

### 3.1 · Cross-language bridges (`research/03-cross-language-bridges.md`)

**Single-question framing:** How does Schema actually resolve
cross-language references at IDE latency, for the 8 bridges committed
in v2 (REST/OpenAPI, gRPC/protobuf, GraphQL, message-bus, db-schema,
job-runner, FFI, IaC), without making the user install or configure
anything?

**Sub-questions to answer:**

- **Per-bridge resolution strategy.** For each of the 8 bridges:
  what's the join key (URL path, topic name, table name, proto
  service, FFI signature, IaC resource id)? What's the precision/
  recall on real polyglot OSS repos? Pull 3 OSS repos and measure.
- **Performance ceiling.** Cite Glean, ast-grep, Sourcegraph SCIP
  benchmarks. Measure (or estimate from comparable tools) the
  extraction time, memory cost, and incremental-extract delta cost
  on a 100k-file polyglot monorepo with all 8 bridges enabled.
- **Spec-vs-source conflicts.** When the OpenAPI says `POST /users`
  and the handler is `app.post("/user")` (typo), what wins? When is
  the mismatch a violation vs silent?
- **Generated-code detection.** How does Schema know `.pb.go` is
  generated across 8 codegen toolchains and route the model to
  `.proto` instead?
- **AsyncAPI.** v2's research doesn't mention it. Is it the
  message-bus equivalent of OpenAPI for REST? Decide whether v3
  bundles AsyncAPI awareness.
- **Competitor reverse-engineering.** Augment Code, Sourcegraph
  Cody. How do they handle cross-language references? Feature-level
  detail. v2's research surveyed the literature; this needs the
  product behaviour.

**Format:** match the shape of `research/01-mvp-scope-and-technical-gap.md`.
6+ sections, citation-heavy with `[N]` refs at the bottom, opinionated,
end with a "what this implies for v3 day-one" beat. ≥ 2000 lines
acceptable; less is fine if the material doesn't support it.

**Plug-and-play constraint:** for every bridge, answer "what does
the user have to install / configure / annotate for this to work
out of the box?" If the answer is "anything", call it out as a
friction point and propose either bundling the requirement or
scoping the feature out.

**Hard recommendation at the end:** which of the 8 bridges ship v3
day-one, which ship v3.1, which never. Justify each.

---

### 3.2 · Wisdom layer empirics (`research/04-wisdom-layer-empirics.md`)

**Single-question framing:** Does the AGENTS.md + Skills + canon-RAG
composition that v2 proposes actually move the needle on staff+
architectural tasks? And what's the right shape for v3 if the answer
is "kinda"?

**Sub-questions to answer:**

- **Skills vs AGENTS.md vs in-context.** The Vercel-eval datapoint
  (AGENTS.md 100% / Skills 53%) is one benchmark on one task class.
  What does the literature say on:
  - architectural decisions ("saga vs 2PC?")
  - paradigm-specific reasoning (OTP, STM, CQRS)
  - cross-package refactor planning
  - reading-code-at-architecture-level (the staff+ activity)
- **Progressive disclosure.** Does the model actually read Skill
  metadata before loading the body? Or does it always fetch? Cost
  implications.
- **Distribution model.** Should a Skills surface be a marketplace
  (Anthropic Skills, Cursor rules, Continue hub)? A curated bundle?
  Or just a directory convention? Reverse-engineer the three
  competitor registries.
- **Canon RAG (50–200 docs on OTP, Jepsen, CQRS, etc.).**
  - chunk size, embedding model, k, hybrid vs pure-vector decision
  - relevance-decay measurement — how much does corpus breadth
    hurt retrieval quality?
  - cold-start cost — does the user wait while the canon embeds on
    first run, or does v3 ship a pre-built index?
- **Plug-and-play implication.** v2 designed Skills as MCP resources
  loaded on demand. v3's plug-and-play constraint says Skills +
  canon must ship in the binary. What's the size budget? Can the
  binary stay under, say, 200 MB with 30 skills + 200 canon docs +
  embeddings?
- **Original measurement.** Build a small architectural-task eval
  harness (~10 tasks; three conditions: bare model, +AGENTS.md,
  +Skill). The literature is thin here so original measurement is
  the right move.

**Format:** same as 03.

**Hard recommendations at the end:**
- Whether v3 ships Skills at all, and if yes how many day-one.
- The canon scope (which paradigms, which papers, which talks).
- Whether RAG is in or out.
- The binary-size budget for the wisdom layer.
- The AGENTS.md round-trip writer (already inherited from v2
  research; reaffirm or overturn).

---

### 3.3 · Distribution and GTM (`research/05-distribution-and-gtm.md`)

**Single-question framing:** How do staff+ engineers actually
discover, install, and adopt dev tools — and what's the v3 GTM that
fits the plug-and-play + staff+ cohort?

**Sub-questions to answer:**

- **Discovery channels.** Where do staff+ engineers find new dev
  tools? HN? Pragmatic Engineer / lethain.com newsletters?
  Conference talks (StaffPlus, GOTO, QCon)? Internal Slack "have
  you tried" threads? Twitter/X? OSS GitHub trending? **Reverse-
  engineer how Cursor, Cline, Continue, Sourcegraph Cody, Augment,
  Aider, and Tabnine each got their first 1k staff+ users.**
- **Install authority and friction.** v2's research asserts staff+
  "have install authority" without a source. Test this. For each
  install path:
  - (a) local OSS install,
  - (b) hosted SaaS,
  - (c) MCP-server install in Claude/Cursor/Cline,
  - (d) VS Code extension,
  what's the realistic approval path at FAANG-class orgs? What's the
  time-to-install for a curious staff+ engineer on a Monday morning?
- **Pricing benchmarks.** Pull actual price lists for Cursor,
  Windsurf, Sourcegraph Cody, Augment Code, Tabnine, Factory.ai,
  Devin, GitHub Copilot, JetBrains AI, Replit Agent. Annotate
  "what's free / what gates pricing / what's enterprise-only."
  Construct three v3 pricing scenarios and stress-test each against
  the staff+ activity breakdown in `research/02.§2.2`.
- **AGENTS.md as distribution.** The standard is at 60k+ repos and
  20+ agents. If v3 is the best AGENTS.md author in the ecosystem,
  is *that* the wedge? Or is the PR-comment artifact? Or the VS
  Code/Cursor extension? Score each as a distribution vector.
- **Conversion path.** The vocabulary kit tells us what NOT to say.
  What positively converts staff+? A 90-second demo video? An
  interactive playground? A literate-programming case study? A
  "before/after" architecture-diff blog post? Survey successful
  staff+-targeted launches in 2024–2026 (e.g. Linear's founder
  essays, Stripe's Increment, Sourcegraph's Cody-vs-Copilot posts).
- **Plug-and-play GTM.** If v3 is "one install, all the
  capabilities", what's the install path? `npm i -g schema`?
  Homebrew? `curl | sh`? A platform-specific binary? A Cursor
  extension that bundles the MCP server? **Make a recommendation
  with rationale.**
- **Anti-pattern study.** Three dev tools that failed at staff+
  adoption in 2024–2026. Why? What would v3 not do as a result?

**Format:** same as 03 and 04.

**Hard recommendations at the end:**
- The primary install path (the answer to "what is the literal
  command a new user types?").
- The pricing posture for the first 12 months.
- The discovery-channel rank order (where v3 spends marketing time
  first).
- The first conversion artifact to build (demo video / blog post /
  playground / extension / etc.).

---

## 4. The architecture-doc brief (COMPLETED — historical reference)

> **Status:** Step 3 is done. `architecture/schema-v3.md` exists
> (3,000+ lines, 17 sections). The brief below is kept as
> historical context for how the architecture doc was scoped.
> Do NOT re-write the architecture doc from this brief.

When `research/03`, `04`, `05` existed and the user approved
them, a single agent wrote `architecture/schema-v3.md`. The
doc's requirements were:

### 4.1 · Structure

Match the shape of `inherited/schema-v2-architecture.md` (which is
the v2 spec) for the table of contents, but **re-derive every
decision from the binding research**. Don't copy v2's decisions
forward unexamined.

Minimum sections:
1. **Hard rules.** The 8 from `INHERITED-SUMMARY.md` §8 + any new
   ones the research surfaces. Each rule cites a research finding.
2. **System overview.** A mermaid diagram + the agnostic-core
   boundary + the target user precision (already locked in by
   `INHERITED-SUMMARY.md` §2).
3. **Module boundaries (the DAG).** The architecture's layers and
   the forbidden cycles. v2's layout (`obs/domain/adapters/session/
   plugin-host/actions/mcp/gui`) is a *starting point*; v3 may
   simplify (e.g. collapse `plugin-host` into `actions` if the
   plug-and-play shift removes the discovery surface).
4. **Data model.** Vocabulary (`NodeKind`, `EdgeRelation`), graph
   structure (single-repo / multi-repo), locator URIs, wire format
   versioning, JSON Schema.
5. **MCP action surface.** Re-derived from scratch. v2's 32 actions
   are a reference point in `inherited/`, not a starting position.
6. **Round-trip data flow.** One concrete polyglot example end-to-end.
7. **Session model.** Server-owned state per R1.
8. **Plug-and-play model.** The explicit shift §1 here, with
   answers to: what's bundled, what's extensible, what's excluded.
9. **Failure modes.** Including the empty-extraction case from the
   case study at `architecture/audits/`.
10. **Non-goals.** Everything v3 explicitly does not ship.
11. **v2 → v3 diff.** A closing section naming every v2 decision v3
    disagrees with, citing the research finding that triggered the
    disagreement. This is the equivalent of v2's deviations log,
    condensed.

### 4.2 · Things the doc does NOT decide

- **The v1/v2 deletion timeline.** That's a user decision after the
  v3 architecture lands. The doc states "v1 and v2 are out of scope
  for v3 work" and leaves cleanup for later.
- **The launch date.** v3 ships when it ships.
- **The exact list of bundled languages / bridges / ops.** Those are
  decided by `research/03` + `research/04`; the architecture doc
  inherits those decisions and explains the implications, but
  doesn't re-litigate them.

### 4.3 · Things the doc MUST decide

- **The language stack.** TypeScript / Node? Rust + bindings? Go?
  The wisdom-layer research's binary-size answer (`research/04`)
  constrains this; the install-path answer (`research/05`)
  constrains it further.
- **The primary install command.** `npm i -g schema`? `brew install
  schema`? `curl | sh`? Decided by `research/05`; the architecture
  doc names the winner.
- **The action surface.** The numbered list of MCP actions v3 ships
  day-one. Re-derived from research, cited line by line.
- **The plug-and-play split.** Exact answer to "what's bundled, what's
  user-extensible via `.schema/plugins/`, what's excluded entirely."
- **The empty-extraction handling.** Per the case study, the wire
  protocol distinguishes "extracting, pending" from "extraction
  done, empty". The doc names the event variant + the GUI behaviour.
- **The hard rule list.** Final and binding for all v3 code.

---

## 5. After the architecture doc (CURRENT STATE)

The architecture doc landed and was approved. Steps 5–6 are
done (scaffold + first vertical slice). We are now in **Step 7**
(successive slices toward v1.0) with **Step 8** (moat-building
slices) queued for post-launch.

The work is iterative: the architecture's own §14 (implementation
order) decides what ships first. `architecture/v1-readiness.md`
tracks the gap to v1.0. `architecture/schema-v3.md §17` tracks
the post-v1 moat roadmap. `architecture/competitive.md` tracks
the four primary competitors.

The 72-row deviations log v2 produced is the anti-pattern v3 is
designed to prevent. v3's deviations log (if one ends up existing)
should have ≤ 10 rows over its lifetime. If it has more, the
architecture doc was wrong; fix the architecture, not the build.

<!-- schema:facts:start -->
## Schema-derived architectural facts

> Auto-generated by Schema. Do not edit inside the fence.
> Last updated: 2026-05-22

**Languages:** TypeScript, Python, Go, Kotlin, Ruby, Rust
**Nodes:** 1561 · **Edges:** 8288

### Node breakdown

- utility: 1513
- service: 18
- contract: 18
- route_handler: 8
- model: 4

### Edge breakdown

- reads_field: 6237
- imports: 1538
- calls: 382
- writes_field: 111
- reads_env: 18
- registers_route: 2

### Route handlers (8)

- `getTodos` (handlers.ts)
- `addTodo` (handlers.ts)
- `list_todos` (main.py)
- `create_todo` (main.py)
- `list_users` (main.py)
- `listTodos` (main.go)
- `createTodo` (main.go)
- `healthCheck` (main.go)

### Cross-language contracts (18)

- `sql:table:todos`
- `sql:table:users`
- `proto:TodoService`
- `proto:rpc:ListTodos`
- `proto:rpc:CreateTodo`
- `proto:rpc:DeleteTodo`
- `proto:msg:ListTodosRequest`
- `proto:msg:ListTodosResponse`
- `proto:msg:CreateTodoRequest`
- `proto:msg:DeleteTodoRequest`
- `proto:msg:Todo`
- `proto:msg:Empty`
- `sql:table:workspaces`
- `sql:table:snapshots`
- `sql:table:nodes`
- `sql:table:edges`
- `sql:table:clusters`
- `sql:table:public`

### Active violations (291)

- ❌ **builtin:no-cycle**: Cycle detected: recursiveSubCluster → recursiveSubCluster
- ❌ **builtin:no-cycle**: Cycle detected: countLeafNodes → countLeafNodes
- ⚠️ **builtin:must-have-handler**: Route handler "list_todos" has no incoming edges — it may be unregistered
- ⚠️ **builtin:must-have-handler**: Route handler "create_todo" has no incoming edges — it may be unregistered
- ⚠️ **builtin:must-have-handler**: Route handler "list_users" has no incoming edges — it may be unregistered
- ⚠️ **builtin:must-have-handler**: Route handler "listTodos" has no incoming edges — it may be unregistered
- ⚠️ **builtin:must-have-handler**: Route handler "createTodo" has no incoming edges — it may be unregistered
- ⚠️ **builtin:must-have-handler**: Route handler "healthCheck" has no incoming edges — it may be unregistered
- ℹ️ **builtin:must-have-inbound**: File "eslint.config.js" has outgoing edges but no incoming — possible entry point or unreferenced module
- ℹ️ **builtin:must-have-inbound**: File "index.js" has outgoing edges but no incoming — possible entry point or unreferenced module
- ... and 281 more

<!-- schema:facts:end -->

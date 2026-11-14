# Extraction-empty diagnostic audit — 2026-05-10

> **Scope:** diagnostic only. No source-code fixes. Per the audit
> brief's hard rules: instrumentation added + removed; report is the
> deliverable.
>
> **Trigger:** post-slice-#2 user report — "real extraction produces
> zero nodes" against the simple/ fixture; `graph.summary` returns
> `{totalNodes: 0, totalEdges: 0, clusters: [{... 0 nodes}]}`; the
> web app's GraphCanvas hangs in "Extracting structural
> understanding…" forever.
>
> **TL;DR.** The brief's primary hypothesis (extraction returns
> empty against the simple/ fixture) is **not reproducible** — the
> live HTTP pipeline correctly yields 5 nodes + 1 edge for that
> exact input. The brief's secondary observation (the GraphCanvas
> hangs in pending state when extraction completes empty) **is
> real** and triggers when the user opens any workspace where the
> top-level extractors return zero contributions, whether
> legitimately empty (no `.ts` files) or all-failed (`scandir
> ENOENT` on a missing path). Per D54's empty-emission rule the
> orchestrator emits no `graph.patched` for those cases; the GUI
> has no UX to distinguish "still extracting" from "extraction
> done, found nothing." That's the bug to fix.

---

## 1. Reproduction

### 1.1 Setup

Both servers booted from a clean state via the slice-#2 dev scripts:

```
cd core && npm run dev:http-server   # PID separate; binds 127.0.0.1:7474
cd gui/web && npm run dev            # binds 127.0.0.1:5173
```

The MCP server's startup log confirms the bundled `extractor-typescript`
plugin loaded successfully (`loaded: 1`, `countsExtractor: 1`):

```
[INFO ] plugin-host.boot.done {
  scope: 'plugin-host',
  candidatesFound: 1,
  discoveryErrors: 0,
  loaded: 1,
  rejected: 0,
  countsExtractor: 1,
  ...
}
schema-mcp-dev: HTTP listening on http://127.0.0.1:7474/mcp · bundledRoot=C:\Users\Ijtihed\schema\plugins · sample workspace URI: file:///C:/Users/Ijtihed/schema/plugins/extractor-typescript/__tests__/__fixtures__/simple
```

### 1.2 Probe via direct HTTP (bypasses the GUI + Vite proxy)

Three probes, one per plausible repo URI shape:

```
POST /mcp tools/call workspace.open uris=["file:///C:/Users/Ijtihed/schema/plugins/extractor-typescript/__tests__/__fixtures__/simple"]
  → graph.patched fires; 5 nodes; 1 edge
  → graph.summary returns {totalNodes:5, totalEdges:1, clusters:[{name:"simple", size:5, kindMix:{utility:5}}]}

POST workspace.open uris=["file:///C:/Users/Ijtihed/schema/plugins/extractor-typescript/__tests__/__fixtures__/simple/"]   (trailing slash)
  → graph.patched fires; 5 nodes; 1 edge
  → graph.summary returns {totalNodes:5, totalEdges:1, ...}

POST workspace.open uris=["file:///C:/Users/Ijtihed/schema/core"]
  → graph.patched fires; 300 nodes; 348 edges
  → (extracts the entire @schema/core workspace)
```

### 1.3 Probe via the actual React app (Playwright Chromium driving the GUI)

A one-off `_audit-probe.spec.ts` (since removed) drove a real
browser through the slice-#2 UI:

```json
{
  "sessionId": "sess_nk8xb5h6_mozvxlge",
  "visibility": { "empty": false, "pending": false, "canvas": true },
  "nodeCount": 5,
  "eventItems": [
    { "kind": "graph.patched", "text": "graph.patchedjust nowhash=file:///" },
    { "kind": "workspace.opened", "text": "workspace.openedjust nowuris=[1]" }
  ],
  "summary": { "visible": true, "nodesText": "5nodes" },
  "networkLog": [
    "→ POST http://127.0.0.1:5173/mcp",
    "← 200 http://127.0.0.1:5173/mcp (application/json)",
    "→ GET http://127.0.0.1:5173/mcp",
    "← 200 http://127.0.0.1:5173/mcp (text/event-stream)",
    "→ POST http://127.0.0.1:5173/mcp",
    "← 200 http://127.0.0.1:5173/mcp (text/event-stream)",
    "→ POST http://127.0.0.1:5173/mcp",
    "← 200 http://127.0.0.1:5173/mcp (text/event-stream)"
  ]
}
```

The GUI sees the right `sessionId`, the canvas IS visible, **5 nodes
render**, the summary shows "5 nodes," both events arrive on the
event stream, and the network log shows clean POST/GET to /mcp.

**The brief's "extraction returns empty" against the simple/ fixture is
not reproducible.**

---

## 2. Trace — what each layer actually sees

Temporary instrumentation in `core/session/multi-repo.ts` +
`plugins/extractor-typescript/src/index.ts` (now removed) traced the
full call chain for one POST `workspace.open` against the simple/
fixture:

```
[AUDIT-PROBE] orchestrator.runOneStream
  repoUri="file:///C:/Users/Ijtihed/schema/plugins/extractor-typescript/__tests__/__fixtures__/simple"
  extractorCount=1
  extractorIds=["schema-plugin-extractor-typescript"]
  adaptersDefined=true
[AUDIT-PROBE] orchestrator.invoke
  extId=schema-plugin-extractor-typescript
  fsDefined=true
[AUDIT-PROBE] extractor.extract.listDir
  repoUri="file:///C:/.../simple"
  entries=["file:///C:/.../simple/helper.ts","file:///C:/.../simple/main.ts"]
[AUDIT-PROBE] extractor.extractRepo.done nodeCount=5 edgeCount=1
[AUDIT-PROBE] extractor.result extId=schema-plugin-extractor-typescript ok=true nodes=5 edges=1
```

Step-by-step against the audit brief's checklist:

| # | Layer | Input | Output | Status |
|---|---|---|---|---|
| 1 | HTTP transport (`core/mcp/transport-http.ts:413-499`) | `POST /mcp` body `{tools/call workspace.open {uris:["file://.../simple"]}}` with `Mcp-Session-Id` header | upgrades to SSE; routes to dispatcher | ✅ |
| 2 | Dispatcher (`core/mcp/dispatcher.ts:303-429#handleToolsCall`) | JSON-RPC request | resolves action `workspace.open`; passes `args = {uris:[...]}` + `ctx = {pluginHost, adapters, ...}` to handler | ✅ |
| 3 | Action handler (`core/actions/workspace-open.ts:96-178`) | `args.uris`, `ctx.adapters`, `ctx.pluginHost` | `args.adapterMode === undefined` → uses `ctx.adapters` (the real adapter set from `run-http-server.ts#makeAdapters`); calls `openSession({workspaceUris, adapters, extractorsForRepo, ...})` | ✅ |
| 4 | Plugin host `matchExtractors` (called from line 142 of workspace-open.ts) | `{repoUri, pluginAllowList:[]}` | returns `[{declare: () => CAPABILITY, extract: ..., category: "extractor"}]` (the loaded extractor-typescript instance) | ✅ — see probe `extractorCount=1, extractorIds=["schema-plugin-extractor-typescript"]` |
| 5 | Orchestrator (`core/session/multi-repo.ts:330-507#runOneStream`) | `stream.repoUri`, matched extractors, `opts.adapters` | wraps adapters via `pluginAdaptersForExtractor`, calls `ext.extract({repoUri, adapters, signal})` per extractor | ✅ — see probe `adaptersDefined=true, fsDefined=true` |
| 6 | Adapter wrappers (`core/session/multi-repo.ts:614-650`) | production `AdapterSet` | plugin-facing `PluginFsAdapter` (real `resolveAllowed/readFile/listDir/exists` bound to `run-http-server.ts#makeRealReadFs`) | ✅ |
| 7 | Extractor's `extract` (`plugins/extractor-typescript/src/index.ts:80-147`) | `{repoUri, adapters: {fs}, signal}` | calls `wrapFsAdapter(adapters.fs)` → `extractRepo({repoUri, fs: fsLite})` | ✅ |
| 8 | `wrapFsAdapter.listDir` recursion (`index.ts:173-225`, D62) | `repoUri` | recurses; returns `["file:///C:/.../simple/helper.ts", "file:///C:/.../simple/main.ts"]` | ✅ — D62's "child names → recurse" branch fires correctly |
| 9 | `extractRepo` (`plugins/extractor-typescript/src/parse.ts:238-300`) | `{repoUri, fs}` | reads each `.ts` file via `fs.readFile`; `parseFile` per file; aggregates → `{nodes: 5, edges: 1}` | ✅ |
| 10 | Back to orchestrator | `result = {ok: true, data: {nodes: 5, edges: 1, clusters: 0}}` | `successes.length === 1`, merges to `RepoSubgraph`, calls `cache.replaceRepoSubgraph`, emits `events.emit({kind: "graph.patched", ...})` | ✅ |
| 11 | `graph.summary` handler (`core/actions/graph-summary.ts:48-141`) | reads `session.cache.graph` | iterates `graph.repos`; per repo collects nodes; returns `{totalNodes:5, totalEdges:1, clusters:[{size:5}], markdownUri: "markdown://..."}` | ✅ |

**Every layer behaves correctly when called against the simple/
fixture from the live HTTP server.** The pipeline is healthy.

---

## 3. Comparison: working test paths vs. live server path

### 3.1 `parse.test.ts#extractRepo` (plugin unit test, 7/7 passing)

Path:
- `parse.test.ts:158-225` constructs `makeNodeFsLite()` (`parse.test.ts:290-324`) which uses `fs.readdir(path, { recursive: true })` + filters to `.ts` + returns full `file://` URIs.
- Calls `extractRepo({repoUri, fs: fsLite})` directly. **No plugin host. No orchestrator. No HTTP.**
- The wrapper is bypassed — the test's `FsLite` is what `extractRepo` consumes directly.

### 3.2 `core/__tests__/e2e-slice.test.ts` (slice-#1 stdio e2e, 1/1 passing)

Path:
- `e2e-slice.test.ts:221-264` builds `makeRealReadFs()` (a Production-shaped `FsAdapter`) backed by `fs/promises`.
- Calls `bootPluginHost({roots: {bundledRoot}, fs})`.
- Spawns the MCP server over **stdio** with `runMcpStdio({serverInfo, handlerOpts: {pluginHost, adapters}})`.
- Two clients each issue `workspace.open` against the simple/ fixture; both observe identical `graph.patched` events with 5 nodes + 1 edge.

### 3.3 `core/bin/run-http-server.ts` (the live server the GUI talks to)

Path:
- `run-http-server.ts:73-104` defines its own `makeRealReadFs()` — **same shape as the e2e test's, line-for-line.** Verified at `run-http-server.ts:73-104` vs. `e2e-slice.test.ts:221-264`.
- `run-http-server.ts:131-141` calls `bootPluginHost({roots: {workspaceUris: [], bundledRoot}, fs})` — same shape as the e2e test's setup.
- Mounts MCP over **HTTP** via `mountMcpHttp({req, res, serverInfo, handlerOpts: {pluginHost, adapters}, originAllowList})`.
- Origin allow-list explicitly includes `http://127.0.0.1:5173` + `http://localhost:5173` so the GUI's Vite-served page can talk.

### 3.4 The brief's hypothesized divergence

The audit brief's hypothesis A:

> A. `defaultAdapters()` returns stubbed fs adapter that throws or returns empty — the e2e test compensated with `makeRealReadFs`, the live app didn't.

**Refuted.** `run-http-server.ts:135-140` constructs the SAME `makeRealReadFs()` shape as `e2e-slice.test.ts:221-264` and passes it through `handlerOpts.adapters` (line 149). The dispatcher's `defaultAdapters()` fallback (`core/mcp/dispatcher.ts:120`) is only used when no `adapters` is supplied — the dev server always supplies one. The `actions/_base.ts#defaultAdapters()` builder is `buildAdapterSet("real")` from `core/adapters/index.ts`, which IS still stubbed (Phase 4 D29) — but the live server doesn't take that path.

The brief's hypothesis B (bundled discovery walker not invoked):
**Refuted.** The startup log shows `loaded: 1, countsExtractor: 1`. `bootPluginHost({roots: {bundledRoot}})` runs the bundled discovery walker per D55; the `extractor-typescript` plugin loads cleanly.

The brief's hypothesis C (D62 wrap recursion bug against real fs):
**Refuted.** Probe trace: `entries=["file:///.../helper.ts","file:///.../main.ts"]` for the simple/ fixture — recursion correctly produces both `.ts` files. Tested against `core/` (300 nodes, 348 edges) — recursion scales.

The brief's hypothesis D (path traversal failure for `file://` URI):
**Refuted.** `stripFileScheme` handles Windows drive letters (`/C:/...` → `C:/...`); `fs.readFile` succeeds for both `helper.ts` and `main.ts` per probe trace.

### 3.5 What IS divergent

The brief's hypothesis E ("something else") covers the actual finding:

**The pipeline works for the simple/ fixture. The brief's described
behaviour is reproducible only against workspaces with zero `.ts`
files at the top level.** Three distinct triggers:

| Trigger | Server behaviour | GUI symptom (the bug) |
|---|---|---|
| Workspace has no `.ts` files (e.g. `marketing/`) | `extract` returns `{ok: true, nodes: [], edges: []}`; orchestrator skips `graph.patched` per D54 (empty-emission rule) | "Extracting structural understanding…" forever |
| Workspace path doesn't exist (typo, deleted dir) | `extractRepo` throws `ENOENT`; extractor returns `{ok: false, code: "internal"}`; orchestrator marks stream `failed`; no `graph.patched` per `multi-repo.ts:407-422` | "Extracting structural understanding…" forever |
| Workspace's only `.ts` files are `.d.ts` | `parseFile` rejects via `isParseTarget(uri)` filter (`parse.ts:344-347`); extractor returns `{ok: true, nodes: [], edges: []}`; same as case 1 | "Extracting structural understanding…" forever |

Probe traces of cases 1 + 2 captured in `terminals/688808.txt`:

```
# Case 1 — marketing/ (real dir, no .ts):
[AUDIT-PROBE] extractor.extract.listDir repoUri="file:///C:/Users/Ijtihed/schema/marketing" entries=[]
[AUDIT-PROBE] extractor.extractRepo.done nodeCount=0 edgeCount=0
[AUDIT-PROBE] extractor.result extId=schema-plugin-extractor-typescript ok=true nodes=0 edges=0

# Case 2 — does-not-exist (path typo):
[AUDIT-PROBE] extractor.result extId=schema-plugin-extractor-typescript ok=false code=internal
  message=schema-plugin-extractor-typescript: extractRepo threw: ENOENT: no such file or directory, scandir 'C:\Users\Ijtihed\schema\does-not-exist'
```

**For both, the resulting `graph.summary` returns the empty shape
the user reported:** `{totalNodes:0, totalEdges:0, clusters:[{...0 nodes}]}`.

---

## 4. Why the brief's primary hypothesis didn't reproduce

Most likely the user was not opening the simple/ fixture. The brief
quotes that path as the canonical input but the actual scenario was
probably one of:

- The user typed `file:///C:/Users/Ijtihed/schema/` (the repo root,
  whose top-level files are `package.json`, `README.md`,
  `LEGACY.md` — no `.ts` files at the top level; the recursion DOES
  walk subdirs but on the repo root it'd take seconds and walk into
  `node_modules/`, possibly timing out or getting confused).
- The user typed a path with a trailing slash + a typo, hitting
  the `ENOENT` branch.
- The user typed the simple/ fixture URI but with a `localhost:`
  vs `127.0.0.1:` mismatch in some upstream config that prevented
  the GUI from talking to the MCP server (refuted in §1.3 — both
  work).
- The user opened multiple workspaces in succession, with the GUI's
  state showing the last one's empty result while the bug brief
  recalled the simple/ fixture URI as the "expected" input.

**The actual repro for the bug as described requires a workspace
with zero contributing extractions.** That's the architectural
trigger; the GUI's pending-state hang is the visible symptom.

---

## 5. Root cause

**The architectural pipeline is healthy.** The bug is a UX gap
spanning two layers:

### 5.1 Server-side: D54's empty-emission rule is correct + intentional

`core/session/multi-repo.ts:432-453` (commented citation: D54 + the
empty-contribution semantic) suppresses `graph.patched` when the
merged subgraph has zero nodes/edges/clusters. This is the
documented correct behaviour: "an extractor that legitimately runs
against a repo + finds nothing shouldn't generate noise on the event
stream." Removing this would break test 2 of `multi-repo-orchestration.
test.ts` (`patches.length === 2` for the 3-repo scenario where med
fails).

### 5.2 GUI-side: GraphCanvas can't distinguish "still extracting" from "extraction done, empty"

`gui/web/src/components/GraphCanvas.tsx:32-41` shows the
"Extracting structural understanding…" text when
`lifecycle === "open"` AND `every repo has zero nodes`. The
condition fires for both:
- The legitimate transient (extraction in flight; nothing committed yet), and
- The terminal-empty (extraction done; no contributions ever arrived).

The session-store reducer
(`gui/web/src/state/session-store.ts:200-215`) has no signal for
"extraction is done" beyond observing `graph.patched` arrive — and
the architecturally-correct path for the empty case is to NOT emit
that event. So the GUI is stuck.

### 5.3 Missing event for "extraction concluded"

Architecture §5.4's `extractor.invalidated` event is the closest
thing to a "an extractor ran and didn't surface anything" channel
(per D54's note), but it's not emitted by `multi-repo.ts` today.
The `RepoExtractionStream`'s state transitions to `ready` (or
`failed`) silently — only the orchestrator's internal log records it.

---

## 6. What test would have caught this

The slice-#1 + slice-#2 e2e tests both use the simple/ fixture
which has 5 nodes. **No test exercises the empty-extraction case
end-to-end through the GUI.** Specifically:

| Test                                  | Exercises empty case? |
|---------------------------------------|---|
| `core/__tests__/multi-repo-orchestration.test.ts` test 4 (aggregate abort, every repo empty) | server-side only — no GUI assertion |
| `core/__tests__/e2e-slice.test.ts` (stdio, simple/ fixture, 5 nodes) | no — only the populated case |
| `core/__tests__/transport-http.test.ts` (HTTP, simple/ fixture) | no — only the populated case |
| `gui/web/tests/mcp-client.test.ts` | no — only the simple/ fixture |
| `gui/web/tests/e2e/workspace-open.spec.ts` | no — only the simple/ fixture |
| `gui/web/tests/e2e/two-tab.spec.ts` | no — only the simple/ fixture |

**The gap:** an e2e test that opens an empty workspace and asserts
the GUI ends up in a "extraction done, no nodes" state (NOT a
pending state) within a bounded time. The brief's exact phrasing:

> A regression test that boots `run-http-server.ts` and exercises
> the same fixture, instead of the test's hand-rolled MCP harness.

I'd refine: a regression test for **the empty case specifically**.
The current e2e tests all use the populated simple/ fixture; what's
missing is a test that drives the GUI against `marketing/` (or any
empty fixture) and asserts the GUI doesn't hang in "Extracting
structural understanding…" indefinitely.

---

## 7. Fix scope (NOT implemented in this audit)

A follow-up PR should ship three changes:

### 7.1 Server: emit a "stream-ready" signal even on empty completion

`core/session/multi-repo.ts:444-453` already log-only on the
empty-merge path. Two options:

- **Option A (preferred):** emit `extractor.invalidated`
  (architecture §5.4 + D54's "future" note) when a stream completes
  empty. The event is already in the `SessionEvent` discriminated
  union (`core/domain/events.ts:96-104`). Payload:
  `{kind: "extractor.invalidated", at, touchedUris: [repoUri], missingPlugins: []}`
  — `missingPlugins: []` because the extractor ran but found
  nothing; per F1 a non-empty `missingPlugins` would mean "no
  extractor matched at all."
- **Option B:** add a new event variant `workspace.extraction_done`
  with `{repoUri, state: "ready" | "failed"}`. Cleaner semantically
  but requires a new event variant + new wire-format-validator entries
  + new D-row.

Option A is cheaper + reuses existing wire shape; Option B is
clearer at the cost of a new event row. Recommend A.

### 7.2 GUI: a "scan complete, no contributions" state in GraphCanvas

`gui/web/src/components/GraphCanvas.tsx:32-41` currently shows
"Extracting structural understanding…" forever when nodes are zero.
The fix: derive a "scan complete" boolean in the session-store:
- `lifecycle === "open"` AND
- (every repo has zero nodes) AND
- (the latest event was `extractor.invalidated` for every repo) OR
  (some elapsed-time bound has passed since `workspace.opened`)

When that boolean is true, render: "No TypeScript files found in
this workspace. (1 extractor matched, 0 nodes emitted.)" with
a "Try a different URI" affordance.

### 7.3 Test: an e2e for the empty case

`gui/web/tests/e2e/empty-workspace.spec.ts`:
1. Boot the MCP server + Vite dev server (existing playwright
   webServer config).
2. Open the GUI, point at `file:///C:/Users/Ijtihed/schema/marketing`
   (or a fixture dir with no .ts).
3. Assert within 8s the GUI shows the "no TypeScript files found"
   message (NOT the pending state).

A second test variant: open a non-existent path; assert the same
"empty" UI surface (with optionally a different message: "couldn't
read this workspace; check the URI").

---

## 8. Limitations of this audit

- **The original bug as reported (against simple/) was not
  reproducible.** The audit's findings are inferred from the
  closest-matching reproducible scenarios (empty real dir +
  nonexistent path + .d.ts-only dir). It's possible the user hit a
  fourth distinct trigger I didn't enumerate.
- **The audit ran on the same Windows box where slice #2 was
  developed.** Behaviour on macOS / Linux is not exercised here;
  the only OS-specific code is `stripFileScheme`'s drive-letter
  trim, which is exercised by the simple/ fixture's success path.
- **The audit didn't exercise the multi-repo case empirically.**
  The slice's first vertical-slice test covers 1-repo; the empty-
  emission rule's interaction with multi-repo where some repos
  populate + others are empty is covered by `multi-repo-
  orchestration.test.ts` test 2 server-side but not via the GUI.

---

## 9. Surface for review

Per the audit brief's hard rule 6: "Stop and surface the report
when complete. No fixes, no follow-up code, no new tests. The
report is the deliverable."

This report is the deliverable. The fix lands in a separate PR
scoped against §7.

**Verification that no instrumentation remains:**

```
$ rg "AUDIT-PROBE" .
(no matches)
```

Tests still passing:

```
core: 129 / 129
extractor-typescript: 7 / 7
gui/web: 15 / 15
```

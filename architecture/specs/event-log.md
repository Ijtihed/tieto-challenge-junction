# Local Event Log — spec

> **Implements:** `architecture/schema-v3.md §17.5`
>
> **Scope:** A local-only, append-only JSONL event log at
> `~/.schema/events.jsonl` that records op/plan/rule/review
> lifecycle events. No network egress. Schema Hub (separate
> repo) can optionally read this file with user consent for
> PRM training.
>
> **Motivation:** The moat research identifies a Process Reward
> Model (PRM) trained on (op, repo state, outcome) tuples as
> the highest-leverage learnable artifact. The OSS core cannot
> train the model (no telemetry, no cloud), but it can collect
> the training data locally. Starting collection at v1.1 means
> 6-12 months of data accumulation before the PRM is feasible.

---

## 1. Design constraints

- **No network egress.** The event log is a local file. No
  HTTP calls, no DNS lookups, no analytics endpoints.
- **No PII.** Events contain opaque IDs, hashes, and counts.
  No file contents, no code snippets, no user names, no
  repository URLs.
- **Append-only.** Each event is one JSON line appended to the
  file. No reads during normal operation. No in-place edits.
- **Opt-out.** A `SCHEMA_EVENT_LOG=off` environment variable
  disables all writes. Default: `on`.
- **Size-bounded.** The log rotates at 10 MB. The rotated file
  is renamed to `events.1.jsonl` (single rotation — only the
  current and one previous log are kept). Total disk: <=20 MB.
- **Non-blocking.** Event writes are fire-and-forget async
  appends. A failed write (disk full, permissions) is silently
  dropped — it must never block or crash the MCP server.

---

## 2. Event schema

Every event is a JSON object with these common fields:

```typescript
interface BaseEvent {
  v: 1;                     // schema version
  ts: string;               // ISO 8601 timestamp (UTC)
  sid: string;              // session ID (opaque)
  kind: string;             // event type discriminator
}
```

### 2.1 Op lifecycle events

```typescript
// An op was proposed (via ops.preview or plan.propose)
interface OpProposed extends BaseEvent {
  kind: "op.proposed";
  opId: string;             // bundled op ID (e.g. "addMiddleware")
  gh: string;               // graph state hash (FNV-1a of node/edge counts + kinds)
  pc: boolean;              // preconditions passed
}

// The user/agent accepted the op (plan.apply)
interface OpAccepted extends BaseEvent {
  kind: "op.accepted";
  opId: string;
}

// The user/agent rejected the op
interface OpRejected extends BaseEvent {
  kind: "op.rejected";
  opId: string;
  reason: "user" | "precondition" | "test" | "conflict";
}
```

### 2.2 Plan lifecycle events

```typescript
// A plan was proposed
interface PlanProposed extends BaseEvent {
  kind: "plan.proposed";
  planId: string;
  opCount: number;          // how many ops in the plan
  gh: string;               // graph state hash at proposal time
}

// A plan was applied
interface PlanApplied extends BaseEvent {
  kind: "plan.applied";
  planId: string;
  tp: boolean;              // tests passed (true/false/null if no tests)
  fc: number;               // files changed count
}

// A plan was restored (rolled back)
interface PlanRestored extends BaseEvent {
  kind: "plan.restored";
  planId: string;
  reason: "user" | "test-failure" | "conflict";
}

// A plan was cancelled
interface PlanCancelled extends BaseEvent {
  kind: "plan.cancelled";
  planId: string;
}
```

### 2.3 Rule events

```typescript
// Rule evaluation completed
interface RulesEvaluated extends BaseEvent {
  kind: "rules.evaluated";
  vc: number;               // violation count
  rc: number;               // rule count evaluated
  scope: "all" | "cluster" | "node";
}

// A rule was added (via rules.add)
interface RuleAdded extends BaseEvent {
  kind: "rule.added";
  ruleId: string;
  source: "builtin" | "datalog" | "custom";
}
```

### 2.4 PR review events

```typescript
// A PR review was generated
interface PrReviewed extends BaseEvent {
  kind: "pr.reviewed";
  vc: number;               // violation count
  nc: number;               // nodes changed count
  // v1.1 additions (from semantic diff spec):
  sc?: string;              // semantic classification
  is?: number;              // impact score (totalImpactedNodes)
}
```

### 2.5 Session lifecycle events

```typescript
// Workspace opened
interface WorkspaceOpened extends BaseEvent {
  kind: "workspace.opened";
  lc: number;               // language count (how many extractors ran)
  nc: number;               // node count extracted
  ec: number;               // edge count extracted
}

// Workspace closed
interface WorkspaceClosed extends BaseEvent {
  kind: "workspace.closed";
  dur: number;              // session duration in seconds
}
```

### 2.6 Extraction events

```typescript
// Extraction completed (per extractor run)
interface ExtractionCompleted extends BaseEvent {
  kind: "extract.completed";
  lang: string;             // extractor language ("typescript", "python", etc.)
  nc: number;               // nodes extracted
  ec: number;               // edges extracted
  ms: number;               // extraction time in milliseconds
}
```

---

## 3. Graph state hash

The `gh` (graph state hash) is a lightweight fingerprint of
the graph at event time. It does NOT hash file contents — only
structural properties:

```typescript
function graphStateHash(graph: MultiRepoGraph): string {
  const parts: string[] = [];
  for (const repo of graph.repos) {
    parts.push(`n:${repo.nodes.length}`);
    parts.push(`e:${repo.edges.length}`);
    const kindCounts = new Map<string, number>();
    for (const node of repo.nodes) {
      kindCounts.set(node.kind, (kindCounts.get(node.kind) ?? 0) + 1);
    }
    for (const [k, v] of [...kindCounts].sort()) {
      parts.push(`${k}:${v}`);
    }
  }
  return fnv1a(parts.join("|")).toString(16);
}
```

This is cheap (<1 ms), deterministic, and contains no PII.
It lets a future PRM correlate "the graph looked like X when
the op was proposed" without storing the graph itself.

---

## 4. Implementation

### 4.1 Location

`src/obs/event-log.ts` — placed in `obs/` because it's an
observability concern, not a domain or session concern.

### 4.2 API

```typescript
interface EventLogger {
  log(event: Omit<BaseEvent, "v" | "ts">): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

function createEventLogger(options?: {
  path?: string;       // default: ~/.schema/events.jsonl
  maxBytes?: number;   // default: 10_000_000 (10 MB)
  enabled?: boolean;   // default: !process.env.SCHEMA_EVENT_LOG === "off"
}): EventLogger;
```

### 4.3 Write strategy

- Writes use `fs.appendFile` with `{ flag: "a" }`.
- Each `log()` call serializes the event to JSON, appends a
  newline, and calls `appendFile`. The call is fire-and-forget
  (no await in the calling code path).
- A flush queue batches writes every 100 ms or 10 events
  (whichever comes first) to reduce syscall overhead.
- On `close()`, the queue is flushed and the file handle is
  released.

### 4.4 Rotation

Before each write batch, check the file size via `fs.stat`.
If >= `maxBytes`:
1. If `events.1.jsonl` exists, delete it.
2. Rename `events.jsonl` to `events.1.jsonl`.
3. Continue writing to the new (empty) `events.jsonl`.

### 4.5 Integration points

The event logger is created in `mcp/serve.ts` at server startup
and passed to the session store. Each action handler that
produces a relevant event calls `logger.log()`:

| Action | Event |
|---|---|
| `workspace.open` | `workspace.opened` |
| `workspace.close` | `workspace.closed` |
| `ops.preview` | `op.proposed` |
| `plan.propose` | `plan.proposed` + `op.proposed` per op |
| `plan.apply` | `plan.applied` + `op.accepted` per op |
| `plan.restore` | `plan.restored` + `op.rejected` per op |
| `plan.cancel` | `plan.cancelled` |
| `rules.evaluate` | `rules.evaluated` |
| `rules.add` | `rule.added` |
| `pr.review` | `pr.reviewed` |
| `extract.invalidate` | (triggers re-extraction → `extract.completed`) |

---

## 5. Privacy and trust

- The event log contains **no code**, **no file paths**, **no
  repository URLs**, **no user names**, **no API keys**.
- Session IDs are random UUIDs that cannot be correlated to
  a user without access to the local machine.
- The `gh` field is a hash of structural graph properties, not
  content.
- The log is local-only. Schema Hub reads it only if the user
  explicitly runs a `schema hub sync-events` command (not in
  v1.1 scope — Hub integration is a separate spec).
- `SCHEMA_EVENT_LOG=off` disables all writes. No hidden
  opt-out-is-hard pattern.

---

## 6. Test plan

1. **Write + read roundtrip:** Create a logger, log 5 events,
   flush, read the file, parse each line as JSON, verify fields.

2. **Rotation:** Log enough data to exceed 10 MB. Verify
   `events.1.jsonl` exists and `events.jsonl` is small.

3. **Opt-out:** Set `SCHEMA_EVENT_LOG=off`, log events, verify
   the file is not created.

4. **Non-blocking:** Log an event with a read-only directory.
   Verify the action handler does not throw.

5. **No PII:** Log all event types. Grep the output for known
   PII patterns (email, URL, file path). Assert zero matches.

6. **Schema version:** Every event has `v: 1`.

7. **Integration:** Run a full workspace.open → plan.propose →
   plan.apply → pr.review cycle. Verify the event log contains
   the expected event sequence.

---

## 7. Dependencies

No new npm dependencies. Uses `node:fs/promises` for append
and stat operations.

---

## 8. Future: Hub integration (out of scope for v1.1)

When Schema Hub is ready to train PRM v0:

1. User runs `schema hub sync-events` (or enables it in Hub
   settings).
2. CLI reads `~/.schema/events.jsonl`, filters to the
   configured time range, and uploads via HTTPS to Hub.
3. Hub aggregates across opted-in users for federated PRM
   training.
4. Differential privacy (epsilon-delta) is applied at the Hub
   side before aggregation.

This is documented here for forward-compatibility; the v1.1
scope is local-only collection.

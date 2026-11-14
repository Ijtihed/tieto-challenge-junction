// Per architecture/schema-v3.md §3.5 + §7.1
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { MultiRepoGraph } from "../domain/multi-repo.ts";
import type { Rule, Plan, PlanRun } from "../domain/types.ts";
import type { ExtractionStats } from "../domain/extraction-stats.ts";
import type { ArchetypeResult } from "../domain/archetype-detect.ts";
import type { AdapterMode } from "../adapters/index.ts";
import type { FileWatcher } from "../adapters/fs/file-watch.ts";
import { createEmptyGraph } from "../domain/multi-repo.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import { EventBus, type SessionEvent } from "./event-bus.ts";
import { AsyncMutex } from "./mutex.ts";
import { IncrementalEvaluator } from "../domain/datalog/differential.ts";

export type SessionId = string;

export interface SessionInit {
  samplerPrefs?: readonly string[];
  adapterMode?: AdapterMode;
}

export interface Session {
  readonly id: SessionId;
  readonly workspaceUris: readonly string[];
  readonly adapterMode: AdapterMode;
  readonly samplerPrefs: readonly string[];
  readonly eventBus: EventBus;
  readonly createdAt: number;
  lastActivityAt: number;
  graph: MultiRepoGraph;
  readonly closed: boolean;
  readonly rules: Rule[];
  readonly plans: Map<string, Plan>;
  readonly planRuns: Map<string, PlanRun>;
  readonly fileSnapshots: Map<string, string>;
  readonly fileHashes: Map<string, string>;
  readonly markdownResources: Map<string, string>;
  readonly mutex: AsyncMutex;
  readonly incrementalEval: IncrementalEvaluator;
  /** Latest extraction summary from this session's most recent
   *  workspace.open pass. `null` for cache-hit opens (no extraction
   *  was actually run). Surfaced by the `caching.stats` MCP action so
   *  Studio's failure banner can re-read it after the initial open. */
  latestExtractionStats: ExtractionStats | null;
  /** Archetype detection result from the most recent workspace.open
   *  per [research:25.§8] + Step 3 of the launch plan. `null` until
   *  the first open completes. Drives the L1 label per archetype
   *  (Services / Modules / Commands / …) and the L0 hero copy. */
  archetype: ArchetypeResult | null;
  /** Whether the open workspace looks like a monorepo per
   *  [research:25.§9.3] (nx.json / lerna.json / turbo.json /
   *  pnpm-workspace.yaml / Cargo workspace marker). Drives whether
   *  Studio renders the optional L-1 `Workspace` level. */
  monorepo: boolean;
  /** L1 (per research/27 §7.1) chokidar-backed file watcher.
   *  `null` until `workspace.watch_start` is called. Auto-stopped
   *  on session close. Each session owns at most one watcher. */
  fileWatcher: FileWatcher | null;
  close(): void;
}

const DEFAULT_SAMPLER_PREFS: readonly string[] = ["anthropic", "gemini", "openai", "mock"];

function canonicaliseUris(uris: readonly string[]): readonly string[] {
  return [...uris].map((u) => {
    if (u.startsWith("file://")) {
      const path = u.slice(7).replace(/\/$/, "");
      return "file://" + resolve(path);
    }
    return u;
  }).sort();
}

export function createSession(
  workspaceUris: readonly string[],
  init?: SessionInit,
): Session {
  const now = Date.now();
  const session: Session = {
    id: `sess_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    workspaceUris: canonicaliseUris(workspaceUris),
    adapterMode: init?.adapterMode ?? "real",
    samplerPrefs: init?.samplerPrefs ?? DEFAULT_SAMPLER_PREFS,
    eventBus: new EventBus(),
    createdAt: now,
    lastActivityAt: now,
    graph: createEmptyGraph(CURRENT_WIRE_VERSION),
    closed: false,
    rules: [],
    plans: new Map(),
    planRuns: new Map(),
    fileSnapshots: new Map(),
    fileHashes: new Map(),
    markdownResources: new Map(),
    mutex: new AsyncMutex(),
    incrementalEval: new IncrementalEvaluator(),
    latestExtractionStats: null,
    archetype: null,
    monorepo: false,
    fileWatcher: null,
    close() {
      (this as { closed: boolean }).closed = true;
      // Best-effort: stop the L1 watcher on close. Errors are
      // swallowed because the watcher's resources are owned by
      // the OS and closing a watcher that's already torn down
      // is a no-op.
      const w = this.fileWatcher;
      if (w) {
        // Fire-and-forget: stop() is idempotent + the session
        // is closing so the user doesn't need to await.
        w.stop().catch(() => { /* swallowed */ });
        this.fileWatcher = null;
      }
      this.eventBus.emit({ kind: "workspace.closed", at: Date.now() });
    },
  };
  return session;
}

// Per `architecture/v1-launch-plan.md` Step 5a + research/27
// (Caching & Differential, §5.5, §7.1, §13.2).
//
// The L1 layer of Schema's 5-layer caching pipeline. Watches the
// workspace for file changes, debounces 100 ms per file path,
// coalesces branch-switch bursts (>10 events in <50 ms) into a
// single batched `files.changed` event, and emits into the
// session's event bus. The existing SSE channel at
// `GET /mcp/events/:sessionId` (transport-http.ts §178-212) routes
// the events to any subscribed MCP client — no new transport.
//
// **Filter integration.** Reuses Step 4's `ComposedFilter` so the
// watcher doesn't fire on `node_modules/*.js` or `.gitignore`d
// paths. This is critical: a `git pull` that touches thousands of
// vendored files would otherwise trigger thousands of useless
// `files.changed` events.
//
// **Editor-event forwarding.** Some atomic-write editors (vim
// with `backupcopy=no`, JetBrains "safe write") cause chokidar to
// see a delete-then-create rather than a change. MCP clients
// (Cursor, Claude Code) can call `forwardEditorEvent(uri, kind)`
// to inject high-fidelity events directly. The
// `--canUseWatchEvents` pattern from TS 5.4+ / chokidar 4+ docs.
//
// **Branch-switch coalescing.** Per research/27 §13.2: a `git
// switch` to a feature branch can fire 10+ chokidar events in
// <50 ms. Without coalescing, L2-L5 would re-run 10× redundantly.
// We detect bursts (>10 events / 50 ms window) and emit one
// batched event with `touchedUris[]` instead of 10 individual
// events.
//
// **Per-session lifecycle.** Each session owns at most one
// watcher. `start()` is idempotent (no-op if already watching).
// `stop()` is idempotent (no-op if not watching). The watcher
// is auto-stopped on session close.

import { FSWatcher, watch } from "chokidar";
import { relative, sep } from "node:path";
import type { ComposedFilter } from "../../domain/gitignore-filter.ts";
import type { EventBus, SessionEvent } from "../../session/event-bus.ts";

/** The kind of file-change a watcher emits. Surfaced on the
 *  `files.changed` event so downstream layers can distinguish
 *  rename from edit from delete. */
export type FileChangeKind = "add" | "change" | "unlink";

/** The 4-member canonical set per §0.6.2. The studio store will
 *  import this directly so wire + engine + client agree. */
export const FILE_CHANGE_KINDS: readonly FileChangeKind[] = [
  "add",
  "change",
  "unlink",
] as const;

/** One file-change record in a batched `files.changed` event. */
export interface FileChange {
  /** The file path as a `file://` URI. */
  readonly uri: string;
  readonly kind: FileChangeKind;
  /** Origin: `chokidar` (fs watch), `editor` (MCP client
   *  forwarded), or `coalesce` (synthesised by the burst
   *  coalescer combining multiple events into one). */
  readonly origin: "chokidar" | "editor" | "coalesce";
}

/** Stats the watcher tracks for telemetry / `incremental.stats`
 *  G8 + G10 reporting. Counts since the watcher last started. */
export interface FileWatchStats {
  /** Raw events from chokidar before debounce / filter. */
  rawEvents: number;
  /** Events dropped by the composed filter (gitignore / always). */
  filteredOut: number;
  /** Events suppressed because identical to the prior event
   *  (chokidar sometimes emits `change` twice on macOS APFS). */
  duplicatesSuppressed: number;
  /** `files.changed` events actually emitted to the event bus. */
  eventsEmitted: number;
  /** Number of bursts coalesced (>10 events in <50 ms collapsed
   *  into a single batched event). */
  burstsCoalesced: number;
  /** Number of editor-forwarded events received. */
  editorForwarded: number;
  /** Timestamp the watcher started (ms epoch). 0 if never started. */
  startedAt: number;
  /** Whether the watcher is currently active. */
  watching: boolean;
}

/** Options accepted by `createFileWatcher`. Defaults map to the
 *  research/27 §7.1 prescriptions. */
export interface FileWatcherOptions {
  /** Per-path debounce in ms. Research §7.1 says 100 ms. */
  debounceMs?: number;
  /** Burst window: if >`burstThreshold` events arrive within
   *  `burstWindowMs`, coalesce them. Research §13.2 says 10
   *  events / 50 ms for the branch-switch case. */
  burstWindowMs?: number;
  burstThreshold?: number;
  /** Optional filter (Step 4 `ComposedFilter`) applied before
   *  emit. If omitted, every event passes the filter stage. */
  filter?: ComposedFilter;
  /** Used in tests + the editor-event path to keep tests
   *  deterministic. */
  now?: () => number;
}

/** The watcher handle returned by `createFileWatcher`. */
export interface FileWatcher {
  /** Start watching the workspace root. Idempotent: re-calling
   *  with the same root is a no-op. */
  start(workspaceRoot: string): Promise<void>;
  /** Stop watching + close the chokidar handle. Idempotent.
   *  Always safe to call (no-op when not watching). */
  stop(): Promise<void>;
  /** Forward an editor-originated change event. Bypasses chokidar
   *  but goes through the same debounce + coalesce + filter
   *  pipeline. */
  forwardEditorEvent(uri: string, kind: FileChangeKind): void;
  /** Snapshot of the watcher's counters. */
  stats(): FileWatchStats;
}

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_BURST_WINDOW_MS = 50;
const DEFAULT_BURST_THRESHOLD = 10;

/** Build a file watcher bound to a session's event bus. The
 *  watcher emits `{ kind: "files.changed", changes: FileChange[], at: number }`
 *  events into the bus; the existing SSE route delivers them to
 *  subscribed MCP clients. */
export function createFileWatcher(
  bus: EventBus,
  options: FileWatcherOptions = {},
): FileWatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const burstWindowMs = options.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS;
  const burstThreshold = options.burstThreshold ?? DEFAULT_BURST_THRESHOLD;
  const filter = options.filter;
  const now = options.now ?? Date.now;

  // Per-path debounce: collapses chokidar's repeated `change`
  // events for the same file (some editors fire 3-5×) into one.
  const pendingByUri = new Map<string, {
    kind: FileChangeKind;
    origin: FileChange["origin"];
    timer: NodeJS.Timeout;
  }>();

  // Burst-window ring buffer: timestamps of the last
  // `burstThreshold` emit attempts. When the oldest of those N
  // is within `burstWindowMs` of now, we're in a burst.
  const recentEmits: number[] = [];

  // While in a burst, collect changes and emit one batched event
  // after the burst settles.
  let burstBuffer: FileChange[] | null = null;
  let burstSettleTimer: NodeJS.Timeout | null = null;

  let watcher: FSWatcher | null = null;
  let currentRoot: string | null = null;
  const stats: FileWatchStats = {
    rawEvents: 0,
    filteredOut: 0,
    duplicatesSuppressed: 0,
    eventsEmitted: 0,
    burstsCoalesced: 0,
    editorForwarded: 0,
    startedAt: 0,
    watching: false,
  };

  // Track the last emitted change per uri to suppress duplicates
  // (macOS APFS can fire `change` events for atomic timestamp
  // touches that don't actually change file content).
  const lastEmittedByUri = new Map<string, { kind: FileChangeKind; at: number }>();
  const DUP_WINDOW_MS = 25;

  function emit(change: FileChange): void {
    const t = now();

    // Duplicate suppression: identical kind on same uri within
    // 25 ms is collapsed.
    const last = lastEmittedByUri.get(change.uri);
    if (last && last.kind === change.kind && t - last.at < DUP_WINDOW_MS) {
      stats.duplicatesSuppressed++;
      return;
    }
    lastEmittedByUri.set(change.uri, { kind: change.kind, at: t });

    // Burst detection: if we've emitted >= burstThreshold in the
    // last burstWindowMs, start coalescing into a batched event.
    recentEmits.push(t);
    while (recentEmits.length > burstThreshold) recentEmits.shift();
    const burst =
      recentEmits.length >= burstThreshold &&
      t - recentEmits[0]! < burstWindowMs;

    if (burst) {
      if (!burstBuffer) {
        burstBuffer = [];
        stats.burstsCoalesced++;
      }
      burstBuffer.push({ ...change, origin: "coalesce" });
      // Reset the settle timer: the burst ends when no event has
      // arrived for `burstWindowMs`.
      if (burstSettleTimer) clearTimeout(burstSettleTimer);
      burstSettleTimer = setTimeout(() => {
        if (burstBuffer) {
          const batched = burstBuffer;
          burstBuffer = null;
          burstSettleTimer = null;
          bus.emit({
            kind: "files.changed",
            changes: batched,
            at: now(),
            coalesced: true,
          } satisfies SessionEvent);
          stats.eventsEmitted++;
        }
      }, burstWindowMs);
      return;
    }

    // Non-burst path: emit a single-change event immediately.
    bus.emit({
      kind: "files.changed",
      changes: [change],
      at: t,
      coalesced: false,
    } satisfies SessionEvent);
    stats.eventsEmitted++;
  }

  function ingest(uri: string, kind: FileChangeKind, origin: FileChange["origin"]): void {
    if (origin === "chokidar") stats.rawEvents++;
    if (origin === "editor") stats.editorForwarded++;

    // Filter: drop events for files that are gitignored or
    // always-ignored. The watcher itself is also configured to
    // not watch ignored paths, but the filter here is the
    // belt-and-suspenders second layer (catches editor-forwarded
    // events that bypass chokidar's path-list).
    if (filter && currentRoot) {
      const rel = relativeFromRoot(currentRoot, uri);
      if (rel !== null) {
        const outcome = filter.check(rel);
        if (!outcome.allowed) {
          stats.filteredOut++;
          return;
        }
      }
    }

    // Kind precedence: unlink > add > change. A delete during the
    // debounce window should win (we don't want to emit a `change`
    // event for a file that's gone). An add during the same
    // window means "create-then-edit", merge as add. If an event
    // for this uri is already pending, the new entry merges
    // kinds via `pickKind`; otherwise the incoming kind is used.
    const existing = pendingByUri.get(uri);
    let effectiveKind = kind;
    let effectiveOrigin = origin;
    if (existing) {
      clearTimeout(existing.timer);
      effectiveKind = pickKind(existing.kind, kind);
      // Preserve the existing origin if it was editor-forwarded
      // (an editor signal is a stronger source-of-truth than a
      // later chokidar event that may be a false-positive).
      effectiveOrigin = existing.origin === "editor" ? "editor" : origin;
    }

    const timer = setTimeout(() => {
      const entry = pendingByUri.get(uri);
      if (!entry) return;
      pendingByUri.delete(uri);
      emit({ uri, kind: entry.kind, origin: entry.origin });
    }, debounceMs);

    pendingByUri.set(uri, { kind: effectiveKind, origin: effectiveOrigin, timer });
  }

  return {
    async start(workspaceRoot: string): Promise<void> {
      if (watcher && currentRoot === workspaceRoot) return; // idempotent
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
      currentRoot = workspaceRoot;
      stats.startedAt = now();
      stats.watching = true;

      // Per research/27 §10.1 + chokidar 5 docs: persistent
      // recursive watch with ignoreInitial=true so we don't fire
      // events for every existing file on start.
      watcher = watch(workspaceRoot, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        ignorePermissionErrors: true,
        atomic: true, // dedupe vim/JetBrains atomic-rename
        // Ignore at the chokidar layer too — the filter inside
        // ingest() is the second pass, but pre-filtering here
        // avoids descending into node_modules entirely.
        ignored: (path: string): boolean => {
          if (!currentRoot) return false;
          const rel = relativeFromRoot(currentRoot, path);
          if (rel === null) return false;
          if (rel === "") return false;
          if (!filter) return false;
          return !filter.check(rel).allowed;
        },
      });

      watcher.on("add", (path: string) => ingest(toFileUri(path), "add", "chokidar"));
      watcher.on("change", (path: string) => ingest(toFileUri(path), "change", "chokidar"));
      watcher.on("unlink", (path: string) => ingest(toFileUri(path), "unlink", "chokidar"));
      // Directory-level events are intentionally ignored — Step
      // 5b's extractor invalidation works at file granularity.
    },

    async stop(): Promise<void> {
      if (!watcher) {
        stats.watching = false;
        return;
      }
      for (const [, entry] of pendingByUri) clearTimeout(entry.timer);
      pendingByUri.clear();
      if (burstSettleTimer) {
        clearTimeout(burstSettleTimer);
        burstSettleTimer = null;
      }
      burstBuffer = null;
      await watcher.close();
      // chokidar v5 has a known issue (paulmillr/chokidar#855, #1452)
      // where ~2 internal Sockets / FSEvents threads on macOS don't
      // release for ~100 ms after `close()`. The session normally
      // outlives this delay (production) but tests need explicit
      // teardown. The recommended workaround per the chokidar
      // tracker is `--test-force-exit` (Node 22+) or
      // `process.exit(0)` after assertions. Production code keeps
      // the watcher referenced for the session's lifetime so this
      // is not observable.
      watcher = null;
      currentRoot = null;
      stats.watching = false;
    },

    forwardEditorEvent(uri: string, kind: FileChangeKind): void {
      ingest(uri, kind, "editor");
    },

    stats(): FileWatchStats {
      return { ...stats };
    },
  };
}

function pickKind(a: FileChangeKind, b: FileChangeKind): FileChangeKind {
  if (a === "unlink" || b === "unlink") return "unlink";
  if (a === "add" || b === "add") return "add";
  return "change";
}

function toFileUri(absPath: string): string {
  if (sep === "\\") {
    return "file:///" + absPath.replace(/\\/g, "/");
  }
  return "file://" + absPath;
}

function relativeFromRoot(root: string, absPathOrUri: string): string | null {
  const abs = absPathOrUri.startsWith("file://")
    ? absPathOrUri.replace(/^file:\/\//, "")
    : absPathOrUri;
  const rel = relative(root, abs);
  if (rel.startsWith("..")) return null;
  return rel;
}

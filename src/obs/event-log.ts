// Per architecture/specs/event-log.md — local-only append-only JSONL event log.
// Placed in obs/ because it's an observability concern.
// Node std lib only — no external deps.

import { appendFile, stat, rename, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { MultiRepoGraph } from "../domain/multi-repo.ts";

// ── Event types ──────────────────────────────────────────────

export interface BaseEvent {
  readonly v: 1;
  readonly ts: string;
  readonly sid: string;
  readonly kind: string;
}

export interface OpProposed extends BaseEvent {
  readonly kind: "op.proposed";
  readonly opId: string;
  readonly gh: string;
  readonly pc: boolean;
}

export interface OpAccepted extends BaseEvent {
  readonly kind: "op.accepted";
  readonly opId: string;
}

export interface OpRejected extends BaseEvent {
  readonly kind: "op.rejected";
  readonly opId: string;
  readonly reason: "user" | "precondition" | "test" | "conflict";
}

export interface PlanProposed extends BaseEvent {
  readonly kind: "plan.proposed";
  readonly planId: string;
  readonly opCount: number;
  readonly gh: string;
}

export interface PlanApplied extends BaseEvent {
  readonly kind: "plan.applied";
  readonly planId: string;
  readonly tp: boolean;
  readonly fc: number;
}

export interface PlanRestored extends BaseEvent {
  readonly kind: "plan.restored";
  readonly planId: string;
  readonly reason: "user" | "test-failure" | "conflict";
}

export interface PlanCancelled extends BaseEvent {
  readonly kind: "plan.cancelled";
  readonly planId: string;
}

export interface RulesEvaluated extends BaseEvent {
  readonly kind: "rules.evaluated";
  readonly vc: number;
  readonly rc: number;
  readonly scope: "all" | "cluster" | "node";
}

export interface RuleAdded extends BaseEvent {
  readonly kind: "rule.added";
  readonly ruleId: string;
  readonly source: "builtin" | "datalog" | "custom";
}

export interface PrReviewed extends BaseEvent {
  readonly kind: "pr.reviewed";
  readonly vc: number;
  readonly nc: number;
  readonly sc?: string;
  readonly is?: number;
}

export interface WorkspaceOpened extends BaseEvent {
  readonly kind: "workspace.opened";
  readonly lc: number;
  readonly nc: number;
  readonly ec: number;
}

export interface WorkspaceClosed extends BaseEvent {
  readonly kind: "workspace.closed";
  readonly dur: number;
}

export interface ExtractionCompleted extends BaseEvent {
  readonly kind: "extract.completed";
  readonly lang: string;
  readonly nc: number;
  readonly ec: number;
  readonly ms: number;
}

export type SchemaEvent =
  | OpProposed
  | OpAccepted
  | OpRejected
  | PlanProposed
  | PlanApplied
  | PlanRestored
  | PlanCancelled
  | RulesEvaluated
  | RuleAdded
  | PrReviewed
  | WorkspaceOpened
  | WorkspaceClosed
  | ExtractionCompleted;

/** The fields callers supply — v and ts are added automatically. */
export type EventInput = Omit<SchemaEvent, "v" | "ts">;

// ── FNV-1a (32-bit) ─────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

// ── Graph state hash ────────────────────────────────────────

export function graphStateHash(graph: MultiRepoGraph): string {
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

// ── EventLogger ─────────────────────────────────────────────

export interface EventLogger {
  log(event: EventInput): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface EventLoggerOptions {
  path?: string;
  maxBytes?: number;
  enabled?: boolean;
}

const DEFAULT_PATH = join(homedir(), ".schema", "events.jsonl");
const DEFAULT_MAX_BYTES = 10_000_000; // 10 MB
const FLUSH_INTERVAL_MS = 100;
const FLUSH_BATCH_SIZE = 10;

class EventLoggerImpl implements EventLogger {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly enabled: boolean;
  private buffer: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushInProgress: Promise<void> | null = null;
  private closed = false;

  constructor(options?: EventLoggerOptions) {
    this.filePath = options?.path ?? DEFAULT_PATH;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.enabled =
      options?.enabled !== undefined
        ? options.enabled
        : process.env["SCHEMA_EVENT_LOG"] !== "off";

    if (this.enabled) {
      this.timer = setInterval(() => {
        void this.flush();
      }, FLUSH_INTERVAL_MS);
      if (this.timer.unref) this.timer.unref();
    }
  }

  log(event: EventInput): void {
    if (!this.enabled || this.closed) return;
    const full = { v: 1 as const, ts: new Date().toISOString(), ...event };
    this.buffer.push(JSON.stringify(full));
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled || this.buffer.length === 0) return;
    if (this.flushInProgress) {
      await this.flushInProgress;
      return;
    }
    this.flushInProgress = this._doFlush();
    try {
      await this.flushInProgress;
    } finally {
      this.flushInProgress = null;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private async _doFlush(): Promise<void> {
    const lines = this.buffer;
    this.buffer = [];
    if (lines.length === 0) return;

    try {
      await this._ensureDir();
      await this._rotateIfNeeded();
      await appendFile(this.filePath, lines.join("\n") + "\n", "utf-8");
    } catch {
      // Non-blocking: silently drop on any I/O failure.
    }
  }

  private async _ensureDir(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
  }

  private async _rotateIfNeeded(): Promise<void> {
    try {
      const s = await stat(this.filePath);
      if (s.size < this.maxBytes) return;
    } catch {
      return; // File doesn't exist yet — no rotation needed.
    }

    const rotated = this.filePath.replace(/\.jsonl$/, ".1.jsonl");
    try {
      await unlink(rotated);
    } catch {
      // .1 file may not exist — that's fine.
    }
    try {
      await rename(this.filePath, rotated);
    } catch {
      // Race condition or permission issue — skip rotation.
    }
  }
}

/** No-op logger returned when event logging is disabled. */
class NoopEventLogger implements EventLogger {
  log(): void {}
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

export function createEventLogger(options?: EventLoggerOptions): EventLogger {
  const enabled =
    options?.enabled !== undefined
      ? options.enabled
      : process.env["SCHEMA_EVENT_LOG"] !== "off";
  if (!enabled) return new NoopEventLogger();
  return new EventLoggerImpl(options);
}

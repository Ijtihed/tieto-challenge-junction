// Per architecture/schema-v3.md §3.5 + §5.5
// Fan-out event bus with bounded replay log (v2 D61, 256-event cap).

export interface SessionEvent {
  readonly kind: string;
  readonly at: number;
  readonly [key: string]: unknown;
}

type Listener = (event: SessionEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();
  private readonly replayLog: SessionEvent[] = [];
  private readonly maxReplay: number;

  constructor(maxReplay = 256) {
    this.maxReplay = maxReplay;
  }

  emit(event: SessionEvent): void {
    this.replayLog.push(event);
    if (this.replayLog.length > this.maxReplay) {
      this.replayLog.shift();
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* isolate: one listener must not break others */ }
    }
  }

  subscribe(listener: Listener): () => void {
    for (const past of this.replayLog) {
      listener(past);
    }
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  get replaySize(): number {
    return this.replayLog.length;
  }
}

---
id: "cqrs-snapshotting"
paradigm: cqrs
title: "Snapshotting Strategies"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/snapshotting"
---

# Snapshotting Strategies

In an event-sourced system, loading an aggregate means replaying its entire event stream. For aggregates with thousands of events, this becomes a performance bottleneck. Snapshotting periodically captures the aggregate's state so that loading starts from the snapshot and replays only subsequent events.

## The Snapshot Contract

A snapshot is a serialized representation of an aggregate's state at a specific event version. The snapshot store is separate from the event store — snapshots are optimization artifacts, not source-of-truth data.

```typescript
interface Snapshot<S> {
  aggregateId: string;
  version: number;
  state: S;
  createdAt: string;
}

interface SnapshotStore {
  save<S>(snapshot: Snapshot<S>): Promise<void>;
  load<S>(aggregateId: string): Promise<Snapshot<S> | null>;
}
```

Loading with snapshots:

```typescript
async function loadWithSnapshot<T extends AggregateRoot>(
  id: string,
  factory: () => T,
  eventStore: EventStore,
  snapshotStore: SnapshotStore,
): Promise<T> {
  const snapshot = await snapshotStore.load<T>(id);
  const aggregate = factory();

  if (snapshot) {
    aggregate.restoreFromSnapshot(snapshot.state);
    aggregate.version = snapshot.version;
  }

  for await (const event of eventStore.read(id, snapshot?.version ?? 0)) {
    aggregate.apply(event);
  }

  return aggregate;
}
```

If the snapshot exists, the aggregate skips replaying all events before the snapshot version. If the snapshot is absent or corrupted, the system falls back to full replay — snapshots are never required for correctness.

## When to Snapshot

**Event-count threshold:** snapshot every N events (commonly 50–500). Simple, predictable, and works well for most aggregates.

**Time-based:** snapshot if more than T seconds have elapsed since the last snapshot. Useful for aggregates with bursty event patterns.

**Hybrid:** snapshot when either the event count or time threshold is exceeded. This prevents both slow-trickle aggregates from never snapshotting and bursty aggregates from snapshotting too frequently.

**On-demand:** snapshot during maintenance windows or as a background job. Decouples snapshot creation from the command-handling path, eliminating any latency impact on writes.

```typescript
function shouldSnapshot(aggregate: AggregateRoot, lastSnapshotVersion: number): boolean {
  const eventsSinceSnapshot = aggregate.version - lastSnapshotVersion;
  return eventsSinceSnapshot >= 100;
}
```

## Snapshot Store Implementations

**Same database, separate table.** The snapshot lives alongside events in PostgreSQL or similar. Simple operationally; the snapshot read adds one indexed query. Most teams start here.

**Dedicated key-value store.** Redis or DynamoDB for sub-millisecond snapshot reads. Appropriate when aggregate load latency is critical and the snapshot payload is small (< 1 MB).

**Blob storage.** S3 or GCS for large snapshots. Appropriate for aggregates whose state is megabytes (e.g., a document-editing aggregate with full document state). Higher latency, but storage is cheap and durable.

## Snapshot Versioning

Snapshots are tightly coupled to the aggregate's internal state shape. When the aggregate's state structure changes (new fields, renamed properties), old snapshots become unreadable. Two strategies:

**Versioned snapshots** carry a schema version. A migration function transforms old snapshot shapes to the current one at load time — analogous to event upcasting.

**Disposable snapshots** treat old-format snapshots as invalid. The loader discards them and falls back to full replay. Simpler but incurs a one-time replay cost per aggregate after schema changes.

In practice, disposable snapshots are sufficient for most systems. The replay fallback means correctness is guaranteed regardless of snapshot validity. Only invest in snapshot migrations if aggregate replay times are measured in seconds and the schema changes frequently.

## Anti-Patterns

**Snapshotting too early.** If your longest event stream is 200 events and replay takes 5ms, snapshots add complexity for no gain. Profile before optimizing.

**Snapshotting on every event.** This turns the snapshot store into a mutable state store, negating the benefits of event sourcing. The snapshot is write-amplified for negligible read improvement.

**Trusting snapshots for correctness.** A corrupted or outdated snapshot should never cause incorrect behavior. The event stream is the source of truth; the snapshot is a cache. Design the loading path so that snapshot absence or invalidity triggers full replay, never an error.

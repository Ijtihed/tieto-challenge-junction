---
id: "cqrs-projection-patterns"
paradigm: cqrs
title: "Projection Patterns"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/projection-patterns"
---

# Projection Patterns

A projection transforms an event stream into a read model. The projection subscribes to events, applies a fold function, and writes the result to a read-optimized store. The choice of projection pattern determines latency, consistency guarantees, and operational complexity.

## Inline Projections

The simplest pattern: the projection runs in the same transaction as the event append. The write side persists events and updates the read model atomically.

```typescript
async function handlePlaceOrder(cmd: PlaceOrder, store: EventStore, db: ReadDb) {
  const events = order.place(cmd);
  await store.append(order.id, events, order.version);
  await db.upsert('order_summary', {
    id: order.id,
    status: 'placed',
    total: cmd.total,
    placedAt: events[0].timestamp,
  });
}
```

Tradeoff: strong consistency (read model is never stale), but it couples the write path to read-model schema changes and limits read-side technology choices. Any read model failure blocks writes.

## Asynchronous Projections

The projection subscribes to a stream (via polling, push, or a message bus) and processes events independently of the write path. This is the dominant pattern in production systems.

Tradeoff: eventual consistency — there is a window where the read model lags behind the write model. The window is typically milliseconds under normal load but can grow under backpressure. The projection must be idempotent since at-least-once delivery is the realistic guarantee.

## Catch-Up Subscriptions

A catch-up subscription starts from a checkpoint (the last processed event position) and reads forward through the store. On reaching the head, it switches to live mode. This is how EventStoreDB's persistent subscriptions and many Kafka consumer groups work internally.

```typescript
async function runProjection(store: EventStore, projection: Projection) {
  let checkpoint = await projection.loadCheckpoint();
  for await (const event of store.readAll({ from: checkpoint })) {
    await projection.apply(event);
    await projection.saveCheckpoint(event.position);
  }
}
```

The checkpoint is the projection's durable cursor. Storing it in the same transaction as the read model update gives exactly-once processing semantics without distributed transactions.

## Live Subscriptions

A live subscription receives only new events from the moment it connects. It does not replay history. Useful for notifications, webhooks, or real-time dashboards where historical state is irrelevant. Risky as the sole projection strategy — any missed events (network partition, subscriber downtime) create permanent gaps.

## Snapshot Projections

When replaying a long event stream is too slow, the projection periodically persists a snapshot of its accumulated state. On restart, it loads the snapshot and replays only events after the snapshot position.

```typescript
interface SnapshotProjection<S> {
  snapshot: S;
  position: number;
  apply(event: DomainEvent): S;
  shouldSnapshot(eventsSinceLastSnapshot: number): boolean;
}
```

Snapshot frequency is a tuning parameter: too frequent increases write amplification, too rare increases recovery time. A common heuristic is every N events (100–1000) or every T seconds, whichever comes first.

## Rebuilding Projections

A major advantage of event sourcing is that projections are disposable. If the read model schema changes or a bug corrupted data, delete the read model and replay the entire event stream. This requires the event store to retain all events indefinitely (or at least within the retention policy). Blue-green projection rebuilds — running the new projection alongside the old one, then switching traffic — minimize downtime during schema migrations.

## Choosing a Pattern

Use inline projections for consistency-critical read models in low-throughput domains. Use async catch-up projections as the default for production systems. Reserve live-only subscriptions for ephemeral consumers. Add snapshotting when replay time exceeds your recovery-time objective.

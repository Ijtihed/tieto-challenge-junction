---
id: "cqrs-event-store-implementation"
paradigm: cqrs
title: "Event Store Implementation"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/event-store-implementation"
---

# Event Store Implementation

An event store is an append-only database that records domain events as the system of record. It differs from a message broker (which routes messages) and from a traditional database (which stores current state). The event store provides two core operations: append events to a stream and read events from a stream.

## Append-Only Semantics

Events are immutable facts. The store never updates or deletes event records in normal operation. This simplifies consistency reasoning: readers never see partially written events, and the store is naturally auditable.

```sql
CREATE TABLE events (
  global_position  BIGSERIAL PRIMARY KEY,
  stream_id        TEXT NOT NULL,
  stream_position  INT NOT NULL,
  event_type       TEXT NOT NULL,
  data             JSONB NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stream_id, stream_position)
);

CREATE INDEX idx_events_stream ON events (stream_id, stream_position);
```

The `global_position` is a monotonically increasing sequence across all streams — essential for catch-up subscriptions that process events in total order. The `stream_position` provides per-stream ordering for optimistic concurrency.

## Optimistic Concurrency Control

When appending events, the writer specifies the expected stream position (the version it loaded). If another writer has appended since then, the unique constraint on `(stream_id, stream_position)` raises a conflict.

```typescript
async function append(
  db: Pool, streamId: string, events: DomainEvent[], expectedVersion: number
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < events.length; i++) {
      await client.query(
        `INSERT INTO events (stream_id, stream_position, event_type, data, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [streamId, expectedVersion + i + 1, events[i].type, events[i].data, events[i].metadata]
      );
    }
    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') throw new ConcurrencyConflict(streamId, expectedVersion);
    throw err;
  } finally {
    client.release();
  }
}
```

This is the same concurrency model used by EventStoreDB, Marten, and most production event store implementations. No distributed locks, no pessimistic locking — just an append with a version guard.

## PostgreSQL as Event Store

PostgreSQL is the pragmatic choice for teams that don't want to operate a dedicated event store. JSONB columns provide schema flexibility; the WAL provides durability; `LISTEN/NOTIFY` or logical replication enables change-data-capture for projections.

Strengths: operational familiarity, transactional outbox pattern (events + read model updates in one transaction), mature tooling. Weaknesses: global ordering via `BIGSERIAL` can become a contention point at very high write volumes (>50k events/sec); no built-in subscription model.

## EventStoreDB

A purpose-built event database. Native support for streams, projections, persistent subscriptions, and competing consumers. The `$all` stream provides total ordering; category streams (`$ce-Order`) aggregate events by stream prefix.

Strengths: built-in subscription engine, server-side projections (JavaScript), native support for `$by_category` and `$by_event_type` system projections. Weaknesses: smaller operational community than PostgreSQL, another database to operate, limited query capabilities outside stream reads.

## Kafka and Message Brokers

Kafka is not an event store — it's an event transport. Key differences: Kafka topics have retention policies (events may be deleted), Kafka doesn't support per-aggregate optimistic concurrency, and reading a single aggregate's events requires filtering a partition. Kafka excels at distributing events to multiple consumers after the event store has recorded them.

The pattern: write to the event store, then publish to Kafka (via outbox pattern or CDC) for downstream consumers. Don't use Kafka as the source of truth for event-sourced aggregates.

## Outbox Pattern

To ensure events are both stored and published reliably without distributed transactions:

```sql
BEGIN;
  INSERT INTO events (...) VALUES (...);
  INSERT INTO outbox (event_id, payload, published) VALUES (..., false);
COMMIT;
```

A background process polls the outbox, publishes unpublished events to the message broker, and marks them as published. This guarantees at-least-once delivery without 2PC between the database and the broker. Combine with idempotent consumers for exactly-once processing semantics.

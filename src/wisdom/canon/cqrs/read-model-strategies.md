---
id: "cqrs-read-model-strategies"
paradigm: cqrs
title: "Read Model Strategies"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/read-model-strategies"
---

# Read Model Strategies

In CQRS, read models are purpose-built data structures optimized for specific query patterns. Unlike write-side aggregates that enforce invariants, read models exist solely to serve queries fast. They are derived from domain events and can be rebuilt at any time from the event store.

## Materialized Views

The core read model pattern: consume events and maintain a denormalized view that directly serves an API endpoint or UI component. One event may update multiple read models; one read model may consume events from multiple aggregates.

```typescript
class OrderDashboardProjection {
  async apply(event: DomainEvent, db: ReadDb): Promise<void> {
    switch (event.type) {
      case 'OrderPlaced':
        await db.insert('order_dashboard', {
          orderId: event.orderId,
          customerName: event.customerName,
          total: event.total,
          status: 'placed',
          itemCount: event.items.length,
          placedAt: event.timestamp,
        });
        break;
      case 'OrderShipped':
        await db.update('order_dashboard', event.orderId, {
          status: 'shipped',
          shippedAt: event.timestamp,
          trackingId: event.trackingId,
        });
        break;
      case 'OrderCancelled':
        await db.update('order_dashboard', event.orderId, {
          status: 'cancelled',
          cancelledAt: event.timestamp,
          cancelReason: event.reason,
        });
        break;
    }
  }
}
```

The read model schema is driven by the query, not the domain model. If the dashboard needs `customerName` alongside `orderId`, the projection denormalizes it at write time rather than joining at read time.

## Denormalization Patterns

**Eager denormalization** copies data from related aggregates into the read model during projection. When `CustomerNameChanged` fires, every read model that displays customer names must be updated. This trades write amplification for zero-cost reads.

**Lookup enrichment** resolves references at projection time by querying another read model. The `OrderPlaced` event carries `customerId`; the projection looks up the current customer name from the customer read model and stores it. Simpler than subscribing to customer events, but introduces a read dependency in the write path of the projection.

**Lazy denormalization** stores only IDs and resolves references at query time. Minimizes write amplification but adds latency to every read. Rarely the right choice in high-throughput read scenarios.

## Multi-Model Composition

Complex UIs often need data from several read models. Two approaches:

**Backend composition** — an API gateway or BFF (Backend for Frontend) queries multiple read models and assembles the response. The read models stay focused; the composition logic lives at the edge.

**Single fat read model** — one projection consumes events from many aggregates and builds a monolithic view. Simpler query path, but the projection becomes a maintenance hotspot and a rebuild bottleneck.

Prefer backend composition when read models serve multiple consumers with different needs. Use fat read models for high-traffic, latency-sensitive endpoints where the composition overhead is unacceptable.

## Rebuild Strategies

Read models are disposable. Rebuilding is a first-class operation, not a disaster recovery procedure.

**Full rebuild** deletes the read model and replays all events. Simple but slow for large event stores. Appropriate during development and for low-volume systems.

**Blue-green rebuild** provisions a new read model instance, replays events into it, then switches traffic. Zero-downtime schema migrations. Requires double the storage temporarily.

**Incremental rebuild** replays events from a checkpoint, applying only the delta. Works when the schema change is additive (new columns) but breaks when existing columns change meaning.

## Technology Choices

Read models are polyglot by design. A single system might project into PostgreSQL (transactional queries), Elasticsearch (full-text search), Redis (low-latency lookups), and ClickHouse (analytics). Each projection writes to the store that best serves its query pattern. The event store is the single source of truth; the read stores are disposable caches with different trade-off profiles.

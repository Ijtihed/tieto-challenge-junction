---
id: "cqrs-core-concepts"
paradigm: cqrs
title: "CQRS Fundamentals"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/core-concepts"
---

# CQRS Fundamentals

CQRS (Command Query Responsibility Segregation) separates a system's write path from its read path at the model level. Commands mutate state and return no data; queries return data and cause no side effects. This isn't merely an interface convention — it's a deployment and scaling boundary. The write model optimizes for invariant enforcement and transactional consistency; the read model optimizes for query shape and latency.

## The Split

In a traditional CRUD architecture, a single model serves both reads and writes. CQRS breaks this into two distinct object models backed (optionally) by separate stores:

```typescript
interface CommandHandler<C extends Command> {
  handle(command: C): Promise<void>;
}

interface QueryHandler<Q extends Query, R> {
  handle(query: Q): Promise<R>;
}
```

Commands are imperative (`PlaceOrder`, `CancelSubscription`). They carry intent, not state. The command handler loads the aggregate, validates invariants, and emits events. Queries are declarative (`GetOrderSummary`, `ListActiveSubscriptions`). They hit a read-optimized store — often denormalized, possibly a different database entirely.

## Event Stores

When CQRS is paired with Event Sourcing, the write side persists events rather than current state. The event store is an append-only log keyed by aggregate ID:

```typescript
interface EventStore {
  append(streamId: string, events: DomainEvent[], expectedVersion: number): Promise<void>;
  read(streamId: string, fromVersion?: number): AsyncIterable<DomainEvent>;
}
```

The `expectedVersion` parameter enforces optimistic concurrency — if another writer has appended since the aggregate was loaded, the write fails with a concurrency conflict. This is the primary consistency mechanism in event-sourced systems and eliminates the need for pessimistic locks in most domains.

## When CQRS Pays Off

CQRS adds structural complexity. It's justified when:

- **Read/write asymmetry is extreme.** Most systems are 90%+ reads. Separate models let you scale and optimize each side independently.
- **Multiple read representations exist.** A single write model projects into several read models (dashboard view, search index, analytics pipeline).
- **Domain complexity demands it.** Rich invariants on the write side coexist with complex query shapes on the read side. A single model serving both becomes a maintenance liability.
- **Audit and temporal queries are required.** Event sourcing gives you a complete history for free; rebuilding state at any point in time is a replay operation.

CQRS does not require Event Sourcing, and Event Sourcing does not require CQRS. They compose well but are independently useful. A CQRS system can use a relational write store with change-data-capture feeding read models. An event-sourced system can serve reads directly from replayed state without a separate read model.

## Anti-Patterns

Applying CQRS to simple CRUD domains adds accidental complexity with no payoff. If your domain has no invariants beyond "field X is required" and your reads mirror your writes, a single model suffices. CQRS also fails when teams treat the command side as a thin pass-through that just persists events — the command handler *is* the domain logic; skipping invariant validation produces a fancy append-only log with no consistency guarantees.

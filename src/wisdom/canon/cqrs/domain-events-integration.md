---
id: "cqrs-domain-events-integration"
paradigm: cqrs
title: "Domain Events vs Integration Events"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/domain-events-integration"
---

# Domain Events vs Integration Events

Not all events are the same. Domain events and integration events serve fundamentally different purposes, have different schemas, different audiences, and different delivery guarantees. Conflating them is one of the most common architectural mistakes in event-driven systems.

## Domain Events

A domain event records something that happened within a bounded context. It is the source of truth for state changes, consumed primarily by projections, sagas, and process managers within the same context.

```typescript
interface OrderPlaced {
  type: 'OrderPlaced';
  orderId: string;
  customerId: string;
  lines: Array<{ productId: string; qty: number; unitPrice: number }>;
  discountApplied: number;
  version: number;
  timestamp: string;
}
```

Domain events are fine-grained, carry internal identifiers, expose domain-specific structure, and evolve with the domain model. They are not designed for external consumption — their schema is an internal implementation detail.

## Integration Events

An integration event is a published contract between bounded contexts (or between services). It communicates what happened in terms that external consumers can understand without knowledge of the publishing context's internals.

```typescript
interface OrderAcceptedIntegration {
  type: 'order.accepted.v1';
  orderId: string;
  customerReference: string;
  totalAmount: { value: number; currency: string };
  acceptedAt: string;
}
```

Key differences from domain events:
- **Coarser-grained.** An integration event summarizes multiple domain events. Five internal events (OrderCreated, LineAdded, LineAdded, DiscountApplied, OrderSubmitted) become one integration event (OrderAccepted).
- **Stable schema.** Integration events are versioned public contracts. Breaking changes require a new version with a migration path for consumers.
- **External identifiers.** Integration events use references meaningful to consumers (`customerReference`), not internal IDs (`customerId: uuid`).
- **Explicit versioning in the type.** The `v1` suffix signals the contract version. Consumers subscribe to specific versions.

## Publishing Patterns

Domain events are recorded in the event store as part of aggregate state transitions. Integration events are published to a message broker (Kafka, RabbitMQ, SNS) for cross-context consumption. The two stores are separate concerns.

**Direct translation:** a projection listens to domain events and publishes integration events. The projection is the translation layer.

```typescript
class OrderIntegrationPublisher {
  async apply(event: DomainEvent, broker: MessageBroker): Promise<void> {
    if (event.type === 'OrderSubmitted') {
      const order = await this.readModel.get(event.orderId);
      await broker.publish('order.accepted.v1', {
        orderId: order.id,
        customerReference: order.externalCustomerRef,
        totalAmount: { value: order.total, currency: order.currency },
        acceptedAt: event.timestamp,
      });
    }
  }
}
```

**Outbox pattern:** the translation writes the integration event to an outbox table in the same transaction as the domain event. A relay process publishes from the outbox. This guarantees at-least-once delivery without distributed transactions.

## Anti-Patterns

**Publishing domain events directly to external consumers.** This couples your internal schema to external contracts. Any domain model refactoring becomes a breaking change for all consumers.

**One-to-one mapping.** Not every domain event produces an integration event. Internal bookkeeping events (SnapshotTaken, CacheInvalidated) have no external significance. The translation layer filters and aggregates.

**Fat integration events.** Including the entire aggregate state in every integration event couples consumers to your data model. Publish only what consumers need to react. Consumers that need more can call back via an API.

**Bidirectional coupling.** If service A publishes integration events that service B consumes, and service B publishes events that A consumes, you have a cycle. This creates deployment coupling and distributed deadlocks. Introduce an intermediary or redesign the context boundaries.

## Delivery Guarantees

Domain events within a context benefit from the event store's transactional guarantees — they are persisted atomically with the aggregate state change. Integration events cross process boundaries, so at-most-once or at-least-once delivery is the realistic contract. Design consumers to be idempotent: processing the same integration event twice must produce the same result.

Exactly-once delivery is a myth at the transport level. Exactly-once *processing* is achievable by combining at-least-once delivery with idempotent consumers that deduplicate by event ID.

## Event Schemas as Contracts

Treat integration event schemas like API contracts. Use a schema registry (Avro, JSON Schema, Protobuf) to enforce backward compatibility. Publish schema changes through the same review process as API changes. Integration events are your system's external interface — they deserve the same rigor as REST or gRPC contracts.
